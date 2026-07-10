#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 86_400_000;
const REFRESH_THRESHOLD_DAYS = 21;
const FAILURE_THRESHOLD_DAYS = 14;
const GIT_OBJECT_RE = /^[0-9a-f]{40}$/u;

export const DAILY_REFRESH_REPOSITORY = "pnascimento9596/wcdraft";
export const DAILY_REFRESH_BRANCH = "automation/daily-seed-salt-map-refresh";
export const DAILY_REFRESH_REF = `refs/heads/${DAILY_REFRESH_BRANCH}`;
export const DAILY_REFRESH_LABEL = "daily-freshness";
export const DAILY_REFRESH_CI_WORKFLOW = "ci.yml";

function fail(message) {
  throw new Error(`daily seed runway: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireUtcDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} must be a UTC YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be a valid UTC date, got ${JSON.stringify(value)}`);
  }
  return value;
}

function addUtcDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function requireSalt(value, label, { allowZero }) {
  if (!Number.isSafeInteger(value) || (allowZero ? value !== 0 && value < 2 : value < 2)) {
    fail(`${label} must be ${allowZero ? "0 or " : ""}an integer >= 2`);
  }
  return value;
}

function normalizeGitObject(value, label, { optional = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (optional && normalized === "") return null;
  if (!GIT_OBJECT_RE.test(normalized)) {
    fail(`${label} must be ${optional ? "empty or " : ""}a 40-character lowercase git object`);
  }
  return normalized;
}

/** Capture the UTC calendar date from one supplied clock reading. */
export function captureUtcDate(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    fail("captureUtcDate requires a valid Date");
  }
  return now.toISOString().slice(0, 10);
}

/**
 * Validate the artifact coverage contract and return a normalized view.
 * Sparse salts are expanded so every explicitly covered date has a salt,
 * including implicit zero.
 */
export function validateDailySeedArtifact(rawArtifact) {
  if (!isRecord(rawArtifact)) fail("artifact must be an object");
  if (!isRecord(rawArtifact.window)) fail("artifact.window must be an object");

  const startDate = requireUtcDate(rawArtifact.window.start_date, "artifact.window.start_date");
  const days = rawArtifact.window.days;
  if (!Number.isSafeInteger(days) || days <= 0) {
    fail("artifact.window.days must be a positive integer");
  }
  if (rawArtifact.window.timezone !== "UTC") {
    fail('artifact.window.timezone must be "UTC"');
  }
  if (!Array.isArray(rawArtifact.dates)) fail("artifact.dates must be an array");
  if (rawArtifact.dates.length !== days) {
    fail(`artifact.dates length ${rawArtifact.dates.length} does not match window.days ${days}`);
  }
  if (!isRecord(rawArtifact.salts)) fail("artifact.salts must be an object");

  const sparseSalts = new Map();
  for (const [dateValue, saltValue] of Object.entries(rawArtifact.salts)) {
    const date = requireUtcDate(dateValue, `artifact.salts.${dateValue}`);
    sparseSalts.set(date, requireSalt(saltValue, `artifact.salts.${date}`, { allowZero: false }));
  }

  const dates = [];
  const effectiveSalts = new Map();
  const seenDates = new Set();
  for (const [index, value] of rawArtifact.dates.entries()) {
    if (!isRecord(value)) fail(`artifact.dates[${index}] must be an object`);
    const date = requireUtcDate(value.date, `artifact.dates[${index}].date`);
    if (seenDates.has(date)) fail(`artifact.dates[${index}].date duplicates ${date}`);
    seenDates.add(date);

    const expectedDate = addUtcDays(startDate, index);
    if (date !== expectedDate) {
      fail(
        `artifact.dates[${index}].date must be contiguous from window.start_date; ` +
          `expected ${expectedDate}, got ${date}`,
      );
    }
    const salt = requireSalt(value.salt, `artifact.dates[${index}].salt`, { allowZero: true });
    const sparseSalt = sparseSalts.get(date);
    const expectedSalt = sparseSalt ?? 0;
    if (salt !== expectedSalt) {
      fail(
        `artifact.dates[${index}].salt ${salt} does not match sparse salt ${expectedSalt} ` +
          `(implicit zero included)`,
      );
    }
    dates.push(date);
    effectiveSalts.set(date, salt);
  }

  for (const date of sparseSalts.keys()) {
    if (!seenDates.has(date)) fail(`artifact.salts.${date} is outside the explicit date window`);
  }

  return {
    startDate,
    endDate: addUtcDays(startDate, days - 1),
    days,
    dates,
    effectiveSalts,
  };
}

