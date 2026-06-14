import { NextResponse, type NextRequest } from "next/server";

import {
  buildContentSecurityPolicy,
  CSP_NONCE_HEADER,
  cspHeaderName,
  reportingEndpointsHeader,
} from "./lib/security/csp";

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy(nonce);
  const headerName = cspHeaderName();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set(headerName, policy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(headerName, policy);
  response.headers.set("Reporting-Endpoints", reportingEndpointsHeader());
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|sw-version.js|brand|data|flags|fonts|icons).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}
