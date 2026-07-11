// F-2 (post-review) — validateCookieSecret length/decode contract.
//
// The previous guard accepted any string ≥ 16 chars even though the
// documented contract — and the generator — produce a 32-byte base64url
// secret (43 chars). The reviewer flagged the gap; these tests pin the
// new contract.
import { describe, it, expect, vi } from "vitest";
import { jsonError, validateCookieSecret } from "@/lib/auth/handler-helpers";
import { AuthError } from "@/lib/auth/errors";

const VALID_32B = Buffer.alloc(32, 0x41).toString("base64url"); // 43 chars
const VALID_64B = Buffer.alloc(64, 0x41).toString("base64url"); // 86 chars
const ONLY_16_BYTES = Buffer.alloc(16, 0x41).toString("base64url"); // 22 chars
const SHORT_16_CHAR_ASCII = "abcdefghijklmnop"; // legacy guard accepted this

describe("validateCookieSecret", () => {
  it("accepts a 32-byte base64url secret (43 chars)", () => {
    expect(validateCookieSecret(VALID_32B)).toBe(VALID_32B);
  });

  it("accepts a longer base64url secret (≥32 decoded bytes)", () => {
    expect(validateCookieSecret(VALID_64B)).toBe(VALID_64B);
  });

  it("REJECTS the legacy 16-char ASCII string (was accepted before the fix)", () => {
    expect(() => validateCookieSecret(SHORT_16_CHAR_ASCII)).toThrow(/at least 32 decoded bytes/i);
  });

  it("REJECTS a base64url string that decodes to only 16 bytes", () => {
    expect(() => validateCookieSecret(ONLY_16_BYTES)).toThrow(/at least 32 decoded bytes/i);
  });

  it("REJECTS empty / undefined input", () => {
    expect(() => validateCookieSecret(undefined)).toThrow(/is not set/);
    expect(() => validateCookieSecret("")).toThrow(/is not set/);
  });

  it("REJECTS garbage base64url that decodes to <32 bytes", () => {
    // Non-alphabet chars are silently dropped; what remains decodes short.
    expect(() => validateCookieSecret("!@#$%^&*()_+|}{")).toThrow(/at least 32 decoded bytes/i);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateCookieSecret(`   ${VALID_32B}   `)).toBe(VALID_32B);
  });

  it("error message names the var (default AUTH_COOKIE_SECRET)", () => {
    expect(() => validateCookieSecret("short")).toThrow(/AUTH_COOKIE_SECRET/);
  });

  it("var name override surfaces in the error message", () => {
    expect(() => validateCookieSecret("short", "ANOTHER_SECRET")).toThrow(/ANOTHER_SECRET/);
  });

  it("byte-length floor is configurable", () => {
    // A 16-byte secret passes when the caller declares 16 is enough.
    expect(validateCookieSecret(ONLY_16_BYTES, "X", 16)).toBe(ONLY_16_BYTES);
  });
});

// q-008 — the var name / generation hint stays SERVER-SIDE: jsonError scrubs
// SECRET_MISCONFIGURED detail into a generic client body (full message goes
// to console.error). Other codes keep their code-level copy untouched.
describe("jsonError — SECRET_MISCONFIGURED body scrub (q-008)", () => {
  it("returns a generic body with no env-var names or generation hints", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const err = (() => {
        try {
          validateCookieSecret(undefined);
          throw new Error("unreachable");
        } catch (e) {
          return e;
        }
      })();
      const res = jsonError(err);
      // accounts-activation — misconfigured env is an honest 503 (substrate
      // unavailable), never a 500.
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("SECRET_MISCONFIGURED");
      expect(body.message).toBe("Server configuration error.");
      expect(JSON.stringify(body)).not.toMatch(/AUTH_COOKIE_SECRET|randomBytes|base64url/);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(
        /AUTH_COOKIE_SECRET|randomBytes|base64url/,
      );
      expect(spy).toHaveBeenCalledWith(
        "[security]",
        expect.stringContaining("AUTH_CONFIGURATION_ERROR"),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("other AuthError codes keep their message in the body", async () => {
    const res = jsonError(new AuthError("RATE_LIMITED", "Too many requests"));
    const body = (await res.json()) as { error: string; message: string };
    expect(res.status).toBe(429);
    expect(body.message).toBe("Too many requests. Try again later.");
  });

  it("redacts unexpected database error messages from logs and responses", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = jsonError(new Error("database failed for victim@example.com"));
      const body = (await res.json()) as Record<string, string>;
      expect(res.status).toBe(500);
      expect(body).toMatchObject({
        error: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      });
      expect(body.correlation_id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(JSON.stringify(body)).not.toContain("victim@example.com");
      expect(JSON.stringify(spy.mock.calls)).not.toContain("victim@example.com");
      expect(spy).toHaveBeenCalledWith(
        "[security]",
        expect.stringContaining("AUTH_UNEXPECTED_ERROR"),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