/** Inclusive explicitly-covered dates from today through the artifact end. */
export function countRemainingCoverage(coverage, today) {
  const capturedDate = requireUtcDate(today, "today");
  const todayIndex = coverage.dates.indexOf(capturedDate);
  return todayIndex === -1 ? 0 : coverage.dates.length - todayIndex;
}

export function decideRunway(remainingDays) {
  if (!Number.isSafeInteger(remainingDays) || remainingDays < 0) {
    fail("remainingDays must be a non-negative integer");
  }
  return {
    remainingDays,
    refreshRequired: remainingDays <= REFRESH_THRESHOLD_DAYS,
    failFreshness: remainingDays < FAILURE_THRESHOLD_DAYS,
  };
}

/** Call the supplied clock exactly once, then validate and decide. */
export function evaluateRunwayAtCapture(rawArtifact, captureToday) {
  if (typeof captureToday !== "function") fail("captureToday must be a function");
  const today = captureToday();
  const coverage = validateDailySeedArtifact(rawArtifact);
  const decision = decideRunway(countRemainingCoverage(coverage, today));
  return { today, coverage, ...decision };
}

/** Compare all explicitly covered dates shared by two validated artifacts. */
export function compareOverlappingSalts(committedArtifact, generatedArtifact) {
  const committed = validateDailySeedArtifact(committedArtifact);
  const generated = validateDailySeedArtifact(generatedArtifact);
  const mismatches = [];
  let overlapDays = 0;

  for (const date of committed.dates) {
    if (!generated.effectiveSalts.has(date)) continue;
    overlapDays += 1;
    const committedSalt = committed.effectiveSalts.get(date);
    const generatedSalt = generated.effectiveSalts.get(date);
    if (committedSalt !== generatedSalt) {
      mismatches.push({ date, committedSalt, generatedSalt });
    }
  }

  return { overlapDays, mismatches, matches: mismatches.length === 0 };
}

export function dailyRefreshAutomationIdentity() {
  return {
    repository: DAILY_REFRESH_REPOSITORY,
    branch: DAILY_REFRESH_BRANCH,
    ref: DAILY_REFRESH_REF,
    label: DAILY_REFRESH_LABEL,
    ciWorkflow: DAILY_REFRESH_CI_WORKFLOW,
    ciForceAll: true,
  };
}

/** Decide the only allowed git mutation for the stable automation branch. */
export function planDailyRefreshBranchUpdate({ candidateTree, remoteSha, remoteTree }) {
  const candidate = normalizeGitObject(candidateTree, "candidateTree");
  const remoteCommit = normalizeGitObject(remoteSha, "remoteSha", { optional: true });
  const remoteCandidateTree = normalizeGitObject(remoteTree, "remoteTree", { optional: true });
  if ((remoteCommit === null) !== (remoteCandidateTree === null)) {
    fail("remoteSha and remoteTree must either both be present or both be empty");
  }

  const refspec = `HEAD:${DAILY_REFRESH_REF}`;
  if (remoteCommit === null) {
    return {
      action: "create",
      commitRequired: true,
      pushRequired: true,
      refspec,
      lease: null,
    };
  }
  if (candidate === remoteCandidateTree) {
    return {
      action: "noop-same-tree",
      commitRequired: false,
      pushRequired: false,
      refspec,
      lease: null,
    };
  }
  return {
    action: "replace-with-exact-lease",
    commitRequired: true,
    pushRequired: true,
    refspec,
    lease: `${DAILY_REFRESH_REF}:${remoteCommit}`,
  };
}

/** Fail closed unless a force-all CI dispatch targets the one automation ref. */
export function requireTrustedDailyRefreshDispatch({ repository, event, ref, forceAll }) {
  if (repository !== DAILY_REFRESH_REPOSITORY) {
    fail(`dispatch repository must be ${DAILY_REFRESH_REPOSITORY}`);
  }
  if (event !== "workflow_dispatch") fail("dispatch event must be workflow_dispatch");
  if (ref !== DAILY_REFRESH_REF) fail(`dispatch ref must be ${DAILY_REFRESH_REF}`);
  if (forceAll !== true) fail("dispatch forceAll must be boolean true");
  return { trusted: true, ...dailyRefreshAutomationIdentity() };
}

