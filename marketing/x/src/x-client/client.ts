// Minimal X API v2 client (OAuth 1.0a user context). Only the calls the
// poster + engagement lanes need: create post, whoami, search, mentions,
// follow. SECRET HYGIENE: credentials are read from the environment by name,
// never logged; the Authorization header is built per-request and discarded.
// Error bodies from X never contain our secrets, but we still cap + carry only
// a short snippet for diagnostics.

import { buildAuthHeader, type OAuth1Creds } from "./oauth1.ts";
import type { Poster } from "../pipeline.ts";

const API_BASE = "https://api.twitter.com/2";

export interface XCreds extends OAuth1Creds {
  bearer?: string;
}

/** Load creds from env by NAME. Returns null when any required key is absent. */
export function loadXCreds(env: NodeJS.ProcessEnv = process.env): XCreds | null {
  const apiKey = env.X_API_KEY;
  const apiSecret = env.X_API_SECRET;
  const accessToken = env.X_ACCESS_TOKEN;
  const accessSecret = env.X_ACCESS_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret, bearer: env.X_BEARER_TOKEN };
}

export class XApiError extends Error {
  constructor(
    readonly status: number,
    readonly bodySnippet: string,
  ) {
    super(`X API ${status}: ${bodySnippet}`);
    this.name = "XApiError";
  }
}

export class XClient implements Poster {
  constructor(private readonly creds: XCreds) {}

  private async request(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<unknown> {
    const query = opts.query ?? {};
    const baseUrl = `${API_BASE}${path}`;
    const qs = Object.keys(query).length
      ? "?" +
        Object.entries(query)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join("&")
      : "";
    const auth = buildAuthHeader(method, baseUrl, query, this.creds);
    const res = await fetch(baseUrl + qs, {
      method,
      headers: {
        Authorization: auth,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new XApiError(res.status, text.slice(0, 500));
    return text ? JSON.parse(text) : {};
  }

  /** POST /2/tweets — create a post (optionally a reply or quote). */
  async createTweet(
    text: string,
    opts: { in_reply_to_tweet_id?: string; quote_tweet_id?: string } = {},
  ): Promise<{ id: string; text: string }> {
    const body: Record<string, unknown> = { text };
    if (opts.in_reply_to_tweet_id) body.reply = { in_reply_to_tweet_id: opts.in_reply_to_tweet_id };
    if (opts.quote_tweet_id) body.quote_tweet_id = opts.quote_tweet_id;
    const json = (await this.request("POST", "/tweets", { body })) as {
      data?: { id: string; text: string };
    };
    if (!json.data?.id) throw new XApiError(200, "tweet response missing data.id");
    return json.data;
  }

  /** Poster seam used by the pipeline. */
  async post(text: string): Promise<{ id: string }> {
    return this.createTweet(text);
  }

  /** GET /2/users/me — the authenticated account. */
  async getMe(): Promise<{ id: string; username: string; name: string }> {
    const json = (await this.request("GET", "/users/me", {
      query: { "user.fields": "username,name" },
    })) as { data?: { id: string; username: string; name: string } };
    if (!json.data?.id) throw new XApiError(200, "users/me missing data.id");
    return json.data;
  }

  /** GET /2/tweets/search/recent — Basic tier or higher. */
  async searchRecent(query: string, maxResults = 10): Promise<unknown> {
    return this.request("GET", "/tweets/search/recent", {
      query: {
        query,
        max_results: String(Math.min(Math.max(maxResults, 10), 100)),
        "tweet.fields": "author_id,created_at,conversation_id,text",
      },
    });
  }

  /** GET /2/users/:id/mentions — Basic tier or higher. */
  async getMentions(userId: string, sinceId?: string): Promise<unknown> {
    const query: Record<string, string> = {
      max_results: "20",
      "tweet.fields":
        "author_id,created_at,conversation_id,referenced_tweets,in_reply_to_user_id,text",
    };
    if (sinceId) query.since_id = sinceId;
    return this.request("GET", `/users/${encodeURIComponent(userId)}/mentions`, { query });
  }

  /** POST /2/users/:id/following — follow an account. */
  async follow(sourceUserId: string, targetUserId: string): Promise<unknown> {
    return this.request("POST", `/users/${encodeURIComponent(sourceUserId)}/following`, {
      body: { target_user_id: targetUserId },
    });
  }
}
