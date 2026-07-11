import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  runWithVerifiedRollbackTarget,
  type RollbackTargetDependencies,
  type RollbackTargetInput,
} from "../scripts/rollback-target-guard.ts";

const ENDPOINT_ID = "ep-quiet-snow-123456";
const ENDPOINT_HOST = `${ENDPOINT_ID}.us-east-2.aws.neon.tech`;
const BRANCH_ID = "br-ephemeral-123456";
const PROJECT_ID = "project-123456";
const DATABASE_NAME = "neondb";
const API_KEY = "napi_test_secret_not_for_logs";
const VERIFIED_HANDLE = { kind: "verified-test-handle" } as const;
type TestHandle = typeof VERIFIED_HANDLE;
const CONNECTION_STRING =
  `postgresql://neondb_owner:database-secret@${ENDPOINT_HOST}/${DATABASE_NAME}` +
  "?sslmode=require";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validEndpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENDPOINT_ID,
    host: ENDPOINT_HOST,
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
    default: false,
    primary: false,
    protected: false,
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

function baseInput(overrides: Partial<RollbackTargetInput> = {}): RollbackTargetInput {
  return {
    connectionString: CONNECTION_STRING,
    ephemeralBranchId: BRANCH_ID,
    apiKey: API_KEY,
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function baseDependencies(
  fetchImpl: typeof fetch,
  connectedDatabase = DATABASE_NAME,
): RollbackTargetDependencies<TestHandle> {
  return {
    verifiedHandle: VERIFIED_HANDLE,
    queryCurrentDatabase: vi.fn(async (handle) => {
      expect(handle).toBe(VERIFIED_HANDLE);
      return connectedDatabase;
    }),
    fetchImpl,
  };
}

async function expectRefusal(
  input: RollbackTargetInput,
  dependencies: RollbackTargetDependencies<TestHandle>,
  expected: RegExp,
): Promise<void> {
  const migrateApplyOrDelete = vi.fn(async () => undefined);
  const operation = runWithVerifiedRollbackTarget(input, dependencies, migrateApplyOrDelete);
  await expect(operation).rejects.toThrow(expected);
  expect(migrateApplyOrDelete).not.toHaveBeenCalled();

  try {
    await operation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.apiKey) expect(message).not.toContain(input.apiKey);
    if (input.connectionString) expect(message).not.toContain(input.connectionString);
    expect(message).not.toContain(API_KEY);
    expect(message).not.toContain(CONNECTION_STRING);
    expect(message).not.toContain("database-secret");
  }
}

describe("rollback target guard", () => {
  it("refuses destructive mode when the ephemeral sentinel is absent", async () => {
    const fetchImpl = mockFetch();
    const dependencies = baseDependencies(fetchImpl);

    await expectRefusal(
      baseInput({ ephemeralBranchId: undefined }),
      dependencies,
      /NEON_EPHEMERAL_BRANCH_ID/i,
    );

    expect(dependencies.queryCurrentDatabase).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["NEON_API_KEY", { apiKey: undefined }],
    ["NEON_PROJECT_ID", { projectId: undefined }],
  ])("refuses destructive mode when %s is absent", async (name, override) => {
    const fetchImpl = mockFetch();
    const dependencies = baseDependencies(fetchImpl);

    await expectRefusal(baseInput(override), dependencies, new RegExp(name));

    expect(dependencies.queryCurrentDatabase).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts a wrong-sentinel probe before migrate, apply, or delete", async () => {
    const fetchImpl = mockFetch(jsonResponse({ endpoints: [validEndpoint()] }));

    await expectRefusal(
      baseInput({ ephemeralBranchId: "br-wrong-sentinel" }),
      baseDependencies(fetchImpl),
      /branch does not match NEON_EPHEMERAL_BRANCH_ID/i,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses duplicate endpoint ID/host mappings", async () => {
    const fetchImpl = mockFetch(jsonResponse({ endpoints: [validEndpoint(), validEndpoint()] }));

    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      /endpoint identity is ambiguous/i,
    );
  });

  it.each([
    ["ID-to-host", [validEndpoint({ host: "ep-other.us-east-2.aws.neon.tech" })]],
    ["host-to-ID", [validEndpoint({ id: "ep-other-123456" })]],
    [
      "split",
      [
        validEndpoint({ host: "ep-other.us-east-2.aws.neon.tech" }),
        validEndpoint({ id: "ep-other-123456" }),
      ],
    ],
  ])("refuses %s endpoint mismatches", async (_description, endpoints) => {
    const fetchImpl = mockFetch(jsonResponse({ endpoints }));

    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      /endpoint identity is ambiguous|does not match/i,
    );
  });

  it("refuses a current_database() mismatch before API lookup", async () => {
    const fetchImpl = mockFetch();

    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl, "another_database"),
      /connected database does not match/i,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when current_database() cannot be resolved", async () => {
    const fetchImpl = mockFetch();
    const dependencies: RollbackTargetDependencies<TestHandle> = {
      verifiedHandle: VERIFIED_HANDLE,
      queryCurrentDatabase: vi.fn(async () => {
        throw new Error("driver included a secret connection string");
      }),
      fetchImpl,
    };

    await expectRefusal(
      baseInput(),
      dependencies,
      /current_database\(\) verification query failed/i,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["default", { default: true }],
    ["primary", { primary: true }],
  ])("refuses a %s branch", async (_description, branchOverride) => {
    const fetchImpl = mockFetch(
      jsonResponse({ endpoints: [validEndpoint()] }),
      jsonResponse({ branch: validBranch(branchOverride) }),
    );

    await expectRefusal(baseInput(), baseDependencies(fetchImpl), /primary\/default branch/i);
  });

  it("refuses an API-protected branch", async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ endpoints: [validEndpoint()] }),
      jsonResponse({ branch: validBranch({ protected: true }) }),
    );

    await expectRefusal(baseInput(), baseDependencies(fetchImpl), /branch is protected/i);
  });

  it.each(["main", "master", "prod", "production", "primary", "default"])(
    "refuses protected branch name %s",
    async (name) => {
      const fetchImpl = mockFetch(
        jsonResponse({ endpoints: [validEndpoint()] }),
        jsonResponse({ branch: validBranch({ name }) }),
      );

      await expectRefusal(baseInput(), baseDependencies(fetchImpl), /protected branch name/i);
    },
  );

  it.each([
    ["malformed", "not a URL"],
    ["non-Neon", "postgresql://owner:secret@db.example.com/neondb"],
    ["pooled", `postgresql://owner:secret@${ENDPOINT_ID}-pooler.us-east-2.aws.neon.tech/neondb`],
    ["missing endpoint ID", "postgresql://owner:secret@proxy.us-east-2.aws.neon.tech/neondb"],
    ["missing database", `postgresql://owner:secret@${ENDPOINT_HOST}`],
  ])("refuses a %s database endpoint", async (_description, connectionString) => {
    const fetchImpl = mockFetch();
    const dependencies = baseDependencies(fetchImpl);

    await expectRefusal(baseInput({ connectionString }), dependencies, /DATABASE_URL_UNPOOLED/i);

    expect(dependencies.queryCurrentDatabase).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["endpoint HTTP failure", [jsonResponse({ error: "unavailable" }, 503)]],
    [
      "branch HTTP failure",
      [jsonResponse({ endpoints: [validEndpoint()] }), jsonResponse({ error: "unavailable" }, 503)],
    ],
  ])("fails closed on %s", async (_description, responses) => {
    const fetchImpl = mockFetch(...responses);

    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      /Neon API verification failed with HTTP 503/i,
    );
  });

  it.each([
    ["network failure", []],
    ["malformed endpoint payload", [jsonResponse({ endpoints: null })]],
    [
      "malformed branch payload",
      [jsonResponse({ endpoints: [validEndpoint()] }), jsonResponse({})],
    ],
  ])("fails closed on %s", async (_description, responses) => {
    const fetchImpl = mockFetch(...responses);

    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      /verification request failed|endpoint response is malformed|branch response is malformed/i,
    );
  });

  it.each([
    ["read-only endpoint", { type: "read_only" }],
    ["different project", { project_id: "project-other" }],
    ["missing branch", { branch_id: undefined }],
  ])("refuses a %s mapping", async (_description, endpointOverride) => {
    const fetchImpl = mockFetch(jsonResponse({ endpoints: [validEndpoint(endpointOverride)] }));

    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      /branch-bound read-write endpoint/i,
    );
  });

  it.each([
    ["different branch", { id: "br-other" }],
    ["different project", { project_id: "project-other" }],
    ["missing protected flag", { protected: undefined }],
  ])("refuses a %s branch response", async (_description, branchOverride) => {
    const fetchImpl = mockFetch(
      jsonResponse({ endpoints: [validEndpoint()] }),
      jsonResponse({ branch: validBranch(branchOverride) }),
    );

    await expectRefusal(
      baseInput(),
      baseDependencies(fetchImpl),
      /branch response is malformed or mismatched/i,
    );
  });

  it("allows exactly one verified ephemeral target and then invokes the destructive callback", async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ endpoints: [validEndpoint()] }),
      jsonResponse({ branch: validBranch() }),
    );
    const dependencies = baseDependencies(fetchImpl);
    const destructiveOperation = vi.fn(async () => "completed");

    const result = await runWithVerifiedRollbackTarget(
      baseInput(),
      dependencies,
      destructiveOperation,
    );

    expect(result).toBe("completed");
    expect(dependencies.queryCurrentDatabase).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://console.neon.tech/api/v2/projects/${PROJECT_ID}/endpoints`,
    );
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      `https://console.neon.tech/api/v2/projects/${PROJECT_ID}/branches/${BRANCH_ID}`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
    });
    expect(destructiveOperation).toHaveBeenCalledOnce();
    expect(destructiveOperation).toHaveBeenCalledWith(
      {
        branchId: BRANCH_ID,
        databaseName: DATABASE_NAME,
        endpointId: ENDPOINT_ID,
      },
      VERIFIED_HANDLE,
    );
  });

  it("wires the real rollback script so target verification encloses the full destructive round trip", () => {
    const source = readFileSync(new URL("../scripts/rollback-check.ts", import.meta.url), "utf8");
    const sourceFile = ts.createSourceFile(
      "rollback-check.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const guardCalls: ts.CallExpression[] = [];
    const executions: ts.CallExpression[] = [];
    const migrations: ts.CallExpression[] = [];
    const poolEnds: ts.CallExpression[] = [];
    const dbOpenCalls: ts.CallExpression[] = [];
    const mainFunctions: ts.FunctionDeclaration[] = [];
    const migratorImports: ts.ImportSpecifier[] = [];
    const verifiedDbIdentifiers: ts.Identifier[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "runWithVerifiedRollbackTarget"
        ) {
          guardCalls.push(node);
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "execute"
        ) {
          executions.push(node);
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "migrate") {
          migrations.push(node);
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "pool" &&
          node.expression.name.text === "end"
        ) {
          poolEnds.push(node);
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "openMigratorDb") {
          dbOpenCalls.push(node);
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text === "main") {
        mainFunctions.push(node);
      }
      if (ts.isIdentifier(node) && node.text === "verifiedDb") {
        verifiedDbIdentifiers.push(node);
      }
      if (
        ts.isImportSpecifier(node) &&
        node.name.text === "openMigratorDb" &&
        ts.isImportDeclaration(node.parent.parent.parent) &&
        node.parent.parent.parent.moduleSpecifier.getText(sourceFile) === '"../src/client.ts"'
      ) {
        migratorImports.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(guardCalls).toHaveLength(1);
    const destructiveCallback = guardCalls[0]?.arguments[2];
    expect(destructiveCallback && ts.isArrowFunction(destructiveCallback)).toBe(true);
    if (!destructiveCallback || !ts.isArrowFunction(destructiveCallback)) {
      throw new Error("verified rollback callback missing");
    }
    expect(destructiveCallback.parameters).toHaveLength(2);
    expect(destructiveCallback.parameters[1]?.name.getText(sourceFile)).toBe("verifiedDb");
    const callbackStart = destructiveCallback.body.getStart(sourceFile);
    const callbackEnd = destructiveCallback.body.getEnd();
    const insideCallback = (call: ts.CallExpression) =>
      call.getStart(sourceFile) > callbackStart && call.getEnd() < callbackEnd;

    const dependencyObject = guardCalls[0]?.arguments[1];
    expect(dependencyObject && ts.isObjectLiteralExpression(dependencyObject)).toBe(true);
    if (!dependencyObject || !ts.isObjectLiteralExpression(dependencyObject)) {
      throw new Error("verified dependency object missing");
    }
    const verifiedHandle = dependencyObject.properties.find(
      (property) => property.name?.getText(sourceFile) === "verifiedHandle",
    );
    expect(verifiedHandle && ts.isPropertyAssignment(verifiedHandle)).toBe(true);
    if (!verifiedHandle || !ts.isPropertyAssignment(verifiedHandle)) {
      throw new Error("verified handle binding missing");
    }
    expect(verifiedHandle.initializer.getText(sourceFile)).toBe("db");
    const queryProperty = dependencyObject.properties.find(
      (property) => property.name?.getText(sourceFile) === "queryCurrentDatabase",
    );
    expect(queryProperty && ts.isPropertyAssignment(queryProperty)).toBe(true);
    if (
      !queryProperty ||
      !ts.isPropertyAssignment(queryProperty) ||
      !ts.isArrowFunction(queryProperty.initializer)
    ) {
      throw new Error("current_database verifier callback missing");
    }
    const queryCallback = queryProperty.initializer;
    expect(queryCallback.parameters).toHaveLength(1);
    expect(queryCallback.parameters[0]?.name.getText(sourceFile)).toBe("verifiedDb");
    const queryStart = queryCallback.body.getStart(sourceFile);
    const queryEnd = queryCallback.body.getEnd();
    const insideQueryCallback = (call: ts.CallExpression) =>
      call.getStart(sourceFile) > queryStart && call.getEnd() < queryEnd;

    // Inventory every execute call regardless of receiver, then require the
    // callback-provided verified capability as that receiver. This rejects
    // otherDb.execute(...) and direct uses of the outer db binding.
    expect(executions).toHaveLength(46);
    expect(
      executions.every(
        (call) =>
          ts.isPropertyAccessExpression(call.expression) &&
          ts.isIdentifier(call.expression.expression) &&
          call.expression.expression.text === "verifiedDb",
      ),
    ).toBe(true);
    const outsideExecutions = executions.filter((call) => !insideCallback(call));
    expect(outsideExecutions).toHaveLength(1);
    expect(outsideExecutions.every(insideQueryCallback)).toBe(true);
    const verifierArgument = outsideExecutions[0]?.arguments[0];
    expect(verifierArgument && ts.isTaggedTemplateExpression(verifierArgument)).toBe(true);
    if (!verifierArgument || !ts.isTaggedTemplateExpression(verifierArgument)) {
      throw new Error("current_database verifier SQL missing");
    }
    expect(verifierArgument.tag.getText(sourceFile)).toBe("sql");
    expect(
      verifierArgument.template.getText(sourceFile).slice(1, -1).replace(/\s+/g, " ").trim(),
    ).toBe("SELECT current_database() AS database_name");
    expect(executions.filter(insideCallback)).toHaveLength(45);

    const shadowDeclarations: ts.Node[] = [];
    const findShadow =
      (allowedParameter: ts.ParameterDeclaration) =>
      (node: ts.Node): void => {
        if (
          node !== allowedParameter &&
          ((ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "verifiedDb") ||
            (ts.isParameter(node) && node.name.getText(sourceFile) === "verifiedDb"))
        ) {
          shadowDeclarations.push(node);
        }
        ts.forEachChild(node, findShadow(allowedParameter));
      };
    findShadow(destructiveCallback.parameters[1]!)(destructiveCallback.body);
    findShadow(queryCallback.parameters[0]!)(queryCallback.body);
    expect(shadowDeclarations).toHaveLength(0);

    expect(migrations).toHaveLength(1);
    expect(migrations.every(insideCallback)).toBe(true);
    expect(migrations[0]?.arguments[0]?.getText(sourceFile)).toBe("verifiedDb");
    const allowedVerifiedDbIdentifiers = new Set<ts.Identifier>([
      destructiveCallback.parameters[1]!.name as ts.Identifier,
      queryCallback.parameters[0]!.name as ts.Identifier,
      ...executions.map(
        (call) => (call.expression as ts.PropertyAccessExpression).expression as ts.Identifier,
      ),
      migrations[0]!.arguments[0] as ts.Identifier,
    ]);
    expect(verifiedDbIdentifiers).toHaveLength(49);
    expect(
      verifiedDbIdentifiers.every((identifier) => allowedVerifiedDbIdentifiers.has(identifier)),
    ).toBe(true);
    expect(dbOpenCalls).toHaveLength(1);
    expect(dbOpenCalls.every((call) => !insideCallback(call))).toBe(true);
    expect(mainFunctions).toHaveLength(1);
    const mainBody = mainFunctions[0]?.body;
    expect(mainBody).toBeDefined();
    if (!mainBody) throw new Error("main body missing");
    const openDeclaration = dbOpenCalls[0]?.parent;
    expect(openDeclaration && ts.isVariableDeclaration(openDeclaration)).toBe(true);
    if (!openDeclaration || !ts.isVariableDeclaration(openDeclaration)) {
      throw new Error("migrator handle declaration missing");
    }
    expect(openDeclaration.name.getText(sourceFile)).toBe("{ db, pool }");
    const declarationList = openDeclaration.parent;
    expect(ts.isVariableDeclarationList(declarationList)).toBe(true);
    expect(
      ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const,
    ).toBe(true);
    expect(
      openDeclaration.getStart(sourceFile) > mainBody.getStart(sourceFile) &&
        openDeclaration.getEnd() < mainBody.getEnd(),
    ).toBe(true);
    const mainDbPoolBindings: string[] = [];
    const mainDbPoolAssignments: ts.BinaryExpression[] = [];
    const localMigratorBindings: ts.Node[] = [];
    const mainDbIdentifiers: ts.Identifier[] = [];
    const mainPoolIdentifiers: ts.Identifier[] = [];
    const collectMainBindings = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        if (node.text === "db") mainDbIdentifiers.push(node);
        if (node.text === "pool") mainPoolIdentifiers.push(node);
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
        if (node.name.text === "db" || node.name.text === "pool") {
          mainDbPoolBindings.push(node.name.text);
        }
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (node.name.text === "db" || node.name.text === "pool") {
          mainDbPoolBindings.push(node.name.text);
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        ts.isIdentifier(node.left) &&
        (node.left.text === "db" || node.left.text === "pool") &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        mainDbPoolAssignments.push(node);
      }
      if (
        (ts.isVariableDeclaration(node) ||
          ts.isParameter(node) ||
          ts.isFunctionDeclaration(node)) &&
        node.name?.getText(sourceFile) === "openMigratorDb"
      ) {
        localMigratorBindings.push(node);
      }
      ts.forEachChild(node, collectMainBindings);
    };
    collectMainBindings(mainBody);
    expect(mainDbPoolBindings.sort()).toEqual(["db", "pool"]);
    expect(mainDbPoolAssignments).toHaveLength(0);
    expect(localMigratorBindings).toHaveLength(0);
    // The direct handles are capabilities, not general-purpose outer values:
    // `db` may appear only in its binding and `verifiedHandle` initializer;
    // `pool` may appear only in its binding and the paired finally teardown.
    // This rejects aliases and object/method mutation that could redirect the
    // verified direct handle to a pooled target without rebinding the const.
    expect(mainDbIdentifiers).toHaveLength(2);
    expect(mainPoolIdentifiers).toHaveLength(2);
    expect(migratorImports).toHaveLength(1);
    expect(poolEnds).toHaveLength(1);
    expect(poolEnds.every((call) => !insideCallback(call))).toBe(true);
    expect(poolEnds[0]?.getStart(sourceFile)).toBeGreaterThan(callbackEnd);
    const guardTryStatements: ts.TryStatement[] = [];
    const collectGuardTry = (node: ts.Node): void => {
      if (
        ts.isTryStatement(node) &&
        guardCalls[0] &&
        guardCalls[0].getStart(sourceFile) > node.tryBlock.getStart(sourceFile) &&
        guardCalls[0].getEnd() < node.tryBlock.getEnd()
      ) {
        guardTryStatements.push(node);
      }
      ts.forEachChild(node, collectGuardTry);
    };
    collectGuardTry(mainBody);
    expect(guardTryStatements).toHaveLength(1);
    const pairedFinally = guardTryStatements[0]?.finallyBlock;
    expect(pairedFinally).toBeDefined();
    expect(pairedFinally?.statements).toHaveLength(1);
    const teardownStatement = pairedFinally?.statements[0];
    expect(teardownStatement && ts.isExpressionStatement(teardownStatement)).toBe(true);
    const teardownAwait =
      teardownStatement &&
      ts.isExpressionStatement(teardownStatement) &&
      ts.isAwaitExpression(teardownStatement.expression)
        ? teardownStatement.expression
        : undefined;
    expect(teardownAwait?.expression).toBe(poolEnds[0]);
  });

  it("rejects adversarial alternate-handle and verifier rewrites in the structural contract", () => {
    const source = readFileSync(new URL("../scripts/rollback-check.ts", import.meta.url), "utf8");
    const analyze = (candidate: string) => {
      const file = ts.createSourceFile(
        "rollback-check.ts",
        candidate,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const executeReceivers: string[] = [];
      const openCalls: ts.CallExpression[] = [];
      const verifiedDbDeclarations: ts.Node[] = [];
      const verifierSql: string[] = [];
      const mainDeclarations: ts.FunctionDeclaration[] = [];
      const guardInvocations: ts.CallExpression[] = [];
      const teardownCalls: ts.CallExpression[] = [];
      const tryStatements: ts.TryStatement[] = [];
      const verifiedDbIdentifiers: ts.Identifier[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          if (
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "execute"
          ) {
            executeReceivers.push(node.expression.expression.getText(file));
            const argument = node.arguments[0];
            if (argument && ts.isTaggedTemplateExpression(argument)) {
              const normalized = argument.template
                .getText(file)
                .slice(1, -1)
                .replace(/\s+/g, " ")
                .trim();
              if (normalized.includes("current_database")) verifierSql.push(normalized);
            }
          }
          if (ts.isIdentifier(node.expression) && node.expression.text === "openMigratorDb") {
            openCalls.push(node);
          }
          if (
            ts.isIdentifier(node.expression) &&
            node.expression.text === "runWithVerifiedRollbackTarget"
          ) {
            guardInvocations.push(node);
          }
          if (
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.expression.getText(file) === "pool" &&
            node.expression.name.text === "end"
          ) {
            teardownCalls.push(node);
          }
        }
        if (
          (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
          node.name.getText(file) === "verifiedDb"
        ) {
          verifiedDbDeclarations.push(node);
        }
        if (ts.isFunctionDeclaration(node) && node.name?.text === "main") {
          mainDeclarations.push(node);
        }
        if (ts.isTryStatement(node)) tryStatements.push(node);
        if (ts.isIdentifier(node) && node.text === "verifiedDb") {
          verifiedDbIdentifiers.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      const openDeclaration = openCalls[0]?.parent;
      const openBinding =
        openDeclaration && ts.isVariableDeclaration(openDeclaration)
          ? openDeclaration.name.getText(file)
          : null;
      const openBindingIsConst =
        openDeclaration &&
        ts.isVariableDeclaration(openDeclaration) &&
        ts.isVariableDeclarationList(openDeclaration.parent) &&
        (openDeclaration.parent.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const;
      const mainDbPoolBindings: string[] = [];
      const mainDbPoolAssignments: ts.BinaryExpression[] = [];
      const mainDbIdentifiers: ts.Identifier[] = [];
      const mainPoolIdentifiers: ts.Identifier[] = [];
      const mainBody = mainDeclarations[0]?.body;
      if (mainBody) {
        const collect = (node: ts.Node): void => {
          if (ts.isIdentifier(node)) {
            if (node.text === "db") mainDbIdentifiers.push(node);
            if (node.text === "pool") mainPoolIdentifiers.push(node);
          }
          if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
            if (node.name.text === "db" || node.name.text === "pool") {
              mainDbPoolBindings.push(node.name.text);
            }
          } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            if (node.name.text === "db" || node.name.text === "pool") {
              mainDbPoolBindings.push(node.name.text);
            }
          }
          if (
            ts.isBinaryExpression(node) &&
            ts.isIdentifier(node.left) &&
            (node.left.text === "db" || node.left.text === "pool") &&
            node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          ) {
            mainDbPoolAssignments.push(node);
          }
          ts.forEachChild(node, collect);
        };
        collect(mainBody);
      }
      const pairedTry = tryStatements.filter(
        (statement) =>
          guardInvocations[0] &&
          guardInvocations[0].getStart(file) > statement.tryBlock.getStart(file) &&
          guardInvocations[0].getEnd() < statement.tryBlock.getEnd(),
      );
      const finallyStatement = pairedTry[0]?.finallyBlock?.statements[0];
      const finallyAwait =
        pairedTry.length === 1 &&
        pairedTry[0]?.finallyBlock?.statements.length === 1 &&
        finallyStatement &&
        ts.isExpressionStatement(finallyStatement) &&
        ts.isAwaitExpression(finallyStatement.expression)
          ? finallyStatement.expression
          : undefined;
      return {
        executeReceivers,
        openCalls,
        verifiedDbDeclarations,
        verifierSql,
        openBinding,
        openBindingIsConst,
        mainDbPoolBindings,
        mainDbPoolAssignments,
        mainDbIdentifierCount: mainDbIdentifiers.length,
        mainPoolIdentifierCount: mainPoolIdentifiers.length,
        verifiedDbIdentifierCount: verifiedDbIdentifiers.length,
        hasPairedFinallyTeardown:
          teardownCalls.length === 1 && finallyAwait?.expression === teardownCalls[0],
      };
    };

    const baseline = analyze(source);
    expect(baseline.executeReceivers.every((receiver) => receiver === "verifiedDb")).toBe(true);
    expect(baseline.openCalls).toHaveLength(1);
    expect(baseline.verifiedDbDeclarations).toHaveLength(2);
    expect(baseline.verifierSql).toEqual(["SELECT current_database() AS database_name"]);
    expect(baseline.openBinding).toBe("{ db, pool }");
    expect(baseline.openBindingIsConst).toBe(true);
    expect(baseline.mainDbPoolBindings.sort()).toEqual(["db", "pool"]);
    expect(baseline.mainDbPoolAssignments).toHaveLength(0);
    expect(baseline.mainDbIdentifierCount).toBe(2);
    expect(baseline.mainPoolIdentifierCount).toBe(2);
    expect(baseline.verifiedDbIdentifierCount).toBe(49);
    expect(baseline.hasPairedFinallyTeardown).toBe(true);

    const shadowed = analyze(
      source.replace(
        "// VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
        "const verifiedDb = openMigratorDb().db;\n// VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
      ),
    );
    expect(shadowed.openCalls).toHaveLength(2);
    expect(shadowed.verifiedDbDeclarations).toHaveLength(3);

    const alternate = analyze(
      source.replace("await verifiedDb.execute(sql`", "await otherDb.execute(sql`"),
    );
    expect(alternate.executeReceivers).toContain("otherDb");

    const compoundVerifier = analyze(
      source.replace(
        "SELECT current_database() AS database_name",
        "DELETE FROM sessions RETURNING current_database() AS database_name",
      ),
    );
    expect(compoundVerifier.verifierSql).not.toEqual([
      "SELECT current_database() AS database_name",
    ]);

    const pooledSubstitution = analyze(
      source.replace(
        "const { db, pool } = openMigratorDb();",
        "const { pool } = openMigratorDb();\n  const db = getDb();",
      ),
    );
    expect(pooledSubstitution.openBinding).not.toBe("{ db, pool }");

    const reassigned = analyze(
      source.replace(
        "const { db, pool } = openMigratorDb();",
        "let { db, pool } = openMigratorDb();\n  db = getDb();",
      ),
    );
    expect(reassigned.openBindingIsConst).toBe(false);
    expect(reassigned.mainDbPoolAssignments).toHaveLength(1);

    const aliasedMutation = analyze(
      source.replace(
        'const migrationsFolder = new URL("../migrations", import.meta.url).pathname;',
        'const alias = db;\n  Object.assign(alias, getDb());\n  const migrationsFolder = new URL("../migrations", import.meta.url).pathname;',
      ),
    );
    expect(aliasedMutation.mainDbIdentifierCount).toBeGreaterThan(2);

    const reassignedCapability = analyze(
      source.replace(
        "// VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
        "verifiedDb = getDb();\n        // VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
      ),
    );
    expect(reassignedCapability.verifiedDbIdentifierCount).toBeGreaterThan(49);

    const mutatedCapability = analyze(
      source.replace(
        "// VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
        "Object.assign(verifiedDb, getDb());\n        // VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
      ),
    );
    expect(mutatedCapability.verifiedDbIdentifierCount).toBeGreaterThan(49);

    const definedCapability = analyze(
      source.replace(
        "// VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
        'Object.defineProperty(verifiedDb, "execute", { value: getDb().execute });\n        // VERIFIED_ROLLBACK_MUTATION_SCOPE_START',
      ),
    );
    expect(definedCapability.verifiedDbIdentifierCount).toBeGreaterThan(49);

    const reflectedCapability = analyze(
      source.replace(
        "// VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
        'Reflect.set(verifiedDb, "execute", getDb().execute);\n        // VERIFIED_ROLLBACK_MUTATION_SCOPE_START',
      ),
    );
    expect(reflectedCapability.verifiedDbIdentifierCount).toBeGreaterThan(49);

    const reboundExecute = analyze(
      source.replace(
        "// VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
        "verifiedDb.execute = getDb().execute.bind(getDb());\n        // VERIFIED_ROLLBACK_MUTATION_SCOPE_START",
      ),
    );
    expect(reboundExecute.verifiedDbIdentifierCount).toBeGreaterThan(49);

    const teardownDecoy = analyze(
      source.replace(
        "  } finally {\n    await pool.end();\n  }",
        "  } finally {}\n  async function unusedTeardown() { await pool.end(); }",
      ),
    );
    expect(teardownDecoy.hasPairedFinallyTeardown).toBe(false);
  });
});
