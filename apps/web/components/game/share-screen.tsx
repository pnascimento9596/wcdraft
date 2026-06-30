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
  dailyDraftHref,
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
  dailyStandingText,
  type DailyShareStanding,
  type ShareIntentUrls,
  type ShareView,
} from "@/lib/game/share-adapters";
import {
  SHARE_SVG_COLOR_FALLBACKS,
  SHARE_SVG_COLOR_TOKENS,
  type ShareSvgColors,
} from "@/lib/game/run-palette";
import { fetchBoardPage } from "@/lib/leaderboard/client";
import { DEFAULT_DAILY_BOARD_FILTER } from "@/lib/leaderboard/config";
import { wasTokenSubmitted } from "@/lib/leaderboard/submit-state";

import s from "./game.module.css";

type Mode =
  | { kind: "loading" }
  | {
      kind: "ready";
      record: RunRecordV1;
      view: ShareView;
      linkRunValue: string;
      isRecipient: boolean;
    }
  | { kind: "missing"; reason: string; runId: string | null }
  | { kind: "skew"; title: string; message: string }
  | { kind: "error"; title: string; message: string };

type OgSignState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ready"; signed: string }
  | { kind: "error"; message: string };

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
        const resolved = await resolveDisplayRun(parsed, { optionalScenarioForLocalRun: true });
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

        const view = buildShareView(resolved.gameData, resolved.record, resolved.scenario);
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
          isRecipient: resolved.isReplayedFromToken,
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

  return (
    <ShareBody
      record={mode.record}
      view={mode.view}
      linkRunValue={mode.linkRunValue}
      isRecipient={mode.isRecipient}
    />
  );
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
  isRecipient,
}: {
  record: RunRecordV1;
  view: ShareView;
  /** Value to thread into in-screen `?run=` URLs — the token when replayed, the run_id otherwise. */
  linkRunValue: string | null;
  isRecipient: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const svgColors = useShareSvgColors();
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState<"idle" | "ok" | "unsupported">("idle");
  const [ogSign, setOgSign] = useState<OgSignState>({ kind: "idle" });

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
    setOgSign({ kind: "idle" });
    if (shareLink.kind !== "ready") return;
    let controller: AbortController | null = null;
    let timeout: number | null = null;
    const signCurrentRun = async () => {
      setOgSign({ kind: "pending" });
      controller = new AbortController();
      timeout = window.setTimeout(() => controller?.abort(), 4000);
      try {
        const response = await fetch("/api/og/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run: shareLink.token }),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!cancelled) {
            setOgSign({
              kind: "error",
              message: "Couldn't sign the run preview for link unfurls.",
            });
          }
          return;
        }
        const body = (await response.json()) as { ok?: unknown; signed?: unknown };
        if (!cancelled && body.ok === true && typeof body.signed === "string") {
          setOgSign({ kind: "ready", signed: body.signed });
          return;
        }
        if (!cancelled) {
          setOgSign({
            kind: "error",
            message: "Couldn't sign the run preview for link unfurls.",
          });
        }
      } catch {
        if (!cancelled) {
          setOgSign({
            kind: "error",
            message: "Couldn't sign the run preview for link unfurls.",
          });
        }
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
      }
    };
    void signCurrentRun();
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
      controller?.abort();
    };
  }, [shareLink]);

  const shareLinkPending =
    shareLink.kind === "ready" && (ogSign.kind === "idle" || ogSign.kind === "pending");
  const signedOg = ogSign.kind === "ready" ? ogSign.signed : null;
  const shareUrl =
    shareLink.kind === "ready" && !shareLinkPending
      ? `${shareLink.origin}${shareHref(shareLink.token, signedOg)}`
      : null;
  const shareLinkError = shareLink.kind === "error" ? shareLink.message : null;
  const ogPreviewError = ogSign.kind === "error" ? ogSign.message : null;
  const shareUnavailable = !!shareLinkError || !shareUrl;
  const [dailyStanding, setDailyStanding] = useState<DailyShareStanding | null>(null);
  const configBadges: ConfigBadge[] = useMemo(() => {
    const replayBadges =
      typeof linkRunValue === "string" ? configBadgesFromReplayToken(linkRunValue) : [];
    return replayBadges.length > 0 ? replayBadges : configBadgesFromRecordToken(record);
  }, [linkRunValue, record]);

  useEffect(() => {
    let cancelled = false;
    setDailyStanding(null);
    if (isRecipient || record.challenge?.kind !== "daily" || shareLink.kind !== "ready") {
      return () => {
        cancelled = true;
      };
    }
    if (!wasTokenSubmitted(shareLink.token, "casual")) {
      return () => {
        cancelled = true;
      };
    }
    void fetchBoardPage({
      filter: { ...DEFAULT_DAILY_BOARD_FILTER, challengeDate: record.challenge.date },
      cursor: null,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setDailyStanding(null);
        return;
      }
      const matches = result.page.entries.filter((entry) => entry.verified_score === view.score);
      if (matches.length !== 1) {
        setDailyStanding(null);
        return;
      }
      const [entry] = matches;
      if (!entry || entry.field_size <= 0) {
        setDailyStanding(null);
        return;
      }
      setDailyStanding({
        rank: entry.rank,
        percentile: entry.percentile,
        fieldSize: entry.field_size,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isRecipient, record.challenge, shareLink, view.score]);

  const caption = useMemo(
    () => buildShareCaption(view, shareUrl, { dailyStanding }),
    [view, shareUrl, dailyStanding],
  );
  const intentText = useMemo(
    () => buildShareIntentText(view, { dailyStanding }),
    [view, dailyStanding],
  );
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
    if (shareLinkPending) return;
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadSvg() {
    if (shareLinkPending) return;
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
    if (!shareUrl) return;
    if (typeof navigator === "undefined" || !navigator.share) {
      setShared("unsupported");
      return;
    }
    try {
      await navigator.share({
        title: `${shareTeamLabel(view, isRecipient)} — ${view.headline}`,
        // `text` excludes the URL so the platform doesn't double-render it
        // alongside the `url:` field. The full caption (with URL) is what
        // Copy Caption emits for clipboard paste targets.
        text: intentText,
        url: shareUrl,
      });
      setShared("ok");
    } catch {
      setShared("idle");
    }
  }

  const teamLabel = shareTeamLabel(view, isRecipient);
  const recipientDraftHref =
    record.challenge?.kind === "daily"
      ? dailyDraftHref(null, record.challenge.date)
      : draftHref(null);
  const recipientCta =
    record.challenge?.kind === "daily"
      ? "Draft today's teams →"
      : `${teamLabel} went ${view.display_record} — draft your own all-time XI →`;
  const shareReadyNote = shareLinkPending
    ? "Preparing the signed run preview..."
    : ogPreviewError
      ? "Signed preview unavailable; sharing still uses a replay-safe run token."
      : signedOg
        ? "Signed run preview ready for large-card unfurls."
        : "Replay-safe share link ready.";

  return (
    <div className={s.share}>
      <ShareAppBar />

      <header className="page-head">
        <span className="eyebrow">{isRecipient ? "Shared run" : "Share your run"}</span>
        <h1 className="display">
          {isRecipient ? `${teamLabel} went ${view.display_record}` : "The card"}
        </h1>
        {configBadges.length > 0 ? <ConfigBadgeRow badges={configBadges} /> : null}
        <p className="page-head__note">
          {isRecipient
            ? record.challenge?.kind === "daily"
              ? "A seed-locked daily run from another browser. Draft the same daily teams and chase your own score."
              : "A seed-locked run from another browser. Start fresh to draft your own XI."
            : "Branded, deterministic, seed-locked. Names and national flag codes only — no competition marks."}
        </p>
      </header>

      {isRecipient ? (
        <section className={`${s.panel} ${s.recipientPanel}`} aria-label="Draft your own">
          <Link href={recipientDraftHref} className={`btn btn--primary ${s.recipientCta}`}>
            {recipientCta}
          </Link>
        </section>
      ) : null}

      {/* ── The SVG card (rendered + serialisable for export) ──────────── */}
      <div className={s.shareCardFrame}>
        <ShareCardSvg
          svgRef={svgRef}
          view={view}
          shareUrl={shareUrl}
          dailyStanding={dailyStanding}
          colors={svgColors}
        />
      </div>

      {/* ── Caption + actions ─────────────────────────────────────────── */}
      <div className={`${s.panel} ${s.sharePanel}`}>
        {shareLinkError ? (
          <p className={s.shareHint} role="alert">
            <strong>Share link unavailable.</strong> {shareLinkError} The card and caption still
            render, but we will not emit a non-reproducible URL.
          </p>
        ) : null}
        {ogPreviewError ? (
          <p className={s.shareHint} role="status">
            <strong>Large-card preview unavailable.</strong> {ogPreviewError} Sharing still uses a
            replay-safe token, but some sites may show the default preview.
          </p>
        ) : null}
        {shareLinkPending ? (
          <p className={s.shareHint} role="status">
            {shareReadyNote}
          </p>
        ) : null}
        <p className={s.shareCaptionLabel}>Caption</p>
        <pre className={s.shareCaption} tabIndex={0} aria-label="Share caption">
          {caption}
        </pre>
        <div className={s.resultsActions}>
          <button
            type="button"
            className={`${isRecipient ? "btn btn--ghost" : "btn btn--primary"}${
              shareLinkPending ? " btn--disabled" : ""
            }`}
            onClick={copyCaption}
            disabled={shareLinkPending}
            aria-disabled={shareLinkPending}
          >
            {copied ? "Copied ✓" : "Copy caption"}
          </button>
          <button
            type="button"
            className={`btn btn--ghost${shareLinkPending ? " btn--disabled" : ""}`}
            onClick={downloadSvg}
            disabled={shareLinkPending}
            aria-disabled={shareLinkPending}
          >
            Download card
          </button>
          <button
            type="button"
            className={`btn btn--ghost${shareUnavailable ? " btn--disabled" : ""}`}
            onClick={shareNative}
            disabled={shareUnavailable}
            aria-disabled={shareUnavailable}
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
          {shareLinkError
            ? "The card remains exportable, but this run cannot be shared as a reproducible replay URL."
            : `${shareReadyNote} The replay URL reproduces this run byte-for-byte from its seed.`}{" "}
          Nothing here uses any official competition name, emblem, or trophy.
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
  const [colors, setColors] = useState<ShareSvgColors>(SHARE_SVG_COLOR_FALLBACKS);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    setColors({
      bgStart: token(SHARE_SVG_COLOR_TOKENS.bgStart, SHARE_SVG_COLOR_FALLBACKS.bgStart),
      bgEnd: token(SHARE_SVG_COLOR_TOKENS.bgEnd, SHARE_SVG_COLOR_FALLBACKS.bgEnd),
      accentStart: token(SHARE_SVG_COLOR_TOKENS.accentStart, SHARE_SVG_COLOR_FALLBACKS.accentStart),
      accentEnd: token(SHARE_SVG_COLOR_TOKENS.accentEnd, SHARE_SVG_COLOR_FALLBACKS.accentEnd),
      goldStart: token(SHARE_SVG_COLOR_TOKENS.goldStart, SHARE_SVG_COLOR_FALLBACKS.goldStart),
      goldMid: token(SHARE_SVG_COLOR_TOKENS.goldMid, SHARE_SVG_COLOR_FALLBACKS.goldMid),
      goldEnd: token(SHARE_SVG_COLOR_TOKENS.goldEnd, SHARE_SVG_COLOR_FALLBACKS.goldEnd),
      text: token(SHARE_SVG_COLOR_TOKENS.text, SHARE_SVG_COLOR_FALLBACKS.text),
      muted: token(SHARE_SVG_COLOR_TOKENS.muted, SHARE_SVG_COLOR_FALLBACKS.muted),
    });
  }, []);

  return colors;
}

// ─── The SVG itself ──────────────────────────────────────────────────────────

function ShareCardSvg({
  svgRef,
  view,
  shareUrl,
  dailyStanding,
  colors,
}: {
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  view: ShareView;
  shareUrl: string | null;
  dailyStanding: DailyShareStanding | null;
  colors: ShareSvgColors;
}) {
  if (view.reveal !== null) {
    return (
      <MemoryRevealShareCardSvg
        svgRef={svgRef}
        view={view}
        shareUrl={shareUrl}
        dailyStanding={dailyStanding}
        colors={colors}
      />
    );
  }

  const recordColor = view.is_perfect_eight_zero ? "url(#wcGold)" : colors.text;
  const headline = view.headline;
  const payoffLines = [
    view.challenge_date !== null ? dailyStandingText(dailyStanding) : null,
    view.perfect_run_reference,
  ].filter((line): line is string => line !== null);
  const narrativeLines = wrapSvgText(view.narrative, 52, payoffLines.length > 1 ? 1 : 2);
  const formationLabel = view.manager
    ? `${view.formation_name} · mgr ${view.manager.nation_code} ${view.manager.name}`
    : view.formation_name;
  const headlineColor = view.is_perfect_eight_zero ? recordColor : colors.muted;

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
        fill={headlineColor}
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

      {/* Daily standing + perfect-run reference */}
      {payoffLines.map((line, i) => (
        <text
          key={`${line}-${i}`}
          x={CARD_WIDTH / 2}
          y={508 + i * 24}
          textAnchor="middle"
          fill={i === 0 && view.challenge_date !== null ? colors.text : colors.muted}
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="16"
          fontWeight="650"
        >
          {line}
        </text>
      ))}

      {/* Existing deterministic result narrative */}
      {narrativeLines.map((line, i) => (
        <text
          key={`${line}-${i}`}
          x={CARD_WIDTH / 2}
          y={508 + payoffLines.length * 24 + i * 24}
          textAnchor="middle"
          fill={colors.text}
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="17"
          fontWeight="500"
        >
          {line}
        </text>
      ))}

      {/* Stats row */}
      <g transform={`translate(0, 624)`}>
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
      <g transform={`translate(${CARD_WIDTH / 2}, 756)`}>
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

function MemoryRevealShareCardSvg({
  svgRef,
  view,
  shareUrl,
  dailyStanding,
  colors,
}: {
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  view: ShareView;
  shareUrl: string | null;
  dailyStanding: DailyShareStanding | null;
  colors: ShareSvgColors;
}) {
  const reveal = view.reveal!;
  const standingLine =
    view.challenge_date !== null ? dailyStandingText(dailyStanding) : "Memory reveal";
  const xiLeft = reveal.revealStarters.slice(0, 6);
  const xiRight = reveal.revealStarters.slice(6, 11);
  const avgAfter = formatShareNumber(reveal.squadAverageAfter);

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      role="img"
      aria-label={`${view.team_name} — Memory reveal, record ${view.display_record}`}
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

      <rect x="0" y="0" width={CARD_WIDTH} height={CARD_HEIGHT} rx="32" ry="32" fill="url(#wcBg)" />
      <rect x="0" y="0" width={CARD_WIDTH} height="8" fill="url(#wcEmerald)" />

      <g transform="translate(48, 56)">
        <text
          x="0"
          y="0"
          fill={colors.text}
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="28"
          fontWeight="700"
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

      <text
        x={CARD_WIDTH / 2}
        y="118"
        textAnchor="middle"
        fill={colors.muted}
        fontFamily="ui-monospace, SF Mono, Menlo, monospace"
        fontSize="13"
        fontWeight="700"
      >
        MEMORY REVEAL
      </text>
      <text
        x={CARD_WIDTH / 2}
        y="158"
        textAnchor="middle"
        fill={colors.text}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="30"
        fontWeight="650"
      >
        {truncate(view.team_name, 25)}
      </text>
      <text
        x={CARD_WIDTH / 2}
        y="190"
        textAnchor="middle"
        fill={colors.muted}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="15"
        fontWeight="600"
      >
        drafted blind, ended {view.display_record} · {view.score} pts · {avgAfter} OVR
      </text>

      <g transform="translate(56, 224)">
        <RevealMetricBox
          x={0}
          title="BLIND OVR"
          value={formatShareNumber(reveal.squadAverageBefore)}
          colors={colors}
        />
        <text
          x="244"
          y="58"
          textAnchor="middle"
          fill={colors.muted}
          fontFamily="ui-monospace, SF Mono, Menlo, monospace"
          fontSize="28"
          fontWeight="700"
        >
          -&gt;
        </text>
        <RevealMetricBox x={284} title="REVEALED OVR" value={avgAfter} colors={colors} />
      </g>

      <g transform="translate(58, 344)">
        <text
          x="0"
          y="0"
          fill={colors.muted}
          fontFamily="ui-monospace, SF Mono, Menlo, monospace"
          fontSize="12"
          fontWeight="700"
        >
          LINE REVEAL
        </text>
        {reveal.lineRatings.map((line, i) => (
          <RevealLineRow key={line.line} line={line} y={30 + i * 28} colors={colors} />
        ))}
      </g>

      <g transform="translate(58, 492)">
        <text
          x="0"
          y="0"
          fill={colors.muted}
          fontFamily="ui-monospace, SF Mono, Menlo, monospace"
          fontSize="12"
          fontWeight="700"
        >
          RESULTING XI
        </text>
        {xiLeft.map((starter, i) => (
          <RevealXiRow
            key={starter.slot_id}
            starter={starter}
            x={0}
            y={30 + i * 28}
            colors={colors}
          />
        ))}
        {xiRight.map((starter, i) => (
          <RevealXiRow
            key={starter.slot_id}
            starter={starter}
            x={268}
            y={30 + i * 28}
            colors={colors}
          />
        ))}
      </g>

      <g transform="translate(58, 700)">
        <text
          x="0"
          y="0"
          fill={colors.muted}
          fontFamily="ui-monospace, SF Mono, Menlo, monospace"
          fontSize="12"
          fontWeight="700"
        >
          TOP REVEALS
        </text>
        <text
          x="0"
          y="28"
          fill={colors.text}
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize="17"
          fontWeight="600"
        >
          {reveal.topReveals.length > 0
            ? reveal.topReveals
                .map(
                  (starter) =>
                    `${formatShareNumber(starter.before_overall)}->${formatShareNumber(
                      starter.after_overall,
                    )} ${starter.nation_code} ${truncate(starter.name, 11)}`,
                )
                .join("  ·  ")
            : "—"}
        </text>
      </g>

      <text
        x={CARD_WIDTH / 2}
        y="766"
        textAnchor="middle"
        fill={colors.muted}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="13"
        fontWeight="600"
      >
        {truncate(`${standingLine} · ${view.perfect_run_reference}`, 68)}
      </text>

      <text
        x={CARD_WIDTH / 2}
        y={CARD_HEIGHT - 18}
        textAnchor="middle"
        fill={colors.muted}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="10"
      >
        {shareUrl ? truncate(shareUrl, 62).toUpperCase() : "WCDRAFT.APP"}
      </text>
    </svg>
  );
}

function RevealMetricBox({
  x,
  title,
  value,
  colors,
}: {
  x: number;
  title: string;
  value: string;
  colors: ShareSvgColors;
}) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <rect
        x="0"
        y="0"
        width="204"
        height="88"
        rx="14"
        fill="rgba(0,0,0,0.16)"
        stroke={colors.muted}
        strokeOpacity="0.36"
      />
      <text
        x="102"
        y="28"
        textAnchor="middle"
        fill={colors.muted}
        fontFamily="ui-monospace, SF Mono, Menlo, monospace"
        fontSize="12"
        fontWeight="700"
      >
        {title}
      </text>
      <text
        x="102"
        y="66"
        textAnchor="middle"
        fill={colors.text}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="34"
        fontWeight="850"
      >
        {value}
      </text>
    </g>
  );
}

