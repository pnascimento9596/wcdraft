#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 86_400_000;
const REFRESH_THRESHOLD_DAYS = 21;
const FAILURE_THRESHOLD_DAYS = 14;

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

/** Offline seam used by the workflow after its read-only PR lookup. */
export function planRefreshPullRequest(existingPrNumber) {
  const normalized = String(existingPrNumber ?? "").trim();
  if (normalized === "") return { action: "open", prNumber: null };
  if (!/^[1-9]\d*$/u.test(normalized)) {
    fail(
      `existing PR number must be empty or a positive integer, got ${JSON.stringify(normalized)}`,
    );
  }
  return { action: "update", prNumber: Number(normalized) };
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

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!command) fail("expected command: inspect, compare-overlap, plan-pr, or check-workflow");
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

  if (command === "plan-pr") {
    const result = planRefreshPullRequest(requireOption(options, "--existing-pr-number"));
    emitGithubOutputs(githubOutput, {
      pr_action: result.action,
      pr_number: result.prNumber ?? "",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "check-workflow") {
    const workflowPath = requireOption(options, "--workflow");
    validateWorkflowBuilderInvocation(readFileSync(workflowPath, "utf8"));
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
