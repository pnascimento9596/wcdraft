import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  NeonBranchIdentityError,
  runWithVerifiedNeonBranchMutation,
  type NeonBranchGuardDependencies,
  type NeonBranchGuardInput,
  type NeonIdentityHandle,
} from "../scripts/neon-branch-guard.ts";

const ENDPOINT_ID = "ep-quiet-snow-123456";
const BRANCH_ID = "br-ephemeral-123456";
const PROJECT_ID = "project-123456";
const DATABASE_NAME = "neondb";
const API_KEY = "napi_test_secret_not_for_logs";
const PRODUCTION_BRANCH_ID = "br-production-123456";
const PRODUCTION_ENDPOINT_ID = "ep-production-123456";

type TestHandle = NeonIdentityHandle;

interface IdentityRow {
  database_name: string | null;
  endpoint_id: string | null;
  branch_id: string | null;
  project_id: string | null;
  is_in_recovery: boolean | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validEndpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENDPOINT_ID,
    branch_id: BRANCH_ID,
    project_id: PROJECT_ID,
    type: "read_write",
    ...overrides,
  };
}

function validBranch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: BRANCH_ID,
    project_id: PROJECT_ID,
    name: "ws-f-rollback-test",
    current_state: "ready",
    default: false,
    primary: false,
    protected: false,
    ...overrides,
  };
}

function validIdentity(overrides: Partial<IdentityRow> = {}): IdentityRow {
  return {
    database_name: DATABASE_NAME,
    endpoint_id: ENDPOINT_ID,
    branch_id: BRANCH_ID,
    project_id: PROJECT_ID,
    is_in_recovery: false,
    ...overrides,
  };
}

function mockFetch(...responses: Response[]): ReturnType<typeof vi.fn<typeof fetch>> {
  let index = 0;
  return vi.fn<typeof fetch>(async () => {
    const response = responses[index];
    index += 1;
    if (!response) throw new Error("unexpected fetch");
    return response;
  });
}

function baseInput(overrides: Partial<NeonBranchGuardInput> = {}): NeonBranchGuardInput {
  return {
    intendedBranchId: BRANCH_ID,
    apiKey: API_KEY,
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function baseDependencies(
  fetchImpl: typeof fetch,
  identityOverrides: Partial<IdentityRow> = {},
): NeonBranchGuardDependencies<TestHandle> & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ rows: [validIdentity(identityOverrides)] }));
  return {
    verifiedHandle: { execute } as unknown as TestHandle,
    fetchImpl,
    execute,
  };
}

async function expectRefusal(
  input: NeonBranchGuardInput,
  dependencies: NeonBranchGuardDependencies<TestHandle>,
  expectedCode: NeonBranchIdentityError["code"],
  expectedMessage: RegExp,
): Promise<void> {
  const mutation = vi.fn(async () => undefined);
  const operation = runWithVerifiedNeonBranchMutation(input, dependencies, mutation);
  await expect(operation).rejects.toBeInstanceOf(NeonBranchIdentityError);
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(NeonBranchIdentityError);
  expect(thrown).toMatchObject({ code: expectedCode });
  expect(thrown).toHaveProperty("message", expect.stringMatching(expectedMessage));
  expect(mutation).not.toHaveBeenCalled();
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  expect(message).not.toContain(API_KEY);
}

