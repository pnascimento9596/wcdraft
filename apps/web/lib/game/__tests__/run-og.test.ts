import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRunTokenOgSummary,
  decodeRunToken,
  encodeRunToken,
  RUN_TOKEN_PREFIX,
  type RunTokenV2Body,
} from "../run-token";
import type { RunRecordV1 } from "../run-record";
import { runSimulationSync } from "../simulate";
import { defaultRunOgImage, formatRunOgResult, shareOgImageForRunValue } from "../run-og-metadata";
import { buildRunOgModelFromTrustedSummary } from "../run-og-model";
import { renderRunOgImage, type RunOgImageAssets } from "../run-og-image";
import { verifyRunTokenForOg } from "../run-og-server";
import {
  sha256Hex,
  signRunOgPayload,
  verifySignedRunOgPayload,
  type SignedRunOgPayload,
} from "../run-og-signing";
import { GET as runOgRouteGet } from "../../../app/api/og/run/route";
import { POST as runOgSignRoutePost } from "../../../app/api/og/sign/route";

import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();
const origin = buildOriginRecord(gameData);
const SECRET = "run-og-test-secret-32-bytes-minimum";
const TRUSTED_IMAGE_CACHE = "public, max-age=31536000, immutable";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

async function signedOgForToken(token: string): Promise<string> {
  const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
  if (verified.status !== "accepted") throw new Error(`token did not verify: ${verified.reason}`);
  const payload: SignedRunOgPayload = {
    v: 1,
    token_hash: await sha256Hex(token),
    versions: gameData.versions,
    model: verified.model,
  };
  return signRunOgPayload(payload, SECRET);
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

function stubOgRouteFetch() {
  const assets = localAssets();
  const markSvg = readFileSync(
    new URL("../../../public/brand/wcdraft-mark.svg", import.meta.url),
    "utf8",
  );
  const fonts = new Map<string, ArrayBuffer>([
    ["/fonts/og/SairaCondensed-Bold.ttf", assets.fonts.sairaCondensedBold],
    ["/fonts/og/Sora-SemiBold.ttf", assets.fonts.soraSemiBold],
    ["/fonts/og/Sora-Bold.ttf", assets.fonts.soraBold],
    ["/fonts/og/JetBrainsMono-Bold.ttf", assets.fonts.jetBrainsMonoBold],
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
      if (pathname === "/brand/wcdraft-mark.svg") {
        return new Response(markSvg, { status: 200 });
      }
      const font = fonts.get(pathname);
      if (font) return new Response(font.slice(0), { status: 200 });
      return new Response("not found", { status: 404 });
    }),
  );
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

  it("does not trust syntactically valid unsigned summaries for server-rendered OG", () => {
    const decoded = decodeV2(encodeRunToken(complete()));
    const forgedSummary = { ...decoded.og!, w: decoded.og!.mp, l: 0, ch: false };
    const forged = encodeBody({ ...decoded, og: forgedSummary });
    const forgedDecoded = decodeV2(forged);

    expect(forgedDecoded.og).toMatchObject(forgedSummary);
    expect(shareOgImageForRunValue(forged, null, gameData.versions)).toEqual(defaultRunOgImage());
  });
});

