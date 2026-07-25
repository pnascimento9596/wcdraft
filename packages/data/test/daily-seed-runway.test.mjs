import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  captureUtcDate,
  compareOverlappingSalts,
  DAILY_REFRESH_GENERATED_PATHS,
  dailyRefreshAutomationIdentity,
  decideRunway,
  evaluateRunwayAtCapture,
  planDailyRefreshBranchUpdate,
  planRefreshPullRequest,
  requireTrustedDailyRefreshDispatch,
  validateDailyRefreshChangedPaths,
  validateDailySeedArtifact,
  validateDailyRefreshWorkflowContract,
  validateWorkflowBuilderInvocation,
} from "../scripts/daily-seed-runway.mjs";

const DAY_MS = 86_400_000;

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function artifact({ start = "2026-07-01", days = 30, salts = {} } = {}) {
  return {
    window: { start_date: start, days, timezone: "UTC" },
    salts,
    dates: Array.from({ length: days }, (_, index) => {
      const date = addDays(start, index);
      return { date, salt: salts[date] ?? 0 };
    }),
  };
}

describe("daily seed runway policy", () => {
  it("proves the complete five-file set from the captured 2026-07-11 regeneration evidence", () => {
    const evidence = readFileSync(
      new URL("fixtures/daily-refresh-changed-paths-2026-07-11.txt", import.meta.url),
      "utf8",
    )
      .trim()
      .split(/\r?\n/u);
    expect(validateDailyRefreshChangedPaths(evidence)).toEqual([
      "packages/data/reports/compact-size.json",
      "packages/data/src/generated/daily-seed-salt-map.compact.json",
      "packages/data/src/generated/daily-seed-salt-map.compact.json.br",
      "packages/data/src/generated/manifest.json",
      "packages/data/src/generated/manifest.json.br",
    ]);
    expect(() =>
      validateDailyRefreshChangedPaths(
        DAILY_REFRESH_GENERATED_PATHS.filter((path) => !path.endsWith(".json.br")),
      ),
    ).toThrow(/canonical five-file set/u);
    expect(() =>
      validateDailyRefreshChangedPaths([...DAILY_REFRESH_GENERATED_PATHS, "unexpected.txt"]),
    ).toThrow(/canonical five-file set/u);
  });

  it.each([
    [22, false, false],
    [21, true, false],
    [14, true, false],
    [13, true, true],
  ])("%i remaining days => refresh=%s fail=%s", (remainingDays, refreshRequired, failFreshness) => {
    expect(decideRunway(remainingDays)).toEqual({
      remainingDays,
      refreshRequired,
      failFreshness,
    });
  });

  it("counts inclusive coverage through the artifact end", () => {
    const result = evaluateRunwayAtCapture(artifact({ days: 30 }), () => "2026-07-10");
    expect(result.remainingDays).toBe(21);
  });

  it("captures the UTC boundary exactly once", () => {
    let calls = 0;
    const result = evaluateRunwayAtCapture(artifact({ start: "2026-07-02", days: 45 }), () => {
      calls += 1;
      return "2026-07-02";
    });
    expect(calls).toBe(1);
    expect(result.today).toBe("2026-07-02");
    expect(result.remainingDays).toBe(45);
    expect(captureUtcDate(new Date("2026-07-01T23:59:59.999Z"))).toBe("2026-07-01");
    expect(captureUtcDate(new Date("2026-07-02T00:00:00.000Z"))).toBe("2026-07-02");
  });

  it.each(["2026-07-01", "2026-07-16"])(
    "fails closed when today %s is outside the explicit artifact window",
    (today) => {
      const result = evaluateRunwayAtCapture(
        artifact({ start: "2026-07-02", days: 14 }),
        () => today,
      );
      expect(result).toMatchObject({
        remainingDays: 0,
        refreshRequired: true,
        failFreshness: true,
      });
    },
  );
});

describe("daily seed artifact validation", () => {
  it.each([
    [
      "missing date",
      () => {
        const value = artifact({ days: 3 });
        value.dates.pop();
        return value;
      },
    ],
    [
      "duplicate date",
      () => {
        const value = artifact({ days: 3 });
        value.dates[1].date = value.dates[0].date;
        return value;
      },
    ],
    [
      "noncontiguous date",
      () => {
        const value = artifact({ days: 3 });
        value.dates[1].date = addDays(value.window.start_date, 2);
        return value;
      },
    ],
    ["malformed date", () => artifact({ start: "2026-02-30", days: 1 })],
  ])("fails closed for a %s artifact", (_label, makeArtifact) => {
    expect(() => validateDailySeedArtifact(makeArtifact())).toThrow(/daily seed runway/u);
  });
});

