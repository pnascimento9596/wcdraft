import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Anton, Newsreader } from "next/font/google";
import { ThemeProvider } from "../components/theme-provider";
import { SiteHeader } from "../components/site-header";
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
  return (
    <html lang="en" data-theme="light" className={`${display.variable} ${text.variable}`}>
      <body>
        <ThemeProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <div className="shell">
            <SiteHeader />
            <main id="main">{children}</main>
            <SiteFooter />
          </div>
        </ThemeProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
