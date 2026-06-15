import { DEFAULT_RUNTIME_DATA_BASE_PATH, loadDataManifest } from "@wcdraft/data/client";

import { OG_DEFAULT_IMAGE } from "../../../../lib/site-metadata";
import { renderRunOgImage, type RunOgImageAssets } from "../../../../lib/game/run-og-image";
import {
  readOgSigningSecret,
  sha256Hex,
  verifySignedRunOgPayload,
} from "../../../../lib/game/run-og-signing";
import { composeVersions, runRecordVersionsEqual } from "../../../../lib/game/versions";

export const runtime = "edge";

const FALLBACK_CACHE = "public, max-age=300";
const TRUSTED_IMAGE_CACHE = "public, max-age=31536000, immutable";
const MAX_RUN_PARAM_CHARS = 8192;

let assetsPromise: Promise<RunOgImageAssets> | null = null;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const runValue = url.searchParams.get("run");
    const signedValue = url.searchParams.get("og");
    if (!runValue || runValue.length > MAX_RUN_PARAM_CHARS) return staticFallback(request);
    if (!signedValue) return staticFallback(request);

    const basePath = new URL(DEFAULT_RUNTIME_DATA_BASE_PATH, request.url).toString();
    const manifest = await loadDataManifest({ basePath, fetch: fetch.bind(globalThis) });
    const versions = composeVersions(manifest);

    const secret = readOgSigningSecret();
    if (!secret) return staticFallback(request);
    const payload = await verifySignedRunOgPayload(signedValue, secret);
    if (!payload) return staticFallback(request);
    if (payload.token_hash !== (await sha256Hex(runValue))) return staticFallback(request);
    if (!runRecordVersionsEqual(payload.versions, versions)) return staticFallback(request);

    const image = renderRunOgImage(payload.model, await loadAssets(request));
    image.headers.set("Cache-Control", TRUSTED_IMAGE_CACHE);
    return image;
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

function loadAssets(request: Request): Promise<RunOgImageAssets> {
  assetsPromise ??= (async () => {
    const base = new URL(request.url);
    const [mark, sairaCondensedBold, soraSemiBold, soraBold, jetBrainsMonoBold] = await Promise.all(
      [
        fetchTextAsset(new URL("/brand/wcdraft-mark.svg", base)),
        fetchBinaryAsset(new URL("/fonts/og/SairaCondensed-Bold.ttf", base)),
        fetchBinaryAsset(new URL("/fonts/og/Sora-SemiBold.ttf", base)),
        fetchBinaryAsset(new URL("/fonts/og/Sora-Bold.ttf", base)),
        fetchBinaryAsset(new URL("/fonts/og/JetBrainsMono-Bold.ttf", base)),
      ],
    );
    return {
      markSvgDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(mark)}`,
      fonts: { sairaCondensedBold, soraSemiBold, soraBold, jetBrainsMonoBold },
    };
  })();
  return assetsPromise;
}

async function fetchTextAsset(url: URL): Promise<string> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`run OG asset fetch failed: ${url.pathname}`);
  return response.text();
}

async function fetchBinaryAsset(url: URL): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`run OG font fetch failed: ${url.pathname}`);
  return response.arrayBuffer();
}
