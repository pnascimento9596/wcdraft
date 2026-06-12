"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { loadGameData, type GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import {
  configBadgesFromRecordToken,
  configBadgesFromReplayToken,
  type ConfigBadge,
} from "@/lib/game/config-badges";
import {
  draftHref,
  historyHref,
  parseRunSearchParams,
  reviewHref,
  shareHref,
} from "@/lib/game/navigation";
import { loadRunRecord, type RunRecordV1 } from "@/lib/game/run-record";
import { loadScenarioBundle } from "@/lib/game/scenario-data";
import {
  decodeRunToken,
  isNewerRunTokenVersion,
  RunTokenError,
  versionsAgree,
  virtualRecordFromToken,
} from "@/lib/game/run-token";
import { runSimulation } from "@/lib/game/simulate";
import {
  buildNarrativeLabels,
  buildRunSummary,
  deriveBox,
  matchCardViews,
  periodTag,
  type DerivedBox,
  type MatchCardView,
  type RunSummaryView,
} from "@/lib/game/results-adapters";
import type { Scenario2026Bundle } from "@wcdraft/data";
import type { MatchResult } from "@wcdraft/core";

import { LeaderboardSubmitPanel } from "../leaderboard/submit-panel";
import { MemoryReveal } from "./memory-reveal";
import s from "./game.module.css";

type Mode =
  | { kind: "loading" }
  | {
      kind: "ready";
      gameData: GameData;
      scenario: Scenario2026Bundle;
      record: RunRecordV1;
      /** True when this run was rehydrated from a shared `?run=<token>` URL. */
      isReplayedFromToken: boolean;
    }
  | { kind: "missing"; reason: string; runId: string | null }
  | { kind: "skew"; title: string; message: string }
  | { kind: "error"; title: string; message: string };

