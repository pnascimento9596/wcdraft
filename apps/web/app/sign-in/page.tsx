// F-3.5 — /sign-in
//
// Server Component shell. Ship-dark gate: when auth is disabled this page
// renders a "coming soon" notice instead of an unusable form (no broken
// "I never received an email" flow in production). The actual form lives
// in the SignInForm client component.
import type { Metadata } from "next";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";
import "./sign-in.css";
import { SignInForm } from "./sign-in-form";

// F-3.5 — force dynamic rendering so the ship-dark gate reflects the
// LIVE env vars at request time, not whatever was set at build time.
// Static prerender would bake a stale `authEnabled = false` into the HTML.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to wcdraft to save your runs, surface your history, and chase the perfect 8-0.",
  robots: { index: false, follow: false },
};

export default function SignInPage(): React.ReactElement {
  const authEnabled = isAuthEnabled();
  return (
    <section className="signin-screen">
      <div className="signin-screen__rule" aria-hidden="true" />
      <div className="signin-screen__inner">
        <header className="signin-screen__hd">
          <div className="signin-screen__eyebrow">
            <span className="signin-screen__dot" aria-hidden="true" />
            <span>your account</span>
          </div>
          <h1 className="signin-screen__title display">
            sign&nbsp;in
          </h1>
          <p className="signin-screen__sub">
            We&rsquo;ll email a single&#8209;use link. No password, no rate of decay&nbsp;&mdash; just the run you&rsquo;ll come back for.
          </p>
        </header>

        {authEnabled ? (
          <SignInForm />
        ) : (
          <DisabledNotice />
        )}

        <ul className="signin-screen__crumbs" aria-label="What sign in gets you">
          <li>
            <span className="signin-screen__crumb-num">01</span>
            Your saved runs travel with you on every device.
          </li>
          <li>
            <span className="signin-screen__crumb-num">02</span>
            The run you saved before sign&#8209;in is claimed to your account.
          </li>
          <li>
            <span className="signin-screen__crumb-num">03</span>
            Email is the only PII. No tracking, no profile fluff.
          </li>
        </ul>
      </div>
    </section>
  );
}

function DisabledNotice(): React.ReactElement {
  return (
    <div className="signin-screen__disabled" role="status" aria-live="polite">
      <span className="signin-screen__disabled-tag">soon</span>
      <p>
        Sign&#8209;in goes live once <code>RESEND_API_KEY</code> +{" "}
        <code>AUTH_EMAIL_FROM</code> + <code>AUTH_BASE_URL</code> are configured
        in the deployment. Your anonymous runs keep saving locally in the meantime.
      </p>
    </div>
  );
}