describe("overlap determinism", () => {
  it("passes when every overlapping effective salt is unchanged", () => {
    const committed = artifact({
      start: "2026-07-01",
      days: 4,
      salts: { "2026-07-03": 2 },
    });
    const generated = artifact({
      start: "2026-07-03",
      days: 4,
      salts: { "2026-07-03": 2 },
    });
    expect(compareOverlappingSalts(committed, generated)).toEqual({
      overlapDays: 2,
      mismatches: [],
      matches: true,
    });
  });

  it("fails when an implicit zero becomes an explicit non-zero salt", () => {
    const committed = artifact({ start: "2026-07-01", days: 3 });
    const generated = artifact({
      start: "2026-07-02",
      days: 3,
      salts: { "2026-07-02": 2 },
    });
    expect(compareOverlappingSalts(committed, generated)).toMatchObject({
      overlapDays: 2,
      matches: false,
      mismatches: [{ date: "2026-07-02", committedSalt: 0, generatedSalt: 2 }],
    });
  });
});

describe("refresh PR planning", () => {
  it("pins the stable branch, label, repository, and CI handoff", () => {
    expect(dailyRefreshAutomationIdentity()).toEqual({
      repository: "pnascimento9596/wcdraft",
      branch: "automation/daily-seed-salt-map-refresh",
      ref: "refs/heads/automation/daily-seed-salt-map-refresh",
      label: "daily-freshness",
      ciWorkflow: "ci.yml",
      ciForceAll: true,
    });
  });

  it("opens when no existing PR was found", () => {
    expect(planRefreshPullRequest("")).toEqual({
      action: "open",
      prNumber: null,
      ...dailyRefreshAutomationIdentity(),
    });
  });

  it("updates the one existing PR", () => {
    expect(planRefreshPullRequest("123")).toEqual({
      action: "update",
      prNumber: 123,
      ...dailyRefreshAutomationIdentity(),
    });
  });

  it("fails closed instead of choosing between duplicate open PRs", () => {
    expect(() => planRefreshPullRequest("123,124")).toThrow(/at most one open PR/u);
    expect(() => planRefreshPullRequest("not-a-pr")).toThrow(/one positive integer/u);
  });

  it("forwards builder arguments without a literal pnpm separator", () => {
    const directInvocation = `pnpm --filter @wcdraft/data run build:daily-seed-salt-map \\
            --start-date "$CAPTURED_DATE" \\
            --window-days 45`;
    const separatedInvocation = `pnpm --filter @wcdraft/data run build:daily-seed-salt-map -- \\
            --start-date "$CAPTURED_DATE" \\
            --window-days 45`;
    expect(validateWorkflowBuilderInvocation(directInvocation)).toBe(true);
    expect(() => validateWorkflowBuilderInvocation(separatedInvocation)).toThrow(
      /literal -- argument/u,
    );
  });

  it("fails when the workflow drops the captured-date or 45-day arguments", () => {
    expect(() =>
      validateWorkflowBuilderInvocation(
        "pnpm --filter @wcdraft/data run build:daily-seed-salt-map",
      ),
    ).toThrow(/captured date and 45-day window/u);
  });
});

describe("refresh branch mutation planning", () => {
  const candidateTree = "a".repeat(40);
  const remoteSha = "b".repeat(40);
  const remoteTree = "c".repeat(40);

  it("makes an identical candidate tree a no-commit, no-push operation", () => {
    expect(
      planDailyRefreshBranchUpdate({ candidateTree, remoteSha, remoteTree: candidateTree }),
    ).toEqual({
      action: "noop-same-tree",
      commitRequired: false,
      pushRequired: false,
      refspec: "HEAD:refs/heads/automation/daily-seed-salt-map-refresh",
      lease: null,
    });
  });

  it("replaces a changed remote tree only with the exact captured lease", () => {
    expect(planDailyRefreshBranchUpdate({ candidateTree, remoteSha, remoteTree })).toEqual({
      action: "replace-with-exact-lease",
      commitRequired: true,
      pushRequired: true,
      refspec: "HEAD:refs/heads/automation/daily-seed-salt-map-refresh",
      lease: `refs/heads/automation/daily-seed-salt-map-refresh:${remoteSha}`,
    });
  });

  it("creates a missing remote branch without a force lease", () => {
    expect(planDailyRefreshBranchUpdate({ candidateTree, remoteSha: "", remoteTree: "" })).toEqual({
      action: "create",
      commitRequired: true,
      pushRequired: true,
      refspec: "HEAD:refs/heads/automation/daily-seed-salt-map-refresh",
      lease: null,
    });
  });

  it.each([
    [{ candidateTree: "invalid", remoteSha: "", remoteTree: "" }],
    [{ candidateTree, remoteSha, remoteTree: "" }],
    [{ candidateTree, remoteSha: "", remoteTree }],
    [{ candidateTree, remoteSha: "invalid", remoteTree }],
  ])("fails closed for invalid or incomplete git objects", (input) => {
    expect(() => planDailyRefreshBranchUpdate(input)).toThrow(/daily seed runway/u);
  });
});

