import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  CSP_REPORT_PATH,
  cspHeaderName,
  reportingEndpointsHeader,
} from "../../security/csp";
import { POST as cspReportPost } from "../../../app/api/csp-report/route";

describe("Content Security Policy", () => {
  it("uses report-only for preview/dev and enforcement for production", () => {
    expect(cspHeaderName({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(
      "Content-Security-Policy-Report-Only",
    );
    expect(cspHeaderName({ NODE_ENV: "development" })).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(
      "Content-Security-Policy",
    );
    expect(
      cspHeaderName({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        WCDRAFT_CSP_REPORT_ONLY: "1",
      }),
    ).toBe("Content-Security-Policy-Report-Only");
  });

  it("keeps script execution nonce-based without blanket unsafe-inline", () => {
    const policy = buildContentSecurityPolicy("abc123", {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows the app's known runtime surfaces and reports violations", () => {
    const policy = buildContentSecurityPolicy("abc123", {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("font-src 'self' data:");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(policy).toContain("report-to csp-endpoint");
    expect(reportingEndpointsHeader()).toBe(`csp-endpoint="${CSP_REPORT_PATH}"`);
  });

  it("bounds CSP report intake before logging", async () => {
    const small = await cspReportPost(
      new Request("https://www.wcdraft.com/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: JSON.stringify({ "blocked-uri": "inline" }),
      }),
    );
    expect(small.status).toBe(204);

    const headerRejected = await cspReportPost(
      new Request("https://www.wcdraft.com/api/csp-report", {
        method: "POST",
        headers: { "content-length": "16385" },
        body: "{}",
      }),
    );
    expect(headerRejected.status).toBe(413);

    const bodyRejected = await cspReportPost(
      new Request("https://www.wcdraft.com/api/csp-report", {
        method: "POST",
        body: "x".repeat(16_385),
      }),
    );
    expect(bodyRejected.status).toBe(413);
  });
});