export function ResultsScreen({
  leaderboardEnabled = false,
}: {
  /** F-4 U4 — server-gated ship-dark flag (results page reads the env). */
  leaderboardEnabled?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Parsed once at component scope so both the load effect AND the render
  // path (link-href threading) see the same discriminated value.
  const parsed = useMemo(() => parseRunSearchParams(searchParams ?? null), [searchParams]);

  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const reqToken = useRef(0);

  useEffect(() => {
    const myToken = ++reqToken.current;
    setMode({ kind: "loading" });
    if (parsed === null) {
      setMode({
        kind: "missing",
        reason: "Open a draft first — results are only available for a simulated run.",
        runId: null,
      });
      return;
    }
    (async () => {
      try {
        const gd = await loadGameData();
        if (myToken !== reqToken.current) return;
        const scenario = await loadScenarioBundle();
        if (myToken !== reqToken.current) return;

        if (parsed.kind === "id") {
          const loaded = loadRunRecord(parsed.run_id, gd.versions);
          if (loaded.status !== "loaded" || !loaded.record) {
            setMode({
              kind: "missing",
              reason:
                loaded.status === "stale"
                  ? "This run was created on an older data bundle and has been evicted."
                  : "We couldn't find that run.",
              runId: parsed.run_id,
            });
            return;
          }
          if (!loaded.record.simulation) {
            // Send the user back to review where they can re-trigger the sim.
            router.replace(reviewHref(parsed.run_id));
            return;
          }
          setMode({
            kind: "ready",
            gameData: gd,
            scenario,
            record: loaded.record,
            isReplayedFromToken: false,
          });
          return;
        }

        // Token path — self-contained `?run=<token>` URL, possibly from a
        // fresh browser. Decode, version-check, replay deterministically.
        const decoded = decodeRunToken(parsed.token);
        if (decoded === null) {
          setMode({
            kind: "missing",
            reason: isNewerRunTokenVersion(parsed.token)
              ? "This link was made on a newer version of the game than this page is running. Reload the page; if that doesn't help, the new version hasn't reached you yet."
              : "The shared link is malformed or truncated — ask the sender for a fresh link.",
            runId: null,
          });
          return;
        }
        if (!versionsAgree(decoded, gd.versions)) {
          setMode({
            kind: "skew",
            title: "This shared run is from a different build",
            message:
              "The dataset, rating engine, or rules on this site differ from when the run was created. Replaying it here would silently produce a different outcome, so we won't. Ask the sender to refresh the link from their current results screen.",
          });
          return;
        }
        try {
          const virtual = virtualRecordFromToken(decoded, gd);
          const { simulation } = await runSimulation(gd, scenario, virtual);
          if (myToken !== reqToken.current) return;
          const recordWithSim: RunRecordV1 = { ...virtual, status: "complete", simulation };
          setMode({
            kind: "ready",
            gameData: gd,
            scenario,
            record: recordWithSim,
            isReplayedFromToken: true,
          });
        } catch (err) {
          if (err instanceof RunTokenError) {
            setMode({
              kind: "missing",
              reason: `Couldn't replay the shared run: ${err.message}`,
              runId: null,
            });
            return;
          }
          throw err;
        }
      } catch (err) {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({ kind: "error", title: d.title, message: d.message });
      }
    })();
  }, [parsed, router]);

  if (mode.kind === "loading") {
    return (
      <div className={s.results}>
        <ResultsAppBar />
        <div className={s.loadingPanel} role="status">
          <p>Loading the run…</p>
        </div>
      </div>
    );
  }

  if (mode.kind === "error") {
    return (
      <div className={s.results}>
        <ResultsAppBar />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>{mode.title}</h2>
          <p className={s.errorMessage}>{mode.message}</p>
          <Link href={draftHref(null)} className="btn btn--primary">
            Start a new draft
          </Link>
        </div>
      </div>
    );
  }

  if (mode.kind === "missing") {
    return (
      <div className={s.results}>
        <ResultsAppBar />
        <div className={s.errorPanel}>
          <h2 className={s.errorTitle}>No results to show</h2>
          <p className={s.errorMessage}>{mode.reason}</p>
          <Link href={draftHref(null)} className="btn btn--primary">
            Open the draft
          </Link>
        </div>
      </div>
    );
  }

  if (mode.kind === "skew") {
    return (
      <div className={s.results}>
        <ResultsAppBar />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>{mode.title}</h2>
          <p className={s.errorMessage}>{mode.message}</p>
          <Link href={draftHref(null)} className="btn btn--primary">
            Start a new draft
          </Link>
        </div>
      </div>
    );
  }

  // For token-replayed sessions, in-screen CTAs must carry the ORIGINAL
  // `?run=` value (the token) so a receiver who didn't originate the run
  // can still click through results ↔ share without losing the replay.
  const linkRunValue = parsed?.kind === "token" ? parsed.token : mode.record.run_id;
  return (
    <ResultsBody
      gameData={mode.gameData}
      scenario={mode.scenario}
      record={mode.record}
      isReplayedFromToken={mode.isReplayedFromToken}
      linkRunValue={linkRunValue}
      leaderboardEnabled={leaderboardEnabled}
    />
  );
}

function ResultsAppBar() {
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image src="/brand/wcdraft-mark.svg" alt="wcdraft" width={28} height={31} priority />
        <span className={s.appBarTitle}>Results</span>
      </div>
    </header>
  );
}

