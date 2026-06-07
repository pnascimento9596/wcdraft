// F-3.6 — ship-dark hardening
//
// The decision rule that AuthProvider applies on mount: it must NOT call
// /api/auth/session when authEnabled is false. Tested at the helper level
// because the web vitest config is node-only (no jsdom / no React renderer
// shim) and pulling in a renderer just for this rule would add deps.
import { describe, it, expect } from "vitest";
import { shouldFetchSessionOnMount } from "@/lib/auth/auth-client-policy";

describe("shouldFetchSessionOnMount", () => {
  it("returns false when auth is disabled (ship-dark)", () => {
    expect(shouldFetchSessionOnMount(false)).toBe(false);
  });

  it("returns true when auth is enabled", () => {
    expect(shouldFetchSessionOnMount(true)).toBe(true);
  });
});
