import { afterEach, describe, expect, it, vi } from "vitest";

import { RESEND_TIMEOUT_MS, ResendEmailSender } from "@/lib/auth/email";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ResendEmailSender", () => {
  it("aborts and rejects at the explicit delivery timeout", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }),
    );
    const pending = new ResendEmailSender("re_test", "auth@example.invalid").sendMagicLink({
      toEmail: "user@example.com",
      magicLinkUrl: "https://www.wcdraft.test/api/auth/verify?token=secret",
      fromAddress: "auth@example.invalid",
      purpose: "signin",
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: "RequestTimeoutError",
      timeoutMs: RESEND_TIMEOUT_MS,
      retrySafe: false,
    });
    await vi.advanceTimersByTimeAsync(RESEND_TIMEOUT_MS);
    await rejected;
    expect(receivedSignal?.aborted).toBe(true);
  });
});
