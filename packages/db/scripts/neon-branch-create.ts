// F-1 — create an EPHEMERAL Neon branch + emit its connection URLs.
//
// Reads NEON_API_KEY and NEON_PROJECT_ID from env (set by CI as repo
// secrets, or sourced from ~/.config/wcdraft/neon.env for local runs).
// Forks off the project's default/primary branch, requests a read_write
// endpoint, and fetches both pooled + unpooled connection URIs for the new
// branch via the Neon `connection_uri` API.
//
// Emits the credentials to:
//   1) a file path passed as the first CLI arg (atomic ENV file the CI job
//      sources for migrate + rollback-check; mode 0600), and
//   2) GITHUB_OUTPUT (if set) as `branch_id=...` so the workflow's
//      always() cleanup step can delete the branch.
//
// Never echoes secret values to stdout/stderr. Only prints redacted
// identifiers (branch id, name, endpoint prefix) plus a CI-visible LENGTH
// diagnostic for NEON_API_KEY + NEON_PROJECT_ID so future drift between
// the stored secret and the value the script sees is obvious in the run
// log without ever revealing the value itself.
import { writeFileSync, chmodSync, appendFileSync } from "node:fs";

const NEON_API = "https://console.neon.tech/api/v2";

function readEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(
      `${name} is not set. CI sets this as a repo secret; locally, source ` +
        `~/.config/wcdraft/neon.env first.`,
    );
  }
  // Defensive trim: a stored secret with a stray trailing newline would
  // make the `Bearer <token>\n` header silently invalid (Neon returns 401).
  // Trim only outer whitespace — never the middle.
  return raw.trim();
}

async function neonRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const resp = await fetch(`${NEON_API}${path}`, init);
  if (!resp.ok) {
    const text = await resp.text();
    // SAFE excerpt — don't echo more than necessary. The token is in the
    // request header, not the response body, so this is fine.
    throw new Error(
      `Neon API ${method} ${path} failed: HTTP ${resp.status.toString()} ${text.slice(0, 300)}`,
    );
  }
  return (await resp.json()) as T;
}

function shortId(s: string, n = 10): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function endpointPrefix(uri: string): string {
  const m = /@(ep-[^.]+)\./.exec(uri);
  return m ? m[1]! : "<no-endpoint>";
}

interface BranchListResp {
  branches: {
    id: string;
    name: string;
    default?: boolean;
    primary?: boolean;
    default_role_name?: string;
  }[];
}

interface BranchCreateResp {
  branch: { id: string; name: string; current_state?: string };
}

interface ConnectionUriResp {
  uri: string;
}