function RevealLineRow({
  line,
  y,
  colors,
}: {
  line: NonNullable<ShareView["reveal"]>["lineRatings"][number];
  y: number;
  colors: ShareSvgColors;
}) {
  return (
    <g transform={`translate(0, ${y})`}>
      <text
        x="0"
        y="0"
        fill={colors.text}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="16"
        fontWeight="600"
      >
        {line.label}
      </text>
      <text
        x="326"
        y="0"
        textAnchor="end"
        fill={colors.muted}
        fontFamily="ui-monospace, SF Mono, Menlo, monospace"
        fontSize="15"
        fontWeight="700"
      >
        {formatShareNumber(line.before_value)}
      </text>
      <text
        x="356"
        y="0"
        textAnchor="middle"
        fill={colors.muted}
        fontFamily="ui-monospace, SF Mono, Menlo, monospace"
        fontSize="15"
        fontWeight="700"
      >
        -&gt;
      </text>
      <text
        x="404"
        y="0"
        textAnchor="end"
        fill={colors.text}
        fontFamily="ui-monospace, SF Mono, Menlo, monospace"
        fontSize="16"
        fontWeight="800"
      >
        {formatShareNumber(line.after_value)}
      </text>
      <rect x="420" y="-12" width="110" height="8" rx="4" fill="rgba(0,0,0,0.22)" />
      <rect
        x="420"
        y="-12"
        width={Math.max(0, Math.min(110, ((line.after_value ?? 0) / 100) * 110))}
        height="8"
        rx="4"
        fill="url(#wcEmerald)"
      />
    </g>
  );
}

