import type { Metadata } from "next";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";
import "../sign-in/sign-in.css";
import { SignUpForm } from "./sign-up-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a wcdraft account with a username, email, and password.",
  robots: { index: false, follow: false },
};

export default function SignUpPage(): React.ReactElement {
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
          <h1 className="signin-screen__title display">create account</h1>
          <p className="signin-screen__sub">
            Pick the public username boards can show, then verify email before ranked posts. Casual
            play works right away.
          </p>
        </header>

        {authEnabled ? <SignUpForm /> : <DisabledNotice />}
      </div>
    </section>
  );
}

function DisabledNotice(): React.ReactElement {
  return (
    <div className="signin-screen__disabled" role="status" aria-live="polite">
      <span className="signin-screen__disabled-tag">unavailable</span>
      <p>
        Account creation is not available in this deployment. You can still draft and keep anonymous
        runs in this browser when storage is available.
      </p>
    </div>
  );
}
