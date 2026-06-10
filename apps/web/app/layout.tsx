import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Anton, Newsreader } from "next/font/google";
import { ThemeProvider } from "../components/theme-provider";
import { AuthProvider } from "../components/auth-context";
import { SiteHeader } from "../components/site-header";
import { isAuthEnabled } from "../lib/auth/auth-enabled";
import { isLeaderboardEnabled } from "../lib/leaderboard/enabled";
import { SiteFooter } from "../components/site-footer";
import { ServiceWorkerRegister } from "../components/sw-register";
import "./ds/tokens.css";
import "./globals.css";

const display = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const text = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-text",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://wcdraft.app"),
  title: {
    default: "wcdraft — draft your all-time World Cup XI",
    template: "%s · wcdraft",
  },
  description:
    "wcdraft is a football drafting game: spin a random national team and tournament year, pick one player per spin, lock a formation, and chase the perfect 8-match run.",
  applicationName: "wcdraft",
  appleWebApp: {
    capable: true,
    title: "wcdraft",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "wcdraft — draft your all-time World Cup XI",
    description: "A football drafting game. Spin, pick, build your XI, and chase the perfect run.",
    siteName: "wcdraft",
    type: "website",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efe9db" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1411" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Ship-dark gate — computed server-side so the client never has to
  // round-trip /api/auth/config on first paint. Setting RESEND_API_KEY +
  // AUTH_EMAIL_FROM in the Vercel env flips this true.
  const authEnabled = isAuthEnabled();
  // F-4 U4 — same ship-dark pattern for the leaderboard nav entry: the env
  // is read server-side here; when dark the entry simply doesn't exist.
  const leaderboardEnabled = isLeaderboardEnabled();
  return (
    <html lang="en" data-theme="light" className={`${display.variable} ${text.variable}`}>
      <body>
        <ThemeProvider>
          <AuthProvider authEnabled={authEnabled}>
            <a className="skip-link" href="#main">
              Skip to content
            </a>
            <div className="shell">
              <SiteHeader leaderboardEnabled={leaderboardEnabled} />
              <main id="main">{children}</main>
              <SiteFooter />
            </div>
          </AuthProvider>
        </ThemeProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
