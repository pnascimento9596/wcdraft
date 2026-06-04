"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { BallBadge, CloseIcon, MenuIcon } from "./icons";

const MENU = [
  { href: "/play", label: "Play" },
  { href: "/how-to-play", label: "How to Play" },
  { href: "/settings", label: "Settings" },
  { href: "/privacy", label: "Privacy Policy" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="masthead">
      <div className="container masthead__inner">
        <Link href="/" className="wordmark" aria-label="wcdraft — home">
          <BallBadge className="wordmark__badge" />
          <span className="wordmark__text">
            wc<b>draft</b>
          </span>
        </Link>

        <nav className="nav-desktop" aria-label="Primary">
          {MENU.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <ThemeToggle />

        {/* Visual-only sign-in slot — no auth wired up yet. */}
        <button
          type="button"
          className="signin-stub"
          aria-disabled="true"
          title="Sign-in coming soon"
        >
          <span className="signin-stub__dot" aria-hidden="true" />
          Sign in
        </button>

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
            {MENU.map((item, i) => (
              <li key={item.href}>
                <Link href={item.href} className="mobile-menu__link">
                  <span className="mobile-menu__num">{String(i + 1).padStart(2, "0")}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mobile-menu__signin">Sign-in coming soon</div>
        </div>
      </nav>
    </header>
  );
}