/** Offline seam used by the workflow after its read-only PR lookup. */
export function planRefreshPullRequest(existingPrNumbers) {
  const normalized = String(existingPrNumbers ?? "").trim();
  const numbers = normalized === "" ? [] : normalized.split(",");
  if (numbers.length > 1) {
    fail(`expected at most one open PR for ${DAILY_REFRESH_BRANCH}, got ${numbers.length}`);
  }
  if (numbers.some((number) => !/^[1-9]\d*$/u.test(number))) {
    fail(
      `existing PR state must be empty or one positive integer, got ${JSON.stringify(normalized)}`,
    );
  }
  return {
    action: numbers.length === 0 ? "open" : "update",
    prNumber: numbers.length === 0 ? null : Number(numbers[0]),
    ...dailyRefreshAutomationIdentity(),
  };
}

/** Guard pnpm's repository-specific argument forwarding contract. */
export function validateWorkflowBuilderInvocation(workflowSource) {
  if (typeof workflowSource !== "string") fail("workflow source must be a string");
  if (/build:daily-seed-salt-map -- \\\n/u.test(workflowSource)) {
    fail("nightly workflow must not forward a literal -- argument to the builder");
  }
  const expected = `pnpm --filter @wcdraft/data run build:daily-seed-salt-map \\
            --start-date "$CAPTURED_DATE" \\
            --window-days 45`;
  if (!workflowSource.includes(expected)) {
    fail("nightly workflow must pass the captured date and 45-day window directly to the builder");
  }
  return true;
}

function requireWorkflowFragment(source, fragment, label) {
  if (!source.includes(fragment))
    fail(`${label} is missing required workflow fragment: ${fragment}`);
}

function requireWorkflowOrder(source, fragments, label) {
  let cursor = 0;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, cursor);
    if (index === -1) fail(`${label} is missing or misorders workflow fragment: ${fragment}`);
    cursor = index + fragment.length;
  }
}

function requireWorkflowFragmentCount(source, fragment, expected, label) {
  const actual = source.split(fragment).length - 1;
  if (actual !== expected) {
    fail(`${label} must contain ${expected} occurrence(s) of ${fragment}, got ${actual}`);
  }
}

function validateSelfHostedWorkflowContract(source, { jobs, label }) {
  const exactRunsOn = "    runs-on: [self-hosted, macOS, ARM64, wcdraft]";
  const runsOnLines = source.match(/^ {4}runs-on:.*$/gmu) ?? [];
  if (runsOnLines.length !== jobs || runsOnLines.some((line) => line !== exactRunsOn)) {
    fail(`${label} must bind all ${jobs} jobs to the exact self-hosted macOS ARM64 label set`);
  }
  for (const [fragment, fragmentLabel] of [
    ["uses: actions/checkout@", "pinned checkout"],
    ["          clean: true", "clean checkout"],
    ["          persist-credentials: false", "non-persistent checkout credentials"],
    ["uses: ./.github/actions/self-hosted-runner-hygiene", "persistent-runner hygiene"],
  ]) {
    requireWorkflowFragmentCount(source, fragment, jobs, `${label} ${fragmentLabel}`);
  }
  requireWorkflowFragment(source, "cancel-in-progress: true", `${label} concurrency`);
}

