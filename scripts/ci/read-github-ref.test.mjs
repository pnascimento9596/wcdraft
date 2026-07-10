#!/usr/bin/env node

import assert from "node:assert/strict";
import { readGithubRef } from "./read-github-ref.mjs";

const SHA = "95c4cd99d91e5353476e8b465a67b69077151433";
const BASE_ENV = {
  GITHUB_API_URL: "https://api.github.test",
  GITHUB_DEFAULT_BRANCH: "main",
  GITHUB_REF_TOKEN: "test-token-never-print",
  GITHUB_REPOSITORY: "pnascimento9596/wcdraft",
};

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

let capturedUrl;
let capturedInit;
const actual = await readGithubRef({
  env: BASE_ENV,
  fetchImpl: async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return response({ ref: "refs/heads/main", object: { sha: SHA } });
  },
});
assert.equal(actual, SHA);
assert.equal(
  capturedUrl,
  "https://api.github.test/repos/pnascimento9596/wcdraft/git/ref/heads/main",
);
assert.equal(capturedInit.method, "GET");
assert.equal(capturedInit.headers.Authorization, "Bearer test-token-never-print");
assert.equal(capturedInit.headers.Accept, "application/vnd.github+json");

await assert.rejects(
  readGithubRef({
    env: BASE_ENV,
    fetchImpl: async () => response({ secret: "must-not-surface" }, { ok: false, status: 404 }),
  }),
  (error) => {
    assert.match(error.message, /GitHub ref API failed with HTTP 404/);
    assert.doesNotMatch(error.message, /test-token-never-print|must-not-surface/);
    return true;
  },
);
await assert.rejects(
  readGithubRef({
    env: BASE_ENV,
    fetchImpl: async () => response({ ref: "refs/heads/not-main", object: { sha: SHA } }),
  }),
  /different ref/,
);
await assert.rejects(
  readGithubRef({
    env: BASE_ENV,
    fetchImpl: async () => response({ ref: "refs/heads/main", object: { sha: "short" } }),
  }),
  /malformed SHA/,
);
await assert.rejects(
  readGithubRef({
    env: { ...BASE_ENV, GITHUB_REF_TOKEN: "" },
    fetchImpl: async () => response({}),
  }),
  /GITHUB_REF_TOKEN is required/,
);
await assert.rejects(
  readGithubRef({
    env: BASE_ENV,
    fetchImpl: async () => response({ ref: "refs/heads/main", object: null }),
  }),
  /malformed SHA/,
);

console.log("read-github-ref: PASS (success + 5 fail-closed cases)");
