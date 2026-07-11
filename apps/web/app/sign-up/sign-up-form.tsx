"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ensureCsrfToken, postJson } from "@/lib/auth/client";
import { unsafeMutationUnknownMessage, useUnsafeMutationLatch } from "@/lib/unsafe-mutation";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "created" };

export function SignUpForm(): React.ReactElement {
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const mutation = useUnsafeMutationLatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/account";

  useEffect(() => {
    void ensureCsrfToken().catch(() => {
      /* submit path surfaces the failure */
    });
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!mutation.begin()) return;
    setState({ kind: "submitting" });
    try {
      const response = await postJson<{
        ok?: boolean;
        redirectTo?: string;
        message?: string;
        username_reason?: string;
      }>("/api/auth/sign-up", {
        username,
        email,
        password,
        next,
      });
      if (!response.ok) {
        mutation.settle();
        setState({
          kind: "error",
          message: response.data?.message ?? "Account could not be created.",
        });
        return;
      }
      mutation.markCommitted();
      setState({ kind: "created" });
      router.push(response.data?.redirectTo ?? "/account");
      router.refresh();
    } catch (error) {
      mutation.markOutcomeUnknown();
      setState({
        kind: "unknown",
        message: unsafeMutationUnknownMessage(error, {
          timeout:
            "The account request timed out and may have completed. This request is locked; refresh, sign in, or change the account details before trying again.",
          transport:
            "The connection ended before account creation was confirmed. This request is locked; refresh, sign in, or change the account details before trying again.",
        }),
      });
    }
  }

  return (
    <form className="signin-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="signin-form__section">
        <label htmlFor={usernameId} className="signin-form__label">
          Username
        </label>
        <input
          id={usernameId}
          className="signin-form__input"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            mutation.resetForChangedOperation();
            if (state.kind === "error" || state.kind === "unknown") setState({ kind: "idle" });
          }}
          autoComplete="username"
          placeholder="manager_10"
          minLength={3}
          maxLength={20}
          required
        />
      </div>

      <div className="signin-form__section">
        <label htmlFor={emailId} className="signin-form__label">
          Email
        </label>
        <input
          id={emailId}
          className="signin-form__input"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            mutation.resetForChangedOperation();
            if (state.kind === "error" || state.kind === "unknown") setState({ kind: "idle" });
          }}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </div>

      <div className="signin-form__section">
        <label htmlFor={passwordId} className="signin-form__label">
          Password
        </label>
        <input
          id={passwordId}
          className="signin-form__input"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            mutation.resetForChangedOperation();
            if (state.kind === "error" || state.kind === "unknown") setState({ kind: "idle" });
          }}
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </div>

      <button type="submit" className="signin-form__submit" disabled={mutation.locked}>
        {state.kind === "submitting" ? "Creating..." : "Create account"}
      </button>

      {state.kind === "error" || state.kind === "unknown" ? (
        <p id="signup-error" className="signin-form__error" role="alert">
          {state.message}
          {state.kind === "unknown" ? (
            <button type="button" className="signin-form__inline" onClick={() => location.reload()}>
              Refresh to check state
            </button>
          ) : null}
        </p>
      ) : (
        <p className="signin-form__hint">
          Already have an account?{" "}
          <Link
            href={`/sign-in?next=${encodeURIComponent(next)}`}
            className="signin-form__hint-link"
          >
            Sign in
          </Link>
          .
        </p>
      )}
    </form>
  );
}
