import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetAuthProbeSingleFlightForTests,
  cookieSecretIsConfigured,
  probeAuthBootstrapDependencies,
} from "../auth-probe";

const STRONG_SECRET = Buffer.alloc(32, 9).toString("base64url");

afterEach(() => {
  __resetAuthProbeSingleFlightForTests();
});

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
    const transaction = vi.fn(async (fn: (tx: { select: typeof select; execute: typeof execute }) => Promise<void>) => {
      await fn({ select, execute });
    });

    const db = { select, execute, transaction } as never;
    await probeAuthBootstrapDependencies(db, 1_700_000_000_000);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(selectLimit).toHaveBeenCalledWith(1);
    // set_config + shape canary
    expect(execute).toHaveBeenCalledTimes(2);
    // No insert/update/delete on the probe path.
    expect(db).not.toHaveProperty("insert");
  });

  it("throws when execute result lacks a rows array (historical shape edge)", async () => {
    const selectLimit = vi.fn(async () => []);
    const select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: selectLimit }),
        }),
      }),
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ set_config: "2000" }] })
      .mockResolvedValueOnce({});
    const db = {
      select,
      execute,
      transaction: async (fn: (tx: { select: typeof select; execute: typeof execute }) => Promise<void>) => {
        await fn({ select, execute });
      },
    } as never;

    await expect(probeAuthBootstrapDependencies(db, Date.now())).rejects.toThrow(
      /missing rows array/i,
    );
  });

  it("single-flights concurrent probes onto one in-flight transaction", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const selectLimit = vi.fn(async () => {
      await gate;
      return [] as { id: string }[];
    });
    const select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: selectLimit }),
        }),
      }),
    });
    const execute = vi.fn(async () => ({ rows: [{ ok: "1" }] }));
    const transaction = vi.fn(async (fn: (tx: { select: typeof select; execute: typeof execute }) => Promise<void>) => {
      await fn({ select, execute });
    });
    const db = { select, execute, transaction } as never;

    const a = probeAuthBootstrapDependencies(db, 1);
    const b = probeAuthBootstrapDependencies(db, 1);
    expect(transaction).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([a, b]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
