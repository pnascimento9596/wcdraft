// F-2 (post-review) — validateCookieSecret length/decode contract.
//
// The previous guard accepted any string ≥ 16 chars even though the
// documented contract — and the generator — produce a 32-byte base64url
// secret (43 chars). The reviewer flagged the gap; these tests pin the
// new contract.
import { describe, it, expect } from "vitest";
import { validateCookieSecret } from "@/lib/auth/handler-helpers";

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
    expect(() => validateCookieSecret(SHORT_16_CHAR_ASCII)).toThrow(
      /at least 32 decoded bytes/i,
    );
  });

  it("REJECTS a base64url string that decodes to only 16 bytes", () => {
    expect(() => validateCookieSecret(ONLY_16_BYTES)).toThrow(
      /at least 32 decoded bytes/i,
    );
  });

  it("REJECTS empty / undefined input", () => {
    expect(() => validateCookieSecret(undefined)).toThrow(/is not set/);
    expect(() => validateCookieSecret("")).toThrow(/is not set/);
  });

  it("REJECTS garbage base64url that decodes to <32 bytes", () => {
    // Non-alphabet chars are silently dropped; what remains decodes short.
    expect(() => validateCookieSecret("!@#$%^&*()_+|}{")).toThrow(
      /at least 32 decoded bytes/i,
    );
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateCookieSecret(`   ${VALID_32B}   `)).toBe(VALID_32B);
  });

  it("error message names the var (default AUTH_COOKIE_SECRET)", () => {
    expect(() => validateCookieSecret("short")).toThrow(/AUTH_COOKIE_SECRET/);
  });

  it("var name override surfaces in the error message", () => {
    expect(() =>
      validateCookieSecret("short", "ANOTHER_SECRET"),
    ).toThrow(/ANOTHER_SECRET/);
  });

  it("byte-length floor is configurable", () => {
    // A 16-byte secret passes when the caller declares 16 is enough.
    expect(validateCookieSecret(ONLY_16_BYTES, "X", 16)).toBe(ONLY_16_BYTES);
  });
});
