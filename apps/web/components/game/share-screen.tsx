"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { loadGameData, type GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import { draftHref, reviewHref, resultsHref, shareHref } from "@/lib/game/navigation";
import { loadRunRecord, type RunRecordV1 } from "@/lib/game/run-record";
import {
  buildShareCaption,
  buildShareView,
  type ShareView,
} from "@/lib/game/share-adapters";

import s from "./game.module.css";

type Mode =
  | { kind: "loading" }
  | { kind: "ready"; gameData: GameData; record: RunRecordV1; view: ShareView }
  | { kind: "missing"; reason: string; runId: string | null }
  | { kind: "error"; title: string; message: string };

export function ShareScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const runId = searchParams?.get("run") ?? null;

  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const reqToken = useRef(0);

  useEffect(() => {
    const myToken = ++reqToken.current;
    setMode({ kind: "loading" });
    if (!runId) {
      setMode({
        kind: "missing",
        reason: "Open a draft first — a share card is only available for a simulated run.",
        runId: null,
      });
      return;
    }
    (async () => {
      try {
        const gd = await loadGameData();
        if (myToken !== reqToken.current) return;
        const loaded = loadRunRecord(runId, gd.versions);
        if (loaded.status !== "loaded" || !loaded.record) {
          setMode({
            kind: "missing",
            reason:
              loaded.status === "stale"
                ? "This run was created on an older data bundle and has been evicted."
                : "We couldn't find that run.",
            runId,
          });
          return;
        }
        if (!loaded.record.simulation) {
          router.replace(reviewHref(runId));
          return;
        }
        const view = buildShareView(gd, loaded.record);
        if (!view) {
          router.replace(reviewHref(runId));
          return;
        }
        setMode({ kind: "ready", gameData: gd, record: loaded.record, view });
      } catch (err) {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({ kind: "error", title: d.title, message: d.message });
      }
    })();
  }, [runId, router]);

  if (mode.kind === "loading") {
    return (
      <div className={s.share}>
        <ShareAppBar />
        <div className={s.loadingPanel} role="status">
          <p>Building your share card…</p>
        </div>
      </div>
    );
  }

  if (mode.kind === "error") {
    return (
      <div className={s.share}>
        <ShareAppBar />
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
      <div className={s.share}>
        <ShareAppBar />
        <div className={s.errorPanel}>
          <h2 className={s.errorTitle}>No card to share</h2>
          <p className={s.errorMessage}>{mode.reason}</p>
          <Link href={draftHref(null)} className="btn btn--primary">
            Open the draft
          </Link>
        </div>
      </div>
    );
  }

  return <ShareBody record={mode.record} view={mode.view} />;
}

function ShareAppBar() {
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image
          src="/brand/wcdraft-mark.svg"
          alt="wcdraft"
          width={28}
          height={31}
          priority
        />
        <span className={s.appBarTitle}>Share</span>
      </div>
    </header>
  );
}

// ─── The card ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 600;
const CARD_HEIGHT = 800;

