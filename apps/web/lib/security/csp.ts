export const CSP_NONCE_HEADER = "x-nonce" as const;
export const CSP_REPORT_PATH = "/api/csp-report" as const;
export const CSP_REPORTING_ENDPOINT = "csp-endpoint" as const;

export type CspHeaderName = "Content-Security-Policy" | "Content-Security-Policy-Report-Only";

export interface CspEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  WCDRAFT_CSP_REPORT_ONLY?: string;
}

export function cspHeaderName(env: CspEnv = process.env): CspHeaderName {
  if (env.WCDRAFT_CSP_REPORT_ONLY === "1") return "Content-Security-Policy-Report-Only";
  if (env.WCDRAFT_CSP_REPORT_ONLY === "0") return "Content-Security-Policy";
  if (env.VERCEL_ENV === "preview") return "Content-Security-Policy-Report-Only";
  if (env.NODE_ENV !== "production") return "Content-Security-Policy-Report-Only";
  return "Content-Security-Policy";
}

export function reportingEndpointsHeader(): string {
  return `${CSP_REPORTING_ENDPOINT}="${CSP_REPORT_PATH}"`;
}

export function buildContentSecurityPolicy(nonce: string, env: CspEnv = process.env): string {
  const isDev = env.NODE_ENV !== "production";
  const directives: string[] = [
    directive("default-src", ["'self'"]),
    directive("script-src", [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ]),
    directive("script-src-attr", ["'none'"]),
    directive("style-src", ["'self'", `'nonce-${nonce}'`]),
    directive("style-src-elem", ["'self'", `'nonce-${nonce}'`]),
    // React style attributes drive progress bars, formation coordinates, and
    // slot-machine transforms. Script execution remains nonce-only.
    directive("style-src-attr", ["'unsafe-inline'"]),
    directive("img-src", ["'self'", "data:", "blob:"]),
    directive("font-src", ["'self'", "data:"]),
    directive("connect-src", [
      "'self'",
      "https://vitals.vercel-insights.com",
      "https://*.vercel-insights.com",
      ...(isDev ? ["ws:", "http://localhost:*", "https://localhost:*"] : []),
    ]),
    directive("worker-src", ["'self'", "blob:"]),
    directive("manifest-src", ["'self'"]),
    directive("media-src", ["'self'", "data:", "blob:"]),
    directive("object-src", ["'none'"]),
    directive("base-uri", ["'self'"]),
    directive("form-action", ["'self'"]),
    directive("frame-ancestors", ["'none'"]),
    directive("report-uri", [CSP_REPORT_PATH]),
    directive("report-to", [CSP_REPORTING_ENDPOINT]),
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

function directive(name: string, values: readonly string[]): string {
  return `${name} ${values.join(" ")}`;
}
