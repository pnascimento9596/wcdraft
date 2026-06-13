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
//   current_prod_t1     — a valid `t1.` token stamped with anchors read from a
//                         real shipped manifest commit (current production
//                         runtime-data-2.0.0 / engine-2026.06.12 era).
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
import { execFileSync } from "node:child_process";
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

// Shipped production manifest used for the live-today t1 skew case. The
// explicit commit keeps fixture regeneration stable even after origin/main
// moves; this is a real git artifact, not invented anchors.
const CURRENT_PROD_MANIFEST_COMMIT = "c174775d223d8776f8950749b50a0e6099ca456b";

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

type ShippedManifest = {
  schema_version: string;
  dataset_version: string;
  rating_version_historical: string;
  rating_version_projected: string;
  engine_version: string;
  ruleset_version: string;
  bundles: { draft_pool: { sha256: string }; scenario_2026: { sha256: string } };
};

function shippedManifestAt(commit: string): ShippedManifest {
  const raw = execFileSync(
    "git",
    ["show", `${commit}:packages/data/src/generated/manifest.json`],
    { encoding: "utf8" },
  );
  return JSON.parse(raw) as ShippedManifest;
}

function manifestAnchors(manifest: ShippedManifest) {
  return {
    sv: manifest.schema_version,
    dv: manifest.dataset_version,
    rv: `${manifest.rating_version_historical}+${manifest.rating_version_projected}`,
    ev: manifest.engine_version,
    uv: manifest.ruleset_version,
    hv: `${manifest.bundles.draft_pool.sha256}+${manifest.bundles.scenario_2026.sha256}`,
  };
}

const gameData = buildGameDataFromBundles();
const origin = buildOriginRecord(gameData, "wcdraft:token-skew-fixture:v1:3");
const currentBody: RunTokenV2Body = buildRunTokenBody(origin);
const currentProdAnchors = manifestAnchors(shippedManifestAt(CURRENT_PROD_MANIFEST_COMMIT));

// 1 — prev-build t1.
const prevT1: RunTokenV1Body = {
  v: 1,
  rid: currentBody.rid,
  fid: currentBody.fid,
  ps: currentBody.ps,
  tn: currentBody.tn,
  md: currentBody.md,
  pl: currentBody.pl.map((p) =>
    p.k === "m" ? { k: "m" as const } : { k: "p" as const, c: p.c, s: p.s },
  ),
  ...PREV,
};

// 1b — current production t1. Current prod still emitted t1 tokens, so this
// fixture strips t2-only config fields and stamps the real shipped anchors.
const currentProdT1: RunTokenV1Body = {
  ...prevT1,
  ...currentProdAnchors,
};

// 2 — prev-build t2 default config.
const prevT2Default: RunTokenV2Body = { ...currentBody, ...PREV };

// 3 — prev-build t2 NON-default config (position_first + modern, ts everywhere).
const prevT2NonDefault: RunTokenV2Body = {
  ...currentBody,
  ...PREV,
  df: "position_first",
  ef: { id: "modern", min: 2018, max: 2026 },
  pl: currentBody.pl.map((p) =>
    p.k === "m" ? { k: "m" as const, ts: "manager" as const } : { ...p, ts: p.s },
  ),
};

// 4 — current-anchor t2 with era bounds tampered AFTER encode.
const tampered: RunTokenV2Body = JSON.parse(JSON.stringify(currentBody)) as RunTokenV2Body;
tampered.ef = { id: "all_time", min: 1900, max: 2026 };

const fixtures = {
  _comment:
    "Draft-config skew token fixtures. prev_* cases pin dead anchors; current_prod_t1 derives anchors from a shipped git manifest; tampered_current_t2 must fail decode regardless of anchors. Regen: pnpm --filter @wcdraft/web gen:token-skew",
  prev_anchors: PREV,
  current_prod_source: {
    manifest_commit: CURRENT_PROD_MANIFEST_COMMIT,
    anchors: currentProdAnchors,
  },
  prev_t1: { token: "t1." + b64url(JSON.stringify(prevT1)) },
  current_prod_t1: { token: "t1." + b64url(JSON.stringify(currentProdT1)) },
  prev_t2_default: { token: "t2." + b64url(JSON.stringify(prevT2Default)) },
  prev_t2_nondefault: { token: "t2." + b64url(JSON.stringify(prevT2NonDefault)) },
  tampered_current_t2: { token: "t2." + b64url(JSON.stringify(tampered)) },
};

// ── Self-checks — refuse to write fixtures the decoder disagrees with ───────
for (const key of ["prev_t1", "current_prod_t1", "prev_t2_default", "prev_t2_nondefault"] as const) {
  const decoded = decodeRunToken(fixtures[key].token);
  if (decoded === null) throw new Error(`self-check failed: ${key} must decode`);
}
if (decodeRunToken(fixtures.tampered_current_t2.token) !== null) {
  throw new Error("self-check failed: tampered_current_t2 must NOT decode");
}

writeFileSync(OUT, JSON.stringify(fixtures, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT}`);
