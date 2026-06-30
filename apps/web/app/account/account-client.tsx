"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { deleteCsrf, fetchWithCsrf, putJson } from "@/lib/auth/client";
import { useAuth } from "@/components/auth-context";
import type { AccountRun, AccountRunsPage } from "@/lib/account/runs";

type Notice =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function AccountClient({ initial }: { readonly initial: AccountRunsPage }) {
  const [identity, setIdentity] = useState(initial.identity);
  const [runs, setRuns] = useState(initial.runs);
  const [page, setPage] = useState(initial.page);
  const [loadingMore, setLoadingMore] = useState(false);
  const { refresh } = useAuth();

  const loadMore = useCallback(async () => {
    if (!page.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/account/runs?limit=${page.limit.toString()}&offset=${(
          page.offset + runs.length
        ).toString()}`,
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!response.ok) return;
      const data = (await response.json()) as AccountRunsPage;
      setRuns((current) => [...current, ...data.runs]);
      setPage(data.page);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, page, runs.length]);

  return (
    <div className="container page account-page">
      <header className="account-head">
        <div>
          <span className="eyebrow">Account</span>
          <h1 className="display">Your runs and settings</h1>
        </div>
        <Link href="/play" className="btn btn--primary">
          Draft Again
        </Link>
      </header>

      <section className="account-grid" aria-label="Account management">
        <IdentityPanel identity={identity} />
        <PasswordPanel
          hasPassword={identity.hasPassword}
          email={identity.email}
          onPasswordSet={async () => {
            setIdentity((current) => ({ ...current, hasPassword: true }));
            await refresh();
          }}
        />
        <DeletePanel />
      </section>

      <StatsGrid stats={initial.stats} />

      <section className="account-runs" aria-labelledby="account-runs-title">
        <div className="account-section-head">
          <div>
            <span className="eyebrow">History</span>
            <h2 id="account-runs-title">All saved runs</h2>
          </div>
          <Link href="/play/history" className="account-inline-link">
            Recent view
          </Link>
        </div>

        {runs.length === 0 ? (
          <div className="account-empty">
            <b>No saved runs yet</b>
            <p>
              Finish a draft and simulate it. Signed-in runs will appear here without needing a
              leaderboard post.
            </p>
          </div>
        ) : (
          <ul className="account-run-list">
            {runs.map((run) => (
              <li key={run.id}>
                <RunRow run={run} />
              </li>
            ))}
          </ul>
        )}

        {page.hasMore ? (
          <button
            type="button"
            className="account-load-more"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more runs"}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function IdentityPanel({ identity }: { readonly identity: AccountRunsPage["identity"] }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await deleteCsrf("/api/auth/session");
      await refresh();
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [refresh, router]);

  return (
    <section className="account-panel">
      <span className="account-panel__label">Identity</span>
      <div className="account-email">{identity.email ?? "—"}</div>
      <p>Only you see this email. Public boards use your username or per-run alias.</p>
      <div className="account-panel__actions">
        <Link href="/settings" className="account-panel__link">
          Browser settings
        </Link>
        <button
          type="button"
          className="account-link-button"
          onClick={signOut}
          disabled={signingOut}
        >
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </section>
  );
}

function PasswordPanel({
  hasPassword,
  email,
  onPasswordSet,
}: {
  readonly hasPassword: boolean;
  readonly email: string | null;
  readonly onPasswordSet: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState<Notice>({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSaving(true);
      setNotice({ kind: "idle" });
      try {
        const response = await putJson<{ message?: string; hasPassword?: boolean }>(
          "/api/account/password",
          {
            currentPassword: currentPassword || undefined,
            newPassword,
          },
        );
        if (!response.ok) {
          setNotice({
            kind: "error",
            message:
              response.data?.message ??
              "Password was not changed. Use your current password or a fresh magic link.",
          });
          return;
        }
        setCurrentPassword("");
        setNewPassword("");
        setNotice({ kind: "ok", message: "Password updated." });
        await onPasswordSet();
      } catch {
        setNotice({ kind: "error", message: "Network hiccup. Try again." });
      } finally {
        setSaving(false);
      }
    },
    [currentPassword, newPassword, onPasswordSet],
  );

  return (
    <section className="account-panel">
      <span className="account-panel__label">{hasPassword ? "Password" : "Set password"}</span>
      <form className="account-form" onSubmit={submit}>
        {hasPassword ? (
          <label>
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          <span>New password</span>
          <input
            type="password"
            autoComplete={hasPassword ? "new-password" : "new-password"}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={10}
            required
          />
        </label>
        <button type="submit" className="account-action" disabled={saving}>
          {saving ? "Saving..." : hasPassword ? "Change password" : "Set password"}
        </button>
      </form>
      <p className="account-panel__note">
        Forgot it? Use a magic link for {email ?? "this account"}, then set a new password here.
      </p>
      {notice.kind !== "idle" ? (
        <p className={`account-notice account-notice--${notice.kind}`} role="status">
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}

function DeletePanel() {
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<Notice>({ kind: "idle" });
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const deleteAccount = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setDeleting(true);
      setNotice({ kind: "idle" });
      try {
        const response = await fetchWithCsrf("/api/account", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          setNotice({
            kind: "error",
            message: body?.message ?? "Account was not deleted.",
          });
          return;
        }
        router.push("/");
        router.refresh();
      } catch {
        setNotice({ kind: "error", message: "Network hiccup. Account not deleted." });
      } finally {
        setDeleting(false);
      }
    },
    [confirm, router],
  );

  return (
    <section className="account-panel account-panel--danger">
      <span className="account-panel__label">Delete</span>
      <p>Deletes the account, sessions, saved runs, and account-owned leaderboard rows.</p>
      <form className="account-form" onSubmit={deleteAccount}>
        <label>
          <span>Type delete my account</span>
          <input
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button type="submit" className="account-danger" disabled={deleting}>
          {deleting ? "Deleting..." : "Delete account"}
        </button>
      </form>
      {notice.kind !== "idle" ? (
        <p className={`account-notice account-notice--${notice.kind}`} role="status">
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}

function StatsGrid({ stats }: { readonly stats: AccountRunsPage["stats"] }) {
  const cells = useMemo(
    () => [
      ["Total runs", stats.totalRuns.toString()],
      ["Best score", valueOrDash(stats.bestScore)],
      ["Perfect runs", stats.perfectRunCount.toString()],
      ["Average score", valueOrDash(stats.averageScore)],
      ["Qualified rate", percentOrDash(stats.qualifyingRate)],
      ["Undefeated rate", percentOrDash(stats.undefeatedRate)],
      ["Daily streak", `${stats.dailyStreakDays.toString()} days`],
      ["Personal best", valueOrDash(stats.personalBest)],
    ],
    [stats],
  );
  return (
    <section className="account-stats" aria-label="Aggregate stats">
      {cells.map(([label, value]) => (
        <div key={label} className="account-stat">
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
    </section>
  );
}

function RunRow({ run }: { readonly run: AccountRun }) {
  const date = new Date(run.createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <article className="account-run">
      <div className="account-run__main">
        <div>
          <div className="account-run__topline">
            <span>{dateLabel}</span>
            <span>{run.configLabel}</span>
          </div>
          <h3>{run.teamName}</h3>
        </div>
        <div className="account-run__badges">
          {run.perfectRun ? <span className="account-badge account-badge--gold">8-0</span> : null}
          {run.postedToLeaderboard ? <span className="account-badge">Posted</span> : null}
        </div>
      </div>
      <div className="account-run__meta">
        <span>
          <b>{valueOrDash(run.score)}</b> pts
        </span>
        <span>{formatRecord(run)}</span>
        <span>{run.formation}</span>
        <span>{run.nationMix}</span>
      </div>
      {run.keyPicks.length > 0 ? (
        <ul className="account-picks" aria-label="Squad summary">
          {run.keyPicks.map((pick) => (
            <li key={`${run.id}-${pick.name}-${pick.nationCode}`}>
              <span>{pick.nationCode}</span>
              {pick.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="account-run__empty">Squad summary —</p>
      )}
      <div className="account-run__foot">
        <code>{run.seed}</code>
        <Link href={run.resultHref}>Open results</Link>
      </div>
    </article>
  );
}

function formatRecord(run: AccountRun): string {
  if (run.record.wins === null || run.record.draws === null || run.record.losses === null) {
    return run.displayRecord === "—" ? "W-L-D —" : `${run.displayRecord}-0`;
  }
  return `${run.record.wins.toString()}-${run.record.losses.toString()}-${run.record.draws.toString()}`;
}

function valueOrDash(value: number | null): string {
  return value === null ? "—" : value.toString();
}

function percentOrDash(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100).toString()}%`;
}