/** Bind the actual workflow files to every state-changing helper decision. */
export function validateDailyRefreshWorkflowContract(nightlySource, ciSource) {
  if (typeof nightlySource !== "string" || typeof ciSource !== "string") {
    fail("nightly and CI workflow sources must be strings");
  }
  validateSelfHostedWorkflowContract(ciSource, { jobs: 10, label: "CI workflow" });
  validateSelfHostedWorkflowContract(nightlySource, { jobs: 3, label: "nightly workflow" });
  requireWorkflowFragment(
    nightlySource,
    '- cron: "23 15 * * *"',
    "nightly self-hosted awake-window schedule",
  );
  for (const fragment of [
    "permissions:\n  contents: read",
    "if: ${{ github.actor != 'dependabot[bot]' }}",
    "github.actor != 'dependabot[bot]' &&",
    "name: ${{ github.actor == 'dependabot[bot]' && 'blocked · dependabot actor' || 'required · aggregate gates' }}",
    "if: ${{ always() && github.actor != 'dependabot[bot]' }}",
  ]) {
    requireWorkflowFragment(ciSource, fragment, "CI self-hosted trust boundary");
  }
  validateWorkflowBuilderInvocation(nightlySource);
  requireWorkflowOrder(
    nightlySource,
    [
      "pnpm --filter @wcdraft/data run build:compact",
      "pnpm --filter @wcdraft/data run build:score-distribution",
      "pnpm --filter @wcdraft/data run build:compact",
      "pnpm --filter @wcdraft/data run build:daily-seed-salt-map",
      "pnpm --filter @wcdraft/data run build:compact",
    ],
    "nightly regeneration chain",
  );
  for (const fragment of [
    `github.repository == '${DAILY_REFRESH_REPOSITORY}'`,
    "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')",
    "actions: write\n      contents: write\n      pull-requests: write",
    "id: automation",
    "daily-seed-runway.mjs automation-identity",
    "AUTOMATION_BRANCH: ${{ steps.automation.outputs.automation_branch }}",
    "id: branch-update",
    "daily-seed-runway.mjs plan-branch-update",
    '--candidate-tree "$candidate_tree"',
    '--remote-sha "$remote_sha"',
    '--remote-tree "$remote_tree"',
    "BRANCH_ACTION: ${{ steps.branch-update.outputs.branch_action }}",
    "GH_TOKEN: ${{ github.token }}",
    "PUSH_LEASE: ${{ steps.branch-update.outputs.push_lease }}",
    "PUSH_REFSPEC: ${{ steps.branch-update.outputs.push_refspec }}",
    "git status --porcelain=v1 --untracked-files=all",
    'case "$BRANCH_ACTION" in',
    "trap cleanup_git_auth EXIT",
    "git config --local --add credential.helper",
    "git config --local --unset-all credential.helper || true",
    'git push --force-with-lease="$PUSH_LEASE" origin "$PUSH_REFSPEC"',
    'git push origin "$PUSH_REFSPEC"',
    "id: refresh-pr",
    "daily-seed-runway.mjs plan-pr",
    '--existing-pr-numbers "$existing_pr"',
    "AUTOMATION_BRANCH: ${{ steps.refresh-pr.outputs.automation_branch }}",
    "PR_LABEL: ${{ steps.refresh-pr.outputs.pr_label }}",
    '--head "$AUTOMATION_BRANCH"',
    '--label "$PR_LABEL"',
    '--add-label "$PR_LABEL"',
    "CI_FORCE_ALL: ${{ steps.automation.outputs.ci_force_all }}",
    "CI_WORKFLOW: ${{ steps.automation.outputs.ci_workflow }}",
    'gh workflow run "$CI_WORKFLOW"',
    '--ref "$AUTOMATION_BRANCH"',
    '--field "force_all=$CI_FORCE_ALL"',
  ]) {
    requireWorkflowFragment(nightlySource, fragment, "nightly workflow");
  }
  for (const path of [
    "packages/data/src/generated/daily-seed-salt-map.compact.json",
    "packages/data/src/generated/manifest.json",
    "packages/data/reports/compact-size.json",
  ]) {
    requireWorkflowFragment(nightlySource, path, "nightly explicit generated allowlist");
  }

  requireWorkflowOrder(
    ciSource,
    [
      "- name: Guard automation dispatch envelope before checkout",
      `if [[ "$GITHUB_REPOSITORY" != "${DAILY_REFRESH_REPOSITORY}"`,
      "- name: Checkout",
      "- name: Bind trusted automation dispatch after checkout",
      "daily-seed-runway.mjs guard-dispatch",
    ],
    "CI pre-check trust boundary",
  );
  for (const fragment of [
    "workflow_dispatch:",
    "force_all:",
    "daily-seed-runway.mjs guard-dispatch",
    '--repository "$GITHUB_REPOSITORY"',
    '--event "$GITHUB_EVENT_NAME"',
    '--ref "$GITHUB_REF"',
    '--force-all "$FORCE_ALL"',
    "steps.force-all.outputs.all == 'true' && 'true' || steps.filter.outputs.ci_config",
    "github.event_name != 'workflow_dispatch' ||",
    `github.repository == '${DAILY_REFRESH_REPOSITORY}' && inputs.force_all &&`,
    `github.ref == '${DAILY_REFRESH_REF}')`,
    "daily-seed-runway.mjs check-workflows",
    "--nightly .github/workflows/nightly-heavy.yml",
    "--ci .github/workflows/ci.yml",
  ]) {
    requireWorkflowFragment(ciSource, fragment, "CI workflow");
  }
  return true;
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    fail(
      "expected command: inspect, compare-overlap, automation-identity, " +
        "plan-branch-update, guard-dispatch, plan-pr, or check-workflows",
    );
  }
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (typeof flag !== "string" || !flag.startsWith("--") || typeof value !== "string") {
      fail(`invalid arguments near ${JSON.stringify(flag)}`);
    }
    if (options.has(flag)) fail(`duplicate option ${flag}`);
    options.set(flag, value);
  }
  return { command, options };
}

