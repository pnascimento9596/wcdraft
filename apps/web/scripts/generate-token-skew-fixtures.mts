// DC-1 — committed PREV-skew token fixtures (plan §A fixture list).
//
// Produces `lib/game/__tests__/fixtures/run-token-skew.json` with five cases:
//
//   prev_t1             — a valid `t1.` token as the previous shipped build
//                         (engine-2026.06.08 era anchors) would have minted it.
//   prev_t2_default     — a valid `t2.` DEFAULT-config token with the same
//                         previous-build anchors.
//   prev_t2_nondefault  — a valid `t2.` NON-default token (position_first +
//                         modern, ts on every pick) with previous-build anchors.
//   shipped_pre_s2_t3   — a valid `t3.` token stamped with anchors read from
//                         the real production commit immediately before the
//                         Season 2 merge.
//   tampered_current_t2 — a CURRENT-anchor `t2.` token whose era bounds were
//                         tampered AFTER encode (must fail decode; this
//                         assertion is anchor-stable across future bumps).
//
// REGEN DISCIPLINE: tests never write this file. The three prev_* cases pin
// anchors that will never ship again, so they survive future bumps; regen is
// only needed if the pick-log shape itself evolves:
//
//   pnpm build && pnpm --filter @wcdraft/web gen:token-skew
//
// The generator self-checks every fixture against the decoder before writing.

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildGameDataFromBundles,
  buildOriginRecord,
} from "../lib/game/__tests__/run-token.test-harness";
import {
  buildRunTokenBody,
  decodeRunToken,
  type RunTokenV1Body,
  type RunTokenV2Body,
} from "../lib/game/run-token";

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../lib/game/__tests__/fixtures/run-token-skew.json",
);

// Anchors of the immediate-prior shipped build (see run-token.test.ts) —
// pinned verbatim; they can never re-ship, so skew is permanent.
const PREV = {
  sv: "runtime-data-1.0.0",
  dv: "2026-06-04",
  rv: "wc-perf-3.0.0+proj-career-2.0.0",
  ev: "engine-2026.06.08",
  uv: "ruleset-2026.06.04",
  hv: "prev-bundle-hash-fixture",
};

// Production main observed live before the Season 2 merge. The explicit commit
// keeps fixture regeneration stable after main moves; both its manifest and
// t3 codec are shipped git artifacts rather than reconstructed version labels.
const SHIPPED_PRE_S2_COMMIT = "f04559f46b43944e94a4ccfa904d8cf9c1a65231";
const SHIPPED_PRE_S2_BODY_SHA256 =
  "38aa896cef26b2c33092bea0f1a1a4feb7fce1b86043cb566b4c5d663b35b2e6";
const SHIPPED_PRE_S2_T3_TOKEN =
  "t3.eyJ2IjozLCJyaWQiOiJ0b2tlbi1vcmlnaW4iLCJmaWQiOiI0LTMtMyIsInBzIjoid2NkcmFmdDpzZWFzb24yOnByZS1tZXJnZS1maXh0dXJlOnYxIiwidG4iOiJPcmlnaW4gWEkiLCJtZCI6ImNsYXNzaWMiLCJkZiI6InNxdWFkX2ZpcnN0IiwicmIiOiJjYXJlZXIiLCJlZiI6eyJpZCI6ImFsbF90aW1lIiwibWluIjoxOTMwLCJtYXgiOjIwMjZ9LCJwbCI6W3siayI6InAiLCJjaSI6MCwicyI6IjQtMy0zLkdLIn0seyJrIjoibSJ9LHsiayI6InAiLCJjaSI6MCwicyI6IjQtMy0zLkxCIn0seyJrIjoicCIsImNpIjowLCJzIjoiNC0zLTMuTENCIn0seyJrIjoicCIsImNpIjowLCJzIjoiNC0zLTMuUkNCIn0seyJrIjoicCIsImNpIjowLCJzIjoiNC0zLTMuUkIifSx7ImsiOiJwIiwiY2kiOjAsInMiOiI0LTMtMy5DRE0ifSx7ImsiOiJwIiwiY2kiOjAsInMiOiI0LTMtMy5MQ00ifSx7ImsiOiJwIiwiY2kiOjAsInMiOiI0LTMtMy5SQ00ifSx7ImsiOiJwIiwiY2kiOjAsInMiOiI0LTMtMy5MVyJ9LHsiayI6InAiLCJjaSI6MCwicyI6IjQtMy0zLlNUIn0seyJrIjoicCIsImNpIjowLCJzIjoiNC0zLTMuUlcifSx7ImsiOiJwIiwiY2kiOjAsInMiOiJiZW5jaC4wIn0seyJrIjoicCIsImNpIjowLCJzIjoiYmVuY2guMSJ9LHsiayI6InAiLCJjaSI6MCwicyI6ImJlbmNoLjIifSx7ImsiOiJwIiwiY2kiOjAsInMiOiJiZW5jaC4zIn0seyJrIjoicCIsImNpIjowLCJzIjoiYmVuY2guNCJ9XSwic3YiOiJydW50aW1lLWRhdGEtMi4xMC4wIiwiZHYiOiIyMDI2LTA3LTAxIiwicnYiOiJ3Yy1wZXJmLTYuNi4wK3Byb2otY2FyZWVyLTUuNi4wIiwiZXYiOiJlbmdpbmUtMjAyNi4wNi4zMC1tYW5hZ2VyLWF0dHJpdGlvbiIsInV2IjoicnVsZXNldC0yMDI2LjA2LjA0IiwiaHYiOiJhZTUzNzZjOTE3Mzc3YjAwYWM5ZGVlN2ExNjZkY2FjZWIyOGRkMTQxNmZjOWZiZThiMDBiMTExNmNhOGU4ZDA3KzUwYzQ1ZDBlOWI5YjU2ODkyZTZiZDM0NjI5ODg0MTdlMDcyZWExYjA4YWZmMjA2ZmUzNDRjM2ViYWNjZDY2ZmQifQ";

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

