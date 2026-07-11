import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  userId: "user-full" as string | null,
  bodyReads: 0,
  resolveMutationAuth: vi.fn(),
  readQuota: vi.fn(),
  saveRun: vi.fn(),
  setRunPinnedByRunId: vi.fn(),
}));

vi.mock("@/lib/game/__server-auth-context", () => ({
  resolveMutationAuth: seams.resolveMutationAuth,
  resolveAuth: vi.fn(),
}));

vi.mock("@/lib/game/saved-runs-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/saved-runs-store")>();
  return {
    ...actual,
    readSavedRunQuota: seams.readQuota,
    saveRun: seams.saveRun,
    setRunPinnedByRunId: seams.setRunPinnedByRunId,
  };
});

import { PATCH, POST } from "@/app/api/runs/route";

const MAX_BYTES = 8 * 1024 * 1024;

function request(body: string, origin = "https://wcdraft.test"): Parameters<typeof POST>[0] {
  const encoded = new TextEncoder().encode(body);
  const headers = new Headers({
    "content-type": "application/json",
    "content-length": encoded.byteLength.toString(),
    cookie: "wcdraft_csrf=csrf-secret",
    host: "wcdraft.test",
    origin,
    "x-csrf-token": "csrf-secret",
  });
  let sent = false;
  return {
    headers,
    body: {
      getReader: () => ({
        read: async () => {
          seams.bodyReads += 1;
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: encoded };
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  seams.userId = "user-full";
  seams.bodyReads = 0;
  seams.resolveMutationAuth.mockReset();
  seams.readQuota.mockReset();
  seams.saveRun.mockReset();
  seams.setRunPinnedByRunId.mockReset();
  seams.resolveMutationAuth.mockImplementation(async () => ({
    ctx: { userId: seams.userId, sessionId: "session-1" },
    csrfSecret: "csrf-secret",
    deps: { db: {} },
    // Model the stateless-bootstrap upgrade: if Origin verification ever
    // moves below this seam again, the error path would attach these cookies.
    freshSession: { cookieValue: "fresh-session-cookie", csrfSecret: "csrf-secret" },
  }));
  seams.readQuota.mockResolvedValue({
    maxRows: 500,
    maxBytes: MAX_BYTES,
    usedRows: 500,
    usedBytes: MAX_BYTES,
  });
});

describe("POST /api/runs account byte-quota preflight", () => {
  it("rejects a full account before reading or parsing the request body", async () => {
    const response = await POST(request('{"token":"t1.never-read"}'));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "SAVED_RUN_QUOTA_EXCEEDED" });
    expect(seams.readQuota).toHaveBeenCalledTimes(1);
    expect(seams.bodyReads).toBe(0);
    expect(seams.saveRun).not.toHaveBeenCalled();
  });

  it("keeps anonymous saves on the five-row transactional policy", async () => {
    seams.userId = null;
    seams.saveRun.mockResolvedValue({
      row: {
        id: "run-1",
        token: "t1.anon",
        runId: null,
        parentSeed: null,
        versionAnchors: null,
        summary: null,
        claimState: "anonymous",
        payloadBytes: 64,
        pinnedAt: null,
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
      },
      evicted: [],
      idempotent: false,
      quota: { maxRows: 5, maxBytes: MAX_BYTES, usedRows: 1, usedBytes: 64 },
    });

    const response = await POST(request('{"token":"t1.anon"}'));

    expect(response.status).toBe(201);
    expect(seams.readQuota).not.toHaveBeenCalled();
    expect(seams.bodyReads).toBeGreaterThan(0);
    expect(seams.saveRun).toHaveBeenCalledTimes(1);
    expect(seams.saveRun.mock.calls[0]?.[1]).toEqual({ userId: null, sessionId: "session-1" });
  });
});

describe("mutating /api/runs Origin firewall", () => {
  it("rejects a cross-origin POST before auth bootstrap materialization", async () => {
    const response = await POST(request('{"token":"t1.never-read"}', "https://attacker.test"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "ORIGIN_MISMATCH" });
    expect(seams.resolveMutationAuth).not.toHaveBeenCalled();
    expect(seams.bodyReads).toBe(0);
    expect(seams.saveRun).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a cross-origin PATCH before auth bootstrap materialization", async () => {
    const response = await PATCH(
      request('{"runId":"run-1","pinned":true}', "https://attacker.test"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "ORIGIN_MISMATCH" });
    expect(seams.resolveMutationAuth).not.toHaveBeenCalled();
    expect(seams.bodyReads).toBe(0);
    expect(seams.setRunPinnedByRunId).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
