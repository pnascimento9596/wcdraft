import { sql, type SQL } from "drizzle-orm";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

const PROTECTED_BRANCH_NAMES = new Set([
  "default",
  "main",
  "master",
  "primary",
  "prod",
  "production",
]);

export type NeonBranchIdentityErrorCode =
  | "NEON_BRANCH_IDENTITY_MISMATCH"
  | "NEON_BRANCH_IDENTITY_INDETERMINATE";

export class NeonBranchIdentityError extends Error {
  readonly code: NeonBranchIdentityErrorCode;

  constructor(code: NeonBranchIdentityErrorCode, message: string) {
    super(`[neon-branch-guard] REFUSING TO RUN: ${message}`);
    this.name = "NeonBranchIdentityError";
    this.code = code;
  }
}

export interface NeonBranchGuardInput {
  intendedBranchId: string | undefined;
  apiKey: string | undefined;
  projectId: string | undefined;
}

export interface NeonBranchIdentity {
  databaseName: string;
  endpointId: string;
  branchId: string;
  projectId: string;
}

export interface NeonIdentityHandle {
  execute(query: SQL): Promise<unknown>;
}

export interface NeonBranchGuardDependencies<Handle extends NeonIdentityHandle> {
  verifiedHandle: Handle;
  fetchImpl?: typeof fetch;
}

interface NeonEndpoint {
  id?: unknown;
  branch_id?: unknown;
  project_id?: unknown;
  type?: unknown;
}

interface NeonBranch {
  id?: unknown;
  project_id?: unknown;
  name?: unknown;
  current_state?: unknown;
  default?: unknown;
  primary?: unknown;
  protected?: unknown;
}

interface ConnectedIdentityRow extends Record<string, unknown> {
  database_name?: unknown;
  endpoint_id?: unknown;
  branch_id?: unknown;
  project_id?: unknown;
  is_in_recovery?: unknown;
}

function mismatch(message: string): NeonBranchIdentityError {
  return new NeonBranchIdentityError("NEON_BRANCH_IDENTITY_MISMATCH", message);
}

function indeterminate(message: string): NeonBranchIdentityError {
  return new NeonBranchIdentityError("NEON_BRANCH_IDENTITY_INDETERMINATE", message);
}

function requiredIdentifier(value: string | undefined, name: string, prefix: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw indeterminate(`${name} is not set; branch identity verification is mandatory.`);
  }
  if (
    trimmed.length > 60 ||
    (prefix.length > 0 && !trimmed.startsWith(prefix)) ||
    !/^[a-z0-9-]+$/.test(trimmed)
  ) {
    throw indeterminate(`${name} is malformed; branch identity cannot be verified.`);
  }
  return trimmed;
}

function requiredSecret(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw indeterminate(`${name} is not set; branch identity verification is mandatory.`);
  }
  return trimmed;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw indeterminate(`Neon did not return a usable ${name} identity.`);
  }
  return value;
}

async function queryConnectedNeonIdentity<Handle extends NeonIdentityHandle>(
  handle: Handle,
): Promise<NeonBranchIdentity> {
  let rawResult: unknown;
  try {
    rawResult = await handle.execute(sql`
      SELECT
        current_database() AS database_name,
        current_setting('neon.endpoint_id', true) AS endpoint_id,
        current_setting('neon.branch_id', true) AS branch_id,
        current_setting('neon.project_id', true) AS project_id,
        pg_is_in_recovery() AS is_in_recovery
    `);
  } catch {
    throw indeterminate("the connected Neon identity query failed.");
  }

  const result = objectRecord(rawResult);
  const rows = result?.rows;
  if (!Array.isArray(rows)) {
    throw indeterminate("the connected Neon identity query returned an unexpected shape.");
  }
  if (rows.length !== 1 || !rows[0]) {
    throw indeterminate("the connected Neon identity query returned an unexpected shape.");
  }
  const row = rows[0] as ConnectedIdentityRow;
  const databaseName = requiredString(row.database_name, "database");
  const endpointId = requiredString(row.endpoint_id, "endpoint");
  const branchId = requiredString(row.branch_id, "branch");
  const projectId = requiredString(row.project_id, "project");
  if (!endpointId.startsWith("ep-") || !branchId.startsWith("br-")) {
    throw indeterminate("the connected Neon identity has malformed resource identifiers.");
  }
  if (row.is_in_recovery !== false) {
    throw mismatch("the connected Neon endpoint is not a writable primary compute.");
  }

  return { databaseName, endpointId, branchId, projectId };
}

