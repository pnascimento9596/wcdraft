import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the wcdraft team.",
};

export default function ContactPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">Say hello</span>
        <h1 className="display">Contact</h1>
        <p className="lede">
          Questions, bug reports, feedback, or press — here&rsquo;s how to reach the wcdraft team.
        </p>
      </header>

      <div className="contact-grid">
        <div className="contact-card">
          <span className="eyebrow">General &amp; support</span>
          <a href="mailto:hello@wcdraft.app">hello@wcdraft.app</a>
          <p>Use this for support, bug reports, feedback, press, or partnership notes.</p>
        </div>

        <div className="contact-card">
          <span className="eyebrow">Privacy &amp; data requests</span>
          <a href="mailto:privacy@wcdraft.app">privacy@wcdraft.app</a>
          <p>Use this for privacy questions, access, correction, deletion, or export requests.</p>
        </div>
      </div>
    </div>
  );
}