function requireOption(options, flag) {
  if (!options.has(flag)) fail(`missing required option ${flag}`);
  return options.get(flag);
}

function requireBooleanOption(options, flag) {
  const raw = requireOption(options, flag);
  if (raw === "true") return true;
  if (raw === "false") return false;
  fail(`${flag} must be true or false`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`could not read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function emitGithubOutputs(path, outputs) {
  if (path === undefined) return;
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${String(value)}\n`)
    .join("");
  appendFileSync(path, lines, "utf8");
}

function identityOutputs(identity) {
  return {
    automation_repository: identity.repository,
    automation_branch: identity.branch,
    automation_ref: identity.ref,
    pr_label: identity.label,
    ci_workflow: identity.ciWorkflow,
    ci_force_all: identity.ciForceAll,
  };
}

function runCli(argv) {
  const { command, options } = parseCli(argv);
  const githubOutput = options.get("--github-output");

  if (command === "inspect") {
    const artifactPath = requireOption(options, "--artifact");
    const today = requireOption(options, "--today");
    const result = evaluateRunwayAtCapture(readJson(artifactPath), () => today);
    const output = {
      captured_date: result.today,
      artifact_start: result.coverage.startDate,
      artifact_end: result.coverage.endDate,
      remaining_days: result.remainingDays,
      refresh_required: result.refreshRequired,
      fail_freshness: result.failFreshness,
    };
    emitGithubOutputs(githubOutput, output);
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }

  if (command === "compare-overlap") {
    const committedPath = requireOption(options, "--committed");
    const generatedPath = requireOption(options, "--generated");
    const result = compareOverlappingSalts(readJson(committedPath), readJson(generatedPath));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.matches) process.exitCode = 1;
    return;
  }

  if (command === "automation-identity") {
    const result = dailyRefreshAutomationIdentity();
    emitGithubOutputs(githubOutput, identityOutputs(result));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "plan-branch-update") {
    const result = planDailyRefreshBranchUpdate({
      candidateTree: requireOption(options, "--candidate-tree"),
      remoteSha: requireOption(options, "--remote-sha"),
      remoteTree: requireOption(options, "--remote-tree"),
    });
    emitGithubOutputs(githubOutput, {
      branch_action: result.action,
      commit_required: result.commitRequired,
      push_required: result.pushRequired,
      push_refspec: result.refspec,
      push_lease: result.lease ?? "",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "guard-dispatch") {
    const result = requireTrustedDailyRefreshDispatch({
      repository: requireOption(options, "--repository"),
      event: requireOption(options, "--event"),
      ref: requireOption(options, "--ref"),
      forceAll: requireBooleanOption(options, "--force-all"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "plan-pr") {
    const result = planRefreshPullRequest(requireOption(options, "--existing-pr-numbers"));
    emitGithubOutputs(githubOutput, {
      pr_action: result.action,
      pr_number: result.prNumber ?? "",
      ...identityOutputs(result),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "check-workflows") {
    const nightlyPath = requireOption(options, "--nightly");
    const ciPath = requireOption(options, "--ci");
    validateDailyRefreshWorkflowContract(
      readFileSync(nightlyPath, "utf8"),
      readFileSync(ciPath, "utf8"),
    );
    process.stdout.write(`${JSON.stringify({ valid: true })}\n`);
    return;
  }

  fail(`unknown command ${JSON.stringify(command)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
