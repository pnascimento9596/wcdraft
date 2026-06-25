"use client";

// F-3.5 — sign-in form (client component).
//
// The submit flow:
//   1. ensureCsrfToken() bootstraps the anon session if needed.
//   2. POST /api/auth/magic-link { email } — server hashes the token,
//      logs (LogEmailSender) or sends (ResendEmailSender) a single-use
//      link to the user's email.
//   3. On 200 → "check your email" panel; on 4xx → inline error.
//   4. The clicked link lands on F-2's prefetch-safe verify interstitial.
//
// Honest-state:
//   - We DO NOT echo whether the email is registered (no enumeration).
//   - Rate-limited responses (429) surface as "give us a minute".
//   - Errors keep the email in the input so the user can retry.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { postJson, ensureCsrfToken } from "@/lib/auth/client";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export function SignInForm(): React.ReactElement {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  // Eagerly bootstrap the csrf cookie on mount — the first POST is then
  // already-warm so the perceived latency on "send link" is just the
  // single API call.
  useEffect(() => {
    void ensureCsrfToken().catch(() => {
      /* honest-state — surface only at submit time */
    });
  }, []);

  const submit = useCallback(
    async (evt: React.FormEvent<HTMLFormElement>) => {
      evt.preventDefault();
      const trimmed = email.trim();
      if (!trimmed || !trimmed.includes("@")) {
        setState({ kind: "error", message: "Enter the email you want to sign in with." });
        inputRef.current?.focus();
        return;
      }
      setState({ kind: "submitting" });
      try {
        const r = await postJson<{ ok?: boolean; error?: string; message?: string }>(
          "/api/auth/magic-link",
          { email: trimmed },
        );
        if (r.status === 429) {
          setState({
            kind: "error",
            message: "Too many requests for this email. Wait a minute and try again.",
          });
          return;
        }
        if (!r.ok) {
          setState({
            kind: "error",
            message: r.data?.message ?? "We couldn't send the link. Try again.",
          });
          return;
        }
        setState({ kind: "sent", email: trimmed });
      } catch {
        setState({
          kind: "error",
          message: "Network hiccup. Try again — your email isn't saved yet.",
        });
      }
    },
    [email],
  );

  if (state.kind === "sent") {
    return (
      <CheckYourEmail
        email={state.email}
        onChange={() => {
          setState({ kind: "idle" });
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      />
    );
  }

  return (
    <form
      className="signin-form"
      onSubmit={submit}
      noValidate
      aria-describedby={state.kind === "error" ? "signin-error" : undefined}
    >
      <label htmlFor={emailId} className="signin-form__label">
        Email
      </label>
      <div className="signin-form__row">
        <input
          ref={inputRef}
          id={emailId}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="you@somewhere.fm"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state.kind === "error") setState({ kind: "idle" });
          }}
          className="signin-form__input"
          aria-invalid={state.kind === "error"}
        />
        <button
          type="submit"
          className="signin-form__submit"
          disabled={state.kind === "submitting"}
        >
          <span>{state.kind === "submitting" ? "Sending…" : "Send link"}</span>
          <span className="signin-form__submit-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>
      {state.kind === "error" ? (
        <p id="signin-error" className="signin-form__error" role="alert">
          {state.message}
        </p>
      ) : (
        <p className="signin-form__hint">
          By signing in you agree to wcdraft&rsquo;s{" "}
          <a href="/privacy" className="signin-form__hint-link">
            privacy policy
          </a>
          .
        </p>
      )}
    </form>
  );
}

function CheckYourEmail({
  email,
  onChange,
}: {
  email: string;
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
        We sent a single&#8209;use sign&#8209;in link to{" "}
        <strong className="signin-sent__email mono">{email}</strong>. Open it on this device to
        finish.
      </p>
      <p className="signin-sent__hint">
        The link expires in 15 minutes. Didn&rsquo;t arrive? Check spam, then{" "}
        <button type="button" onClick={onChange} className="signin-sent__again">
          try a different email
        </button>
        .
      </p>
    </div>
  );
}
