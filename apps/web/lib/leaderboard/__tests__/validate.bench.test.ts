// F-4 U2 — opt-in wall-time bench for the validation pipeline (plan §0.1).
//
// OFF by default (machines vary; CI never time-asserts — same posture as the
// committed plan bench). Flip on with:
//
//   WCDRAFT_LEADERBOARD_BENCH=1 pnpm --filter @wcdraft/web exec vitest run \
//     lib/leaderboard/__tests__/validate.bench.test.ts --disable-console-intercept
//
// Measures `validateSubmission` end-to-end (decode → season → name → replay →
// re-sim → score check) over N real-bundle submissions synthesized via
// autoDraft on distinct seeds, mirroring the plan-§0.1 method. The plan's
// Historical plan numbers were p50 7.6 ms / p95 17.0 ms per submission.
// They are context only. Audit S1 C6 measured p50 5.6 ms / p95 11.4 ms /
// max 13.6 ms locally on 2026-07-12; this remains telemetry, not a threshold.
//
// `performance.now` here is TEST harness telemetry — it never feeds the
// pipeline (the core stays clock-free).

import { describe, expect, it } from "vitest";

import { validateSubmission, type ValidationData } from "../validate";
import {
  buildOriginRecord,
  buildSubmissionBody,
  buildServerGameData,
  serverScenarioBundle,
} from "./_harness";

const BENCH_ON = process.env.WCDRAFT_LEADERBOARD_BENCH === "1";
const N = 30;
const WARMUP = 3;

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!;
}

(BENCH_ON ? describe : describe.skip)("validateSubmission wall-time bench", () => {
  it(`p50/p95 over ${N} real-bundle submissions`, () => {
    const data: ValidationData = {
      gameData: buildServerGameData(),
      scenario: serverScenarioBundle(),
    };

    const submissions = Array.from({ length: N + WARMUP }, (_, i) => {
      const record = buildOriginRecord(
        data.gameData,
        `wcdraft:f4-u2-bench:${i}`,
        "classic",
        "Bench XI",
      );
      return buildSubmissionBody(data.gameData, data.scenario, record, {
        display_alias: "bench_player",
      });
    });

    // Warmup (JIT + lazy structures), then timed runs.
    for (const s of submissions.slice(0, WARMUP)) {
      expect(validateSubmission(s, data).status).toBe("accepted");
    }
    const times: number[] = [];
    for (const s of submissions.slice(WARMUP)) {
      const t0 = performance.now();
      const verdict = validateSubmission(s, data);
      times.push(performance.now() - t0);
      expect(verdict.status).toBe("accepted"); // bench measures the FULL path
    }

    const sorted = [...times].sort((a, b) => a - b);
    const fmt = (x: number) => `${x.toFixed(1)} ms`;
    console.log(
      `[f4-u2 bench] n=${N} p50=${fmt(quantile(sorted, 0.5))} p95=${fmt(
        quantile(sorted, 0.95),
      )} max=${fmt(sorted[sorted.length - 1]!)} (historical plan reference only: p50 7.6 / p95 17.0)`,
    );
  });
});
