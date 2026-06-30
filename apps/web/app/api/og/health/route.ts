import { NextResponse } from "next/server";

import {
  hasUsableOgSigningSecret,
  RUN_OG_SIGNING_SECRET_ENV,
  RUN_OG_SIGNING_SECRET_MIN_CHARS,
} from "../../../../lib/game/run-og-signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function GET(): Response {
  if (hasUsableOgSigningSecret()) {
    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
  }
  return NextResponse.json(
    {
      ok: false,
      error: "OG_SIGNING_SECRET_MISSING",
      env: RUN_OG_SIGNING_SECRET_ENV,
      min_chars: RUN_OG_SIGNING_SECRET_MIN_CHARS,
    },
    { status: 503, headers: NO_STORE },
  );
}
