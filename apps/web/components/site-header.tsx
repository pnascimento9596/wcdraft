"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { CloseIcon, MenuIcon } from "./icons";
import { AccountMenu } from "./account-menu";
import { useTheme } from "./theme-provider";

export interface MenuItem {
  readonly href: string;
  readonly label: string;
}

/**
 * F-4 U4 — menu derivation. The Leaderboard entry exists only when the
 * server says the feature is live (layout reads LEADERBOARD_ENABLED; no
 * NEXT_PUBLIC_ mirror) — when dark there is no dead link anywhere.
 */
export function buildMenu(opts: { leaderboardEnabled: boolean }): MenuItem[] {
  return [
    { href: "/play", label: "Play" },
    { href: "/play/daily", label: "Daily" },
    { href: "/play/history", label: "History" },
    ...(opts.leaderboardEnabled ? [{ href: "/leaderboard", label: "Leaderboard" }] : []),
    { href: "/how-to-play", label: "How to Play" },
    { href: "/settings", label: "Settings" },
    { href: "/privacy", label: "Privacy Policy" },
  ];
}

export function SiteHeader({
  leaderboardEnabled = false,
  buildStamp = "dev",
}: {
  leaderboardEnabled?: boolean;
  /** Build identifier (short SHA · date, or "dev") — computed server-side in
      the root layout from VERCEL_GIT_COMMIT_SHA; see lib/build-stamp.ts. */
  buildStamp?: string;
}) {
  const menu = buildMenu({ leaderboardEnabled });
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { theme } = useTheme();
  const markSrc = theme === "light" ? "/brand/wcdraft-mark-light.svg" : "/brand/wcdraft-mark.svg";

  // Close the mobile menu on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="masthead">
      <div className="container masthead__inner">
        {/* Canonical wcdraft mark — gold tactical pitch + draft arrow.
            Source: apps/web/public/brand/wcdraft-mark*.svg. The light variant
            is the same geometry with deeper gold-family stops for the pale
            masthead. Never redraw inline. */}
        <Link href="/" className="wordmark" aria-label="wcdraft — home">
          <Image src={markSrc} alt="" width={32} height={35} priority className="wordmark__badge" />
          <span className="wordmark__text">
            wc<b>draft</b>
          </span>
        </Link>

        <nav className="nav-desktop" aria-label="Primary">
          {menu.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <ThemeToggle />

        {/* F-3.5 — live account menu. Ship-dark gate hides this when the
            email sender or public auth base URL is not configured. */}
        <AccountMenu />

        <button
          type="button"
          className="icon-btn menu-toggle"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon width={22} height={22} /> : <MenuIcon width={22} height={22} />}
        </button>
      </div>

      <nav id="mobile-menu" className="mobile-menu" aria-label="Menu" hidden={!open}>
        <div className="container">
          <ul className="mobile-menu__list">
            {menu.map((item, i) => (
              <li key={item.href}>
                <Link href={item.href} className="mobile-menu__link">
                  <span className="mobile-menu__num">{String(i + 1).padStart(2, "0")}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mobile-menu__signin">
            <AccountMenu />
          </div>
          {/* Build stamp — lets a real device be checked against the deploy
              it should be serving (the SW is cache-first). */}
          <p className="mobile-menu__footer">build {buildStamp}</p>
        </div>
      </nav>
    </header>
  );
}
