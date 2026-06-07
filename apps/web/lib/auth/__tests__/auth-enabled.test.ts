// F-3.5 — ship-dark gate.
//
// The gate is the contract that decides whether the sign-in UI surfaces
// in production. It MUST be false unless BOTH env vars are present and
// non-blank. Whitespace counts as blank — defence against a half-
// configured env where someone pasted a trailing space.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAuthEnabled, getAuthConfig } from "@/lib/auth/auth-enabled";

const KEYS = ["RESEND_API_KEY", "AUTH_EMAIL_FROM"] as const;

function snapshot(): Record<(typeof KEYS)[number], string | undefined> {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
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
  it("FALSE when both env vars are missing", () => {
    expect(isAuthEnabled()).toBe(false);
    expect(getAuthConfig()).toEqual({ authEnabled: false });
  });

  it("FALSE with only RESEND_API_KEY", () => {
    process.env.RESEND_API_KEY = "re_demo";
    expect(isAuthEnabled()).toBe(false);
  });

  it("FALSE with only AUTH_EMAIL_FROM", () => {
    process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@resend.dev>";
    expect(isAuthEnabled()).toBe(false);
  });

  it("FALSE when either value is blank (just whitespace)", () => {
    process.env.RESEND_API_KEY = "re_demo";
    process.env.AUTH_EMAIL_FROM = "   ";
    expect(isAuthEnabled()).toBe(false);
    process.env.RESEND_API_KEY = "   ";
    process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@resend.dev>";
    expect(isAuthEnabled()).toBe(false);
  });

  it("FALSE when either value is empty string", () => {
    process.env.RESEND_API_KEY = "";
    process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@resend.dev>";
    expect(isAuthEnabled()).toBe(false);
  });

  it("TRUE only when BOTH values are present and non-blank", () => {
    process.env.RESEND_API_KEY = "re_real_value";
    process.env.AUTH_EMAIL_FROM = "wcdraft <noreply@wcdraft.com>";
    expect(isAuthEnabled()).toBe(true);
    expect(getAuthConfig()).toEqual({ authEnabled: true });
  });

  it("trims whitespace before evaluating", () => {
    process.env.RESEND_API_KEY = "  re_padded_value  ";
    process.env.AUTH_EMAIL_FROM = "  wcdraft <noreply@wcdraft.com>  ";
    expect(isAuthEnabled()).toBe(true);
  });
});