describe("trusted force-all CI dispatch", () => {
  const trusted = {
    repository: "pnascimento9596/wcdraft",
    event: "workflow_dispatch",
    ref: "refs/heads/automation/daily-seed-salt-map-refresh",
    forceAll: true,
  };

  it("accepts only the force-all dispatch for the stable automation ref", () => {
    expect(requireTrustedDailyRefreshDispatch(trusted)).toEqual({
      trusted: true,
      ...dailyRefreshAutomationIdentity(),
    });
  });

  it.each([
    [{ ...trusted, repository: "fork/wcdraft" }],
    [{ ...trusted, event: "pull_request" }],
    [{ ...trusted, ref: "refs/heads/main" }],
    [{ ...trusted, forceAll: false }],
    [{ ...trusted, forceAll: "true" }],
  ])("rejects a widened or malformed dispatch", (input) => {
    expect(() => requireTrustedDailyRefreshDispatch(input)).toThrow(/daily seed runway/u);
  });
});

describe("actual workflow mutation contract", () => {
  const nightly = readFileSync(
    new URL("../../../.github/workflows/nightly-heavy.yml", import.meta.url),
    "utf8",
  );
  const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

  it("binds regeneration, git mutation, PR identity, and trusted CI dispatch", () => {
    expect(validateDailyRefreshWorkflowContract(nightly, ci)).toBe(true);
  });

  it("fails when the actual contract loses the exact lease or stable label", () => {
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly.replace('git push --force-with-lease="$PUSH_LEASE"', "git push --force"),
        ci,
      ),
    ).toThrow(/force-with-lease/u);
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly.replace('--label "$PR_LABEL"', "--label wrong"),
        ci,
      ),
    ).toThrow(/PR_LABEL/u);
  });

  it("fails when the writer loses step-scoped git authentication or its cleanup", () => {
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly.replace(
          "git config --local --add credential.helper",
          "git config --global --add credential.helper",
        ),
        ci,
      ),
    ).toThrow(/credential.helper/u);
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly.replace("trap cleanup_git_auth EXIT", "true"),
        ci,
      ),
    ).toThrow(/cleanup_git_auth/u);
  });

  it("fails when the A0 self-hosted runner or trust boundary drifts", () => {
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly.replace("runs-on: [self-hosted, wcdraft-linux]", "runs-on: ubuntu-latest"),
        ci,
      ),
    ).toThrow(/self-hosted wcdraft-linux/u);
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly,
        ci.replace("github.actor != 'dependabot[bot]' &&", "true &&"),
      ),
    ).toThrow(/dependabot/u);
  });

  it("fails when the actual contract drops untracked checks or widens CI dispatch", () => {
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly.replace("git status --porcelain=v1 --untracked-files=all", "git status --short"),
        ci,
      ),
    ).toThrow(/untracked-files/u);
    expect(() =>
      validateDailyRefreshWorkflowContract(
        nightly,
        ci.replaceAll(
          "refs/heads/automation/daily-seed-salt-map-refresh",
          "refs/heads/automation/*",
        ),
      ),
    ).toThrow(/daily-seed-salt-map-refresh/u);
  });

  it("fails when checkout moves ahead of the repository-code-free dispatch pre-check", () => {
    const guard = "- name: Guard automation dispatch envelope before checkout";
    const checkout = "- name: Checkout";
    const reordered = ci
      .replace(guard, "__DAILY_REFRESH_GUARD__")
      .replace(checkout, guard)
      .replace("__DAILY_REFRESH_GUARD__", checkout);
    expect(() => validateDailyRefreshWorkflowContract(nightly, reordered)).toThrow(
      /pre-check trust boundary/u,
    );
  });
});
