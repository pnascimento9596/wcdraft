const NEON_API_BASE = "https://console.neon.tech/api/v2";

const PROTECTED_BRANCH_NAMES = new Set([
  "default",
  "main",
  "master",
  "primary",
  "prod",
  "production",
]);

export interface RollbackTargetInput {
  connectionString: string | undefined;
  ephemeralBranchId: string | undefined;
  apiKey: string | undefined;
  projectId: string | undefined;
}

export interface RollbackTargetDependencies<Handle> {
  verifiedHandle: Handle;
  queryCurrentDatabase: (handle: Handle) => Promise<string>;
  fetchImpl?: typeof fetch;
}

export interface VerifiedRollbackTarget {
  branchId: string;
  databaseName: string;
  endpointId: string;
}

interface NeonEndpoint {
  id?: unknown;
  host?: unknown;
  branch_id?: unknown;
  project_id?: unknown;
  type?: unknown;
}

interface NeonBranch {
  id?: unknown;
  project_id?: unknown;
  name?: unknown;
  default?: unknown;
  primary?: unknown;
  protected?: unknown;
}

function refusal(message: string): Error {
  return new Error(`[rollback-check] REFUSING TO RUN: ${message}`);
}

function requiredIdentifier(value: string | undefined, name: string, prefix: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw refusal(`${name} is not set; API-verified destructive mode is mandatory.`);
  }
  if (trimmed.length > 60 || !trimmed.startsWith(prefix) || !/^[a-z0-9-]+$/.test(trimmed)) {
    throw refusal(`${name} is malformed.`);
  }
  return trimmed;
}

function requiredSecret(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw refusal(`${name} is not set; API-verified destructive mode is mandatory.`);
  }
  return trimmed;
}

function parseDirectTarget(connectionString: string | undefined): {
  databaseName: string;
  endpointHost: string;
  endpointId: string;
} {
  if (!connectionString?.trim()) {
    throw refusal("DATABASE_URL_UNPOOLED is not set.");
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw refusal("DATABASE_URL_UNPOOLED is malformed.");
  }

  const endpointHost = parsed.hostname.toLowerCase();
  if (
    !/^postgres(?:ql)?:$/.test(parsed.protocol) ||
    !endpointHost.endsWith(".neon.tech") ||
    endpointHost.includes("-pooler.")
  ) {
    throw refusal("DATABASE_URL_UNPOOLED must be a direct Neon PostgreSQL endpoint.");
  }

  const endpointId = endpointHost.split(".")[0];
  if (
    !endpointId ||
    endpointId.length > 60 ||
    !endpointId.startsWith("ep-") ||
    !/^[a-z0-9-]+$/.test(endpointId)
  ) {
    throw refusal("DATABASE_URL_UNPOOLED does not contain a valid Neon endpoint ID.");
  }

  const encodedDatabase = parsed.pathname.slice(1);
  if (!encodedDatabase || encodedDatabase.includes("/")) {
    throw refusal("DATABASE_URL_UNPOOLED does not identify exactly one database.");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(encodedDatabase);
  } catch {
    throw refusal("DATABASE_URL_UNPOOLED contains a malformed database name.");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw refusal("DATABASE_URL_UNPOOLED does not identify exactly one database.");
  }

  return { databaseName, endpointHost, endpointId };
}

