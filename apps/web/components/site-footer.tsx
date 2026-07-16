import Link from "next/link";
import { LegalDisclosure } from "./legal-disclosure";

/**
 * Footer carries three non-negotiable items:
 *  1. exact CC-BY-SA data attribution for the Fjelstul World Cup Database,
 *  2. the not-affiliated disclaimer,
 *  3. the How to Play · Privacy Policy · Contact links.
 * The attribution and disclaimer strings are reproduced verbatim — do not edit.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          wc<span style={{ color: "var(--footer-wordmark-accent)" }}>draft</span>
        </div>

        <nav aria-label="Footer">
          <ul className="site-footer__links">
            <li>
              <Link href="/how-to-play">How to Play</Link>
            </li>
            <li aria-hidden="true" className="site-footer__sep">
              ·
            </li>
            <li>
              <Link href="/privacy">Privacy Policy</Link>
            </li>
            <li aria-hidden="true" className="site-footer__sep">
              ·
            </li>
            <li>
              <Link href="/contact">Contact</Link>
            </li>
          </ul>
        </nav>

        <LegalDisclosure className="site-footer__fine" />
      </div>
    </footer>
  );
}
