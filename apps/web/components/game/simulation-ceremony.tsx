"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { MatchResult } from "@wcdraft/core";
import type { PersistedSimulation } from "@/lib/game/simulation-payload";
import s from "./simulation-ceremony.module.css";

export const CEREMONY_TOTAL_MS = 3200;
const FILL_RISE_MS = 480;
const EASE = "cubic-bezier(.2,.7,.2,1)";
const ROUNDS = ["R32", "R16", "QF", "SF", "F"] as const;
const LABELS = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"] as const;
const CHAMPION_BEATS = [520, 820, 1120, 1420, 1760] as const;
const REG_TOP = 22;
const REG_BOT = 110;
const REG_H = REG_BOT - REG_TOP;
function isCeremonyRound(round: MatchResult["round"]): round is CeremonyNode["round"] {
  return (ROUNDS as readonly string[]).includes(round);
}

type NodeState = "win" | "loss" | "champ" | "none";
export interface CeremonyNode {
  round: (typeof ROUNDS)[number];
  state: NodeState;
  score: string;
}
export interface CeremonyModel {
  nodes: CeremonyNode[];
  champion: boolean;
  status: string;
  heroNum: string;
  fillPct: number;
  decisive: string;
}
export interface CeremonyTiming {
  beats: readonly (number | null)[];
  resolve: number;
}
export function isCeremonyResolved(
  elapsedMs: number,
  hasTerminal: boolean,
  nodes: readonly CeremonyNode[],
  visible: readonly boolean[],
): boolean {
  return (
    hasTerminal &&
    elapsedMs >= CEREMONY_TOTAL_MS &&
    nodes.every((node, index) => node.state === "none" || visible[index] === true)
  );
}
const DEV_FIXTURES: Record<"A" | "B" | "C", CeremonyModel> = {
  A: {
    champion: true,
    status: "Champions",
    heroNum: "8–0",
    fillPct: 100,
    decisive: "Final",
    nodes: ["R32", "R16", "QF", "SF", "F"].map((round, i) => ({
      round: round as CeremonyNode["round"],
      state: i === 4 ? "champ" : "win",
      score: ["3–0", "2–0", "2–0", "1–0", "2–0"][i]!,
    })),
  },
  B: {
    champion: false,
    status: "Out in the semi-final",
    heroNum: "1–2",
    fillPct: 75,
    decisive: "Semi-final",
    nodes: ["R32", "R16", "QF", "SF", "F"].map((round, i) => ({
      round: round as CeremonyNode["round"],
      state: i < 3 ? "win" : i === 3 ? "loss" : "none",
      score: ["2–1", "3–1", "1–0", "1–2", ""][i]!,
    })),
  },
  // Architect correction: C is a genuine R16 exit (R32 win, then R16 loss).
  C: {
    champion: false,
    status: "Out in the round of 16",
    heroNum: "0–1",
    fillPct: 50,
    decisive: "Round of 16",
    nodes: ["R32", "R16", "QF", "SF", "F"].map((round, i) => ({
      round: round as CeremonyNode["round"],
      state: i === 0 ? "win" : i === 1 ? "loss" : "none",
      score: ["2–0", "0–1", "", "", ""][i]!,
    })),
  },
};
const DEV_LABELS = { A: "Champions", B: "Semi-final exit", C: "Round-of-16 exit" } as const;

function matchScore(match: MatchResult): string {
  const user = match.user_goals + (match.user_goals_et ?? 0);
  const opp = match.opp_goals + (match.opp_goals_et ?? 0);
  return match.shootout
    ? `${user}–${opp} (${match.shootout.user}–${match.shootout.opp} pens)`
    : `${user}–${opp}`;
}

export function deriveStreamedCeremonyModel(
  matches: readonly MatchResult[],
  simulation: PersistedSimulation | null,
): CeremonyModel {
  const knockout = new Map(matches.filter((m) => m.phase === "knockout").map((m) => [m.round, m]));
  let eliminated = false;
  const nodes = ROUNDS.map((round): CeremonyNode => {
    if (eliminated) return { round, state: "none", score: "" };
    const match = knockout.get(round);
    if (!match) return { round, state: "none", score: "" };
    if (!match.advanced) {
      eliminated = true;
      return { round, state: "loss", score: matchScore(match) };
    }
    return {
      round,
      state: round === "F" && simulation?.run.is_champion ? "champ" : "win",
      score: matchScore(match),
    };
  });
  const finalWin = knockout.get("F")?.advanced === true;
  const champion = simulation?.run.is_champion === true;
  const lossIndex = nodes.findIndex((node) => node.state === "loss");
  const wins = nodes.filter((node) => node.state === "win" || node.state === "champ").length;
  const groupExit = simulation !== null && matches.every((match) => match.phase === "group");
  const decisive =
    champion || finalWin ? "Final" : lossIndex >= 0 ? LABELS[lossIndex]! : "Group stage";
  const decisiveScore = lossIndex >= 0 ? nodes[lossIndex]!.score : "";
  return {
    nodes,
    champion,
    status:
      simulation === null
        ? ""
        : champion || finalWin
          ? "Champions"
          : lossIndex >= 0 || groupExit
            ? `Out in the ${decisive.toLowerCase()}`
            : "",
    heroNum: champion
      ? `${simulation!.run.wins}–${simulation!.run.losses}`
      : decisiveScore || (knockout.get("F") ? matchScore(knockout.get("F")!) : ""),
    fillPct:
      champion || finalWin
        ? 100
        : lossIndex >= 0
          ? wins === 0
            ? 15
            : (wins / (lossIndex + 1)) * 100
          : 0,
    decisive,
  };
}