function ResultsBody({
  gameData,
  scenario,
  record,
  isReplayedFromToken,
  linkRunValue,
  leaderboardEnabled,
}: {
  gameData: GameData;
  scenario: Scenario2026Bundle;
  record: RunRecordV1;
  isReplayedFromToken: boolean;
  /** Value to thread into in-screen `?run=` URLs — the token when replayed, the run_id otherwise. */
  linkRunValue: string | null;
  leaderboardEnabled: boolean;
}) {
  void isReplayedFromToken; // present for future banner UI; not rendered yet.
  const sim = record.simulation!;
  const eliminatedInGroup = !sim.group_stage.user_qualified && sim.matches.length === 3;

  const narrativeLabels = useMemo(
    () => buildNarrativeLabels(gameData, scenario, record.draft),
    [gameData, scenario, record.draft],
  );

  const summary: RunSummaryView = useMemo(
    () =>
      buildRunSummary(
        gameData,
        record.draft.team_name,
        sim.run,
        sim.matches,
        eliminatedInGroup,
        narrativeLabels,
      ),
    [gameData, record.draft, sim.run, sim.matches, eliminatedInGroup, narrativeLabels],
  );

  const matchCards: MatchCardView[] = useMemo(
    () => matchCardViews(scenario, gameData, sim.matches),
    [scenario, gameData, sim.matches],
  );

  // Open the LAST match by default (the climax of the run).
  const lastMatchId = sim.matches[sim.matches.length - 1]?.match_id ?? null;
  const [open, setOpen] = useState<string | null>(lastMatchId);

  const eyebrow = summary.is_champion
    ? "Champions"
    : summary.eliminated_in_group
      ? "Eliminated in the group"
      : "Run complete";

  const recordClass = summary.is_perfect_eight_zero
    ? `${s.outcomeBig} ${s.outcomeBigGold}`
    : s.outcomeBig;
  const configBadges: ConfigBadge[] = useMemo(() => {
    const replayBadges =
      typeof linkRunValue === "string" ? configBadgesFromReplayToken(linkRunValue) : [];
    return replayBadges.length > 0 ? replayBadges : configBadgesFromRecordToken(record);
  }, [linkRunValue, record]);

  return (
    <div className={s.results}>
      <ResultsAppBar />

      {/* ── Outcome header ────────────────────────────────────────────── */}
      <header className={`${s.panel} ${s.outcome}`}>
        <span className={s.eyebrowAccent}>{eyebrow}</span>
        {configBadges.length > 0 ? <ConfigBadgeRow badges={configBadges} /> : null}
        <div className={s.outcomeRecord}>
          <span className={recordClass}>{summary.display_record}</span>
          <span className={s.outcomeWL}>W–L</span>
        </div>
        <div className={s.outcomeStats}>
          <OutcomeStat num={summary.goals_for} label="scored" />
          <OutcomeStat num={summary.goals_against} label="conceded" />
          <OutcomeStat
            num={summary.top_scorer ? summary.top_scorer.goals : "—"}
            label={summary.top_scorer ? summary.top_scorer.name : "top scorer"}
          />
          <OutcomeStat num={summary.shootout_wins} label="shootout wins" />
        </div>
        <div className={s.outcomeFlags}>
          {summary.is_champion && <span className={s.flagGold}>Tournament won</span>}
          {!summary.eliminated_in_group && (
            <span className={summary.undefeated_regulation ? s.flagGood : s.flagMuted}>
              {summary.undefeated_regulation ? "Undefeated in regulation" : "Decided by a shootout"}
            </span>
          )}
          {summary.eliminated_in_group && (
            <span className={s.flagMuted}>
              Finished {ordinal(sim.group_stage.user_rank)} in the group
            </span>
          )}
        </div>
      </header>

      {/* ── Memory-mode reveal ────────────────────────────────────────────
          Hidden-mode runs blind every rating signal through draft + review;
          the sim has now run, so the full blind set reveals here. This also
          covers SHARED hidden runs — a token replay reconstructs the
          draft (mode rides the token's `md`) and reveals the same way.
          Classic runs render nothing extra. */}
      {record.draft.mode === "hidden" ? <MemoryReveal gameData={gameData} record={record} /> : null}

      {/* ── Narrative ─────────────────────────────────────────────────── */}
      {summary.narrative ? (
        <section className={`${s.panel} ${s.narrative}`}>
          <span className={s.narrativeMark} aria-hidden="true">
            &ldquo;
          </span>
          <p className={s.narrativeText}>{summary.narrative}</p>
        </section>
      ) : null}

      {/* ── Match-by-match ────────────────────────────────────────────── */}
      <section className={s.panel} aria-label="Match results">
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>
            The run · {summary.matches_played} match{summary.matches_played === 1 ? "" : "es"}
          </h2>
          <span className={s.panelMeta}>Box scores derived from the event log</span>
        </div>

        <ul className={s.matchList}>
          {matchCards.map((m, i) => {
            const match = sim.matches[i]!;
            const isOpen = open === m.match_id;
            return (
              <MatchListItem
                key={m.match_id}
                view={m}
                match={match}
                isOpen={isOpen}
                gameData={gameData}
                onToggle={() => setOpen(isOpen ? null : m.match_id)}
              />
            );
          })}
        </ul>
      </section>

      {/* ── Leaderboard submit (F-4 U4) ───────────────────────────────────
          Post-sim only (this body only mounts with a simulation), classic
          AND hidden. Server-gated: when the leaderboard is dark the prop is
          false and nothing renders. The panel itself also stays absent when
          the run's version anchors don't match the loaded bundle. */}
      {leaderboardEnabled ? <LeaderboardSubmitPanel gameData={gameData} record={record} /> : null}

      {/* ── Seed + actions ────────────────────────────────────────────── */}
      <section className={`${s.panel} ${s.seedPanel}`}>
        <div className={s.seedRow}>
          <span className={s.seedLabel}>Seed</span>
          <code className={s.seedCode}>{summary.seed}</code>
          <span className={s.seedNote}>Replays are seed-locked — identical every time.</span>
        </div>
        {/*
          Action hierarchy (ws-results/history-share):
            - PRIMARY: Draft Again — the only forward action. Always starts a
              NEW run (new seed → spins → squad). The sim is deterministic,
              so re-simulating this squad would be a no-op; we never offer it.
            - SECONDARY: Share — preserves token across in-app navigation.
            - SECONDARY: View History — recent local runs (cap 5).
        */}
        <div className={s.resultsActions}>
          <Link href={draftHref(null)} className="btn btn--primary">
            Draft Again →
          </Link>
          <Link href={shareHref(linkRunValue)} className="btn btn--ghost">
            Share
          </Link>
          <Link href={historyHref()} className="btn btn--ghost">
            View History
          </Link>
        </div>
      </section>
    </div>
  );
}

