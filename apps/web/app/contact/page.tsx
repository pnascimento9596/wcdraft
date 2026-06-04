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
        </div>

        <div className="contact-card">
          <span className="eyebrow">Privacy &amp; data requests</span>
          <a href="mailto:privacy@wcdraft.app">privacy@wcdraft.app</a>
        </div>

        <div className="contact-card">
          <span className="eyebrow">Social</span>
          <span className="placeholder">Handles coming soon</span>
        </div>

        <div className="contact-card">
          <span className="eyebrow">Community</span>
          <span className="placeholder">Community links coming soon</span>
        </div>
      </div>

      <div className="callout">
        <p>
          Contact details are placeholders for the shell milestone and will be confirmed before
          launch.
        </p>
      </div>
    </div>
  );
}