export function deriveCeremonyModel(simulation: PersistedSimulation | null): CeremonyModel {
  return deriveStreamedCeremonyModel(simulation?.matches ?? [], simulation);
}

export function ceremonyTiming(model: CeremonyModel): CeremonyTiming {
  const lossIndex = model.nodes.findIndex((node) => node.state === "loss");
  if (model.champion || model.nodes[4]?.state === "champ") {
    return { beats: CHAMPION_BEATS, resolve: 2100 };
  }
  if (lossIndex === 3) return { beats: [520, 820, 1120, 1520, null], resolve: 1860 };
  if (lossIndex === 1) return { beats: [520, 900, null, null, null], resolve: 1440 };
  if (lossIndex === 0) return { beats: [900, null, null, null, null], resolve: 1440 };
  if (lossIndex === 2) return { beats: [520, 820, 1120, null, null], resolve: 1440 };
  if (lossIndex === 4) return { beats: CHAMPION_BEATS, resolve: 2100 };
  return { beats: CHAMPION_BEATS, resolve: model.status ? 1440 : 2100 };
}

export function SimulationCeremony({
  matches,
  simulation,
  reducedMotion,
  showHarness = false,
  onSkip,
  onComplete,
}: {
  matches: readonly MatchResult[];
  simulation: PersistedSimulation | null;
  reducedMotion?: boolean;
  showHarness?: boolean;
  onSkip: () => void;
  onComplete?: () => void;
}) {
  const [t, setT] = useState(0);
  const [prefersReduced, setPrefersReduced] = useState(false);
  const [fixture, setFixture] = useState<"A" | "B" | "C">("A");
  const [harnessReduced, setHarnessReduced] = useState(false);
  const [replay, setReplay] = useState(0);
  const fired = useRef(false);
  const stopped = useRef(false);
  const t0Ref = useRef(0);
  const arrivalRef = useRef(new Map<CeremonyNode["round"], number>());
  const portalRootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const portalRoot = portalRootRef.current;
    if (!portalRoot) return;
    const covered = [...document.body.children].filter((element) => element !== portalRoot);
    const prior = covered.map((element) => ({
      element,
      inert: element.getAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    const overflow = document.body.style.getPropertyValue("overflow");
    const overflowPriority = document.body.style.getPropertyPriority("overflow");
    for (const { element } of prior) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    document.body.style.setProperty("overflow", "hidden");
    return () => {
      for (const { element, inert, ariaHidden } of prior) {
        if (inert === null) element.removeAttribute("inert");
        else element.setAttribute("inert", inert);
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (overflow.length === 0) document.body.style.removeProperty("overflow");
      else document.body.style.setProperty("overflow", overflow, overflowPriority);
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [replay]);
  const reduced = showHarness ? harnessReduced : (reducedMotion ?? prefersReduced);
  useEffect(() => {
    const start = performance.now();
    t0Ref.current = start;
    arrivalRef.current.clear();
    fired.current = false;
    stopped.current = false;
    setT(0);
    let raf = 0;
    const loop = (now: number) => {
      if (stopped.current) return;
      setT(now - start);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay, fixture]);
  const model = useMemo(
    () => (showHarness ? DEV_FIXTURES[fixture] : deriveStreamedCeremonyModel(matches, simulation)),
    [fixture, matches, showHarness, simulation],
  );
  const timing = ceremonyTiming(model);
  for (const match of matches) {
    if (
      match.phase === "knockout" &&
      isCeremonyRound(match.round) &&
      !arrivalRef.current.has(match.round)
    ) {
      arrivalRef.current.set(match.round, Math.max(0, performance.now() - t0Ref.current));
    }
  }
  const arrivedRounds = useMemo(
    () =>
      new Set(
        showHarness
          ? model.nodes.filter((node) => node.state !== "none").map((node) => node.round)
          : matches.filter((m) => m.phase === "knockout").map((m) => m.round),
      ),
    [matches, showHarness, model],
  );
  const revealAt = model.nodes.map((node, i) => {
    const beat = timing.beats[i];
    if (beat === null || beat === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(
      beat,
      showHarness ? 0 : (arrivalRef.current.get(node.round) ?? Number.POSITIVE_INFINITY),
    );
  });
  const visible = model.nodes.map((node, i) => arrivedRounds.has(node.round) && t >= revealAt[i]!);
  const navigationResolved = isCeremonyResolved(
    t,
    showHarness || simulation !== null,
    model.nodes,
    visible,
  );
  const playedVisible = model.nodes.every(
    (node, index) => node.state === "none" || visible[index] === true,
  );
  const visualResolved = model.status.length > 0 && playedVisible && t >= timing.resolve;
  useEffect(() => {
    if (navigationResolved) stopped.current = true;
  }, [navigationResolved]);
  useEffect(() => {
    if (navigationResolved && !fired.current) {
      fired.current = true;
      onComplete?.();
    }
  }, [navigationResolved, onComplete]);
  let last = -1;
  visible.forEach((on, i) => {
    if (on) last = i;
  });
  const lossIndex = model.nodes.findIndex((node) => node.state === "loss");
  const fillFor = (through: number) => {
    const survived = model.nodes
      .slice(0, through + 1)
      .filter((node) => node.state === "win" || node.state === "champ").length;
    if (model.champion) return survived * 20;
    if (lossIndex < 0) return 0;
    if (survived === 0) return through >= lossIndex ? 15 : 0;
    return (survived / (lossIndex + 1)) * 100;
  };
  const targetFill = last < 0 ? 0 : fillFor(last);
  const prevFill = last <= 0 ? 0 : fillFor(last - 1);
  const p =
    reduced || last < 0 ? 1 : Math.max(0, Math.min(1, (t - revealAt[last]!) / FILL_RISE_MS));
  const fillPct = prevFill + (targetFill - prevFill) * (1 - Math.pow(1 - p, 3));
  const filled = (REG_H * fillPct) / 100,
    fillTop = REG_BOT - filled;
  const current = last >= 0 ? model.nodes[last]! : null;
  const eyebrow = visualResolved
    ? model.decisive.toUpperCase()
    : last >= 0
      ? LABELS[last]!.toUpperCase()
      : LABELS[0].toUpperCase();
  const num = visualResolved ? model.heroNum : (current?.score ?? "");
  const champOn = model.champion && model.nodes[4]?.state === "champ" && visible[4];
  const cssVars = { "--dur": reduced ? "0ms" : "420ms", "--ease": EASE } as CSSProperties;
  return createPortal(
    <div
      ref={portalRootRef}
      className={`${s.root} ${showHarness ? s.withHarness : ""} ${reduced ? s.reduced : ""}`}
      style={cssVars}
      data-simulation-ceremony="true"
      data-reduced-motion={reduced ? "true" : "false"}
    >
      {showHarness ? (
        <div className={s.harnessTop}>
          <div className={s.label}>Simulation ceremony</div>
          <div className={`${s.label} ${s.preview}`}>Preview</div>
        </div>
      ) : null}
      <div className={s.shell}>
        <div className={s.dots} />
        <div className={s.top}>
          <div className={s.brand}>wcdraft</div>
          <button
            className={s.skip}
            onClick={() => {
              stopped.current = true;
              setT(Number.MAX_SAFE_INTEGER);
              onSkip();
            }}
          >
            Skip<span style={{ fontSize: 14, lineHeight: 1 }}>»</span>
          </button>
        </div>
        <div className={s.body}>
          <div
            className={`${s.trophy} ${champOn ? s.champGlow : ""}`}
            data-ceremony-trophy="true"
            data-fill-pct={fillPct.toFixed(2)}
            data-gold={champOn ? "true" : "false"}
          >
            <Trophy
              fillTop={fillTop}
              fillHeight={filled}
              surfaceOp={fillPct > 1 ? 0.55 : 0}
              goldOutlineOp={champOn ? 1 : 0}
            />
          </div>
          <div className={s.hero}>
            <div className={s.label} style={{ minHeight: 14 }}>
              {eyebrow}
            </div>
            <div
              className={`${s.heroNum} ${visualResolved && !reduced ? s.heroSettle : ""}`}
              style={{
                color: visualResolved && model.champion ? "var(--sc-gold)" : "var(--sc-ink)",
              }}
            >
              {num}
            </div>
            <div
              className={`${s.status} ${visualResolved && !reduced ? s.statusIn : ""}`}
              style={{
                color: model.champion ? "var(--sc-gold)" : "var(--sc-ink)",
                opacity: visualResolved ? 1 : 0,
              }}
            >
              {visualResolved ? model.status : ""}
            </div>
          </div>
          <div className={s.path}>
            {model.nodes.map((node, i) => (
              <Fragment key={node.round}>
                {i > 0 ? (
                  <div className={s.conn}>
                    <div
                      className={s.connFill}
                      style={{
                        width: visible[i] && model.nodes[i - 1]!.state !== "loss" ? "100%" : "0%",
                      }}
                    />
                  </div>
                ) : null}
                <div
                  className={s.nodeCol}
                  data-ceremony-node={node.round}
                  data-state={node.state}
                  data-visible={visible[i] ? "true" : "false"}
                >
                  <div className={s.node}>
                    <div className={s.nodeBase} />
                    {(["win", "loss", "champ"] as const).map((state) => (
                      <div
                        key={state}
                        className={s.nodeState}
                        style={{
                          background: `var(--sc-${state === "win" ? "em" : state === "loss" ? "loss" : "gold"})`,
                          opacity: visible[i] && node.state === state ? 1 : 0,
                        }}
                      />
                    ))}
                    {visible[i] && !reduced && node.state !== "none" ? (
                      <div
                        className={`${s.ring} ${node.state === "champ" ? s.pulseChamp : node.state === "loss" ? s.pulseLoss : s.pulseWin}`}
                        style={{
                          borderColor: `var(--sc-${node.state === "win" ? "em" : node.state === "loss" ? "loss" : "gold"})`,
                        }}
                      />
                    ) : null}
                  </div>
                  <div className={s.micro}>{node.round}</div>
                  <div className={s.score} style={{ opacity: visible[i] ? 1 : 0 }}>
                    {visible[i] ? node.score : ""}
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
        <div aria-live="polite" role="status" className={s.srOnly}>
          {visualResolved ? `${model.status}. ${model.heroNum}.` : ""}
        </div>
      </div>
      {showHarness ? (
        <div className={s.harnessBottom}>
          <div className={s.tabs} role="tablist" aria-label="Scenario">
            {(["A", "B", "C"] as const).map((key) => (
              <button
                className={`${s.tab} ${fixture === key ? s.tabSelected : ""}`}
                key={key}
                role="tab"
                aria-selected={fixture === key}
                onClick={() => setFixture(key)}
              >
                {DEV_LABELS[key]}
              </button>
            ))}
          </div>
          <div className={s.harnessControls}>
            <button
              className={s.switch}
              role="switch"
              aria-checked={harnessReduced}
              onClick={() => setHarnessReduced((value) => !value)}
            >
              <span className={`${s.switchTrack} ${harnessReduced ? s.switchOn : ""}`}>
                <span className={`${s.switchKnob} ${harnessReduced ? s.switchKnobOn : ""}`} />
              </span>
              <span>Reduced motion</span>
            </button>
            <button className={s.replay} onClick={() => setReplay((value) => value + 1)}>
              <span>↻</span>Replay
            </button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function Trophy({
  fillTop,
  fillHeight,
  surfaceOp,
  goldOutlineOp,
}: {
  fillTop: number;
  fillHeight: number;
  surfaceOp: number;
  goldOutlineOp: number;
}) {
  const cup = (
    <>
      <path d="M34,22 H86 C86,50 78,72 68,74 H52 C42,72 34,50 34,22 Z" />
      <path d="M53,74 H67 V96 H53 Z" />
      <path d="M50,96 H70 L76,110 H44 Z" />
    </>
  );
  return (
    <svg
      width="132"
      height="165"
      viewBox="0 0 120 150"
      fill="none"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id="sc-tbody">{cup}</clipPath>
        <linearGradient id="sc-tgold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5c95f" />
          <stop offset="1" stopColor="var(--sc-gold)" />
        </linearGradient>
      </defs>
      <g clipPath="url(#sc-tbody)">
        <rect x="0" width="120" y={fillTop} height={fillHeight} fill="url(#sc-tgold)" />
        <rect x="0" width="120" height="2.5" y={fillTop} fill="#f5c95f" opacity={surfaceOp} />
      </g>
      <g
        stroke="var(--sc-line)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        {cup}
        <ellipse cx="60" cy="22" rx="26" ry="4.5" />
      </g>
      <g
        stroke="var(--sc-gold)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
        style={{ opacity: goldOutlineOp, transition: "opacity var(--dur) var(--ease)" }}
      >
        {cup}
        <ellipse cx="60" cy="22" rx="26" ry="4.5" />
      </g>
    </svg>
  );
}
