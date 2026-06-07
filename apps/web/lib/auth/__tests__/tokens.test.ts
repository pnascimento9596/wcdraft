// F-2 — tokens + signed cookie pure tests.
import { describe, it, expect } from "vitest";
import {
  generateOpaqueToken,
  generateToken,
  sha256Hex,
  timingSafeStringEqual,
  base64UrlEncode,
} from "@/lib/auth/tokens";
import {
  signCookie,
  parseSignedCookie,
} from "@/lib/auth/sessions";

describe("generateOpaqueToken", () => {
  it("returns 43-char base64url (32 bytes, no padding)", () => {
    const t = generateOpaqueToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns a different value on each call (CSPRNG)", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
  });
});

describe("generateToken", () => {
  it("returns token + sha-256 hex of the token", () => {
    const { token, tokenHash } = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(sha256Hex(token));
  });
});

describe("timingSafeStringEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeStringEqual("abc", "abc")).toBe(true);
  });
  it("returns false for different strings", () => {
    expect(timingSafeStringEqual("abc", "abd")).toBe(false);
  });
  it("returns false (not throw) for different lengths", () => {
    expect(timingSafeStringEqual("abc", "abcd")).toBe(false);
  });
});

describe("base64UrlEncode", () => {
  it("strips padding and uses URL-safe alphabet", () => {
    expect(base64UrlEncode(Buffer.from("hello"))).toBe("aGVsbG8");
    expect(base64UrlEncode(Buffer.from("?>:>"))).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("signCookie + parseSignedCookie", () => {
  const SECRET = "cookie-secret-32-bytes-_____________________________";

  it("produces <payload>.<sig>", () => {
    const cv = signCookie("session-id-abc", SECRET);
    expect(cv).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const parsed = parseSignedCookie(cv);
    expect(parsed).not.toBeNull();
    expect(parsed?.payload).toBe("session-id-abc");
  });

  it("parseSignedCookie rejects malformed input", () => {
    expect(parseSignedCookie("")).toBeNull();
    expect(parseSignedCookie(".")).toBeNull();
    expect(parseSignedCookie(".sig")).toBeNull();
    expect(parseSignedCookie("payload.")).toBeNull();
    expect(parseSignedCookie("not-base64url!@#.also")).toBeNull();
  });

  it("signature changes when secret changes (forgery resistant)", () => {
    const a = signCookie("x", "secret-a");
    const b = signCookie("x", "secret-b");
    expect(a).not.toBe(b);
  });

  it("signature is deterministic for the same (payload, secret)", () => {
    expect(signCookie("y", SECRET)).toBe(signCookie("y", SECRET));
  });
});
