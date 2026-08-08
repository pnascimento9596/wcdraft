// F-1 — delete a Neon branch by id.
//
// Reads NEON_API_KEY + NEON_PROJECT_ID + NEON_EPHEMERAL_BRANCH_ID from env
// (CI workflow's always() cleanup step sets these from the create step's
// outputs). Refuses to delete the project's primary or default branch even
// if asked to — belt-and-suspenders against a misconfigured workflow.
//
// Defensive: trim env values to neutralise any stray trailing whitespace
// (e.g. a stored secret with a trailing newline that would otherwise make
// the `Bearer <token>\n` header silently invalid and 401-out).
import { request } from "node:https";

const NEON_API_HOST = "console.neon.tech";

interface BranchResp {
  branch: { id: string; default?: boolean; primary?: boolean; name?: string };
}

function neonRequest<T>(method: "GET" | "DELETE", path: string, apiKey: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method,
        host: NEON_API_HOST,
        path: `/api/v2${path}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      (resp) => {
        const chunks: Buffer[] = [];
        resp.on("data", (c: Buffer) => chunks.push(c));
        resp.on("end", () => {
          const status = resp.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          if (status >= 200 && status < 300) {
            if (!body) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              resolve(null);
            }
          } else {
            reject(
              new Error(
                `Neon API ${method} ${path} failed: HTTP ${status.toString()} ${body.slice(0, 300)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v.trim();
}

function shortId(s: string, n = 10): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function main(): Promise<void> {
  const apiKey = readEnv("NEON_API_KEY");
  const projectId = readEnv("NEON_PROJECT_ID");
  const branchId = readEnv("NEON_EPHEMERAL_BRANCH_ID");

  console.log("[neon-branch-delete] required API credentials and branch identity present");
  console.log(`[neon-branch-delete] project=${shortId(projectId)} branch=${shortId(branchId)}`);

  // Belt-and-suspenders: refuse to delete primary/default branches even if
  // env asked us to. Better to leak an ephemeral compute for an hour than
  // to wipe a production branch.
  const fetched = await neonRequest<BranchResp>(
    "GET",
    `/projects/${projectId}/branches/${branchId}`,
    apiKey,
  );
  if (fetched?.branch.default || fetched?.branch.primary) {
    throw new Error(
      `REFUSING to delete branch ${branchId} — it is default/primary (name=${fetched.branch.name ?? "<?>"})`,
    );
  }

  await neonRequest("DELETE", `/projects/${projectId}/branches/${branchId}`, apiKey);
  console.log(`[neon-branch-delete] OK — ephemeral branch deleted`);
}

main().catch(() => {
  console.error("[neon-branch-delete] FAILED; protected diagnostics are not printed");
  process.exit(1);
});