async function main(): Promise<void> {
  const apiKey = readEnv("NEON_API_KEY");
  const projectId = readEnv("NEON_PROJECT_ID");
  const outPath = process.argv[2];
  if (!outPath) {
    throw new Error("usage: neon-branch-create.ts <env-file-out-path>");
  }

  // DIAGNOSTIC: print only SAFE metadata. If the secret reaches the script
  // truncated/empty/with-trailing-newline, the length and prefix below
  // surface it BEFORE Neon's 401 hides the cause. The `napi_` prefix is
  // documented Neon-API convention, not a sensitive value.
  console.log(
    `[neon-branch-create] env diagnostic — ` +
      `NEON_API_KEY length=${apiKey.length.toString()} prefix=${apiKey.slice(0, 5)} ` +
      `NEON_PROJECT_ID length=${projectId.length.toString()} prefix=${projectId.slice(0, 8)}`,
  );
  console.log(`[neon-branch-create] project=${shortId(projectId)}`);

  // PRE-AUTH PROBE: hit a cheap authenticated endpoint first. If this 401s,
  // the message is unambiguous: the API key didn't authenticate. If we tried
  // to create a branch first, the same 401 would look like a logic bug.
  await neonRequest("GET", "/users/me/organizations", apiKey);
  console.log(`[neon-branch-create] auth probe OK`);

  // 1. Find primary/default branch.
  const branches = await neonRequest<BranchListResp>(
    "GET",
    `/projects/${projectId}/branches`,
    apiKey,
  );
  const parent =
    branches.branches.find((b) => b.default) ??
    branches.branches.find((b) => b.primary) ??
    branches.branches[0];
  if (!parent) {
    throw new Error("no branches found under project");
  }
  console.log(`[neon-branch-create] parent=${shortId(parent.id)} name=${parent.name}`);

  // 2. Create ephemeral branch with a read_write endpoint.
  const runId = process.env.GITHUB_RUN_ID ?? process.pid.toString();
  const branchName = `ws-f-rollback-${runId}-${Math.floor(performance.now()).toString()}`;
  const created = await neonRequest<BranchCreateResp>(
    "POST",
    `/projects/${projectId}/branches`,
    apiKey,
    {
      branch: { name: branchName, parent_id: parent.id },
      endpoints: [{ type: "read_write" }],
    },
  );
  const newBranchId = created.branch.id;
  console.log(`[neon-branch-create] new=${shortId(newBranchId)} name=${branchName}`);

  // 3. Fetch both connection URIs (with retries — endpoint takes a moment).
  const role = parent.default_role_name ?? "neondb_owner";
  // The project doesn't expose database name directly; use the conventional
  // Neon default. F-2 can switch this to a project setting if needed.
  const database = "neondb";

  let pooled = "";
  let unpooled = "";
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const pooledQ =
        `/projects/${projectId}/connection_uri?branch_id=${newBranchId}` +
        `&database_name=${database}&role_name=${role}&pooled=true`;
      const unpooledQ =
        `/projects/${projectId}/connection_uri?branch_id=${newBranchId}` +
        `&database_name=${database}&role_name=${role}&pooled=false`;
      pooled = (await neonRequest<ConnectionUriResp>("GET", pooledQ, apiKey)).uri;
      unpooled = (await neonRequest<ConnectionUriResp>("GET", unpooledQ, apiKey)).uri;
      break;
    } catch (e) {
      console.log(
        `[neon-branch-create] endpoint not ready (attempt ${attempt.toString()}/12); waiting 3s`,
      );
      await new Promise((r) => setTimeout(r, 3000));
      if (attempt === 12) throw e;
    }
  }

  if (!pooled.includes("-pooler.")) {
    pooled = pooled.replace(/(ep-[^.]+?)\./, "$1-pooler.");
  }
  if (unpooled.includes("-pooler.")) {
    unpooled = unpooled.replace(/(ep-[^.]+?)-pooler\./, "$1.");
  }
  if (!pooled || !unpooled) {
    throw new Error("empty connection URI(s) returned");
  }
  console.log(`[neon-branch-create] pooled prefix:   ${endpointPrefix(pooled)}`);
  console.log(`[neon-branch-create] unpooled prefix: ${endpointPrefix(unpooled)}`);

  // 4. Write env file (mode 0600).
  const envContents =
    `# F-1 — EPHEMERAL Neon branch credentials. Generated by neon-branch-create.ts.\n` +
    `# Do not edit by hand. Deleted by neon-branch-delete.ts in the workflow's always() step.\n` +
    `DATABASE_URL="${pooled}"\n` +
    `DATABASE_URL_UNPOOLED="${unpooled}"\n` +
    `NEON_EPHEMERAL_BRANCH_ID="${newBranchId}"\n` +
    `NEON_PROJECT_ID="${projectId}"\n`;
  writeFileSync(outPath, envContents, { encoding: "utf8" });
  chmodSync(outPath, 0o600);
  console.log(`[neon-branch-create] wrote ${outPath} (mode 0600)`);

  // 5. Emit branch_id to GITHUB_OUTPUT for the cleanup step (NOT a secret;
  // a branch id by itself can't reach the database).
  const ghOut = process.env.GITHUB_OUTPUT;
  if (ghOut) {
    appendFileSync(ghOut, `branch_id=${newBranchId}\n`, { encoding: "utf8" });
    appendFileSync(ghOut, `project_id=${projectId}\n`, { encoding: "utf8" });
    console.log(`[neon-branch-create] wrote branch_id+project_id to GITHUB_OUTPUT`);
  }
}

main().catch((err: unknown) => {
  console.error(`[neon-branch-create] FAILED: ${String(err)}`);
  process.exit(1);
});