const gameData = buildGameDataFromBundles();
const origin = buildOriginRecord(gameData, "wcdraft:token-skew-fixture:v1:3");
const currentBody = buildRunTokenBody(origin);
const plV2 = [...origin.draft.spins]
  .sort((a, b) => a.index - b.index)
  .map((spin) => {
    if (spin.picked_kind === "manager") return { k: "m" as const };
    if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
      throw new Error(`origin spin ${spin.index} is missing player pick fields`);
    }
    return { k: "p" as const, c: spin.picked_card_id as string, s: spin.assigned_slot_id };
  });
const currentBodyV2: RunTokenV2Body = {
  v: 2,
  rid: currentBody.rid,
  fid: currentBody.fid,
  ps: currentBody.ps,
  tn: currentBody.tn,
  md: currentBody.md,
  df: currentBody.df,
  rb: currentBody.rb,
  ef: currentBody.ef,
  pl: plV2,
  sv: currentBody.sv,
  dv: currentBody.dv,
  rv: currentBody.rv,
  ev: currentBody.ev,
  uv: currentBody.uv,
  hv: currentBody.hv,
};

// 1 — prev-build t1.
const prevT1: RunTokenV1Body = {
  v: 1,
  rid: currentBody.rid,
  fid: currentBody.fid,
  ps: currentBody.ps,
  tn: currentBody.tn,
  md: currentBody.md,
  pl: plV2,
  ...PREV,
};

// 2 — prev-build t2 default config.
const prevT2Default: RunTokenV2Body = { ...currentBodyV2, ...PREV };

// 3 — prev-build t2 NON-default config (position_first + modern, ts everywhere).
const prevT2NonDefault: RunTokenV2Body = {
  ...currentBodyV2,
  ...PREV,
  df: "position_first",
  ef: { id: "modern", min: 2018, max: 2026 },
  pl: plV2.map((p) =>
    p.k === "m" ? { k: "m" as const, ts: "manager" as const } : { ...p, ts: p.s },
  ),
};

// 4 — current-anchor t2 with era bounds tampered AFTER encode.
const tampered: RunTokenV2Body = JSON.parse(JSON.stringify(currentBodyV2)) as RunTokenV2Body;
tampered.ef = { id: "all_time", min: 1900, max: 2026 };

const fixtures = {
  _comment:
    "Draft-config skew token fixtures. prev_* cases pin dead anchors; shipped_pre_s2_t3 uses the t3 codec shape and anchors from production main f04559f while its deterministic run values remain test data; tampered_current_t2 must fail decode regardless of anchors. Regen: pnpm --filter @wcdraft/web gen:token-skew",
  prev_anchors: PREV,
  shipped_pre_s2_source: {
    production_main_commit: SHIPPED_PRE_S2_COMMIT,
    manifest_path: "packages/data/src/generated/manifest.json",
    codec_path: "apps/web/lib/game/run-token.ts",
    producer: "shipped build deterministic test run; not user data",
    body_sha256: SHIPPED_PRE_S2_BODY_SHA256,
  },
  prev_t1: { token: "t1." + b64url(JSON.stringify(prevT1)) },
  shipped_pre_s2_t3: { token: SHIPPED_PRE_S2_T3_TOKEN },
  prev_t2_default: { token: "t2." + b64url(JSON.stringify(prevT2Default)) },
  prev_t2_nondefault: { token: "t2." + b64url(JSON.stringify(prevT2NonDefault)) },
  tampered_current_t2: { token: "t2." + b64url(JSON.stringify(tampered)) },
};

// ── Self-checks — refuse to write fixtures the decoder disagrees with ───────
for (const key of [
  "prev_t1",
  "shipped_pre_s2_t3",
  "prev_t2_default",
  "prev_t2_nondefault",
] as const) {
  const decoded = decodeRunToken(fixtures[key].token);
  if (decoded === null) throw new Error(`self-check failed: ${key} must decode`);
}
const shippedDecoded = decodeRunToken(fixtures.shipped_pre_s2_t3.token);
if (
  shippedDecoded === null ||
  createHash("sha256").update(JSON.stringify(shippedDecoded)).digest("hex") !==
    SHIPPED_PRE_S2_BODY_SHA256
) {
  throw new Error("self-check failed: shipped_pre_s2_t3 body digest changed");
}
if (decodeRunToken(fixtures.tampered_current_t2.token) !== null) {
  throw new Error("self-check failed: tampered_current_t2 must NOT decode");
}

writeFileSync(OUT, JSON.stringify(fixtures, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT}`);
