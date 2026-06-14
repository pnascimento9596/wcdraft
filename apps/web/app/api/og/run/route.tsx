import { DEFAULT_RUNTIME_DATA_BASE_PATH, loadDataManifest } from "@wcdraft/data/client";

import { OG_DEFAULT_IMAGE } from "../../../../lib/site-metadata";
import { composeVersions } from "../../../../lib/game/data";
import { decodeRunToken, runTokenOgSummary, versionsAgree } from "../../../../lib/game/run-token";

export const runtime = "edge";

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

    const basePath = new URL(DEFAULT_RUNTIME_DATA_BASE_PATH, request.url).toString();
    const manifest = await loadDataManifest({ basePath, fetch: fetch.bind(globalThis) });
    const versions = composeVersions(manifest);
    if (!versionsAgree(token, versions)) return staticFallback(request);

    // Current `t2` summaries are browser-minted and intentionally unsigned.
    // Until a future signed/server-minted token carries enough trusted display
    // detail to render without replaying the full draft catalog, the safe edge
    // behavior is the static default. This keeps the route out of the full
    // 100MB draft-pool parse path on every cold render.
    return staticFallback(request);
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
