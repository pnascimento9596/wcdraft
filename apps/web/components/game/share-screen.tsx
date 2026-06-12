"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { loadGameData, type GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import {
  draftHref,
  parseRunSearchParams,
  reviewHref,
  resultsHref,
  shareHref,
} from "@/lib/game/navigation";
import { loadRunRecord, type RunRecordV1 } from "@/lib/game/run-record";
import {
  decodeRunToken,
  isNewerRunTokenVersion,
  encodeRunToken,
  RunTokenError,
  versionsAgree,
  virtualRecordFromToken,
} from "@/lib/game/run-token";
import { loadScenarioBundle } from "@/lib/game/scenario-data";
import { runSimulation } from "@/lib/game/simulate";
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
  | { kind: "ready"; gameData: GameData; record: RunRecordV1; view: ShareView }
  | { kind: "missing"; reason: string; runId: string | null }
  | { kind: "skew"; title: string; message: string }
  | { kind: "error"; title: string; message: string };

export function ShareScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Parsed once at component scope so both the load effect AND the render
  // path (link-href threading) see the same discriminated value.
  const parsed = useMemo(
    () => parseRunSearchParams(searchParams ?? null),
    [searchParams],
  );

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
        const gd = await loadGameData();
        if (myToken !== reqToken.current) return;

        let record: RunRecordV1;
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
            router.replace(reviewHref(parsed.run_id));
            return;
          }
          record = loaded.record;
        } else {
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
                "The dataset, rating engine, or rules on this site differ from when the run was created. Replaying it here would silently produce a different outcome, so we won't. Ask the sender to refresh the link from their current share screen.",
            });
            return;
          }
          try {
            const scenario = await loadScenarioBundle();
            if (myToken !== reqToken.current) return;
            const virtual = virtualRecordFromToken(decoded, gd);
            const { simulation } = await runSimulation(gd, scenario, virtual);
            if (myToken !== reqToken.current) return;
            record = { ...virtual, status: "complete", simulation };
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
        }

        const view = buildShareView(gd, record);
        if (!view) {
          // No simulation — token decoded but rebuilding the view failed.
          setMode({
            kind: "missing",
            reason: "We couldn't assemble the card for this run.",
            runId: null,
          });
          return;
        }
        setMode({ kind: "ready", gameData: gd, record, view });
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

  // Threaded into in-screen CTAs so a token-replay session keeps the
  // token across the share ↔ results boundary.
  const linkRunValue = parsed?.kind === "token" ? parsed.token : mode.record.run_id;
  return <ShareBody record={mode.record} view={mode.view} linkRunValue={linkRunValue} />;
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
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState<"idle" | "ok" | "unsupported">("idle");

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
    | { kind: "ready"; url: string }
    | { kind: "ssr" }
    | { kind: "error"; message: string }
  >(() => {
    if (typeof window === "undefined") return { kind: "ssr" };
    const origin = window.location.origin;
    try {
      const token = encodeRunToken(record);
      return { kind: "ready", url: `${origin}${shareHref(token)}` };
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

  const shareUrl = shareLink.kind === "ready" ? shareLink.url : null;
  const shareLinkError = shareLink.kind === "error" ? shareLink.message : null;

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
        {shareLinkError ? (
          <p className={s.shareHint} role="alert">
            <strong>Share link unavailable.</strong> {shareLinkError} The card and caption
            still render, but we will not emit a non-reproducible URL.
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
