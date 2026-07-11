import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How wcdraft handles account, gameplay, local browser, leaderboard, share, and technical data.",
};

export default function PrivacyPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">Legal</span>
        <h1 className="display">Privacy Policy</h1>
        <p className="page-head__note">Effective date: July 11, 2026.</p>
        <p className="lede">
          This policy describes what the current wcdraft website and game collect, process, and
          store. If the product changes, we will update this page so the policy matches the code
          that is running.
        </p>
      </header>

      <div className="prose">
        <h2>What we collect</h2>
        <p>
          wcdraft collects the information needed to run drafts, save and replay runs, keep
          leaderboards honest, and secure sign-in.
        </p>
        <ul>
          <li>
            <strong>Account and sign-in data.</strong> If you create an account, we store your
            email, public username, password hash, password-set timestamp, and email verification
            timestamp when verification is complete. If you request a magic-link sign-in,
            verification link, or password reset, we store the submitted email address with the
            magic-link record. Magic-link flows also use a purpose, delivery outcome, PII-free
            correlation id, token hash, expiry time, consumed time, session identifier, CSRF secret,
            and session expiry so the link can be single-use and your session can stay secure.
            Password sign-in verifies against the stored password hash.
          </li>
          <li>
            <strong>Gameplay and history data.</strong> Draft runs can include the run id, parent
            seed, version anchors, squad, manager, match results, score summary, share token, claim
            state, and timestamps. Runs are saved locally in this browser. Completed runs may also
            be mirrored to the server under an anonymous session or a signed-in account so history,
            claiming, and replay can work across the site.
          </li>
          <li>
            <strong>Leaderboard data.</strong> When you post a result, we store the season, board
            mode, draft mode, display name, run token, verified score, score breakdown, account or
            session link, and timestamps.
          </li>
          <li>
            <strong>Share links.</strong> Share URLs contain a self-contained run token. Anyone you
            give the link to can use that token to replay the run summary encoded in the URL.
          </li>
          <li>
            <strong>Security and technical data.</strong> Sign-in and leaderboard submission use
            rate limits based on hashed email, IP, or session buckets. Our hosting provider may
            process standard request and server logs such as IP address, browser details, requested
            URLs, and timestamps. Vercel may also process performance-only Web Vitals measurements;
            wcdraft does not use those measurements for advertising or behavior profiles.
          </li>
        </ul>

        <h2>What we do not collect</h2>
        <p>wcdraft does not collect or process these categories in the current product:</p>
        <ul>
          <li>Plaintext passwords.</li>
          <li>Third-party or social sign-in identifiers.</li>
          <li>Payment details, billing records, or paid entitlements.</li>
          <li>Ad targeting profiles, ad cookies, or ad delivery data.</li>
          <li>Product-behavior analytics, marketing tracker events, or advertising profiles.</li>
          <li>Player photos, likeness rights, or biometric data.</li>
        </ul>

        <h2>Cookies and local storage</h2>
        <p>
          wcdraft uses same-site application cookies for sessions and protected actions:{" "}
          <code>wcdraft_sid</code> for the session, <code>wcdraft_csrf</code> for CSRF protection, a
          short-lived <code>wcdraft_bootstrap</code> proof before the first mutation, and a
          short-lived <code>wcdraft_recent_magic</code> proof after a completed email-link sign-in.
          Session and proof cookies are HTTP-only where browser JavaScript does not need them; all
          are marked secure in production.
        </p>
        <p>
          The game also uses browser local storage for recent local runs, the run history index, a
          local run counter, the last leaderboard display name, last submitted leaderboard token,
          and the Synergy panel preference. Clearing browser data removes local records from that
          browser. It does not delete server-saved runs, account sessions, or leaderboard entries.
        </p>

        <h2>How we use information</h2>
        <ul>
          <li>
            To send sign-in, verification, and password-reset emails and keep sessions secure.
          </li>
          <li>To run drafts, score tournament results, save history, and replay share links.</li>
          <li>To verify and display leaderboard submissions.</li>
          <li>
            To prevent abuse, rate-limit sensitive actions, investigate failures, and debug the
            service.
          </li>
        </ul>

        <h2>Service providers</h2>
        <p>wcdraft relies on service providers that process data only as needed to run the site:</p>
        <ul>
          <li>
            <strong>Vercel</strong> hosts the website and may process request/server logs and
            performance-only Web Vitals measurements.
          </li>
          <li>
            <strong>Neon Postgres</strong> stores account, session, run, leaderboard, and rate-limit
            data. The application accesses that database through Drizzle.
          </li>
          <li>
            <strong>Resend</strong> processes your email address and magic-link email content when
            we send sign-in, verification, or password-reset links.
          </li>
        </ul>

        <h2>Retention and deletion</h2>
        <p>
          Magic links expire quickly and are single-use. Session cookies expire automatically.
          Browser runs stay in local storage until you clear browser data or the app evicts old
          local records. Anonymous server history keeps the 5 most recent unpinned runs. Signed-in
          account history is capped at 500 rows and 8 MiB; when a cap is crossed, the oldest
          unpinned rows are removed deterministically. Leaderboard entries may remain visible as
          season standings unless they are removed for moderation, security, or a valid privacy
          request.
        </p>
        <p>
          Clearing browser data removes local browser copies. It does not remove a run that was
          already saved to the server, posted to the leaderboard, or shared with someone else.
          Deleting an account from Account deletes that account's sessions, saved runs, and
          account-owned leaderboard rows. A share URL already given to someone remains a copy in
          that recipient's possession. Contact us if you want help with access, correction,
          deletion, or export.
        </p>

        <h2>Data attribution</h2>
        <p>
          wcdraft uses football data derived from public sources under the terms described on the{" "}
          <Link href="/attribution">attribution page</Link>, including CC BY-SA source attribution.
          The app uses names and statistical records to power gameplay; it does not store or display
          player photos.
        </p>

        <h2>Contact and privacy requests</h2>
        <p>
          Questions about this policy or your data? Reach us via the{" "}
          <Link href="/contact">contact page</Link>. We will update this page when the product
          changes in ways that affect what data is collected, processed, or retained.
        </p>
      </div>
    </div>
  );
}
