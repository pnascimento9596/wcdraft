#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function readGithubRef({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = required(env, "GITHUB_REF_TOKEN");
  const repository = required(env, "GITHUB_REPOSITORY");
  const branch = required(env, "GITHUB_DEFAULT_BRANCH");
  const apiUrl = (env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/$/, "");

  if (!REPOSITORY_PATTERN.test(repository)) throw new Error("GITHUB_REPOSITORY is malformed");
  if (branch.startsWith("/") || branch.endsWith("/") || branch.includes("..")) {
    throw new Error("GITHUB_DEFAULT_BRANCH is malformed");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const [owner, repo] = repository.split("/");
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  const url =
    `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/git/ref/heads/${encodedBranch}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response?.ok) {
    const status = Number.isInteger(response?.status) ? response.status.toString() : "unknown";
    throw new Error(`GitHub ref API failed with HTTP ${status}`);
  }

  const payload = await response.json();
  const expectedRef = `refs/heads/${branch}`;
  if (payload?.ref !== expectedRef) throw new Error("GitHub ref API returned a different ref");
  const sha = payload?.object?.sha;
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    throw new Error("GitHub ref API returned a malformed SHA");
  }
  return sha;
}

async function main() {
  const sha = await readGithubRef();
  process.stdout.write(sha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown failure";
    console.error(`[read-github-ref] FAILED: ${message}`);
    process.exit(1);
  });
}
