import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { inflateSync } from "node:zlib";

import { buildNarrative } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRunTokenOgSummary,
  decodeRunToken,
  encodeRunToken,
  RUN_TOKEN_PREFIX,
  type RunTokenV3Body,
} from "../run-token";
import type { RunRecordV1 } from "../run-record";
import { runSimulationSync } from "../simulate";
import { defaultRunOgImage, formatRunOgResult, shareOgImageForRunValue } from "../run-og-metadata";
import { buildRunOgModelFromTrustedSummary } from "../run-og-model";
import { renderRunOgImage, type RunOgImageAssets } from "../run-og-image";
import { verifyRunTokenForOg } from "../run-og-server";
import { buildNarrativeLabels } from "../results-adapters";
import { buildShareView } from "../share-adapters";
import {
  allowAllRunOgSignRateLimiter,
  createDbRunOgSignRateLimiter,
  type RunOgSignRateLimiter,
} from "../run-og-sign-rate-limiter-db";
import {
  LEGACY_SIGNED_RUN_OG_PREFIX,
  LEGACY_SIGNED_RUN_OG_VERSION,
  SIGNED_RUN_OG_PREFIX,
  SIGNED_RUN_OG_VERSION,
  assertOgSigningSecretPresent,
  sha256Hex,
  signRunOgPayload,
  verifySignedRunOgPayload,
  type SignedRunOgPayload,
} from "../run-og-signing";
import { GET as runOgHealthGet } from "../../../app/api/og/health/route";
import { GET as runOgRouteGet } from "../../../app/api/og/run/route";
import { handleRunOgSignPost, POST as runOgSignRoutePost } from "../../../app/api/og/sign/route";
import { setupTestDb } from "../../auth/__tests__/_test-db";

import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";
import skewFixtures from "./fixtures/run-token-skew.json" with { type: "json" };

const gameData = buildGameDataFromBundles();
const origin = buildOriginRecord(gameData);
const SECRET = "run-og-test-secret-32-bytes-minimum";
const TRUSTED_IMAGE_CACHE = "public, max-age=31536000, immutable";
const { db: ogRateDb, pg: ogRatePg, reset: resetOgRateDb } = await setupTestDb();
type V3WithVestigialOg = RunTokenV3Body & { og?: unknown };

afterAll(async () => ogRatePg.close());

