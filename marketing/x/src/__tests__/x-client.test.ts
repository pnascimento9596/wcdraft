import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAuthHeader } from "../x-client/oauth1.ts";
import { loadXCreds, XApiError, XClient } from "../x-client/client.ts";
import { probeTier } from "../x-client/tier-probe.ts";

const CREDS = { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessSecret: "as" };

describe("OAuth1 signing", () => {
  it("is deterministic for fixed nonce + timestamp", () => {
    const a = buildAuthHeader("POST", "https://api.twitter.com/2/tweets", {}, CREDS, {
      nonce: "n1",
      timestamp: 1700000000,
    });
    const b = buildAuthHeader("POST", "https://api.twitter.com/2/tweets", {}, CREDS, {
      nonce: "n1",
      timestamp: 1700000000,
    });
    expect(a).toBe(b);
  });

  it("includes all required oauth fields + a signature", () => {
    const h = buildAuthHeader("GET", "https://api.twitter.com/2/users/me", {}, CREDS, {
      nonce: "n",
      timestamp: 1,
    });
    expect(h.startsWith("OAuth ")).toBe(true);
    for (const k of [
      "oauth_consumer_key",
      "oauth_nonce",
      "oauth_signature_method",
      "oauth_timestamp",
      "oauth_token",
      "oauth_version",
      "oauth_signature",
    ]) {
      expect(h).toContain(`${k}=`);
    }
  });

  it("the signature changes when the query params change", () => {
    const a = buildAuthHeader(
      "GET",
      "https://api.twitter.com/2/tweets/search/recent",
      { query: "a" },
      CREDS,
      { nonce: "n", timestamp: 1 },
    );
    const b = buildAuthHeader(
      "GET",
      "https://api.twitter.com/2/tweets/search/recent",
      { query: "b" },
      CREDS,
      { nonce: "n", timestamp: 1 },
    );
    expect(a).not.toBe(b);
  });

  it("never embeds the raw consumer/token SECRET in the header", () => {
    const h = buildAuthHeader("POST", "https://api.twitter.com/2/tweets", {}, CREDS, {
      nonce: "n",
      timestamp: 1,
    });
    expect(h).not.toContain("cs"); // apiSecret
    expect(h).not.toContain("as"); // accessSecret
  });
});

describe("loadXCreds", () => {
  it("returns null when a required key is missing", () => {
    expect(loadXCreds({ X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t" })).toBeNull();
  });
  it("loads all four required keys (+ optional bearer)", () => {
    const c = loadXCreds({
      X_API_KEY: "k",
      X_API_SECRET: "s",
      X_ACCESS_TOKEN: "t",
      X_ACCESS_SECRET: "x",
      X_BEARER_TOKEN: "b",
    });
    expect(c).toMatchObject({ apiKey: "k", accessSecret: "x", bearer: "b" });
  });
});

describe("XClient (mocked fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createTweet POSTs to /2/tweets with the text body and an OAuth header", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ data: { id: "123", text: "hi" } }), { status: 200 });
    });
    const client = new XClient(CREDS);
    const res = await client.createTweet("hi");
    expect(res.id).toBe("123");
    expect(captured!.url).toContain("/2/tweets");
    expect(captured!.init.method).toBe("POST");
    expect(String((captured!.init.headers as Record<string, string>).Authorization)).toContain(
      "OAuth ",
    );
    expect(JSON.parse(String(captured!.init.body))).toEqual({ text: "hi" });
  });

  it("throws XApiError with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", async () => new Response("forbidden", { status: 403 }));
    const client = new XClient(CREDS);
    await expect(client.createTweet("hi")).rejects.toBeInstanceOf(XApiError);
  });
});

describe("tier probe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("200 search ⇒ basic_or_higher", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    expect((await probeTier(new XClient(CREDS))).tier).toBe("basic_or_higher");
  });

  it("403 search ⇒ free", async () => {
    vi.stubGlobal("fetch", async () => new Response("client-not-enrolled", { status: 403 }));
    expect((await probeTier(new XClient(CREDS))).tier).toBe("free");
  });

  it("402 search (Payment Required) ⇒ free — the real @WCDraft Free-tier signal", async () => {
    vi.stubGlobal("fetch", async () => new Response("payment required", { status: 402 }));
    expect((await probeTier(new XClient(CREDS))).tier).toBe("free");
  });

  it("401/other ⇒ unknown (fails safe, engagement stays gated)", async () => {
    vi.stubGlobal("fetch", async () => new Response("unauthorized", { status: 401 }));
    expect((await probeTier(new XClient(CREDS))).tier).toBe("unknown");
  });
});