function RevealXiRow({
  starter,
  x,
  y,
  colors,
}: {
  starter: NonNullable<ShareView["reveal"]>["revealStarters"][number];
  x: number;
  y: number;
  colors: ShareSvgColors;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <text
        x="0"
        y="0"
        fill={colors.muted}
        fontFamily="ui-monospace, SF Mono, Menlo, monospace"
        fontSize="12"
        fontWeight="700"
      >
        {truncate(starter.slot_label, 4)}
      </text>
      <text
        x="42"
        y="0"
        fill={colors.text}
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="15"
        fontWeight="600"
      >
        {starter.nation_code} {truncate(starter.name, 13)}
      </text>
      <text
        x="234"
        y="0"
        textAnchor="end"
        fill={colors.text}
        fontFamily="ui-monospace, SF Mono, Menlo, monospace"
        fontSize="14"
        fontWeight="800"
      >
        {formatShareNumber(starter.after_overall)}
      </text>
    </g>
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

function formatShareNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)) + "…";
}

function wrapSvgText(value: string, maxLineChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const rawWord of words) {
    const word = rawWord.length > maxLineChars ? truncate(rawWord, maxLineChars) : rawWord;
    const current = lines[lines.length - 1];
    if (!current) {
      lines.push(word);
      continue;
    }
    if (`${current} ${word}`.length <= maxLineChars) {
      lines[lines.length - 1] = `${current} ${word}`;
      continue;
    }
    if (lines.length >= maxLines) {
      lines[lines.length - 1] = truncate(`${current} ${word}`, maxLineChars);
      break;
    }
    lines.push(word);
  }
  return lines.length > 0 ? lines.slice(0, maxLines) : ["Run complete."];
}

function shareTeamLabel(view: ShareView, isRecipient: boolean): string {
  const teamName = view.team_name.replace(/\s+/gu, " ").trim() || "This XI";
  if (isRecipient && /^your xi$/iu.test(teamName)) return "This XI";
  return teamName;
}
