// Append-only post ledger — the idempotency backbone.
//
// Every published (and every dry-run) post appends one JSONL line keyed by its
// content_hash. `hasPosted` makes re-runs safe: the same content can never be
// double-posted, even if the workflow fires twice or a retry re-enters the
// pipeline. The ledger is COMMITTED, so idempotency survives across workflow
// runs (each run pulls the latest main, appends, and the workflow commits the
// new lines back).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { LEDGER_PATH } from "./paths.ts";

export type PostMode = "dry_run" | "live";

export interface LedgerEntry {
  /** ISO-8601 UTC timestamp the entry was written. */
  at: string;
  /** YYYY-MM-DD (UTC) the post counts against for the daily cap. */
  day: string;
  mode: PostMode;
  family: string;
  post_id: string;
  content_hash: string;
  /** The X post id once live-published; null for dry-run. */
  x_post_id: string | null;
  /** The resolved deep link / share URL in the post. */
  deep_link: string;
  /** Full post text — committed for audit (a reviewer reads exactly what shipped). */
  text: string;
  referenced_feature_ids: string[];
}

export function readLedger(path = LEDGER_PATH): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const out: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as LedgerEntry);
    } catch {
      // A malformed line is a corruption signal — skip but never silently
      // succeed elsewhere; callers can diff committed ledger in review.
    }
  }
  return out;
}

/** Idempotency check: has this exact content already been recorded as posted? */
export function hasPosted(contentHash: string, path = LEDGER_PATH): boolean {
  return readLedger(path).some((e) => e.content_hash === contentHash);
}

/** Count entries recorded for a given UTC day (for the per-day cap). */
export function countForDay(day: string, mode: PostMode, path = LEDGER_PATH): number {
  return readLedger(path).filter((e) => e.day === day && e.mode === mode).length;
}

export function appendLedger(entry: LedgerEntry, path = LEDGER_PATH): void {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

/** UTC YYYY-MM-DD for a Date (default now). */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
