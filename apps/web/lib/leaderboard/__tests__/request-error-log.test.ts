import { describe, expect, it, vi } from "vitest";

import {
  createRequestCorrelationId,
  internalErrorResponse,
  logRequestError,
  rateLimitUnavailableResponse,
} from "../../http/request-error-log";

describe("request-error-log", () => {
  it("creates UUID correlation ids", () => {
    expect(createRequestCorrelationId()).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("internalErrorResponse returns 500 with correlation_id and scrubbed body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = internalErrorResponse("POST /api/test", new Error("secret email user@example.com"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "INTERNAL_ERROR",
      message: "The request could not be completed.",
      correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(JSON.stringify(body)).not.toContain("user@example.com");
    expect(spy).toHaveBeenCalled();
    const logged = String(spy.mock.calls[0]?.[1] ?? "");
    expect(logged).toContain("correlation_id");
    expect(logged).not.toContain("user@example.com");
    spy.mockRestore();
  });

  it("rateLimitUnavailableResponse is 503 with Retry-After and correlation", async () => {
    const res = rateLimitUnavailableResponse({
      correlationId: "00000000-0000-4000-8000-000000000001",
      retryAfterSeconds: 60,
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = await res.json();
    expect(body).toMatchObject({
      error: "RATE_LIMIT_UNAVAILABLE",
      correlation_id: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("logRequestError never writes raw error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logRequestError({
      code: "INTERNAL_ERROR",
      correlationId: "cid",
      route: "test",
      error: new Error("pii@example.com leaked"),
    });
    const payload = String(spy.mock.calls[0]?.[1] ?? "");
    expect(payload).not.toContain("pii@example.com");
    expect(payload).toContain('"error_class"');
    spy.mockRestore();
  });
});
