// F-4 U4 — submit-affordance state tests: wire→phase mapping for EVERY
// outcome the route can produce, single-sourced copy-table exhaustiveness,
// Retry-After handling, and the best-effort local memory (token dedupe +
// last-used name) incl. storage-less environments.

import { afterEach, describe, expect, it } from "vitest";

import { SUBMIT_ERROR_HTTP_STATUS, type SubmitErrorCode } from "../validate";
import {
  NAME_HINT,
  SUBMIT_STATUS_COPY,
  SUBMIT_UNEXPECTED_COPY,
  submitStatusCopy,
} from "../submit-copy";
import {
  loadLastDisplayName,
  outcomeFromResponse,
  rememberTokenSubmitted,
  saveLastDisplayName,
  tokenMemoryKey,
  wasTokenSubmitted,
  LAST_NAME_KEY,
  SUBMITTED_TOKENS_KEY,
} from "../submit-state";
import type { DisplayNameRejection } from "../display-name";

const ENTRY = {
  id: "e1",
  season_key: "s",
  mode: "casual",
  draft_mode: "classic",
  draft_order: "squad_first",
  era: "all_time",
  rating_basis: "career",
  display_name: "golden_xi",
  verified_score: 42,
  score_breakdown: [],
  created_at: "2026-06-10T12:00:00.000Z",
};

describe("outcomeFromResponse — every state maps 1:1 to a server response", () => {
  it("201 → accepted with same-snapshot rank + verified score", () => {
    const p = outcomeFromResponse(201, { entry: ENTRY, duplicate: false, rank: 4 }, null);
    expect(p).toEqual({
      kind: "accepted",
      rank: 4,
      score: 42,
      percentile: null,
      fieldSize: 0,
    });
  });

  it("201 with null rank stays honest (no invented rank)", () => {
    const p = outcomeFromResponse(201, { entry: ENTRY, duplicate: false, rank: null }, null);
    expect(p).toMatchObject({ kind: "accepted", rank: null });
  });

  it("200 → duplicate (already on the board) with existing rank", () => {
    const p = outcomeFromResponse(200, { entry: ENTRY, duplicate: true, rank: 7 }, null);
    expect(p).toEqual({
      kind: "duplicate",
      rank: 7,
      score: 42,
      percentile: null,
      fieldSize: 0,
    });
  });

  it("success bodies preserve percentile + field size for daily standing copy", () => {
    const p = outcomeFromResponse(
      201,
      { entry: ENTRY, duplicate: false, rank: 2, percentile: 50, field_size: 12 },
      null,
    );
    expect(p).toMatchObject({
      kind: "accepted",
      rank: 2,
      percentile: 50,
      fieldSize: 12,
    });
  });

  it("DIFFERENT_BUILD → rejected with the different-build copy", () => {
    const p = outcomeFromResponse(
      SUBMIT_ERROR_HTTP_STATUS.DIFFERENT_BUILD,
      { error: "DIFFERENT_BUILD", mismatched_anchors: ["dataset_version"] },
      null,
    );
    expect(p.kind).toBe("rejected");
    if (p.kind !== "rejected") return;
    expect(p.code).toBe("DIFFERENT_BUILD");
    expect(p.copy).toBe(SUBMIT_STATUS_COPY.DIFFERENT_BUILD);
    expect(p.copy.title).toBe("Different build");
    expect(p.copy.message).toMatch(/different build/i);
    expect(p.copy.message).not.toMatch(/season/i);
  });

  it("WRONG_SEASON → rejected with the different-season copy", () => {
    const p = outcomeFromResponse(
      SUBMIT_ERROR_HTTP_STATUS.WRONG_SEASON,
      { error: "WRONG_SEASON" },
      null,
    );
    expect(p.kind).toBe("rejected");
    if (p.kind !== "rejected") return;
    expect(p.code).toBe("WRONG_SEASON");
    expect(p.copy).toBe(SUBMIT_STATUS_COPY.WRONG_SEASON);
    expect(p.copy.title).toBe("Different season");
    expect(p.copy.message).toMatch(/season/i);
  });

  it("INVALID_NAME carries the mirrored category hint", () => {
    const p = outcomeFromResponse(
      422,
      { error: "INVALID_NAME", name_reason: "blocked_term" },
      null,
    );
    expect(p).toMatchObject({
      kind: "rejected",
      code: "INVALID_NAME",
      nameHint: NAME_HINT.blocked_term,
    });
  });

  it("RATE_LIMITED respects Retry-After (and survives its absence)", () => {
    const withHeader = outcomeFromResponse(429, { error: "RATE_LIMITED" }, "30");
    expect(withHeader).toMatchObject({ kind: "rejected", retryAfterSeconds: 30 });
    const withoutHeader = outcomeFromResponse(429, { error: "RATE_LIMITED" }, null);
    expect(withoutHeader).toMatchObject({ kind: "rejected", retryAfterSeconds: null });
    const garbageHeader = outcomeFromResponse(429, { error: "RATE_LIMITED" }, "soon");
    expect(garbageHeader).toMatchObject({ kind: "rejected", retryAfterSeconds: null });
  });

  it("RATE_LIMIT_UNAVAILABLE (503) also respects Retry-After so clients do not retry-storm", () => {
    const withHeader = outcomeFromResponse(
      503,
      { error: "RATE_LIMIT_UNAVAILABLE", correlation_id: "00000000-0000-4000-8000-000000000099" },
      "60",
    );
    expect(withHeader).toMatchObject({
      kind: "rejected",
      code: "RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 60,
    });
    // Must not look like a free "try again immediately" success path.
    expect(withHeader.kind).toBe("rejected");
  });

  it("every route-producible code maps to rejected with its table copy", () => {
    for (const code of Object.keys(SUBMIT_ERROR_HTTP_STATUS) as SubmitErrorCode[]) {
      const p = outcomeFromResponse(SUBMIT_ERROR_HTTP_STATUS[code], { error: code }, null);
      expect(p.kind).toBe("rejected");
      if (p.kind !== "rejected") continue;
      expect(p.code).toBe(code);
      expect(p.copy).toBe(SUBMIT_STATUS_COPY[code]);
    }
  });

  it("unknown code / non-JSON body fall back honestly (never success)", () => {
    const unknown = outcomeFromResponse(418, { error: "FUTURE_CODE" }, null);
    expect(unknown).toMatchObject({ kind: "rejected", copy: SUBMIT_UNEXPECTED_COPY });
    const noBody = outcomeFromResponse(500, null, null);
    expect(noBody).toMatchObject({ kind: "rejected", code: "INTERNAL_ERROR" });
    // A 2xx without a parseable body is NOT success — no fabricated rank.
    const broken200 = outcomeFromResponse(200, null, null);
    expect(broken200.kind).toBe("rejected");
  });
});

