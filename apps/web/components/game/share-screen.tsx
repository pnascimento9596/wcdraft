"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { describeGameError } from "@/lib/game/errors";
import {
  configBadgesFromRecordToken,
  configBadgesFromReplayToken,
  type ConfigBadge,
} from "@/lib/game/config-badges";
import {
  draftHref,
  parseRunSearchParams,
  reviewHref,
  resultsHref,
  shareHref,
} from "@/lib/game/navigation";
import type { RunRecordV1 } from "@/lib/game/run-record";
import { encodeRunToken, RunTokenError } from "@/lib/game/run-token";
import { resolveDisplayRun } from "@/lib/game/run-screen-loader";
import {
  buildShareCaption,
  buildShareIntentText,
  buildShareIntentUrls,
  buildShareView,
  type ShareIntentUrls,
  type ShareView,
} from "@/lib/game/share-adapters";

import s from "./game.module.css";

type Mode =
  | { kind: "loading" }
  | { kind: "ready"; record: RunRecordV1; view: ShareView; linkRunValue: string }
  | { kind: "missing"; reason: string; runId: string | null }
  | { kind: "skew"; title: string; message: string }
  | { kind: "error"; title: string; message: string };

type ShareSvgColors = {
  bgStart: string;
  bgEnd: string;
  accentStart: string;
  accentEnd: string;
  goldStart: string;
  goldMid: string;
  goldEnd: string;
  text: string;
  muted: string;
};

const SHARE_SVG_COLOR_VARS: ShareSvgColors = {
  bgStart: "var(--field)",
  bgEnd: "var(--accent-ink)",
  accentStart: "var(--accent)",
  accentEnd: "var(--accent-strong)",
  goldStart: "var(--gold-strong)",
  goldMid: "var(--gold)",
  goldEnd: "var(--gold)",
  text: "var(--field-ink)",
  muted: "var(--ink-soft)",
};

export function ShareScreen() {
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
        reason: "Open a draft first — a share card is only available for a simulated run.",
        runId: null,
      });
      return;
    }
    (async () => {
      try {
        const resolved = await resolveDisplayRun(parsed);
        if (myToken !== reqToken.current) return;
        if (resolved.kind === "missing") {
          setMode({
            kind: "missing",
            reason:
              resolved.runId === null
                ? "Open a draft first — a share card is only available for a simulated run."
                : "We couldn't find that run.",
            runId: resolved.runId,
          });
          return;
        }
        if (resolved.kind === "stale") {
          setMode({
            kind: "missing",
            reason: "This run was created on an older data bundle and has been evicted.",
            runId: resolved.runId,
          });
          return;
        }
        if (resolved.kind === "needsReview") {
          router.replace(reviewHref(resolved.runId));
          return;
        }
        if (resolved.kind === "newerToken") {
          setMode({
            kind: "missing",
            reason:
              "This link was made on a newer version of the game than this page is running. Reload the page; if that doesn't help, the new version hasn't reached you yet.",
            runId: null,
          });
          return;
        }
        if (resolved.kind === "invalidToken") {
          setMode({
            kind: "missing",
            reason:
              resolved.reason === "malformed"
                ? "The shared link is malformed or truncated — ask the sender for a fresh link."
                : resolved.reason,
            runId: null,
          });
          return;
        }
        if (resolved.kind === "versionSkew") {
          setMode({
            kind: "skew",
            title: "This shared run is from a different build",
            message:
              "The dataset, rating engine, or rules on this site differ from when the run was created. Replaying it here would silently produce a different outcome, so we won't. Ask the sender to refresh the link from their current share screen.",
          });
          return;
        }

        const view = buildShareView(resolved.gameData, resolved.record);
        if (!view) {
          // No simulation — token decoded but rebuilding the view failed.
          setMode({
            kind: "missing",
            reason: "We couldn't assemble the card for this run.",
            runId: null,
          });
          return;
        }
        setMode({
          kind: "ready",
          record: resolved.record,
          view,
          linkRunValue: resolved.linkRunValue,
        });
      } catch (err) {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({ kind: "error", title: d.title, message: d.message });
      }
    })();
  }, [parsed, router]);

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

  if (mode.kind === "skew") {
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

  return <ShareBody record={mode.record} view={mode.view} linkRunValue={mode.linkRunValue} />;
}

