import { describe, expect, it, vi } from "vitest";

import { cookieSecretIsConfigured, probeAuthBootstrapDependencies } from "../auth-probe";

const STRONG_SECRET = Buffer.alloc(32, 9).toString("base64url");

describe("auth bootstrap health probe", () => {
  it("accepts a 32-byte base64url cookie secret and rejects empty/weak", () => {
    expect(cookieSecretIsConfigured(STRONG_SECRET)).toBe(true);
    expect(cookieSecretIsConfigured(undefined)).toBe(false);
    expect(cookieSecretIsConfigured("")).toBe(false);
    expect(cookieSecretIsConfigured("   ")).toBe(false);
    expect(cookieSecretIsConfigured("short")).toBe(false);
  });

  it("runs a read-only sessions select and execute shape check without mutations", async () => {
    const selectLimit = vi.fn(async () => [] as { id: string }[]);
    const orderBy = vi.fn(() => ({ limit: selectLimit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const execute = vi.fn(async () => ({ rows: [{ ok: "1" }] }));

    const db = { select, execute } as never;
    await probeAuthBootstrapDependencies(db, 1_700_000_000_000);

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(selectLimit).toHaveBeenCalledWith(1);
    expect(execute).toHaveBeenCalledTimes(1);
    // No insert/update/delete on the probe path.
    expect(db).not.toHaveProperty("insert");
  });

  it("throws when execute result lacks a rows array (historical shape edge)", async () => {
    const selectLimit = vi.fn(async () => []);
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: selectLimit }),
          }),
        }),
      }),
      execute: vi.fn(async () => ({})),
    } as never;

    await expect(probeAuthBootstrapDependencies(db, Date.now())).rejects.toThrow(
      /missing rows array/i,
    );
  });
});