async function neonGet(path: string, apiKey: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${NEON_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
  } catch {
    throw refusal("Neon API verification request failed.");
  }
  if (!response.ok) {
    throw refusal(`Neon API verification failed with HTTP ${response.status.toString()}.`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw refusal("Neon API verification returned malformed JSON.");
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export async function verifyRollbackTarget<Handle>(
  input: RollbackTargetInput,
  dependencies: RollbackTargetDependencies<Handle>,
): Promise<VerifiedRollbackTarget> {
  const ephemeralBranchId = requiredIdentifier(
    input.ephemeralBranchId,
    "NEON_EPHEMERAL_BRANCH_ID",
    "br-",
  );
  const apiKey = requiredSecret(input.apiKey, "NEON_API_KEY");
  const projectId = requiredIdentifier(input.projectId, "NEON_PROJECT_ID", "");
  const target = parseDirectTarget(input.connectionString);

  let connectedDatabase: string;
  try {
    connectedDatabase = await dependencies.queryCurrentDatabase(dependencies.verifiedHandle);
  } catch {
    throw refusal("current_database() verification query failed.");
  }
  if (!connectedDatabase || connectedDatabase !== target.databaseName) {
    throw refusal("connected database does not match DATABASE_URL_UNPOOLED.");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const encodedProject = encodeURIComponent(projectId);
  const endpointsPayload = objectRecord(
    await neonGet(`/projects/${encodedProject}/endpoints`, apiKey, fetchImpl),
  );
  const endpoints = endpointsPayload?.endpoints;
  if (!Array.isArray(endpoints)) {
    throw refusal("Neon API endpoint response is malformed.");
  }

  const endpointRecords = endpoints
    .map((endpoint) => objectRecord(endpoint) as NeonEndpoint | null)
    .filter((endpoint): endpoint is NeonEndpoint => endpoint !== null);
  const idMatches = endpointRecords.filter((endpoint) => endpoint.id === target.endpointId);
  const hostMatches = endpointRecords.filter(
    (endpoint) =>
      typeof endpoint.host === "string" && endpoint.host.toLowerCase() === target.endpointHost,
  );
  if (idMatches.length !== 1 || hostMatches.length !== 1 || idMatches[0] !== hostMatches[0]) {
    throw refusal("connected endpoint identity is ambiguous or does not match Neon API truth.");
  }

  const endpoint = idMatches[0];
  if (
    !endpoint ||
    endpoint.type !== "read_write" ||
    endpoint.project_id !== projectId ||
    typeof endpoint.branch_id !== "string" ||
    !endpoint.branch_id
  ) {
    throw refusal("connected endpoint is not a branch-bound read-write endpoint in this project.");
  }
  if (endpoint.branch_id !== ephemeralBranchId) {
    throw refusal("connected endpoint branch does not match NEON_EPHEMERAL_BRANCH_ID.");
  }

  const encodedBranch = encodeURIComponent(endpoint.branch_id);
  const branchPayload = objectRecord(
    await neonGet(`/projects/${encodedProject}/branches/${encodedBranch}`, apiKey, fetchImpl),
  );
  const branch = objectRecord(branchPayload?.branch) as NeonBranch | null;
  if (
    !branch ||
    branch.id !== endpoint.branch_id ||
    branch.project_id !== projectId ||
    typeof branch.name !== "string" ||
    !branch.name ||
    typeof branch.default !== "boolean" ||
    typeof branch.protected !== "boolean" ||
    (branch.primary !== undefined && typeof branch.primary !== "boolean")
  ) {
    throw refusal("Neon API branch response is malformed or mismatched.");
  }
  if (branch.default || branch.primary === true) {
    throw refusal("connected branch is the project's primary/default branch.");
  }
  if (branch.protected) {
    throw refusal("connected branch is protected.");
  }
  if (PROTECTED_BRANCH_NAMES.has(branch.name.trim().toLowerCase())) {
    throw refusal("connected branch uses a protected branch name.");
  }

  return {
    branchId: endpoint.branch_id,
    databaseName: connectedDatabase,
    endpointId: target.endpointId,
  };
}

export async function runWithVerifiedRollbackTarget<T, Handle>(
  input: RollbackTargetInput,
  dependencies: RollbackTargetDependencies<Handle>,
  destructiveOperation: (target: VerifiedRollbackTarget, handle: Handle) => Promise<T>,
): Promise<T> {
  const target = await verifyRollbackTarget(input, dependencies);
  return destructiveOperation(target, dependencies.verifiedHandle);
}