function ShareAppBar() {
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image src="/brand/wcdraft-mark.svg" alt="wcdraft" width={28} height={31} priority />
        <span className={s.appBarTitle}>Share</span>
      </div>
    </header>
  );
}

// ─── The card ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 600;
const CARD_HEIGHT = 800;

function ShareBody({
  record,
  view,
  linkRunValue,
}: {
  record: RunRecordV1;
  view: ShareView;
  /** Value to thread into in-screen `?run=` URLs — the token when replayed, the run_id otherwise. */
  linkRunValue: string | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const svgColors = useShareSvgColors();
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState<"idle" | "ok" | "unsupported">("idle");
  const [signedOg, setSignedOg] = useState<string | null>(null);

  // Replay URL: a self-contained `?run=<token>` URL so a fresh browser with
  // no matching localStorage can reproduce the run byte-for-byte. The token
  // carries the seed, the 17 picks, and every version anchor; honest-state
  // fires on the receiving site if any version differs.
  //
  // I3.7 fix-pass #2 (PR #18 BLOCKER): NO silent bare-id fallback. A
  // `ready`/`simulated` run MUST always tokenize; if `encodeRunToken` ever
  // fails (e.g. the record is malformed or has <17 picks somehow), we emit
  // NO share URL and surface an honest disabled/error state instead of a
  // non-reproducible `run-v1-*` link.
  const shareLink = useMemo<
    | { kind: "ready"; origin: string; token: string }
    | { kind: "ssr" }
    | { kind: "error"; message: string }
  >(() => {
    if (typeof window === "undefined") return { kind: "ssr" };
    const origin = window.location.origin;
    try {
      const token = encodeRunToken(record);
      return { kind: "ready", origin, token };
    } catch (err) {
      return {
        kind: "error",
        message:
          err instanceof RunTokenError
            ? `Couldn't build a reproducible share link: ${err.message}`
            : "Couldn't build a reproducible share link for this run.",
      };
    }
  }, [record]);

  useEffect(() => {
    let cancelled = false;
    setSignedOg(null);
    if (shareLink.kind !== "ready") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/og/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run: shareLink.token }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { ok?: unknown; signed?: unknown };
        if (!cancelled && body.ok === true && typeof body.signed === "string") {
          setSignedOg(body.signed);
        }
      } catch {
        // Static unfurl fallback is acceptable; the replay URL remains valid.
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [shareLink]);

  const shareUrl =
    shareLink.kind === "ready"
      ? `${shareLink.origin}${shareHref(shareLink.token, signedOg)}`
      : null;
  const shareLinkError = shareLink.kind === "error" ? shareLink.message : null;
  const configBadges: ConfigBadge[] = useMemo(() => {
    const replayBadges =
      typeof linkRunValue === "string" ? configBadgesFromReplayToken(linkRunValue) : [];
    return replayBadges.length > 0 ? replayBadges : configBadgesFromRecordToken(record);
  }, [linkRunValue, record]);

  const caption = useMemo(() => buildShareCaption(view, shareUrl), [view, shareUrl]);
  const intentText = useMemo(() => buildShareIntentText(view), [view]);
  const intentUrls = useMemo<ShareIntentUrls | null>(() => {
    if (!shareUrl) return null;
    return buildShareIntentUrls({ url: shareUrl, text: intentText, caption });
  }, [shareUrl, intentText, caption]);

  const [linkCopied, setLinkCopied] = useState(false);

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  }

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
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n` + xml], {
      type: "image/svg+xml",
    });
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
        // `text` excludes the URL so the platform doesn't double-render it
        // alongside the `url:` field. The full caption (with URL) is what
        // Copy Caption emits for clipboard paste targets.
        text: intentText,
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
        {configBadges.length > 0 ? <ConfigBadgeRow badges={configBadges} /> : null}
        <p className="page-head__note">
          Branded, deterministic, seed-locked. Names and national flag codes only — no competition
          marks.
        </p>
      </header>

      {/* ── The SVG card (rendered + serialisable for export) ──────────── */}
      <div className={s.shareCardFrame}>
        <ShareCardSvg svgRef={svgRef} view={view} shareUrl={shareUrl} colors={svgColors} />
      </div>

      {/* ── Caption + actions ─────────────────────────────────────────── */}
      <div className={`${s.panel} ${s.sharePanel}`}>
        {shareLinkError ? (
          <p className={s.shareHint} role="alert">
            <strong>Share link unavailable.</strong> {shareLinkError} The card and caption still
            render, but we will not emit a non-reproducible URL.
          </p>
        ) : null}
        <p className={s.shareCaptionLabel}>Caption</p>
        <pre className={s.shareCaption}>{caption}</pre>
        <div className={s.resultsActions}>
          <button
            type="button"
            className={`btn btn--primary${shareLinkError ? " btn--disabled" : ""}`}
            onClick={copyCaption}
            disabled={!!shareLinkError}
            aria-disabled={!!shareLinkError}
          >
            {copied ? "Copied ✓" : "Copy caption"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={downloadSvg}>
            Download card
          </button>
          <button
            type="button"
            className={`btn btn--ghost${shareLinkError ? " btn--disabled" : ""}`}
            onClick={shareNative}
            disabled={!!shareLinkError}
            aria-disabled={!!shareLinkError}
          >
            {shared === "unsupported" ? "Share unavailable" : "Native share"}
          </button>
        </div>
        {/* Social web intents (ws-results/history-share). All affordances
            depend on the tokenized `shareUrl`; when tokenization fails we
            render disabled spans rather than emit a non-reproducible URL. */}
        <div className={s.shareIntentGroup}>
          <p className={s.shareIntentLabel}>Share to</p>
          <div className={s.shareIntentRow}>
            {intentUrls ? (
              <>
                <a
                  href={intentUrls.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`btn btn--ghost ${s.shareIntentButton}`}
                  aria-label="Share on X (Twitter)"
                >
                  X / Twitter
                </a>
                <a
                  href={intentUrls.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`btn btn--ghost ${s.shareIntentButton}`}
                  aria-label="Share on WhatsApp"
                >
                  WhatsApp
                </a>
                <a
                  href={intentUrls.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`btn btn--ghost ${s.shareIntentButton}`}
                  aria-label="Share on Facebook"
                >
                  Facebook
                </a>
                <a
                  href={intentUrls.reddit}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`btn btn--ghost ${s.shareIntentButton}`}
                  aria-label="Share on Reddit"
                >
                  Reddit
                </a>
                <button
                  type="button"
                  className={`btn btn--ghost ${s.shareIntentButton}`}
                  onClick={copyLink}
                  aria-label="Copy share link"
                >
                  {linkCopied ? "Link copied ✓" : "Copy link"}
                </button>
              </>
            ) : (
              <>
                <span
                  className={`btn btn--ghost btn--disabled ${s.shareIntentButton}`}
                  aria-disabled="true"
                >
                  X / Twitter
                </span>
                <span
                  className={`btn btn--ghost btn--disabled ${s.shareIntentButton}`}
                  aria-disabled="true"
                >
                  WhatsApp
                </span>
                <span
                  className={`btn btn--ghost btn--disabled ${s.shareIntentButton}`}
                  aria-disabled="true"
                >
                  Facebook
                </span>
                <span
                  className={`btn btn--ghost btn--disabled ${s.shareIntentButton}`}
                  aria-disabled="true"
                >
                  Reddit
                </span>
                <span
                  className={`btn btn--ghost btn--disabled ${s.shareIntentButton}`}
                  aria-disabled="true"
                >
                  Copy link
                </span>
              </>
            )}
          </div>
        </div>
        <div className={s.resultsActions}>
          <Link href={resultsHref(linkRunValue)} className="btn btn--ghost">
            Back to results
          </Link>
        </div>
        <p className={s.shareHint}>
          The replay URL above reproduces this run byte-for-byte from its seed. Nothing here uses
          any official competition name, emblem, or trophy.
        </p>
      </div>
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

function useShareSvgColors(): ShareSvgColors {
  const [colors, setColors] = useState<ShareSvgColors>(SHARE_SVG_COLOR_VARS);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    setColors({
      bgStart: token("--field", SHARE_SVG_COLOR_VARS.bgStart),
      bgEnd: token("--accent-ink", SHARE_SVG_COLOR_VARS.bgEnd),
      accentStart: token("--accent", SHARE_SVG_COLOR_VARS.accentStart),
      accentEnd: token("--accent-strong", SHARE_SVG_COLOR_VARS.accentEnd),
      goldStart: token("--gold-strong", SHARE_SVG_COLOR_VARS.goldStart),
      goldMid: token("--gold", SHARE_SVG_COLOR_VARS.goldMid),
      goldEnd: token("--gold", SHARE_SVG_COLOR_VARS.goldEnd),
      text: token("--field-ink", SHARE_SVG_COLOR_VARS.text),
      muted: token("--ink-soft", SHARE_SVG_COLOR_VARS.muted),
    });
  }, []);

  return colors;
}

// ─── The SVG itself ──────────────────────────────────────────────────────────

function ShareCardSvg({
  svgRef,
  view,
  shareUrl,
  colors,
}: {
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  view: ShareView;
  shareUrl: string | null;
  colors: ShareSvgColors;
}) {
  const recordColor = view.is_perfect_eight_zero ? "url(#wcGold)" : colors.text;
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
          <stop offset="0" stopColor={colors.bgStart} />
          <stop offset="1" stopColor={colors.bgEnd} />
        </linearGradient>
        <linearGradient id="wcEmerald" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={colors.accentStart} />
          <stop offset="1" stopColor={colors.accentEnd} />
        </linearGradient>
        <linearGradient id="wcGold" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={colors.goldStart} />
          <stop offset="0.5" stopColor={colors.goldMid} />
          <stop offset="1" stopColor={colors.goldEnd} />
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
          fill={colors.text}
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="28"
          fontWeight="700"
          letterSpacing="0.04em"
        >
          wc
          <tspan fontWeight="900" fill="url(#wcEmerald)">
            draft
          </tspan>
        </text>
        <text
          x={CARD_WIDTH - 96}
          y="0"
          fill={colors.muted}
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
        fill={colors.text}
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
        fill={colors.muted}
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
        fill={colors.muted}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="16"
        letterSpacing="0.06em"
      >
        {truncate(formationLabel, 48)}
      </text>

      {/* Stats row */}
      <g transform={`translate(0, 540)`}>
        <ShareStat
          x={CARD_WIDTH * 0.2}
          num={String(view.goals_for)}
          label="scored"
          colors={colors}
        />
        <ShareStat
          x={CARD_WIDTH * 0.5}
          num={String(view.goals_against)}
          label="conceded"
          colors={colors}
        />
        <ShareStat
          x={CARD_WIDTH * 0.8}
          num={view.top_scorer ? String(view.top_scorer.goals) : "—"}
          label={view.top_scorer ? truncate(view.top_scorer.name, 14) : "top scorer"}
          colors={colors}
        />
      </g>

      {/* Stars row — names + flag codes only */}
      <g transform={`translate(${CARD_WIDTH / 2}, 700)`}>
        <text
          x="0"
          y="-30"
          textAnchor="middle"
          fill={colors.muted}
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
          fill={colors.text}
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
        fill={colors.muted}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="11"
        letterSpacing="0.28em"
      >
        {shareUrl ? truncate(shareUrl, 56).toUpperCase() : "WCDRAFT.APP"}
      </text>
    </svg>
  );
}

function ShareStat({
  x,
  num,
  label,
  colors,
}: {
  x: number;
  num: string;
  label: string;
  colors: ShareSvgColors;
}) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <text
        x="0"
        y="0"
        textAnchor="middle"
        fill={colors.text}
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
        fill={colors.muted}
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