describe("Neon branch identity guard", () => {
  it("passes only after server identity and API identity agree", async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ endpoints: [validEndpoint()] }),
      jsonResponse({ branch: validBranch() }),
    );
    const dependencies = baseDependencies(fetchImpl);
    const mutation = vi.fn(async () => "completed");

    const result = await runWithVerifiedNeonBranchMutation(baseInput(), dependencies, mutation);

    expect(result).toBe("completed");
    expect(dependencies.execute).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenCalledWith(
      {
        databaseName: DATABASE_NAME,
        endpointId: ENDPOINT_ID,
        branchId: BRANCH_ID,
        projectId: PROJECT_ID,
      },
      dependencies.verifiedHandle,
    );
  });

  it.each([
    ["missing sentinel", { intendedBranchId: undefined }, /NEON_EPHEMERAL_BRANCH_ID/],
    ["missing API key", { apiKey: undefined }, /NEON_API_KEY/],
    ["missing project", { projectId: undefined }, /NEON_PROJECT_ID/],
  ])("fails closed for %s", async (_description, input, expectedMessage) => {
    const fetchImpl = mockFetch();
    const dependencies = baseDependencies(fetchImpl);
    await expectRefusal(
      baseInput(input),
      dependencies,
      "NEON_BRANCH_IDENTITY_INDETERMINATE",
      expectedMessage,
    );
    expect(dependencies.execute).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when a branch DSN resolves to production", async () => {
    const fetchImpl = mockFetch();
    const dependencies = baseDependencies(fetchImpl, {
      endpoint_id: PRODUCTION_ENDPOINT_ID,
      branch_id: PRODUCTION_BRANCH_ID,
    });

    await expectRefusal(
      baseInput(),
      dependencies,
      "NEON_BRANCH_IDENTITY_MISMATCH",
      /connected Neon branch identity does not match/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the connected project is different", async () => {
    const fetchImpl = mockFetch();
    const dependencies = baseDependencies(fetchImpl, { project_id: "other-project" });

    await expectRefusal(
      baseInput(),
      dependencies,
      "NEON_BRANCH_IDENTITY_MISMATCH",
      /connected Neon project identity does not match/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      "identity query failure",
      async () => {
        throw new Error("contains a database secret");
      },
    ],
    ["missing branch setting", async () => ({ rows: [{ ...validIdentity(), branch_id: null }] })],
    [
      "missing endpoint setting",
      async () => ({ rows: [{ ...validIdentity(), endpoint_id: null }] }),
    ],
    ["wrong row shape", async () => ({ rows: [] })],
  ])("fails closed when identity is indeterminate: %s", async (_description, execute) => {
    const fetchImpl = mockFetch();
    const dependencies = {
      verifiedHandle: { execute } as unknown as TestHandle,
      fetchImpl,
    };

    await expectRefusal(
      baseInput(),
      dependencies,
      "NEON_BRANCH_IDENTITY_INDETERMINATE",
      /connected Neon identity|Neon did not return/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a recovery endpoint before any API lookup", async () => {
    const fetchImpl = mockFetch();
    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl, { is_in_recovery: true }),
      "NEON_BRANCH_IDENTITY_MISMATCH",
      /not a writable primary compute/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      "duplicate endpoint",
      { endpoints: [validEndpoint(), validEndpoint()] },
      /missing or ambiguous/,
    ],
    [
      "read-only endpoint",
      { endpoints: [validEndpoint({ type: "read_only" })] },
      /not the intended branch/,
    ],
    [
      "wrong endpoint branch",
      { endpoints: [validEndpoint({ branch_id: "br-other-123456" })] },
      /not the intended branch/,
    ],
    ["malformed endpoint payload", { endpoints: null }, /endpoint identity response was malformed/],
  ])("rejects %s", async (_description, endpointPayload, expectedMessage) => {
    const fetchImpl = mockFetch(jsonResponse(endpointPayload));
    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      ["read-only endpoint", "wrong endpoint branch"].includes(_description)
        ? "NEON_BRANCH_IDENTITY_MISMATCH"
        : "NEON_BRANCH_IDENTITY_INDETERMINATE",
      expectedMessage,
    );
  });

  it.each([
    ["default", { default: true }, /primary, default/],
    ["primary", { primary: true }, /primary, default/],
    ["protected", { protected: true }, /primary, default/],
    ["protected name", { name: "production" }, /primary, default/],
    ["not ready", { current_state: "init" }, /incomplete or mismatched/],
    ["missing default flag", { default: undefined }, /incomplete or mismatched/],
  ])("rejects branch metadata: %s", async (_description, overrides, expectedMessage) => {
    const fetchImpl = mockFetch(
      jsonResponse({ endpoints: [validEndpoint()] }),
      jsonResponse({ branch: validBranch(overrides) }),
    );
    const expectedCode = ["default", "primary", "protected", "protected name"].includes(
      _description,
    )
      ? "NEON_BRANCH_IDENTITY_MISMATCH"
      : "NEON_BRANCH_IDENTITY_INDETERMINATE";
    await expectRefusal(baseInput(), baseDependencies(fetchImpl), expectedCode, expectedMessage);
  });

  it.each([
    ["HTTP failure", [jsonResponse({}, 503)], /failed with HTTP 503/],
    ["network failure", [], /verification request failed/],
    [
      "malformed branch response",
      [jsonResponse({ endpoints: [validEndpoint()] }), jsonResponse({})],
      /branch identity response was malformed/,
    ],
  ])("fails closed on API verification failure: %s", async (_description, responses, expected) => {
    const fetchImpl = mockFetch(...responses);
    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      "NEON_BRANCH_IDENTITY_INDETERMINATE",
      expected,
    );
  });

  it("keeps the migration target guard before migrate", () => {
    const source = readFileSync(new URL("../scripts/migrate.ts", import.meta.url), "utf8");
    const file = ts.createSourceFile(
      "migrate.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const guardCalls: ts.CallExpression[] = [];
    const migrateCalls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "assertNeonBranchIdentity"
        ) {
          guardCalls.push(node);
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "migrate") {
          migrateCalls.push(node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(guardCalls).toHaveLength(1);
    expect(migrateCalls).toHaveLength(1);
    expect(guardCalls[0]!.getStart(file)).toBeLessThan(migrateCalls[0]!.getStart(file));
  });

  it("keeps every rollback mutation inside the verified-handle callback", () => {
    const source = readFileSync(new URL("../scripts/rollback-check.ts", import.meta.url), "utf8");
    const file = ts.createSourceFile(
      "rollback-check.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const guardCalls: ts.CallExpression[] = [];
    const executeCalls: ts.CallExpression[] = [];
    const migrateCalls: ts.CallExpression[] = [];
    const openCalls: ts.CallExpression[] = [];
    const poolEndCalls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "runWithVerifiedNeonBranchMutation"
        ) {
          guardCalls.push(node);
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "execute"
        ) {
          executeCalls.push(node);
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "migrate") {
          migrateCalls.push(node);
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "openMigratorDb") {
          openCalls.push(node);
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "end" &&
          node.expression.expression.getText(file) === "pool"
        ) {
          poolEndCalls.push(node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(guardCalls).toHaveLength(1);
    expect(openCalls).toHaveLength(1);
    expect(poolEndCalls).toHaveLength(1);
    const callback = guardCalls[0]!.arguments[2];
    expect(callback && ts.isArrowFunction(callback)).toBe(true);
    if (!callback || !ts.isArrowFunction(callback)) throw new Error("mutation callback missing");
    expect(callback.parameters[1]?.name.getText(file)).toBe("verifiedDb");
    const dependencies = guardCalls[0]!.arguments[1];
    expect(dependencies && ts.isObjectLiteralExpression(dependencies)).toBe(true);
    if (!dependencies || !ts.isObjectLiteralExpression(dependencies)) {
      throw new Error("verified dependency object missing");
    }
    const verifiedHandle = dependencies.properties.find(
      (property) => property.name?.getText(file) === "verifiedHandle",
    );
    expect(verifiedHandle && ts.isPropertyAssignment(verifiedHandle)).toBe(true);
    if (!verifiedHandle || !ts.isPropertyAssignment(verifiedHandle)) {
      throw new Error("verified handle binding missing");
    }
    expect(verifiedHandle.initializer.getText(file)).toBe("db");
    const callbackStart = callback.body.getStart(file);
    const callbackEnd = callback.body.getEnd();
    const insideCallback = (node: ts.Node) =>
      node.getStart(file) > callbackStart && node.getEnd() < callbackEnd;
    expect(executeCalls.every(insideCallback)).toBe(true);
    expect(migrateCalls).toHaveLength(1);
    expect(migrateCalls.every(insideCallback)).toBe(true);
    expect(migrateCalls[0]!.arguments[0]?.getText(file)).toBe("verifiedDb");
    expect(
      executeCalls.every((call) => call.expression.getText(file).startsWith("verifiedDb.")),
    ).toBe(true);
    expect(poolEndCalls.every((call) => !insideCallback(call))).toBe(true);
    expect(poolEndCalls[0]!.getStart(file)).toBeGreaterThan(callbackEnd);
  });
});
