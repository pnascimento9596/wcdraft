// F-3 — server-backed RunHistoryProvider — fetch shape + error handling.
//
// The pglite-backed store tests already pin the security invariants. These
// tests pin the CLIENT-SIDE provider's contract: that it satisfies the
// `RunHistoryProvider` interface, doesn't leak rejection internals, and
// renders well-formed (if display-degraded) entries from the API rows.
//
// `decodeRunToken` is mocked so the tests don't need a fully drafted
// `RunRecordV1` fixture to encode a real token; the provider's
// responsibility is to map a decoded body, not to verify decoding.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServerRunHistoryProvider } from "@/lib/game/server-history-provider";
import * as runToken from "@/lib/game/run-token";
import type { GameData } from "@/lib/game/data";

const FAKE_GAME_DATA = {} as unknown as GameData;

const VALID_BODY = {
  v: 1 as const,
  rid: "run-v1-test",
  fid: "f4-3-3",
  ps: "wcdraft:run:v1:run-v1-test:f4-3-3",
  tn: "Test XI",
  md: "classic" as const,
  pl: [],
  sv: "1",
  dv: "ds-1",
  rv: "rt-1",
  ev: "eng-1",
  uv: "rs-1",
  hv: "h-1",
};

beforeEach(() => {
  vi.spyOn(runToken, "decodeRunToken").mockImplementation((s: string) =>
    s.startsWith("t1.") ? VALID_BODY : null,
  );
});

describe("createServerRunHistoryProvider", () => {
  it("returns empty entries with a warning when /api/runs throws", async () => {
    const provider = createServerRunHistoryProvider({
      fetcher: () => Promise.reject(new Error("network down")),
    });
    const result = await provider.listCompletedRuns(FAKE_GAME_DATA);
    expect(result.entries).toEqual([]);
    expect(result.persistence).toBe("volatile");
    expect(result.warnings[0]).toMatch(/network down/);
  });

  it("returns empty entries with a warning on non-2xx", async () => {
    const provider = createServerRunHistoryProvider({
      fetcher: async () => new Response("", { status: 401, statusText: "Unauthorized" }),
    });
    const result = await provider.listCompletedRuns(FAKE_GAME_DATA);
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatch(/HTTP 401/);
  });

  it("returns empty entries with a warning on malformed body", async () => {
    const provider = createServerRunHistoryProvider({
      fetcher: async () =>
        new Response(JSON.stringify({ unrelated: true }), { status: 200 }),
    });
    const result = await provider.listCompletedRuns(FAKE_GAME_DATA);
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatch(/malformed/);
  });

  it("skips rows whose token does not decode + surfaces a per-row warning", async () => {
    const provider = createServerRunHistoryProvider({
      fetcher: async () =>
        new Response(
          JSON.stringify({
            runs: [
              {
                id: "row-1",
                token: "not-a-real-token",
                run_id: null,
                parent_seed: null,
                version_anchors: null,
                claim_state: "claimed",
                created_at: new Date().toISOString(),
              },
            ],
            cap: 5,
          }),
          { status: 200 },
        ),
    });
    const result = await provider.listCompletedRuns(FAKE_GAME_DATA);
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatch(/did not decode/);
  });

  it("maps valid tokens to well-formed entries (placeholder display fields documented)", async () => {
    const provider = createServerRunHistoryProvider({
      fetcher: async () =>
        new Response(
          JSON.stringify({
            runs: [
              {
                id: "row-1",
                token: "t1.fake-body",
                run_id: VALID_BODY.rid,
                parent_seed: VALID_BODY.ps,
                version_anchors: null,
                claim_state: "claimed",
                created_at: new Date().toISOString(),
              },
            ],
            cap: 5,
          }),
          { status: 200 },
        ),
    });
    const result = await provider.listCompletedRuns(FAKE_GAME_DATA);
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0]!;
    expect(entry.run_id).toBe(VALID_BODY.rid);
    expect(entry.team_name).toBe(VALID_BODY.tn);
    expect(entry.formation_name).toBe(VALID_BODY.fid);
    expect(entry.seed).toBe(VALID_BODY.ps);
    expect(entry.replay_href).toContain("t1.fake-body");
    expect(entry.share_href).toContain("t1.fake-body");
    // Display-degraded fields the Yellow follow upgrades:
    expect(entry.display_record).toBe("—");
    expect(entry.key_picks).toEqual([]);
    expect(entry.is_champion).toBe(false);
  });

  it("caps the returned list at RUN_RECORD_CAP", async () => {
    const provider = createServerRunHistoryProvider({
      fetcher: async () =>
        new Response(
          JSON.stringify({
            runs: Array.from({ length: 50 }, (_, i) => ({
              id: `row-${i.toString()}`,
              token: `t1.fake-${i.toString()}`,
              run_id: `run-v1-${i.toString()}`,
              parent_seed: null,
              version_anchors: null,
              claim_state: "claimed",
              created_at: new Date().toISOString(),
            })),
            cap: 5,
          }),
          { status: 200 },
        ),
    });
    const result = await provider.listCompletedRuns(FAKE_GAME_DATA);
    expect(result.entries.length).toBeLessThanOrEqual(5);
  });

  it("persistence is 'durable' on success (rows live in Neon, not browser storage)", async () => {
    const provider = createServerRunHistoryProvider({
      fetcher: async () =>
        new Response(JSON.stringify({ runs: [], cap: 5 }), { status: 200 }),
    });
    const result = await provider.listCompletedRuns(FAKE_GAME_DATA);
    expect(result.persistence).toBe("durable");
  });
});
