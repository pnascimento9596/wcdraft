"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { postJson, ensureCsrfToken } from "@/lib/auth/client";
import { unsafeMutationUnknownMessage, useUnsafeMutationLatch } from "@/lib/unsafe-mutation";

type State =
  | { kind: "idle" }
  | { kind: "link-submitting"; purpose: "signin" | "reset" }
  | { kind: "password-submitting" }
  | { kind: "sent"; email: string; purpose: "signin" | "reset" }
  | {
      kind: "unknown";
      operation: "password" | "signin-link" | "reset-link";
      message: string;
    }
  | { kind: "error"; message: string };

export function SignInForm(): React.ReactElement {
  const identifierId = useId();
  const passwordId = useId();
  const linkEmailId = useId();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const mutation = useUnsafeMutationLatch();
  const identifierRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/play";

  useEffect(() => {
    void ensureCsrfToken().catch(() => {
      /* submit path surfaces the failure */
    });
  }, []);

  const emailForSecondaryFlow = useCallback((): string => {
    const explicit = linkEmail.trim();
    if (explicit) return explicit;
    const fromIdentifier = identifier.trim();
    return fromIdentifier.includes("@") ? fromIdentifier : "";
  }, [identifier, linkEmail]);

  const sendLink = useCallback(
    async (purpose: "signin" | "reset") => {
      const email = emailForSecondaryFlow();
      if (!email || !email.includes("@")) {
        setState({ kind: "error", message: "Enter the email address for the link." });
        return;
      }
      if (!mutation.begin()) return;
      setState({ kind: "link-submitting", purpose });
      try {
        const endpoint = purpose === "reset" ? "/api/auth/password-reset" : "/api/auth/magic-link";
        const body = purpose === "reset" ? { email } : { email, next };
        const r = await postJson<{ ok?: boolean; message?: string }>(endpoint, body);
        if (r.status === 429) {
          mutation.settle();
          setState({
            kind: "error",
            message: "Too many email requests. Wait a minute and try again.",
          });
          return;
        }
        if (!r.ok) {
          mutation.settle();
          setState({
            kind: "error",
            message: r.data?.message ?? "We couldn't send the link. Try again.",
          });
          return;
        }
        mutation.settle();
        setState({ kind: "sent", email, purpose });
      } catch (error) {
        mutation.markOutcomeUnknown();
        setState({
          kind: "unknown",
          operation: purpose === "signin" ? "signin-link" : "reset-link",
          message: unsafeMutationUnknownMessage(error, {
            timeout:
              "The delivery request timed out and may still be processing. This request is locked; refresh or change the email before sending another link.",
            transport:
              "The connection ended before delivery was confirmed. This request is locked; refresh or change the email before sending another link.",
          }),
        });
      }
    },
    [emailForSecondaryFlow, mutation, next],
  );

  const submitPassword = useCallback(
    async (evt: React.FormEvent<HTMLFormElement>) => {
      evt.preventDefault();
      const trimmed = identifier.trim();
      if (!trimmed || password.length === 0) {
        setState({ kind: "error", message: "Enter your username or email and password." });
        identifierRef.current?.focus();
        return;
      }
      if (!mutation.begin()) return;
      setState({ kind: "password-submitting" });
      try {
        const r = await postJson<{ ok?: boolean; redirectTo?: string; message?: string }>(
          "/api/auth/password-login",
          { identifier: trimmed, password, next },
        );
        if (r.status === 429) {
          mutation.settle();
          setState({ kind: "error", message: "Too many password attempts. Wait and try again." });
          return;
        }
        if (!r.ok) {
          mutation.settle();
          setState({ kind: "error", message: "Username/email or password is incorrect." });
          return;
        }
        mutation.markCommitted();
        router.push(r.data?.redirectTo ?? "/play");
        router.refresh();
      } catch (error) {
        mutation.markOutcomeUnknown();
        setState({
          kind: "unknown",
          operation: "password",
          message: unsafeMutationUnknownMessage(error, {
            timeout:
              "The sign-in request timed out and may have completed. This request is locked; refresh or change the credentials before trying again.",
            transport:
              "The connection ended before sign-in was confirmed. This request is locked; refresh or change the credentials before trying again.",
          }),
        });
      }
    },
    [identifier, mutation, next, password, router],
  );

  const clearErrorOrChangedOperation = useCallback(
    (field: "identifier" | "password" | "link-email") => {
      if (state.kind === "error") {
        setState({ kind: "idle" });
        return;
      }
      if (state.kind !== "unknown") return;
      const changesUnknownOperation =
        state.operation === "password"
          ? field === "identifier" || field === "password"
          : field === "link-email" || (field === "identifier" && linkEmail.trim() === "");
      if (!changesUnknownOperation) return;
      mutation.resetForChangedOperation();
      setState({ kind: "idle" });
    },
    [linkEmail, mutation, state],
  );

  if (state.kind === "sent") {
    return (
      <CheckYourEmail
        email={state.email}
        purpose={state.purpose}
        onChange={() => {
          setState({ kind: "idle" });
          setTimeout(() => identifierRef.current?.focus(), 0);
        }}
      />
    );
  }

  const linkSubmitting = state.kind === "link-submitting" ? state.purpose : null;

  return (
    <div
      className="signin-form"
      aria-describedby={
        state.kind === "error" || state.kind === "unknown" ? "signin-error" : undefined
      }
    >
      <form className="signin-form__section" onSubmit={submitPassword} noValidate>
        <label htmlFor={identifierId} className="signin-form__label">
          Username or email
        </label>
        <input
          ref={identifierRef}
          id={identifierId}
          type="text"
          autoComplete="username"
          required
          placeholder="manager_10 or you@example.com"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            clearErrorOrChangedOperation("identifier");
          }}
          className="signin-form__input"
          aria-invalid={state.kind === "error"}
        />

        <div className="signin-form__split-label">
          <label htmlFor={passwordId} className="signin-form__label">
            Password
          </label>
          <button
            type="button"
            className="signin-form__inline"
            onClick={() => void sendLink("reset")}
            disabled={mutation.locked}
          >
            Forgot password?
          </button>
        </div>
        <div className="signin-form__row">
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearErrorOrChangedOperation("password");
            }}
            className="signin-form__input"
          />
          <button type="submit" className="signin-form__submit" disabled={mutation.locked}>
            <span>{state.kind === "password-submitting" ? "Signing in..." : "Sign in"}</span>
          </button>
        </div>
      </form>

      <div className="signin-form__divider">
        <span>email link</span>
      </div>

      <div className="signin-form__section">
        <label htmlFor={linkEmailId} className="signin-form__label">
          Email
        </label>
        <div className="signin-form__row">
          <input
            id={linkEmailId}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={linkEmail}
            onChange={(e) => {
              setLinkEmail(e.target.value);
              clearErrorOrChangedOperation("link-email");
            }}
            className="signin-form__input"
          />
          <button
            type="button"
            className="signin-form__submit signin-form__submit--ghost"
            disabled={mutation.locked}
            onClick={() => void sendLink("signin")}
          >
            <span>{linkSubmitting === "signin" ? "Sending..." : "Send link"}</span>
          </button>
        </div>
      </div>

      {state.kind === "error" || state.kind === "unknown" ? (
        <p id="signin-error" className="signin-form__error" role="alert">
          {state.message}
          {state.kind === "unknown" ? (
            <button type="button" className="signin-form__inline" onClick={() => location.reload()}>
              Refresh to check state
            </button>
          ) : null}
        </p>
      ) : (
        <p className="signin-form__hint">
          No account yet?{" "}
          <Link
            href={`/sign-up?next=${encodeURIComponent(next)}`}
            className="signin-form__hint-link"
          >
            Create one
          </Link>
          . Email is never shown on public boards.
        </p>
      )}
    </div>
  );
}

function CheckYourEmail({
  email,
  purpose,
  onChange,
}: {
  email: string;
  purpose: "signin" | "reset";
  onChange: () => void;
}): React.ReactElement {
  return (
    <div className="signin-sent" role="status" aria-live="polite">
      <div className="signin-sent__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none">
          <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 7l9 7 9-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M16 3l1.5 2L20 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="signin-sent__h display">check your email</h2>
      <p className="signin-sent__msg">
        We sent a single-use {purpose === "reset" ? "password reset" : "sign-in"} link to{" "}
        <strong className="signin-sent__email mono">{email}</strong>.
      </p>
      {purpose === "reset" ? (
        <p className="signin-sent__hint">
          The link lands in account settings so you can set a new password.
        </p>
      ) : null}
      <p className="signin-sent__hint">
        The link expires in 15 minutes. Didn&apos;t arrive? Check spam, then{" "}
        <button type="button" onClick={onChange} className="signin-sent__again">
          try a different email
        </button>
        .
      </p>
    </div>
  );
}
