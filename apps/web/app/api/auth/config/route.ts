// F-3.5 — GET /api/auth/config
//
// Returns the ship-dark gate state so the client can choose whether to
// surface the sign-in UI. No secret data — just the boolean flag.
//
// Read-only, no CSRF, no session required. Edge-safe.
import { NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/auth-enabled";

export async function GET(): Promise<NextResponse> {
  // The cache directive is a defensive note — the config rarely changes
  // and the response is tiny; but a cached-stale value would leave the UI
  // out of sync with reality after a Vercel env change. no-store keeps it
  // honest.
  const response = NextResponse.json(getAuthConfig());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