describe("dynamic run OG metadata decision", () => {
  it("uses the static default for malformed, legacy, pre-summary, unsigned, and foreign-build tokens", () => {
    const completedToken = encodeRunToken(complete());
    const decoded = decodeV2(completedToken);
    const foreign = encodeBody({ ...decoded, hv: "foreign-build" });

    expect(shareOgImageForRunValue("not-a-token", null, gameData.versions)).toEqual(
      defaultRunOgImage(),
    );
    expect(
      shareOgImageForRunValue(legacyT1FromCurrentT2(completedToken), null, gameData.versions),
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
    const image = shareOgImageForRunValue(token, signed, gameData.versions, {
      VERCEL_GIT_COMMIT_SHA: "abc1234567890",
    });
    expect(image.dynamic).toBe(true);
    expect(image.url).toContain("/api/og/run?");
    expect(image.url).toContain("run=t2.");
    expect(image.url).toContain("og=ogs1.");
    expect(image.url).toContain("v=abc1234567890.");
  });
});

describe("dynamic run OG model and image", () => {
  it("builds the image model only from a trusted server-derived summary", () => {
    const token = encodeRunToken(complete());
    const decoded = decodeV2(token);
    const summary = buildRunTokenOgSummary(complete())!;
    const model = buildRunOgModelFromTrustedSummary(gameData, decoded, summary);
    expect(model.summary).toEqual(summary);
    expect(model.lineup).toHaveLength(11);
  });

  it("renders byte-identical ImageResponse bytes for an already trusted model", async () => {
    const summary = buildRunTokenOgSummary(complete())!;
    const model = {
      team_name: "Origin XI",
      mode_label: "Classic" as const,
      formation_name: "4-3-3",
      result_label: "3-1, R32",
      record: `${summary.w}-${summary.l}`,
      summary,
      badges: [],
      lineup: [
        {
          slot_id: "GK",
          slot_label: "GK",
          position: "GK" as const,
          shape: "square" as const,
          x_pct: 50,
          y_pct: 88,
          name: "Keeper",
          nation_code: "AAA",
        },
      ],
      stars: [],
      manager: null,
    };
    const assets = localAssets();

    const a = Buffer.from(await renderRunOgImage(model, assets).arrayBuffer());
    const b = Buffer.from(await renderRunOgImage(model, assets).arrayBuffer());

    expect(Buffer.compare(a, b)).toBe(0);
    expect(a.length).toBeLessThan(500_000);
  });
});

describe("trusted run OG signing", () => {
  it("mutation: an illegal pick is rejected and never receives a signed model", () => {
    const body = decodeV2(encodeRunToken(complete()));
    const first = body.pl.find((p) => p.k === "p");
    const last = [...body.pl].reverse().find((p) => p.k === "p");
    if (!first || !last || first.k !== "p" || last.k !== "p") {
      throw new Error("expected player picks in fixture");
    }
    first.c = last.c;
    const token = encodeBody(body);
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified).toEqual({ status: "rejected", reason: "ILLEGAL_PICK" });
  });

  it("mutation: a tampered result field signs and renders the true re-derived result", async () => {
    const completed = complete();
    const trueSummary = buildRunTokenOgSummary(completed)!;
    const body = decodeV2(encodeRunToken(completed));
    body.og = { w: 8, l: 0, mp: 8, gf: 99, ga: 0, rr: "F", ch: true, sw: 0 };
    const token = encodeBody(body);
    const verified = verifyRunTokenForOg(token, { gameData, scenario: SCENARIO_2026_BUNDLE });
    expect(verified.status).toBe("accepted");
    if (verified.status !== "accepted") return;
    expect(verified.summary).toEqual(trueSummary);
    expect(verified.model.summary).toEqual(trueSummary);
    expect(verified.model.result_label).toBe(formatRunOgResult(trueSummary));

    const payload: SignedRunOgPayload = {
      v: 1,
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

  it("sanitizes attacker-controlled display text before route signing", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const body = decodeV2(encodeRunToken(complete()));
    body.tn = "X".repeat(161);
    const token = encodeBody(body);

    const response = await runOgSignRoutePost(
      new Request("http://localhost/api/og/sign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.161",
        },
        body: JSON.stringify({ run: token }),
      }),
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
    let last: Response | null = null;
    for (let i = 0; i < 31; i += 1) {
      last = await runOgSignRoutePost(
        new Request("http://localhost/api/og/sign", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.77",
          },
          body: JSON.stringify({ run: "not-a-token" }),
        }),
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toMatch(/^[1-9]\d*$/u);
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