describe("status table — single-sourced and exhaustive", () => {
  it("covers every pipeline + gate code with non-empty honest copy", () => {
    for (const code of Object.keys(SUBMIT_ERROR_HTTP_STATUS) as SubmitErrorCode[]) {
      const copy = SUBMIT_STATUS_COPY[code];
      expect(copy, `missing copy for ${code}`).toBeDefined();
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
    }
  });

  it("covers the route transport codes", () => {
    for (const code of ["UNSUPPORTED_MEDIA_TYPE", "BODY_TOO_LARGE", "INTERNAL_ERROR"] as const) {
      expect(SUBMIT_STATUS_COPY[code].message.length).toBeGreaterThan(0);
    }
  });

  it("covers every display-name rejection category with a hint", () => {
    const categories: DisplayNameRejection[] = [
      "not_a_string",
      "too_short",
      "too_long",
      "invalid_chars",
      "blocked_term",
    ];
    for (const c of categories) expect(NAME_HINT[c].length).toBeGreaterThan(0);
  });

  it("submitStatusCopy falls back for unknown codes", () => {
    expect(submitStatusCopy("NOT_A_CODE")).toBe(SUBMIT_UNEXPECTED_COPY);
    expect(submitStatusCopy("WRONG_SEASON")).toBe(SUBMIT_STATUS_COPY.WRONG_SEASON);
  });
});

describe("local memory", () => {
  it("tokenMemoryKey is deterministic and content-sensitive", () => {
    expect(tokenMemoryKey("t1.abc")).toBe(tokenMemoryKey("t1.abc"));
    expect(tokenMemoryKey("t1.abc")).not.toBe(tokenMemoryKey("t1.abd"));
    expect(tokenMemoryKey("t1.abc", "casual")).not.toBe(tokenMemoryKey("t1.abc", "ranked"));
  });

  it("no window → safe no-ops (never throws, never claims submitted)", () => {
    expect(typeof window).toBe("undefined");
    expect(loadLastDisplayName()).toBe("");
    expect(wasTokenSubmitted("t1.x")).toBe(false);
    expect(() => {
      saveLastDisplayName("golden_xi");
      rememberTokenSubmitted("t1.x");
    }).not.toThrow();
  });

  describe("with a window/localStorage stub", () => {
    const store = new Map<string, string>();
    const stub = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };

    afterEach(() => {
      store.clear();
      delete (globalThis as Record<string, unknown>).window;
    });

    function install(): void {
      (globalThis as Record<string, unknown>).window = stub;
    }

    it("remembers the last-used display name (not a secret)", () => {
      install();
      saveLastDisplayName("golden_xi");
      expect(loadLastDisplayName()).toBe("golden_xi");
      expect(store.get(LAST_NAME_KEY)).toBe("golden_xi");
    });

    it("remembers submitted tokens and caps the list", () => {
      install();
      expect(wasTokenSubmitted("t1.one")).toBe(false);
      rememberTokenSubmitted("t1.one");
      expect(wasTokenSubmitted("t1.one")).toBe(true);
      expect(wasTokenSubmitted("t1.one", "ranked")).toBe(false);
      rememberTokenSubmitted("t1.one", "ranked");
      expect(wasTokenSubmitted("t1.one", "ranked")).toBe(true);
      expect(wasTokenSubmitted("t1.two")).toBe(false);

      for (let i = 0; i < 60; i++) rememberTokenSubmitted(`t1.fill-${i}`);
      const keys = JSON.parse(store.get(SUBMITTED_TOKENS_KEY)!) as string[];
      expect(keys.length).toBeLessThanOrEqual(50);
      // Oldest evicted first — the original token aged out.
      expect(wasTokenSubmitted("t1.one")).toBe(false);
      expect(wasTokenSubmitted("t1.fill-59")).toBe(true);
    });

    it("corrupt stored JSON degrades to empty, never throws", () => {
      install();
      store.set(SUBMITTED_TOKENS_KEY, "{not json");
      expect(wasTokenSubmitted("t1.x")).toBe(false);
      rememberTokenSubmitted("t1.x");
      expect(wasTokenSubmitted("t1.x")).toBe(true);
    });
  });
});
