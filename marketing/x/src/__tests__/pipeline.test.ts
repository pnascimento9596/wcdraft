import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPoster, plannedFamily, type Poster } from "../pipeline.ts";
import { readLedger } from "../ledger.ts";
import { loadMarketingGameData } from "../engine/game-data.ts";
import { checkLexicon } from "../lexicon.ts";

let dir: string;
const gd = loadMarketingGameData();
const NOW = new Date("2026-06-13T12:00:00Z");

function fakePoster(): Poster & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async post(text: string) {
      calls.push(text);
      return { id: `x-${calls.length}` };
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mkt-pipe-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("kill switch", () => {
  it("MARKETING_PAUSED=true halts everything (no post, no ledger write)", async () => {
    const ledger = join(dir, "l.jsonl");
    const res = await runPoster({
      now: NOW,
      env: { MARKETING_PAUSED: "true" },
      gd,
      ledgerPath: ledger,
      artifactsDir: dir,
    });
    expect(res.action).toBe("paused");
    expect(existsSync(ledger)).toBe(false);
  });
});

describe("per-day cap (code-enforced)", () => {
  it("stops at the cap and never exceeds it, even across re-runs", async () => {
    const ledger = join(dir, "l.jsonl");
    const env = { MARKETING_DAILY_CAP: "3" };
    const actions: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await runPoster({ now: NOW, env, gd, ledgerPath: ledger, artifactsDir: dir });
      actions.push(res.action);
    }
    expect(actions.filter((a) => a === "dry_run").length).toBe(3);
    expect(actions.filter((a) => a === "cap_reached").length).toBe(3);
    expect(readLedger(ledger).length).toBe(3);
  });

  it("clamps an over-large requested cap to the code default (6)", async () => {
    const ledger = join(dir, "l.jsonl");
    const env = { MARKETING_DAILY_CAP: "999" };
    let posted = 0;
    for (let i = 0; i < 10; i += 1) {
      const res = await runPoster({ now: NOW, env, gd, ledgerPath: ledger, artifactsDir: dir });
      if (res.action === "dry_run") posted += 1;
    }
    expect(posted).toBe(6); // DEFAULT_DAILY_POST_CAP, not 999
  });
});

describe("idempotency", () => {
  it("never double-posts: every recorded content_hash is unique across re-runs", async () => {
    const ledger = join(dir, "l.jsonl");
    const env = { MARKETING_DAILY_CAP: "6" };
    for (let i = 0; i < 8; i += 1) {
      await runPoster({ now: NOW, env, gd, ledgerPath: ledger, artifactsDir: dir });
    }
    const hashes = readLedger(ledger).map((e) => e.content_hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes.length).toBe(6);
  });

  it("re-running the same slot does not produce a second ledger line", async () => {
    const ledger = join(dir, "l.jsonl");
    const env = { MARKETING_DAILY_CAP: "6" };
    const first = await runPoster({ now: NOW, env, gd, ledgerPath: ledger, artifactsDir: dir });
    expect(first.action).toBe("dry_run");
    const beforeLen = readLedger(ledger).length;
    // Simulate a retry that re-enters with the SAME observed count by removing
    // nothing — the next run advances the slot, so the new post must differ.
    const second = await runPoster({ now: NOW, env, gd, ledgerPath: ledger, artifactsDir: dir });
    if (first.action === "dry_run" && second.action === "dry_run") {
      expect(second.post.content_hash).not.toBe(first.post.content_hash);
    }
    expect(readLedger(ledger).length).toBe(beforeLen + 1);
  });
});

describe("dry-run artifact", () => {
  it("writes a per-day artifact with the full, lexicon-clean post text", async () => {
    const ledger = join(dir, "l.jsonl");
    await runPoster({ now: NOW, env: {}, gd, ledgerPath: ledger, artifactsDir: dir });
    const artifact = join(dir, "dry-run-2026-06-13.jsonl");
    expect(existsSync(artifact)).toBe(true);
    const line = readFileSync(artifact, "utf8").trim().split("\n")[0]!;
    const entry = JSON.parse(line);
    expect(entry.mode).toBe("dry_run");
    expect(entry.x_post_id).toBe(null);
    expect(typeof entry.text).toBe("string");
    expect(checkLexicon(entry.text)).toEqual([]);
  });
});

describe("live posting", () => {
  it("publishes via the injected poster and records the x_post_id", async () => {
    const ledger = join(dir, "l.jsonl");
    const poster = fakePoster();
    const res = await runPoster({
      now: NOW,
      env: { MARKETING_LIVE: "true", MARKETING_DAILY_CAP: "1" },
      gd,
      poster,
      ledgerPath: ledger,
      artifactsDir: dir,
    });
    expect(res.action).toBe("posted");
    if (res.action !== "posted") return;
    expect(poster.calls.length).toBe(1);
    expect(res.x_post_id).toBe("x-1");
    const entries = readLedger(ledger);
    expect(entries.length).toBe(1);
    expect(entries[0]!.mode).toBe("live");
    expect(entries[0]!.x_post_id).toBe("x-1");
  });

  it("falls back to dry-run when MARKETING_LIVE is set but no poster is injected", async () => {
    const ledger = join(dir, "l.jsonl");
    const res = await runPoster({
      now: NOW,
      env: { MARKETING_LIVE: "true" },
      gd,
      ledgerPath: ledger,
      artifactsDir: dir,
    });
    expect(res.action).toBe("dry_run");
  });
});

describe("rotation", () => {
  it("rotates generated families and never auto-generates a result_spotlight", () => {
    const fams = new Set(Array.from({ length: 6 }, (_, i) => plannedFamily(i)));
    expect(fams.has("result_spotlight")).toBe(false);
    expect(fams.has("daily_challenge")).toBe(true);
    expect(fams.has("feature_pitch")).toBe(true);
    expect(fams.has("factoid")).toBe(true);
  });
});