function ConfigBadgeRow({ badges }: { badges: readonly ConfigBadge[] }) {
  return (
    <div className={s.configBadgeRow} aria-label="Run configuration">
      {badges.map((badge) => (
        <span key={badge.axis} className={`${s.configBadge} ${s[`configBadge_${badge.axis}`]!}`}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function OutcomeStat({ num, label }: { num: number | string; label: string }) {
  return (
    <div className={s.oStat}>
      <span className={s.oStatNum}>{num}</span>
      <span className={s.oStatLabel}>{label}</span>
    </div>
  );
}

function MatchListItem({
  view,
  match,
  isOpen,
  gameData,
  onToggle,
}: {
  view: MatchCardView;
  match: MatchResult;
  isOpen: boolean;
  gameData: GameData;
  onToggle: () => void;
}) {
  const box: DerivedBox = useMemo(() => deriveBox(gameData, match), [gameData, match]);
  const outcomeClass = view.outcome === "W" ? s.win : view.outcome === "L" ? s.loss : s.draw;
  const opponentLabel =
    view.opponent.nation_code !== null
      ? `${view.opponent.nation_code} ${view.opponent.name}`
      : view.opponent.name;
  return (
    <li className={s.matchItem}>
      <button type="button" className={s.matchRow} aria-expanded={isOpen} onClick={onToggle}>
        <span className={`${s.matchOutcome} ${outcomeClass}`}>{view.outcome}</span>
        <span className={s.matchRound}>{view.round_label}</span>
        <span className={s.matchOpp}>vs {opponentLabel}</span>
        <span className={s.matchScore}>
          {view.scoreline.user}–{view.scoreline.opp}
          {view.scoreline.tag && <span className={s.matchTag}>{view.scoreline.tag}</span>}
        </span>
        <span className={s.matchChevron} aria-hidden="true">
          {isOpen ? "▾" : "▸"}
        </span>
      </button>

      {isOpen && (
        <div className={s.boxScore}>
          <div className={s.boxCol}>
            <span className={s.boxColHead}>Your XI</span>
            {box.userGoals.length === 0 && <span className={s.boxNone}>No goals</span>}
            {box.userGoals.map((g, i) => (
              <span key={`u${i}`} className={s.boxGoal}>
                ⚽ {g.name} {g.minute}&rsquo;{periodTag(g.period)}
                {g.detail && <span className={s.boxDetail}> · {g.detail}</span>}
              </span>
            ))}
          </div>
          <div className={s.boxCol}>
            <span className={s.boxColHead}>{view.opponent.name}</span>
            {box.oppGoals.length === 0 && <span className={s.boxNone}>No goals</span>}
            {box.oppGoals.map((g, i) => (
              <span key={`o${i}`} className={s.boxGoal}>
                ⚽ {g.name} {g.minute}&rsquo;{periodTag(g.period)}
                {g.detail && <span className={s.boxDetail}> · {g.detail}</span>}
              </span>
            ))}
          </div>

          {(box.cards.length > 0 || box.subs.length > 0 || box.injuries.length > 0) && (
            <div className={s.boxEvents}>
              {box.cards.map((c, i) => (
                <span key={`c${i}`} className={s.boxEvent}>
                  <span
                    className={c.card === "red" ? s.cardRed : s.cardYellow}
                    aria-hidden="true"
                  />
                  {c.name} {c.minute}&rsquo; ({c.side === "user" ? "us" : view.opponent.name})
                </span>
              ))}
              {box.subs.map((sub, i) => (
                <span key={`s${i}`} className={s.boxEvent}>
                  🔁 {sub.name} for {sub.off} {sub.minute}&rsquo;
                </span>
              ))}
              {box.injuries.map((inj, i) => (
                <span key={`i${i}`} className={s.boxEvent}>
                  🩹 {inj.name} {inj.minute}&rsquo;{inj.ending ? " (out of tournament)" : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