function ShareBody({ record, view }: { record: RunRecordV1; view: ShareView }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState<"idle" | "ok" | "unsupported">("idle");

  // Replay URL is derived deterministically from the run_id; no entropy.
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const origin = window.location.origin;
    return `${origin}${shareHref(record.run_id)}`;
  }, [record.run_id]);

  const caption = useMemo(() => buildShareCaption(view, shareUrl), [view, shareUrl]);

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadSvg() {
    const node = svgRef.current;
    if (!node) return;
    const xml = new XMLSerializer().serializeToString(node);
    const blob = new Blob(
      [`<?xml version="1.0" encoding="UTF-8"?>\n` + xml],
      { type: "image/svg+xml" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wcdraft-${record.run_id}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function shareNative() {
    if (typeof navigator === "undefined" || !navigator.share) {
      setShared("unsupported");
      return;
    }
    try {
      await navigator.share({
        title: `${view.team_name} — ${view.headline}`,
        text: caption,
        url: shareUrl ?? undefined,
      });
      setShared("ok");
    } catch {
      setShared("idle");
    }
  }

  return (
    <div className={s.share}>
      <ShareAppBar />

      <header className="page-head">
        <span className="eyebrow">Share your run</span>
        <h1 className="display">The card</h1>
        <p className="page-head__note">
          Branded, deterministic, seed-locked. Names and national flag codes only — no
          competition marks.
        </p>
      </header>

      {/* ── The SVG card (rendered + serialisable for export) ──────────── */}
      <div className={s.shareCardFrame}>
        <ShareCardSvg
          svgRef={svgRef}
          view={view}
          shareUrl={shareUrl}
        />
      </div>

      {/* ── Caption + actions ─────────────────────────────────────────── */}
      <div className={`${s.panel} ${s.sharePanel}`}>
        <p className={s.shareCaptionLabel}>Caption</p>
        <pre className={s.shareCaption}>{caption}</pre>
        <div className={s.resultsActions}>
          <button type="button" className="btn btn--primary" onClick={copyCaption}>
            {copied ? "Copied ✓" : "Copy caption"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={downloadSvg}>
            Download card
          </button>
          <button type="button" className="btn btn--ghost" onClick={shareNative}>
            {shared === "unsupported" ? "Share unavailable" : "Native share"}
          </button>
        </div>
        <div className={s.resultsActions}>
          <Link href={resultsHref(record.run_id)} className="btn btn--ghost">
            Back to results
          </Link>
        </div>
        <p className={s.shareHint}>
          The replay URL above reproduces this run byte-for-byte from its seed. Nothing
          here uses any official competition name, emblem, or trophy.
        </p>
      </div>
    </div>
  );
}

// ─── The SVG itself ──────────────────────────────────────────────────────────

function ShareCardSvg({
  svgRef,
  view,
  shareUrl,
}: {
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  view: ShareView;
  shareUrl: string | null;
}) {
  const recordColor = view.is_perfect_eight_zero ? "url(#wcGold)" : "#e9f9f2";
  const headline = view.headline;
  const formationLabel = view.manager
    ? `${view.formation_name} · mgr ${view.manager.nation_code} ${view.manager.name}`
    : view.formation_name;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      role="img"
      aria-label={`${view.team_name} — ${headline}, record ${view.display_record}`}
      className={s.shareSvg}
    >
      <defs>
        <linearGradient id="wcBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#141b24" />
          <stop offset="1" stopColor="#0a0e13" />
        </linearGradient>
        <linearGradient id="wcEmerald" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#54e3ab" />
          <stop offset="1" stopColor="#1c9e6e" />
        </linearGradient>
        <linearGradient id="wcGold" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#c8861a" />
          <stop offset="0.5" stopColor="#f5b62a" />
          <stop offset="1" stopColor="#ffd86a" />
        </linearGradient>
      </defs>

      {/* Card background */}
      <rect x="0" y="0" width={CARD_WIDTH} height={CARD_HEIGHT} rx="32" ry="32" fill="url(#wcBg)" />
      {/* Subtle emerald top border */}
      <rect x="0" y="0" width={CARD_WIDTH} height="8" fill="url(#wcEmerald)" />

      {/* Brand mark + seed */}
      <g transform="translate(48, 56)">
        <text
          x="0"
          y="0"
          fill="#e9f9f2"
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="28"
          fontWeight="700"
          letterSpacing="0.04em"
        >
          wc
          <tspan fontWeight="900" fill="url(#wcEmerald)">draft</tspan>
        </text>
        <text
          x={CARD_WIDTH - 96}
          y="0"
          fill="#a7b3bd"
          fontFamily="ui-monospace, SF Mono, Menlo, monospace"
          fontSize="14"
          textAnchor="end"
        >
          {truncate(view.seed, 28)}
        </text>
      </g>

      {/* Team name */}
      <text
        x={CARD_WIDTH / 2}
        y="180"
        textAnchor="middle"
        fill="#e9f9f2"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="32"
        fontWeight="600"
        letterSpacing="0.02em"
      >
        {truncate(view.team_name, 24)}
      </text>

      {/* Headline */}
      <text
        x={CARD_WIDTH / 2}
        y="244"
        textAnchor="middle"
        fill="#9bb6ad"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="18"
        fontWeight="600"
        letterSpacing="0.32em"
      >
        {headline}
      </text>

      {/* Record (huge, gold if 8-0) */}
      <text
        x={CARD_WIDTH / 2}
        y="412"
        textAnchor="middle"
        fill={recordColor}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="180"
        fontWeight="900"
        letterSpacing="-0.04em"
      >
        {view.display_record}
      </text>

      {/* Formation + manager */}
      <text
        x={CARD_WIDTH / 2}
        y="470"
        textAnchor="middle"
        fill="#9bb6ad"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="16"
        letterSpacing="0.06em"
      >
        {truncate(formationLabel, 48)}
      </text>

      {/* Stats row */}
      <g transform={`translate(0, 540)`}>
        <ShareStat x={CARD_WIDTH * 0.2} num={String(view.goals_for)} label="scored" />
        <ShareStat x={CARD_WIDTH * 0.5} num={String(view.goals_against)} label="conceded" />
        <ShareStat
          x={CARD_WIDTH * 0.8}
          num={view.top_scorer ? String(view.top_scorer.goals) : "—"}
          label={view.top_scorer ? truncate(view.top_scorer.name, 14) : "top scorer"}
        />
      </g>

      {/* Stars row — names + flag codes only */}
      <g transform={`translate(${CARD_WIDTH / 2}, 700)`}>
        <text
          x="0"
          y="-30"
          textAnchor="middle"
          fill="#5e7068"
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="12"
          letterSpacing="0.32em"
        >
          KEY PICKS
        </text>
        <text
          x="0"
          y="0"
          textAnchor="middle"
          fill="#cfe5db"
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="18"
          fontWeight="500"
        >
          {view.stars.length > 0
            ? view.stars.map((s) => `${s.nation_code} ${s.name}`).join("  ·  ")
            : "—"}
        </text>
      </g>

      {/* Footer line */}
      <text
        x={CARD_WIDTH / 2}
        y={CARD_HEIGHT - 32}
        textAnchor="middle"
        fill="#5e7068"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="11"
        letterSpacing="0.28em"
      >
        {shareUrl ? truncate(shareUrl, 56).toUpperCase() : "WCDRAFT.APP"}
      </text>
    </svg>
  );
}

function ShareStat({ x, num, label }: { x: number; num: string; label: string }) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <text
        x="0"
        y="0"
        textAnchor="middle"
        fill="#e9f9f2"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="40"
        fontWeight="800"
      >
        {num}
      </text>
      <text
        x="0"
        y="22"
        textAnchor="middle"
        fill="#5e7068"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="11"
        letterSpacing="0.28em"
      >
        {label.toUpperCase()}
      </text>
    </g>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)) + "…";
}
