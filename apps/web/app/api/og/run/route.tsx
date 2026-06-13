import { loadDataManifest, loadDraftPoolBundle } from "@wcdraft/data/client";

import { OG_DEFAULT_IMAGE } from "../../../../lib/site-metadata";
import { buildGameData, composeVersions } from "../../../../lib/game/data";
import { renderRunOgImage, type RunOgImageAssets } from "../../../../lib/game/run-og-image";
import { buildRunOgModel } from "../../../../lib/game/run-og-model";
import {
  decodeRunToken,
  runTokenOgSummary,
  versionsAgree,
  type RunTokenV2Body,
} from "../../../../lib/game/run-token";

export const runtime = "edge";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const FALLBACK_CACHE = "public, max-age=300";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const runValue = url.searchParams.get("run");
    if (!runValue) return staticFallback(request);

    const token = decodeRunToken(runValue);
    if (!token || token.v !== 2 || !runTokenOgSummary(token)) {
      return staticFallback(request);
    }

    const basePath = new URL("/data/wcdraft", request.url).toString();
    const manifest = await loadDataManifest({ basePath, fetch: fetch.bind(globalThis) });
    const versions = composeVersions(manifest);
    if (!versionsAgree(token, versions)) return staticFallback(request);

    const draftPool = await loadDraftPoolBundle({ basePath, fetch: fetch.bind(globalThis) });
    const gameData = buildGameData(manifest, draftPool);
    const model = buildRunOgModel(gameData, token as RunTokenV2Body);
    if (!model) return staticFallback(request);

    const response = renderRunOgImage(model, await loadAssets(request));
    response.headers.set("Cache-Control", IMMUTABLE_CACHE);
    return response;
  } catch {
    return staticFallback(request);
  }
}

function staticFallback(request: Request): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(OG_DEFAULT_IMAGE, request.url).toString(),
      "Cache-Control": FALLBACK_CACHE,
    },
  });
}

async function loadAssets(request: Request): Promise<RunOgImageAssets> {
  const [sairaCondensedBold, soraSemiBold, soraBold, jetBrainsMonoBold, markSvg] =
    await Promise.all([
      fetchAsset(request, "/fonts/og/SairaCondensed-Bold.ttf"),
      fetchAsset(request, "/fonts/og/Sora-SemiBold.ttf"),
      fetchAsset(request, "/fonts/og/Sora-Bold.ttf"),
      fetchAsset(request, "/fonts/og/JetBrainsMono-Bold.ttf"),
      fetch(new URL("/brand/wcdraft-mark.svg", request.url)).then(async (res) => {
        if (!res.ok) throw new Error(`failed to load mark svg (${res.status})`);
        return res.text();
      }),
    ]);
  return {
    markSvgDataUri: svgToDataUri(markSvg),
    fonts: { sairaCondensedBold, soraSemiBold, soraBold, jetBrainsMonoBold },
  };
}

async function fetchAsset(request: Request, path: string): Promise<ArrayBuffer> {
  const res = await fetch(new URL(path, request.url));
  if (!res.ok) throw new Error(`failed to load ${path} (${res.status})`);
  return res.arrayBuffer();
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