beforeEach(async () => {
  await resetOgRateDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function complete(record: RunRecordV1 = origin): RunRecordV1 {
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
  return { ...record, status: "complete", simulation };
}

function encodeBody(body: unknown, prefix = "t3."): string {
  return prefix + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function decodeV3(token: string): RunTokenV3Body {
  const decoded = decodeRunToken(token);
  if (!decoded || decoded.v !== 3) throw new Error("expected a t3 token");
  return decoded;
}

async function signedOgForToken(token: string): Promise<string> {
  const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
  if (verified.status !== "accepted") throw new Error(`token did not verify: ${verified.reason}`);
  const payload: SignedRunOgPayload = {
    v: SIGNED_RUN_OG_VERSION,
    token_hash: await sha256Hex(token),
    versions: gameData.versions,
    model: verified.model,
  };
  return signRunOgPayload(payload, SECRET);
}

async function signedRawOgPayload(
  payload: unknown,
  prefix: string = SIGNED_RUN_OG_PREFIX,
): Promise<string> {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${prefix}${payloadB64}.${Buffer.from(sig).toString("base64url")}`;
}

function tamperSignedOgPayload(signed: string, mutate: (payload: Record<string, unknown>) => void) {
  const prefixEnd = signed.indexOf(".") + 1;
  const prefix = signed.slice(0, prefixEnd);
  const rest = signed.slice(prefixEnd);
  const dot = rest.lastIndexOf(".");
  const payload = JSON.parse(
    Buffer.from(rest.slice(0, dot), "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  mutate(payload);
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${prefix}${payloadB64}.${rest.slice(dot + 1)}`;
}

function corruptSignedOgSignature(signed: string): string {
  return `${signed.slice(0, -1)}${signed.endsWith("A") ? "B" : "A"}`;
}

function ogSignDeps(rateLimiter: RunOgSignRateLimiter = allowAllRunOgSignRateLimiter) {
  return {
    now: () => Date.now(),
    getRateLimiter: () => rateLimiter,
  };
}

function legacyT1FromCurrentToken(token: string, record: RunRecordV1): string {
  const decoded = decodeV3(token);
  return encodeBody(
    {
      v: 1,
      rid: decoded!.rid,
      fid: decoded!.fid,
      ps: decoded!.ps,
      tn: decoded!.tn,
      md: decoded!.md,
      pl: [...record.draft.spins]
        .sort((a, b) => a.index - b.index)
        .map((spin) => {
          if (spin.picked_kind === "manager") return { k: "m" as const };
          if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
            throw new Error(`spin ${spin.index} is missing player pick fields`);
          }
          return { k: "p" as const, c: spin.picked_card_id as string, s: spin.assigned_slot_id };
        }),
      sv: decoded!.sv,
      dv: decoded!.dv,
      rv: decoded!.rv,
      ev: decoded!.ev,
      uv: decoded!.uv,
      hv: decoded!.hv,
    },
    RUN_TOKEN_PREFIX,
  );
}

function previousVersionTokenFromCurrentToken(token: string): string {
  const decoded = decodeV3(token);
  return encodeBody({
    ...decoded,
    sv: "runtime-data-previous",
    dv: "dataset-previous",
    rv: "wc-perf-previous+proj-career-previous",
    ev: "engine-previous",
    uv: "ruleset-previous",
    hv: `${"a".repeat(64)}+${"b".repeat(64)}`,
  });
}

function localAssets(): RunOgImageAssets {
  return {
    markSvgDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(
      readFileSync(new URL("../../../public/brand/logo-mark.svg", import.meta.url), "utf8"),
    )}`,
    fonts: {
      archivoRegular: readArrayBuffer(
        new URL(
          "../../../public/fonts/archivo-og-tabular/archivo-latin-400-og-tabular.woff",
          import.meta.url,
        ),
      ),
      archivoRegularExt: readArrayBuffer(
        new URL("../../../public/fonts/archivo/archivo-latin-ext-400-normal.woff", import.meta.url),
      ),
      archivoMedium: readArrayBuffer(
        new URL(
          "../../../public/fonts/archivo-og-tabular/archivo-latin-500-og-tabular.woff",
          import.meta.url,
        ),
      ),
      archivoMediumExt: readArrayBuffer(
        new URL("../../../public/fonts/archivo/archivo-latin-ext-500-normal.woff", import.meta.url),
      ),
      archivoExtraBold: readArrayBuffer(
        new URL(
          "../../../public/fonts/archivo-og-tabular/archivo-latin-800-og-tabular.woff",
          import.meta.url,
        ),
      ),
      archivoExtraBoldExt: readArrayBuffer(
        new URL("../../../public/fonts/archivo/archivo-latin-ext-800-normal.woff", import.meta.url),
      ),
      archivoBlack: readArrayBuffer(
        new URL(
          "../../../public/fonts/archivo-og-tabular/archivo-latin-900-og-tabular.woff",
          import.meta.url,
        ),
      ),
      archivoBlackExt: readArrayBuffer(
        new URL("../../../public/fonts/archivo/archivo-latin-ext-900-normal.woff", import.meta.url),
      ),
    },
  };
}

function readArrayBuffer(url: URL): ArrayBuffer {
  const buffer = readFileSync(url);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function stubOgRouteFetch() {
  const assets = localAssets();
  const markSvg = readFileSync(
    new URL("../../../public/brand/logo-mark.svg", import.meta.url),
    "utf8",
  );
  const fonts = new Map<string, ArrayBuffer>([
    ["/fonts/archivo-og-tabular/archivo-latin-400-og-tabular.woff", assets.fonts.archivoRegular],
    ["/fonts/archivo/archivo-latin-ext-400-normal.woff", assets.fonts.archivoRegularExt],
    ["/fonts/archivo-og-tabular/archivo-latin-500-og-tabular.woff", assets.fonts.archivoMedium],
    ["/fonts/archivo/archivo-latin-ext-500-normal.woff", assets.fonts.archivoMediumExt],
    ["/fonts/archivo-og-tabular/archivo-latin-800-og-tabular.woff", assets.fonts.archivoExtraBold],
    ["/fonts/archivo/archivo-latin-ext-800-normal.woff", assets.fonts.archivoExtraBoldExt],
    ["/fonts/archivo-og-tabular/archivo-latin-900-og-tabular.woff", assets.fonts.archivoBlack],
    ["/fonts/archivo/archivo-latin-ext-900-normal.woff", assets.fonts.archivoBlackExt],
  ]);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const { pathname } = new URL(href);
      if (pathname.endsWith(`/data/wcdraft/${gameData.manifest.schema_version}/manifest.json`)) {
        return Response.json(gameData.manifest);
      }
      if (pathname === "/brand/logo-mark.svg") {
        return new Response(markSvg, { status: 200 });
      }
      const font = fonts.get(pathname);
      if (font) return new Response(font.slice(0), { status: 200 });
      return new Response("not found", { status: 404 });
    }),
  );
}

async function renderNumericBandWidth(font: ArrayBuffer, digits: string): Promise<number> {
  const image = new ImageResponse(
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
        },
      },
      createElement(
        "div",
        {
          style: {
            display: "flex",
            background: "#ff0000",
            color: "#ffffff",
            fontFamily: "Archivo",
            fontSize: 60,
            fontWeight: 500,
            lineHeight: 1,
          },
        },
        digits,
      ),
    ),
    {
      width: 500,
      height: 160,
      fonts: [{ name: "Archivo", data: font, weight: 500, style: "normal" }],
    },
  );
  return exactRedBandWidth(Buffer.from(await image.arrayBuffer()));
}

async function renderMarketingWordmark(font: ArrayBuffer): Promise<Buffer> {
  const image = new ImageResponse(
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: "transparent",
          fontFamily: "Archivo",
          fontSize: 55,
          fontWeight: 800,
          letterSpacing: -1.1,
          lineHeight: 1,
        },
      },
      createElement("span", { style: { color: "#ebe6da" } }, "WC"),
      createElement("span", { style: { color: "#3fa268" } }, "DRAFT"),
    ),
    {
      width: 306,
      height: 90,
      fonts: [{ name: "Archivo", data: font, weight: 800, style: "normal" }],
    },
  );
  return Buffer.from(await image.arrayBuffer());
}

function exactRedBandWidth(png: Buffer): number {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, signature.length).equals(signature)) {
    throw new Error("numeric-band receipt is not a PNG");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed: Buffer[] = [];
  for (let offset = signature.length; offset + 12 <= png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === "IDAT") {
      compressed.push(data);
    }
    offset += length + 12;
    if (type === "IEND") break;
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(
      `unsupported numeric-band PNG: ${width}x${height}, depth ${bitDepth}, type ${colorType}`,
    );
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  let previous = new Uint8Array(stride);
  let sourceOffset = 0;
  let minX = width;
  let maxX = -1;

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++]!;
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const raw = filtered[sourceOffset++]!;
      const left = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0;
      const up = previous[i]!;
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : filter === 4
                  ? paeth(left, up, upLeft)
                  : Number.NaN;
      if (!Number.isFinite(predictor)) throw new Error(`unsupported PNG filter ${filter}`);
      row[i] = (raw + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = x * bytesPerPixel;
      const opaque = colorType === 2 || row[pixel + 3]! > 0;
      if (opaque && row[pixel] === 255 && row[pixel + 1] === 0 && row[pixel + 2] === 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    previous = row;
  }

  if (maxX < minX) throw new Error("numeric-band PNG contains no exact red pixels");
  return maxX - minX + 1;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

describe("dynamic run OG tokens", () => {
  it("builds a compact result summary only after a run has simulated", () => {
    expect(buildRunTokenOgSummary(origin)).toBeNull();
    const completed = complete();
    const summary = buildRunTokenOgSummary(completed);
    expect(summary).toEqual({
      w: completed.simulation!.run.wins,
      l: completed.simulation!.run.losses,
      mp: completed.simulation!.matches.length,
      gf: completed.simulation!.run.aggregate.goals_for,
      ga: completed.simulation!.run.aggregate.goals_against,
      rr: completed.simulation!.run.reached_round,
      ch: completed.simulation!.run.is_champion,
      sw: completed.simulation!.run.shootout_wins,
    });
    const decoded = decodeRunToken(encodeRunToken(completed));
    expect(decoded).toMatchObject({ v: 3 });
    expect(decoded).not.toHaveProperty("og");
  });

  it("tolerates vestigial result-summary fields on older token bodies", () => {
    const completed = complete();
    const decoded = decodeV3(encodeRunToken(completed));
    const summary = buildRunTokenOgSummary(completed)!;
    const tampered = encodeBody({ ...decoded, og: { ...summary, w: 9 } });
    expect(decodeRunToken(tampered)).toMatchObject({ v: 3 });
  });

  it("does not trust syntactically valid unsigned summaries for server-rendered OG", () => {
    const decoded = decodeV3(encodeRunToken(complete()));
    const trueSummary = buildRunTokenOgSummary(complete())!;
    const forgedSummary = { ...trueSummary, w: trueSummary.mp, l: 0, ch: false };
    const forged = encodeBody({ ...decoded, og: forgedSummary });
    const forgedDecoded = decodeV3(forged) as V3WithVestigialOg;

    expect(forgedDecoded.og).toMatchObject(forgedSummary);
    expect(shareOgImageForRunValue(forged, null, gameData.versions)).toEqual(defaultRunOgImage());
  });
});

describe("dynamic run OG metadata decision", () => {
  it("rejects a token whose persisted manager-presence tier disagrees with deterministic re-sim", () => {
    const completed = { ...complete(), manager_presence_band: 1 as const };
    const body = decodeV3(encodeRunToken(completed));
    const verified = verifyRunTokenForOg(encodeBody({ ...body, mp: 0 }), {
      gameData,
      scenario: SCENARIO_2026_BUNDLE,
    });
    expect(verified).toEqual({ status: "rejected", reason: "ILLEGAL_PICK" });
  });

  it("uses the static default for malformed, legacy, pre-summary, unsigned, and foreign-build tokens", () => {
    const completed = complete();
    const completedToken = encodeRunToken(completed);
    const decoded = decodeV3(completedToken);
    const foreign = encodeBody({ ...decoded, hv: "foreign-build" });

    expect(shareOgImageForRunValue("not-a-token", null, gameData.versions)).toEqual(
      defaultRunOgImage(),
    );
    expect(
      shareOgImageForRunValue(
        legacyT1FromCurrentToken(completedToken, completed),
        null,
        gameData.versions,
      ),
    ).toEqual(defaultRunOgImage());
    expect(shareOgImageForRunValue(encodeRunToken(origin), null, gameData.versions)).toEqual(
      defaultRunOgImage(),
    );
    expect(shareOgImageForRunValue(foreign, "ogs1.x.y", gameData.versions)).toEqual(
      defaultRunOgImage(),
    );
    expect(shareOgImageForRunValue(completedToken, null, gameData.versions)).toEqual(
      defaultRunOgImage(),
    );
  });

  it("uses the dynamic image route only when a signed OG payload is present", async () => {
    const token = encodeRunToken(complete());
    const signed = await signedOgForToken(token);
    const tokenHash = await sha256Hex(token);
    const image = shareOgImageForRunValue(token, signed, gameData.versions);
    expect(image.dynamic).toBe(true);
    expect(image.url).toContain("/api/og/run?");
    expect(image.url).toContain("run=t3.");
    expect(image.url).toContain("og=ogs2.");
    expect(image.url).toContain(`v=ogs2.${tokenHash.slice(0, 32)}`);
    expect(image.url).not.toContain("ogs1.");
  });

  it("keeps signed historical snapshots dynamic after version anchors move", async () => {
    const currentToken = encodeRunToken(complete());
    const historicalToken = previousVersionTokenFromCurrentToken(currentToken);
    const verified = verifyRunTokenForOg(currentToken, {
      gameData,
      scenario: SCENARIO_2026_BUNDLE,
    });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    const signed = await signRunOgPayload(
      {
        v: SIGNED_RUN_OG_VERSION,
        token_hash: await sha256Hex(historicalToken),
        versions: {
          schema_version: "runtime-data-previous",
          dataset_version: "dataset-previous",
          rating_version: "wc-perf-previous+proj-career-previous",
          engine_version: "engine-previous",
          ruleset_version: "ruleset-previous",
          data_bundle_hash: `${"a".repeat(64)}+${"b".repeat(64)}`,
        },
        model: verified.model,
      },
      SECRET,
    );

    const decoded = decodeV3(historicalToken);
    expect(decoded.sv).not.toBe(gameData.versions.schema_version);
    expect(shareOgImageForRunValue(historicalToken, signed, gameData.versions).dynamic).toBe(true);
  });
});

describe("dynamic run OG model and image", () => {
  it("makes the fallback wordmark depend on explicit Archivo bytes", async () => {
    const archivoExtraBold = readArrayBuffer(
      new URL("../../../public/fonts/archivo/archivo-latin-800-normal.woff", import.meta.url),
    );
    const archivoRegular = readArrayBuffer(
      new URL("../../../public/fonts/archivo/archivo-latin-400-normal.woff", import.meta.url),
    );
    const [first, second, fontMutation] = await Promise.all([
      renderMarketingWordmark(archivoExtraBold),
      renderMarketingWordmark(archivoExtraBold),
      renderMarketingWordmark(archivoRegular),
    ]);

    expect(Buffer.compare(first, second)).toBe(0);
    expect(Buffer.compare(first, fontMutation)).not.toBe(0);
    await expect(renderMarketingWordmark(new Uint8Array([0, 1, 2, 3]).buffer)).rejects.toThrow();
  });

  it("uses renderer-compatible default tabular glyphs for OG data numerals", async () => {
    const upstreamMedium = readArrayBuffer(
      new URL("../../../public/fonts/archivo/archivo-latin-500-normal.woff", import.meta.url),
    );
    const tabularMedium = localAssets().fonts.archivoMedium;

    const [upstreamOnes, upstreamEights, tabularOnes, tabularEights] = await Promise.all([
      renderNumericBandWidth(upstreamMedium, "111111"),
      renderNumericBandWidth(upstreamMedium, "888888"),
      renderNumericBandWidth(tabularMedium, "111111"),
      renderNumericBandWidth(tabularMedium, "888888"),
    ]);

    expect(upstreamOnes).not.toBe(upstreamEights);
    expect(tabularOnes).toBeGreaterThan(0);
    expect(tabularOnes).toBe(tabularEights);
  });

  it("reports the real pre-Season-2 production token as wrong-season skew", () => {
    expect(
      verifyRunTokenForOg(skewFixtures.shipped_pre_s2_t3.token, {
        gameData,
        scenario: SCENARIO_2026_BUNDLE,
      }),
    ).toEqual({ status: "rejected", reason: "WRONG_SEASON" });
  });

  it("builds the image model only from a trusted server-derived summary", () => {
    const token = encodeRunToken(complete());
    const decoded = decodeV3(token);
    const summary = buildRunTokenOgSummary(complete())!;
    const model = buildRunOgModelFromTrustedSummary(gameData, decoded, summary);
    expect(model.summary).toEqual(summary);
    expect(model.lineup).toHaveLength(11);
    expect(model.reveal).toBeNull();
  });

  it("refuses trusted-summary reconstruction when token anchors are version-skewed", () => {
    const historicalToken = previousVersionTokenFromCurrentToken(encodeRunToken(complete()));
    const decoded = decodeV3(historicalToken);
    const summary = buildRunTokenOgSummary(complete())!;
    expect(() => buildRunOgModelFromTrustedSummary(gameData, decoded, summary)).toThrow(
      /version anchors/u,
    );
  });

  it("threads the server re-derived narrative into the signed image model", () => {
    const completed = complete();
    const token = encodeRunToken(completed);
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    const labels = buildNarrativeLabels(gameData, SCENARIO_2026_BUNDLE, completed.draft);
    const expected = buildNarrative(
      completed.simulation!.run,
      [...completed.simulation!.matches],
      labels,
    ).filled_text;
    expect(verified.model.narrative).toBe(expected);
    expect(verified.model.narrative).not.toContain("Unavailable");
    expect(verified.model.narrative).not.toMatch(/WC2026-/u);
  });

  it("threads hidden-mode reveal data into the signed image model without pre-reveal ratings", async () => {
    const completed = complete();
    const hidden: RunRecordV1 = {
      ...completed,
      draft: { ...completed.draft, mode: "hidden" },
    };
    const token = encodeRunToken(hidden);
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    expect(verified.model.mode_label).toBe("Memory");
    expect(verified.model.reveal).not.toBeNull();
    expect(verified.model.reveal?.squad_before).toBeNull();
    expect(typeof verified.model.reveal?.squad_after).toBe("number");
    expect(verified.model.reveal?.lines.length).toBeGreaterThan(0);
    for (const line of verified.model.reveal?.lines ?? []) {
      expect(line.before).toBeNull();
      expect(typeof line.after).toBe("number");
    }
    expect(verified.model.lineup.some((slot) => typeof slot.overall === "number")).toBe(true);
    const signed = await signedOgForToken(token);
    expect(signed.length).toBeLessThan(12_000);
    const trusted = await verifySignedRunOgPayload(signed, SECRET);
    expect(trusted?.model.reveal?.squad_before).toBeNull();
    expect(trusted?.model.reveal?.squad_after).toBe(verified.model.reveal?.squad_after);
  });

  it("labels the share narrative with display names when scenario data is available", () => {
    const completed = complete();
    const view = buildShareView(gameData, completed, SCENARIO_2026_BUNDLE);
    const labels = buildNarrativeLabels(gameData, SCENARIO_2026_BUNDLE, completed.draft);
    const expected = buildNarrative(
      completed.simulation!.run,
      [...completed.simulation!.matches],
      labels,
    ).filled_text;
    expect(view?.narrative).toBe(expected);
    expect(view?.narrative).not.toContain("Unavailable");
    expect(view?.narrative).not.toMatch(/WC2026-/u);
  });

  it("omits share narrative instead of exposing raw labels when scenario data is unavailable", () => {
    const completed = complete();
    const view = buildShareView(gameData, completed, null);
    expect(completed.simulation!.run.narrative.filled_text).toContain("Unavailable");
    expect(completed.simulation!.run.narrative.filled_text).toContain("WC2026-");
    expect(view?.narrative).toBe("");
  });

  it("renders byte-identical ImageResponse bytes for an already trusted model", async () => {
    const summary = buildRunTokenOgSummary(complete())!;
    const model = {
      team_name: "Origin XI",
      mode_label: "Classic" as const,
      formation_name: "4-3-3",
      result_label: "3-1, R32",
      record: `${summary.w}-${summary.l}`,
      narrative: "Knocked out in the round of 32.",
      summary,
      badges: [],
      lineup: [
        {
          slot_id: "GK",
          slot_label: "GK",
          position: "GK" as const,
          shape: "square" as const,
          badge_kind: "historical" as const,
          x_pct: 50,
          y_pct: 88,
          name: "Keeper",
          nation_code: "AAA",
        },
      ],
      stars: [],
      manager: null,
      reveal: null,
    };
    const assets = localAssets();
    const fontBytes = Object.values(assets.fonts).reduce(
      (total, font) => total + font.byteLength,
      0,
    );

    const a = Buffer.from(await renderRunOgImage(model, assets).arrayBuffer());
    const b = Buffer.from(await renderRunOgImage(model, assets).arrayBuffer());

    expect(Buffer.compare(a, b)).toBe(0);
    expect(fontBytes).toBe(150_032);
    expect(fontBytes).toBeLessThan(500_000);
    expect(a.length).toBeLessThan(500_000);
  });
});

describe("trusted run OG signing", () => {
  it("only emits current-version envelopes", async () => {
    const token = encodeRunToken(complete());
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;

    const signed = await signRunOgPayload(
      {
        v: SIGNED_RUN_OG_VERSION,
        token_hash: await sha256Hex(token),
        versions: gameData.versions,
        model: verified.model,
      },
      SECRET,
    );

    expect(signed).toMatch(/^ogs2\./u);
    expect(signed).not.toMatch(/^ogs1\./u);
  });

  it("mutation: an illegal pick is rejected and never receives a signed model", () => {
    const body = decodeV3(encodeRunToken(complete()));
    const first = body.pl.find((p) => p.k === "p");
    if (!first || first.k !== "p") {
      throw new Error("expected player picks in fixture");
    }
    first.ci = 99;
    const token = encodeBody(body);
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified).toEqual({ status: "rejected", reason: "ILLEGAL_PICK" });
  });

  it("mutation: a tampered result field signs and renders the true re-derived result", async () => {
    const completed = complete();
    const trueSummary = buildRunTokenOgSummary(completed)!;
    const body = decodeV3(encodeRunToken(completed));
    (body as V3WithVestigialOg).og = {
      w: 8,
      l: 0,
      mp: 8,
      gf: 99,
      ga: 0,
      rr: "F",
      ch: true,
      sw: 0,
    };
    const token = encodeBody(body);
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    expect(verified.summary).toEqual(trueSummary);
    expect(verified.model.summary).toEqual(trueSummary);
    expect(verified.model.result_label).toBe(formatRunOgResult(trueSummary));

    const payload: SignedRunOgPayload = {
      v: SIGNED_RUN_OG_VERSION,
      token_hash: await sha256Hex(token),
      versions: gameData.versions,
      model: verified.model,
    };
    const signedA = await signRunOgPayload(payload, SECRET);
    const signedB = await signRunOgPayload(payload, SECRET);
    expect(signedA).toBe(signedB);
    const trusted = await verifySignedRunOgPayload(signedA, SECRET);
    expect(trusted?.model.summary).toEqual(trueSummary);
  });

  it("normalizes historical model payloads inside the v2 envelope", async () => {
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:og:legacy")));
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    const legacyModel = { ...verified.model } as Record<string, unknown>;
    delete legacyModel.narrative;
    const legacySigned = await signedRawOgPayload({
      v: SIGNED_RUN_OG_VERSION,
      token_hash: await sha256Hex(token),
      versions: gameData.versions,
      model: legacyModel,
    });

    const trusted = await verifySignedRunOgPayload(legacySigned, SECRET);
    expect(trusted?.model.narrative).toBe(verified.model.result_label);
    expect(trusted?.model.team_name).toBe(verified.model.team_name);
  });

  it("rejects envelope/payload version mismatches", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:og:v1-cutover")));
    const verified = verifyRunTokenForOg(token, {
      gameData,
      scenario: SCENARIO_2026_BUNDLE,
    });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    const oldPayload = {
      v: 1,
      token_hash: await sha256Hex(token),
      versions: gameData.versions,
      model: verified.model,
    };
    const oldPayloadUnderCurrentPrefix = await signedRawOgPayload(oldPayload);
    const currentPayloadUnderOldPrefix = await signedRawOgPayload(
      {
        ...oldPayload,
        v: SIGNED_RUN_OG_VERSION,
      },
      LEGACY_SIGNED_RUN_OG_PREFIX,
    );

    for (const signed of [oldPayloadUnderCurrentPrefix, currentPayloadUnderOldPrefix]) {
      expect(await verifySignedRunOgPayload(signed, SECRET)).toBeNull();
      expect(shareOgImageForRunValue(token, signed, gameData.versions)).toEqual(
        defaultRunOgImage(),
      );
      const response = await runOgRouteGet(
        new Request(
          `http://localhost/api/og/run?run=${encodeURIComponent(token)}&og=${encodeURIComponent(signed)}`,
        ),
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost/brand/marketing/og-default.png",
      );
    }
  });

  it.each([
    ["absent", new Headers()],
    ["wrong", new Headers({ "content-type": "text/plain" })],
  ])("rejects %s content type before reading the body", async (_label, headers) => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const request = {
      headers,
      get body(): never {
        throw new Error("body must not be read for unsupported media types");
      },
    } as unknown as Request;

    const response = await handleRunOgSignPost(request, ogSignDeps());

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      ok: false,
      error: "UNSUPPORTED_MEDIA_TYPE",
    });
  });

  it("sanitizes attacker-controlled display text before route signing", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const body = decodeV3(encodeRunToken(complete()));
    body.tn = "X".repeat(161);
    const token = encodeBody(body);

    const response = await handleRunOgSignPost(
      new Request("http://localhost/api/og/sign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.161",
        },
        body: JSON.stringify({ run: token }),
      }),
      ogSignDeps(),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { signed?: unknown };
    expect(typeof payload.signed).toBe("string");
    const trusted = await verifySignedRunOgPayload(String(payload.signed), SECRET);
    expect(trusted?.model.team_name).toHaveLength(80);
    expect(trusted?.model.team_name.endsWith("...")).toBe(true);
  });

  it("bounds repeated uncached sign attempts before re-sim work", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 5, 15, 12, 0, 30));
    const limiter = createDbRunOgSignRateLimiter({
      db: ogRateDb,
      now: () => Date.now(),
      random: () => 1,
    });
    let last: Response | null = null;
    try {
      for (let i = 0; i < 31; i += 1) {
        last = await handleRunOgSignPost(
          new Request("http://localhost/api/og/sign", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "198.51.100.77",
            },
            body: JSON.stringify({ run: "not-a-token" }),
          }),
          ogSignDeps(limiter),
        );
      }
    } finally {
      nowSpy.mockRestore();
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toMatch(/^[1-9]\d*$/u);
  });

  it("serves cached signatures before consulting durable quota", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:og:cache-hit")));
    let quotaCalls = 0;
    const allowOnce: RunOgSignRateLimiter = {
      async checkSign() {
        quotaCalls += 1;
        return { allowed: true };
      },
    };
    const denyIfCalled: RunOgSignRateLimiter = {
      async checkSign() {
        quotaCalls += 1;
        return { allowed: false, retryAfterSeconds: 60 };
      },
    };
    const request = () =>
      new Request("http://localhost/api/og/sign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.79",
        },
        body: JSON.stringify({ run: token }),
      });

    const first = await handleRunOgSignPost(request(), ogSignDeps(allowOnce));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      signed?: unknown;
      challenge_proof?: unknown;
      cache_key?: unknown;
    };
    expect(firstBody.signed).toMatch(/^ogs2\./u);
    expect(firstBody.cache_key).toMatch(/^ogs2\.[0-9a-f]{32}$/u);
    expect(firstBody.challenge_proof).toMatch(/^fc1\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/u);

    const second = await handleRunOgSignPost(request(), ogSignDeps(denyIfCalled));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { signed?: unknown; challenge_proof?: unknown };
    expect(secondBody.signed).toBe(firstBody.signed);
    expect(secondBody.challenge_proof).toBe(firstBody.challenge_proof);
    expect(quotaCalls).toBe(1);
  });

  it("rejects headerless oversized sign bodies while reading the stream", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const response = await runOgSignRoutePost(
      new Request("http://localhost/api/og/sign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.78",
        },
        body: JSON.stringify({ run: "X".repeat(9000) }),
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "BODY_TOO_LARGE" });
  });

  it("returns 422 for illegal picks and never signs them", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const body = decodeV3(encodeRunToken(complete()));
    const first = body.pl.find((p) => p.k === "p");
    if (!first || first.k !== "p") throw new Error("expected player pick");
    first.ci = 99;

    const response = await handleRunOgSignPost(
      new Request("http://localhost/api/og/sign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.80",
        },
        body: JSON.stringify({ run: encodeBody(body) }),
      }),
      ogSignDeps(),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "ILLEGAL_PICK" });
  });

  it("asserts the stable OG secret is configured without exposing its value", async () => {
    const absent = await runOgHealthGet();
    expect(absent.status).toBe(503);
    const absentBody = await absent.text();
    expect(absentBody).toContain("OG_SIGNING_SECRET_MISSING");
    expect(absentBody).not.toContain(SECRET);
    expect(() => assertOgSigningSecretPresent({})).toThrow(/WCDRAFT_OG_SIGNING_SECRET/u);

    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const present = await runOgHealthGet();
    expect(present.status).toBe(200);
    expect(await present.json()).toEqual({ ok: true });
    expect(assertOgSigningSecretPresent()).toBe(SECRET);
  });
});

