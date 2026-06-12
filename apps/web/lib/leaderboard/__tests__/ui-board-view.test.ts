// F-4 U4 — pure board view-model tests: relative time, breakdown evidence
// validation, row views (me-highlight), keyset load-more accumulation
// (pagination walk), query-string building, season label.

import { describe, expect, it } from "vitest";

import {
  appendBoardPage,
  boardQueryString,
  boardRowViews,
  breakdownLines,
  relativeTimeLabel,
  seasonLabel,
  EMPTY_BOARD,
  type BoardEntryWire,
  type BoardPageWire,
} from "../board-view";

const NOW = Date.parse("2026-06-10T12:00:00.000Z");

function entry(over: Partial<BoardEntryWire> & { id: string; rank: number }): BoardEntryWire {
  return {
    draft_mode: "classic",
    display_name: `manager_${over.rank}`,
    verified_score: 100 - over.rank,
    score_breakdown: [{ label: "Goals scored", raw: 2, weight: 3, points: 6 }],
    created_at: new Date(NOW - 3_600_000).toISOString(),
    ...over,
  };
}

function page(entries: BoardEntryWire[], nextCursor: string | null): BoardPageWire {
  return {
    season_key: "s",
    current_season_key: "s",
    entries,
    next_cursor: nextCursor,
  };
}

describe("relativeTimeLabel", () => {
  it("buckets honestly: just now → m → h → d → date", () => {
    expect(relativeTimeLabel(NOW, new Date(NOW - 10_000).toISOString())).toBe("just now");
    expect(relativeTimeLabel(NOW, new Date(NOW - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTimeLabel(NOW, new Date(NOW - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relativeTimeLabel(NOW, new Date(NOW - 2 * 86_400_000).toISOString())).toBe("2d ago");
    expect(relativeTimeLabel(NOW, "2026-01-01T00:00:00.000Z")).toBe("1 Jan 2026");
  });

  it("future or unparseable timestamps render the honest dash", () => {
    expect(relativeTimeLabel(NOW, new Date(NOW + 60_000).toISOString())).toBe("—");
    expect(relativeTimeLabel(NOW, "not-a-date")).toBe("—");
  });
});

describe("breakdownLines (evidence validation)", () => {
  it("accepts the persisted ScoreComponent shape", () => {
    const lines = breakdownLines([
      { label: "Goals scored", raw: 2, weight: 3, points: 6 },
      { label: "Goal difference", raw: -2, weight: 1, points: -2 },
    ]);
    expect(lines).toEqual([
      { label: "Goals scored", points: 6 },
      { label: "Goal difference", points: -2 },
    ]);
  });

  it("anything off-shape is absent — never fabricated", () => {
    expect(breakdownLines(null)).toBeNull();
    expect(breakdownLines([])).toBeNull();
    expect(breakdownLines("x")).toBeNull();
    expect(breakdownLines([{ label: "ok", points: "6" }])).toBeNull();
    expect(breakdownLines([{ points: 6 }])).toBeNull();
    expect(breakdownLines([{ label: "ok", points: 6 }, null])).toBeNull();
  });
});

describe("boardRowViews (me-highlight)", () => {
  const entries = [entry({ id: "a", rank: 1 }), entry({ id: "b", rank: 2, draft_mode: "hidden" })];

  it("flags exactly the caller's best entry id", () => {
    const rows = boardRowViews(entries, { nowMs: NOW, myEntryId: "b" });
    expect(rows.map((r) => r.isMine)).toEqual([false, true]);
  });

  it("no /me resolution → no highlight anywhere", () => {
    const rows = boardRowViews(entries, { nowMs: NOW, myEntryId: null });
    expect(rows.every((r) => !r.isMine)).toBe(true);
  });

  it("carries server rank/score/draft_mode verbatim", () => {
    const rows = boardRowViews(entries, { nowMs: NOW, myEntryId: null });
    expect(rows[0]).toMatchObject({ rank: 1, score: 99, draftMode: "classic" });
    expect(rows[1]).toMatchObject({ rank: 2, score: 98, draftMode: "hidden" });
  });
});

describe("appendBoardPage (pagination walk)", () => {
  it("walks pages with no overlap and threads the cursor", () => {
    const p1 = page([entry({ id: "a", rank: 1 }), entry({ id: "b", rank: 2 })], "CUR1");
    const p2 = page([entry({ id: "c", rank: 3 }), entry({ id: "d", rank: 4 })], "CUR2");
    const p3 = page([entry({ id: "e", rank: 5 })], null);

    let acc = appendBoardPage(EMPTY_BOARD, p1);
    expect(acc.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(acc.nextCursor).toBe("CUR1");

    acc = appendBoardPage(acc, p2);
    acc = appendBoardPage(acc, p3);
    expect(acc.entries.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(acc.nextCursor).toBeNull();

    // Ranks stay the server's window ranks — never recomputed client-side.
    expect(acc.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drops already-present ids defensively (replayed cached page)", () => {
    const p1 = page([entry({ id: "a", rank: 1 })], "CUR1");
    const replay = page([entry({ id: "a", rank: 1 }), entry({ id: "b", rank: 2 })], null);
    const acc = appendBoardPage(appendBoardPage(EMPTY_BOARD, p1), replay);
    expect(acc.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("boardQueryString", () => {
  it("'all' sends no draft_mode (server default view)", () => {
    expect(boardQueryString({ draftMode: "all", cursor: null })).toBe("");
  });
  it("filter + cursor compose", () => {
    expect(boardQueryString({ draftMode: "hidden", cursor: null })).toBe("?draft_mode=hidden");
    expect(boardQueryString({ draftMode: "classic", cursor: "C 1" })).toBe(
      "?draft_mode=classic&cursor=C+1",
    );
  });
});

describe("seasonLabel", () => {
  it("leads with dataset · engine from the derived key", () => {
    expect(
      seasonLabel(
        "engine-2026.06.11_wc-perf-4.2.1+proj-career-3.0.0_2026-06-04_ruleset-2026.06.04_f166edc0",
      ),
    ).toBe("2026-06-04 · engine-2026.06.11");
  });
  it("falls back to the raw key when the shape is unexpected", () => {
    expect(seasonLabel("weird")).toBe("weird");
  });
});
