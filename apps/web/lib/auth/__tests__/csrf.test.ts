// F-2 — CSRF + Origin/Host pure tests.
import { describe, it, expect } from "vitest";
import { verifyCsrfDoubleSubmit, verifyOriginHost } from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";

const SECRET = "csrf-secret-1234567890123456789012345678901234";

describe("verifyCsrfDoubleSubmit", () => {
  it("accepts matching cookie + header == sessionCsrfSecret", () => {
    expect(() =>
      verifyCsrfDoubleSubmit({
        cookieValue: SECRET,
        headerValue: SECRET,
        sessionCsrfSecret: SECRET,
      }),
    ).not.toThrow();
  });

  it("CSRF_MISSING when header absent", () => {
    expect(() =>
      verifyCsrfDoubleSubmit({
        cookieValue: SECRET,
        headerValue: null,
        sessionCsrfSecret: SECRET,
      }),
    ).toThrow(expect.objectContaining({ code: "CSRF_MISSING" }));
  });

  it("CSRF_MISSING when cookie absent", () => {
    expect(() =>
      verifyCsrfDoubleSubmit({
        cookieValue: undefined,
        headerValue: SECRET,
        sessionCsrfSecret: SECRET,
      }),
    ).toThrow(expect.objectContaining({ code: "CSRF_MISSING" }));
  });

  it("CSRF_MISMATCH when cookie != session secret", () => {
    expect(() =>
      verifyCsrfDoubleSubmit({
        cookieValue: "other-cookie-value",
        headerValue: SECRET,
        sessionCsrfSecret: SECRET,
      }),
    ).toThrow(expect.objectContaining({ code: "CSRF_MISMATCH" }));
  });

  it("CSRF_MISMATCH when header != session secret (header forged)", () => {
    expect(() =>
      verifyCsrfDoubleSubmit({
        cookieValue: SECRET,
        headerValue: "header-forged-by-attacker-but-matches-cookie-shape",
        sessionCsrfSecret: SECRET,
      }),
    ).toThrow(expect.objectContaining({ code: "CSRF_MISMATCH" }));
  });

  it("rejection is AuthError with HTTP status 401", () => {
    try {
      verifyCsrfDoubleSubmit({
        cookieValue: "a",
        headerValue: "b",
        sessionCsrfSecret: SECRET,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).status).toBe(401);
    }
  });
});

describe("verifyOriginHost", () => {
  it("accepts Origin host matching Host header", () => {
    expect(() =>
      verifyOriginHost({
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
      }),
    ).not.toThrow();
  });

  it("falls back to Referer when Origin is null", () => {
    expect(() =>
      verifyOriginHost({
        origin: null,
        referer: "https://wcdraft.com/sign-in",
        host: "wcdraft.com",
      }),
    ).not.toThrow();
  });

  it("ORIGIN_MISMATCH when Origin host differs from Host", () => {
    expect(() =>
      verifyOriginHost({
        origin: "https://evil.example",
        referer: null,
        host: "wcdraft.com",
      }),
    ).toThrow(expect.objectContaining({ code: "ORIGIN_MISMATCH" }));
  });

  it("ORIGIN_MISMATCH when both Origin and Referer are null", () => {
    expect(() => verifyOriginHost({ origin: null, referer: null, host: "wcdraft.com" })).toThrow(
      expect.objectContaining({ code: "ORIGIN_MISMATCH" }),
    );
  });

  it("ORIGIN_MISMATCH when Host header is missing", () => {
    expect(() =>
      verifyOriginHost({
        origin: "https://wcdraft.com",
        referer: null,
        host: null,
      }),
    ).toThrow(expect.objectContaining({ code: "ORIGIN_MISMATCH" }));
  });

  it("ORIGIN_MISMATCH when Origin is not a URL", () => {
    expect(() =>
      verifyOriginHost({
        origin: "not a url",
        referer: null,
        host: "wcdraft.com",
      }),
    ).toThrow(expect.objectContaining({ code: "ORIGIN_MISMATCH" }));
  });
});
