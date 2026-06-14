import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

// Themed 404. Replaces Next's bare default not-found page so a user who hits a
// dead URL (or a route gated off, e.g. a disabled surface) gets a branded page
// with a clear path back into the app instead of an unstyled dead end.
export default function NotFound() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">404</span>
        <h1 className="display">Off the pitch</h1>
        <p className="lede">
          We couldn&rsquo;t find that page. It may have moved, or the link was a mis&#8209;kick.
        </p>
      </header>
      <div className="btn-row">
        <Link href="/" className="btn btn--primary">
          Home
        </Link>
        <Link href="/play" className="btn btn--ghost">
          Play
        </Link>
      </div>
    </div>
  );
}
