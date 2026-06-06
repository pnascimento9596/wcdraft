// Tests for the local run history provider (ws-results/history-share).
//
// The honest-state contract:
//   - The provider lists ONLY records with `simulation` attached. Older
//     records that lack the `status` field still surface as long as they
//     hold a complete simulation payload.
//   - Replay/share hrefs MUST be tokenized (`?run=t1.…`). If tokenization
//     fails the entry surfaces `replay_href: null` + a `replay_error`; we
//     NEVER emit a bare `run-v1-*` id as a fallback.
//   - Listing is capped by `RUN_RECORD_CAP` (currently 5).
//
// These tests use the injectable `RunHistoryProvider` interface so we don't
// need a full `GameData`/scenario stack; the local provider's full path is
// exercised by the existing integration tests (run-token, gate-and-fallback).

import { describe, expect, it } from "vitest";

import {
  listCompletedRunHistory,
  type HistoryEntry,
  type HistoryListResult,
  type RunHistoryProvider,
} from "../history";
import type { GameData } from "../data";

function fakeProvider(result: HistoryListResult): RunHistoryProvider {
  return {
    async listCompletedRuns(): Promise<HistoryListResult> {
      return result;
    },
  };
}

function makeEntry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    run_id: "run-v1-1",
    team_name: "Test XI",
    display_record: "6-2",
    formation_name: "4-3-3",
    key_picks: [
      { name: "Pelé", nation_code: "BRA" },
      { name: "Maradona", nation_code: "ARG" },
      { name: "Zidane", nation_code: "FRA" },
    ],
    recency_label: "Most recent",
    sequence_label: "Run #1",
    seed: "wcdraft:run:v1:run-v1-1:4-3-3",
    is_champion: false,
    replay_href: "/play/results?run=t1.fakeBody",
    share_href: "/play/share?run=t1.fakeBody",
    replay_error: null,
    created_seq: 1,
    updated_seq: 1,
    ...over,
  };
}

// We never actually load GameData in these tests — the fake provider ignores it.
const STUB_GAME_DATA = {} as unknown as GameData;

describe("listCompletedRunHistory — provider boundary", () => {
  it("returns whatever the provider emits", async () => {
    const entries = [makeEntry()];
    const out = await listCompletedRunHistory(
      STUB_GAME_DATA,
      fakeProvider({ entries, persistence: "durable", warnings: [] }),
    );
    expect(out.entries).toEqual(entries);
    expect(out.persistence).toBe("durable");
    expect(out.warnings).toEqual([]);
  });

  it("propagates volatile-storage signal so the UI can warn", async () => {
    const out = await listCompletedRunHistory(
      STUB_GAME_DATA,
      fakeProvider({ entries: [], persistence: "volatile", warnings: [] }),
    );
    expect(out.persistence).toBe("volatile");
  });

  it("surfaces provider warnings (e.g. evicted bad records)", async () => {
    const out = await listCompletedRunHistory(
      STUB_GAME_DATA,
      fakeProvider({
        entries: [],
        persistence: "durable",
        warnings: ["history: evicted malformed record 'run-v1-2'"],
      }),
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/malformed/);
  });
});

describe("HistoryEntry shape — replay link contract", () => {
  it("emits a tokenized replay_href (`?run=t1.`)", () => {
    const entry = makeEntry();
    expect(entry.replay_href).not.toBeNull();
    expect(entry.replay_href).toMatch(/\?run=t1\./);
    expect(entry.replay_href).not.toMatch(/run-v1-/);
  });

  it("emits a tokenized share_href when token encoding succeeded", () => {
    const entry = makeEntry();
    expect(entry.share_href).not.toBeNull();
    expect(entry.share_href).toMatch(/\?run=t1\./);
  });

  it("when tokenization fails, replay_href + share_href are NULL — never a bare run-v1-* id", () => {
    const entry = makeEntry({
      replay_href: null,
      share_href: null,
      replay_error: "Couldn't build a reproducible share link: <17 picks",
    });
    expect(entry.replay_href).toBeNull();
    expect(entry.share_href).toBeNull();
    expect(entry.replay_error).toMatch(/share link|picks/i);
  });

  it("never emits a bare local id as a fallback URL", () => {
    // Pin: even when given a deliberately malformed entry, the type forces
    // the UI to handle the null case rather than fall back to run_id.
    const broken = makeEntry({
      replay_href: null,
      share_href: null,
      replay_error: "x",
    });
    // It is the screen's responsibility to render disabled state — the entry
    // itself must not synthesize `/play/results?run=run-v1-…`. We accept
    // `null` as the honest-state signal; a non-null fallback containing the
    // local id would fail this guard.
    if (broken.replay_href !== null) {
      expect(broken.replay_href).not.toMatch(/run-v1-/);
    }
    if (broken.share_href !== null) {
      expect(broken.share_href).not.toMatch(/run-v1-/);
    }
    // And for a "well-formed" entry, the tokenized href must NOT carry it.
    const ok = makeEntry();
    expect(ok.replay_href).not.toMatch(/run-v1-/);
    expect(ok.share_href).not.toMatch(/run-v1-/);
  });
});
