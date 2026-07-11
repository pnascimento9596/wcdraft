import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildRuntimeDeps: vi.fn(),
  consumeAndIssueSession: vi.fn(),
}));

vi.mock("@/lib/auth/auth-enabled", () => ({ isAuthEnabled: () => true }));
vi.mock("@/lib/auth/handler-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/handler-helpers")>()),
  buildRuntimeDeps: mocks.buildRuntimeDeps,
}));
vi.mock("@/lib/auth/verify-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/verify-flow")>()),
  consumeAndIssueSession: mocks.consumeAndIssueSession,
}));

import { POST } from "@/app/api/auth/verify/route";

describe("/api/auth/verify POST ordering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a bad Origin before parsing the form or touching runtime deps", async () => {
    const req = new NextRequest("https://www.wcdraft.com/api/auth/verify", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        host: "www.wcdraft.com",
        origin: "https://attacker.example",
      },
      body: "token=secret&next=%2Fplay&csrf=value",
    });
    const formData = vi.spyOn(req, "formData");

    const response = await POST(req);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "ORIGIN_MISMATCH" });
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.buildRuntimeDeps).not.toHaveBeenCalled();
    expect(mocks.consumeAndIssueSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
