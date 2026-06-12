// F-3.5 — ship-dark gate.
//
// The gate is the contract that decides whether the sign-in UI surfaces
// in production. It MUST be false unless all three env vars are present
// and non-blank. Whitespace counts as blank — defence against a half-
// configured env where someone pasted a trailing space.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAuthEnabled, getAuthConfig } from "@/lib/auth/auth-enabled";

const KEYS = ["RESEND_API_KEY", "AUTH_EMAIL_FROM", "AUTH_BASE_URL"] as const;

function snapshot(): Record<(typeof KEYS)[number], string | undefined> {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    AUTH_BASE_URL: process.env.AUTH_BASE_URL,
  };
}

let originals: ReturnType<typeof snapshot>;

beforeEach(() => {
  originals = snapshot();
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (originals[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originals[k];
    }
  }
});

describe("isAuthEnabled", () => {
  it.each([
    [false, false, false, false],
    [true, false, false, false],
    [false, true, false, false],
    [false, false, true, false],
    [true, true, false, false],
    [true, false, true, false],
    [false, true, true, false],
    [true, true, true, true],
  ])(
    "truth table: RESEND_API_KEY=%s AUTH_EMAIL_FROM=%s AUTH_BASE_URL=%s -> %s",
    (hasApiKey, hasFromAddress, hasBaseUrl, expected) => {
      if (hasApiKey) process.env.RESEND_API_KEY = "re_real_value";
      if (hasFromAddress) {
        process.env.AUTH_EMAIL_FROM = "wcdraft <noreply@wcdraft.com>";
      }
      if (hasBaseUrl) process.env.AUTH_BASE_URL = "https://www.wcdraft.com";

      expect(isAuthEnabled()).toBe(expected);
      expect(getAuthConfig()).toEqual({ authEnabled: expected });
    },
  );

  it("FALSE when any value is blank (just whitespace)", () => {
    process.env.RESEND_API_KEY = "re_demo";
    process.env.AUTH_EMAIL_FROM = "   ";
    process.env.AUTH_BASE_URL = "https://www.wcdraft.com";
    expect(isAuthEnabled()).toBe(false);
    process.env.RESEND_API_KEY = "   ";
    process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@resend.dev>";
    process.env.AUTH_BASE_URL = "https://www.wcdraft.com";
    expect(isAuthEnabled()).toBe(false);
    process.env.RESEND_API_KEY = "re_demo";
    process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@resend.dev>";
    process.env.AUTH_BASE_URL = "   ";
    expect(isAuthEnabled()).toBe(false);
  });

  it("FALSE when any value is empty string", () => {
    process.env.RESEND_API_KEY = "";
    process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@resend.dev>";
    process.env.AUTH_BASE_URL = "https://www.wcdraft.com";
    expect(isAuthEnabled()).toBe(false);
  });

  it("TRUE only when all three production auth env values are present and non-blank", () => {
    process.env.RESEND_API_KEY = "re_real_value";
    process.env.AUTH_EMAIL_FROM = "wcdraft <noreply@wcdraft.com>";
    process.env.AUTH_BASE_URL = "https://www.wcdraft.com";
    expect(isAuthEnabled()).toBe(true);
    expect(getAuthConfig()).toEqual({ authEnabled: true });
  });

  it("trims whitespace before evaluating", () => {
    process.env.RESEND_API_KEY = "  re_padded_value  ";
    process.env.AUTH_EMAIL_FROM = "  wcdraft <noreply@wcdraft.com>  ";
    process.env.AUTH_BASE_URL = "  https://www.wcdraft.com  ";
    expect(isAuthEnabled()).toBe(true);
  });
});
