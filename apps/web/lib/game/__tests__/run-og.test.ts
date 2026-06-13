import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";
import { describe, expect, it } from "vitest";

import {
  buildRunTokenOgSummary,
  decodeRunToken,
  encodeRunToken,
  RUN_TOKEN_PREFIX,
  type RunTokenV2Body,
} from "../run-token";
import type { RunRecordV1 } from "../run-record";
import { runSimulationSync } from "../simulate";
import {
  defaultRunOgImage,
  RUN_OG_HEIGHT,
  RUN_OG_WIDTH,
  shareOgImageForRunValue,
} from "../run-og-metadata";
import { buildRunOgModel } from "../run-og-model";
import { renderRunOgImage, type RunOgImageAssets } from "../run-og-image";
import { GET as runOgRouteGet } from "../../../app/api/og/run/route";

import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();
const origin = buildOriginRecord(gameData);

function complete(record: RunRecordV1 = origin): RunRecordV1 {
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
  return { ...record, status: "complete", simulation };
}

function encodeBody(body: unknown, prefix = "t2."): string {
  return prefix + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function decodeV2(token: string): RunTokenV2Body {
  const decoded = decodeRunToken(token);
  if (!decoded || decoded.v !== 2) throw new Error("expected a t2 token");
  return decoded;
}

function legacyT1FromCurrentT2(token: string): string {
  const decoded = decodeV2(token);
  return encodeBody(
    {
      v: 1,
      rid: decoded!.rid,
      fid: decoded!.fid,
      ps: decoded!.ps,
      tn: decoded!.tn,
      md: decoded!.md,
      pl: decoded!.pl.map((p) =>
        p.k === "m" ? { k: "m" as const } : { k: "p" as const, c: p.c, s: p.s },
      ),
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

function localAssets(): RunOgImageAssets {
  return {
    markSvgDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(
      readFileSync(new URL("../../../public/brand/wcdraft-mark.svg", import.meta.url), "utf8"),
    )}`,
    fonts: {
      sairaCondensedBold: readArrayBuffer(
        new URL("../../../public/fonts/og/SairaCondensed-Bold.ttf", import.meta.url),
      ),
      soraSemiBold: readArrayBuffer(
        new URL("../../../public/fonts/og/Sora-SemiBold.ttf", import.meta.url),
      ),
      soraBold: readArrayBuffer(new URL("../../../public/fonts/og/Sora-Bold.ttf", import.meta.url)),
      jetBrainsMonoBold: readArrayBuffer(
        new URL("../../../public/fonts/og/JetBrainsMono-Bold.ttf", import.meta.url),
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

describe("dynamic run OG tokens", () => {
  it("adds a compact result summary only after a run has simulated", () => {
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
    expect(decodeRunToken(encodeRunToken(completed))).toMatchObject({ v: 2, og: summary });
  });

  it("rejects malformed result summaries instead of guessing", () => {
    const completed = complete();
    const decoded = decodeV2(encodeRunToken(completed));
    const tampered = encodeBody({ ...decoded, og: { ...decoded.og, w: 9 } });
    expect(decodeRunToken(tampered)).toBeNull();
  });
});

describe("dynamic run OG metadata decision", () => {
  it("uses the static default for malformed, legacy, pre-summary, and foreign-build tokens", () => {
    const completedToken = encodeRunToken(complete());
    const decoded = decodeV2(completedToken);
    const foreign = encodeBody({ ...decoded, hv: "foreign-build" });

    expect(shareOgImageForRunValue("not-a-token", gameData.versions)).toEqual(defaultRunOgImage());
    expect(
      shareOgImageForRunValue(legacyT1FromCurrentT2(completedToken), gameData.versions),
    ).toEqual(defaultRunOgImage());
    expect(shareOgImageForRunValue(encodeRunToken(origin), gameData.versions)).toEqual(
      defaultRunOgImage(),
    );
    expect(shareOgImageForRunValue(foreign, gameData.versions)).toEqual(defaultRunOgImage());
  });

  it("builds a cache-keyed large-card image descriptor for current t2 summary tokens", () => {
    const token = encodeRunToken(complete());
    const image = shareOgImageForRunValue(token, gameData.versions, {
      VERCEL_GIT_COMMIT_SHA: "abc1234567890",
    });
    expect(image.dynamic).toBe(true);
    expect(image.width).toBe(RUN_OG_WIDTH);
    expect(image.height).toBe(RUN_OG_HEIGHT);
    expect(image.url).toContain("/api/og/run?");
    expect(image.url).toContain("run=t2.");
    expect(image.url).toContain("abc1234567890");
    expect(image.alt).toContain("Origin XI");
  });
});

describe("dynamic run OG model and image", () => {
  it("replays the token into the same XI display model without server simulation", () => {
    const token = encodeRunToken(complete());
    const decoded = decodeV2(token);
    const model = buildRunOgModel(gameData, decoded);
    expect(model).not.toBeNull();
    expect(model!.team_name).toBe("Origin XI");
    expect(model!.mode_label).toBe("Classic");
    expect(model!.lineup).toHaveLength(11);
    expect(model!.stars).toHaveLength(3);
    expect(model!.result_label).toMatch(/^\d-\d/);
  });

  it("renders byte-identical ImageResponse bytes for the same token", async () => {
    const token = encodeRunToken(complete());
    const decoded = decodeV2(token);
    const model = buildRunOgModel(gameData, decoded)!;
    const assets = localAssets();

    const start = performance.now();
    const a = Buffer.from(await renderRunOgImage(model, assets).arrayBuffer());
    const b = Buffer.from(await renderRunOgImage(model, assets).arrayBuffer());
    const elapsedMs = performance.now() - start;

    expect(Buffer.compare(a, b)).toBe(0);
    expect(a.length).toBeLessThan(500_000);
    expect(elapsedMs).toBeLessThan(3_000);
  });
});

describe("dynamic run OG route scope", () => {
  it("malformed route input redirects to the static default instead of throwing", async () => {
    const response = await runOgRouteGet(
      new Request("http://localhost/api/og/run?run=malformed-token&v=test"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/brand/marketing/og-default.png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("keeps the server image route out of the simulation path", () => {
    const routeSrc = readFileSync(
      new URL("../../../app/api/og/run/route.tsx", import.meta.url),
      "utf8",
    );
    const modelSrc = readFileSync(new URL("../run-og-model.ts", import.meta.url), "utf8");
    expect(`${routeSrc}\n${modelSrc}`).not.toMatch(/runSimulation(?:Sync)?/u);
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