describe("dynamic run OG route scope", () => {
  it("malformed route input redirects to the static default instead of throwing", async () => {
    const response = await runOgRouteGet(
      new Request("http://localhost/api/og/run?run=malformed-token&v=test"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/brand/marketing/og-default.png",
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("renders signed route bytes deterministically with immutable caching", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    stubOgRouteFetch();
    const token = encodeRunToken(complete());
    const signed = await signedOgForToken(token);
    const url = `http://localhost/api/og/run?run=${encodeURIComponent(
      token,
    )}&og=${encodeURIComponent(signed)}&v=test`;

    const start = performance.now();
    const first = await runOgRouteGet(new Request(url));
    const second = await runOgRouteGet(new Request(url));
    const elapsedMs = performance.now() - start;
    const firstBytes = Buffer.from(await first.arrayBuffer());
    const secondBytes = Buffer.from(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe(TRUSTED_IMAGE_CACHE);
    expect(second.headers.get("cache-control")).toBe(TRUSTED_IMAGE_CACHE);
    expect(Buffer.compare(firstBytes, secondBytes)).toBe(0);
    expect(firstBytes.length).toBeLessThan(500_000);
    expect(elapsedMs).toBeLessThan(3_000);
  });

  it("accepts v1 only on the read path, rekeys it to ogs2, and rejects v1 attacks", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    stubOgRouteFetch();
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:og:v1-durability")));
    const verified = verifyRunTokenForOg(token, {
      gameData,
      scenario: SCENARIO_2026_BUNDLE,
    });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;

    const legacyPayload = {
      v: LEGACY_SIGNED_RUN_OG_VERSION,
      token_hash: await sha256Hex(token),
      versions: gameData.versions,
      model: verified.model,
    };
    const validV1 = await signedRawOgPayload(legacyPayload, LEGACY_SIGNED_RUN_OG_PREFIX);
    const validV2 = await signedOgForToken(token);
    const tamperedV1 = tamperSignedOgPayload(validV1, (payload) => {
      const model = payload.model as Record<string, unknown>;
      model.result_label = "8-0 - FORGED";
    });
    const forgedSignatureV1 = corruptSignedOgSignature(validV1);

    const trustedLegacy = await verifySignedRunOgPayload(validV1, SECRET);
    expect(trustedLegacy?.v).toBe(LEGACY_SIGNED_RUN_OG_VERSION);
    expect(await verifySignedRunOgPayload(tamperedV1, SECRET)).toBeNull();
    expect(await verifySignedRunOgPayload(forgedSignatureV1, SECRET)).toBeNull();

    const descriptor = shareOgImageForRunValue(token, validV1, gameData.versions);
    expect(descriptor.dynamic).toBe(true);
    const descriptorUrl = new URL(descriptor.url, "http://localhost");
    expect(descriptorUrl.searchParams.get("og")).toBe(validV1);
    expect(descriptorUrl.searchParams.get("v")).toBe(
      `ogs2.${legacyPayload.token_hash.slice(0, 32)}`,
    );

    const route = (og: string) =>
      runOgRouteGet(
        new Request(
          `http://localhost/api/og/run?run=${encodeURIComponent(token)}&og=${encodeURIComponent(og)}&v=ogs2.${legacyPayload.token_hash.slice(0, 32)}`,
        ),
      );
    const [legacyResponse, currentResponse, tamperedResponse, forgedResponse] = await Promise.all([
      route(validV1),
      route(validV2),
      route(tamperedV1),
      route(forgedSignatureV1),
    ]);

    for (const response of [legacyResponse, currentResponse]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe(TRUSTED_IMAGE_CACHE);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
    }
    for (const response of [tamperedResponse, forgedResponse]) {
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost/brand/marketing/og-default.png",
      );
    }
    expect(shareOgImageForRunValue(token, "ogs1.malformed", gameData.versions)).toEqual(
      defaultRunOgImage(),
    );
    const malformed = await route("ogs1.malformed");
    expect(malformed.status).toBe(307);
    expect(malformed.headers.get("location")).toBe(
      "http://localhost/brand/marketing/og-default.png",
    );
  });

  it("renders a version-moved signed snapshot instead of falling back to default", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    stubOgRouteFetch();
    const currentToken = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:og:old")));
    const historicalToken = previousVersionTokenFromCurrentToken(currentToken);
    const verified = verifyRunTokenForOg(currentToken, {
      gameData,
      scenario: SCENARIO_2026_BUNDLE,
    });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    const signed = await signRunOgPayload(
      {
        v: SIGNED_RUN_OG_VERSION,
        token_hash: await sha256Hex(historicalToken),
        versions: {
          schema_version: "runtime-data-previous",
          dataset_version: "dataset-previous",
          rating_version: "wc-perf-previous+proj-career-previous",
          engine_version: "engine-previous",
          ruleset_version: "ruleset-previous",
          data_bundle_hash: `${"a".repeat(64)}+${"b".repeat(64)}`,
        },
        model: verified.model,
      },
      SECRET,
    );
    const url = `http://localhost/api/og/run?run=${encodeURIComponent(
      historicalToken,
    )}&og=${encodeURIComponent(signed)}&v=ogs2.test`;

    const response = await runOgRouteGet(new Request(url));
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(TRUSTED_IMAGE_CACHE);
    expect(bytes.length).toBeGreaterThan(1_000);
  });

  it("rejects forged signed snapshots without rendering forged cards", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    stubOgRouteFetch();
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:og:forgery")));
    const signed = await signedOgForToken(token);
    const wrongToken = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:og:wrong")));
    const url = (run: string, og: string) =>
      `http://localhost/api/og/run?run=${encodeURIComponent(run)}&og=${encodeURIComponent(
        og,
      )}&v=test`;

    const wrongHash = await runOgRouteGet(new Request(url(wrongToken, signed)));
    const badHmac = await runOgRouteGet(new Request(url(token, corruptSignedOgSignature(signed))));
    const tamperedModel = await runOgRouteGet(
      new Request(
        url(
          token,
          tamperSignedOgPayload(signed, (payload) => {
            const model = payload.model as Record<string, unknown>;
            model.result_label = "8-0 - PERFECT";
          }),
        ),
      ),
    );

    for (const response of [wrongHash, badHmac, tamperedModel]) {
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost/brand/marketing/og-default.png",
      );
    }
  });

  it("keeps the server image route out of the simulation path", () => {
    const routeSrc = readFileSync(
      new URL("../../../app/api/og/run/route.tsx", import.meta.url),
      "utf8",
    );
    expect(routeSrc).not.toMatch(
      /game\/data|run-token|loadDraftPoolBundle|buildGameData|verifyRunTokenForOg/u,
    );
    expect(routeSrc).not.toMatch(
      /decodeRunToken|versionsAgree|reconstructDraftFromToken|createDraft|pickPlayer|pickManager/u,
    );
    expect(routeSrc).not.toMatch(
      /runSimulation(?:Sync)?|buildSimWorldInputs|runTournamentFull|buildRunScenario/u,
    );
  });

  it("keeps the edge route out of the full draft-pool parse path", () => {
    const routeSrc = readFileSync(
      new URL("../../../app/api/og/run/route.tsx", import.meta.url),
      "utf8",
    );
    expect(routeSrc).not.toContain("loadDraftPoolBundle");
    expect(routeSrc).not.toContain("buildGameData");
    expect(routeSrc).not.toContain("getValidationData");
  });

  it("keeps the share page wired for query-aware large-card unfurls", () => {
    const pageSrc = readFileSync(
      new URL("../../../app/play/share/page.tsx", import.meta.url),
      "utf8",
    );
    expect(pageSrc).toContain("generateMetadata");
    expect(pageSrc).toContain("shareOgImageForRunValue");
    expect(pageSrc).toContain("summary_large_image");
  });
});