async function neonGet(path: string, apiKey: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${NEON_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
  } catch {
    throw indeterminate("the Neon API identity verification request failed.");
  }
  if (!response.ok) {
    throw indeterminate(
      `the Neon API identity verification failed with HTTP ${response.status.toString()}.`,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw indeterminate("the Neon API identity response was malformed.");
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function endpointRecords(value: unknown): NeonEndpoint[] {
  const payload = objectRecord(value);
  if (!payload || !Array.isArray(payload.endpoints)) {
    throw indeterminate("the Neon API endpoint identity response was malformed.");
  }
  return payload.endpoints
    .map((endpoint) => objectRecord(endpoint) as NeonEndpoint | null)
    .filter((endpoint): endpoint is NeonEndpoint => endpoint !== null);
}

function branchRecord(value: unknown): NeonBranch {
  const payload = objectRecord(value);
  const branch = objectRecord(payload?.branch) as NeonBranch | null;
  if (!branch) {
    throw indeterminate("the Neon API branch identity response was malformed.");
  }
  return branch;
}

export async function assertNeonBranchIdentity<Handle extends NeonIdentityHandle>(
  input: NeonBranchGuardInput,
  dependencies: NeonBranchGuardDependencies<Handle>,
): Promise<NeonBranchIdentity> {
  const intendedBranchId = requiredIdentifier(
    input.intendedBranchId,
    "NEON_EPHEMERAL_BRANCH_ID",
    "br-",
  );
  const projectId = requiredIdentifier(input.projectId, "NEON_PROJECT_ID", "");
  const apiKey = requiredSecret(input.apiKey, "NEON_API_KEY");
  const connected = await queryConnectedNeonIdentity(dependencies.verifiedHandle);

  if (connected.projectId !== projectId) {
    throw mismatch("connected Neon project identity does not match the intended project.");
  }
  if (connected.branchId !== intendedBranchId) {
    throw mismatch("connected Neon branch identity does not match NEON_EPHEMERAL_BRANCH_ID.");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const encodedProject = encodeURIComponent(projectId);
  const endpoints = endpointRecords(
    await neonGet(`/projects/${encodedProject}/endpoints`, apiKey, fetchImpl),
  );
  const endpointMatches = endpoints.filter((endpoint) => endpoint.id === connected.endpointId);
  if (endpointMatches.length !== 1) {
    throw indeterminate("the connected Neon endpoint identity is missing or ambiguous.");
  }
  const endpoint = endpointMatches[0];
  if (!endpoint) {
    throw indeterminate("the connected Neon endpoint identity is missing or ambiguous.");
  }
  if (
    endpoint.project_id !== projectId ||
    endpoint.branch_id !== connected.branchId ||
    endpoint.type !== "read_write"
  ) {
    throw mismatch("the connected Neon endpoint is not the intended branch read-write endpoint.");
  }

  const encodedBranch = encodeURIComponent(connected.branchId);
  const branch = branchRecord(
    await neonGet(`/projects/${encodedProject}/branches/${encodedBranch}`, apiKey, fetchImpl),
  );
  if (
    branch.id !== connected.branchId ||
    branch.project_id !== projectId ||
    typeof branch.name !== "string" ||
    branch.name.length === 0 ||
    branch.current_state !== "ready" ||
    typeof branch.default !== "boolean" ||
    typeof branch.protected !== "boolean" ||
    (branch.primary !== undefined && typeof branch.primary !== "boolean")
  ) {
    throw indeterminate("the Neon API branch identity response was incomplete or mismatched.");
  }
  if (
    branch.default ||
    branch.primary === true ||
    branch.protected ||
    PROTECTED_BRANCH_NAMES.has(branch.name.trim().toLowerCase())
  ) {
    throw mismatch(
      "the connected Neon branch is a primary, default, protected, or protected-name branch.",
    );
  }

  return connected;
}

export async function runWithVerifiedNeonBranchMutation<T, Handle extends NeonIdentityHandle>(
  input: NeonBranchGuardInput,
  dependencies: NeonBranchGuardDependencies<Handle>,
  destructiveOperation: (target: NeonBranchIdentity, handle: Handle) => Promise<T>,
): Promise<T> {
  const target = await assertNeonBranchIdentity(input, dependencies);
  return destructiveOperation(target, dependencies.verifiedHandle);
}
