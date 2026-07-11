import type { Metadata } from "next";
import Link from "next/link";
import { ThemeSetting } from "../../components/theme-setting";

export const metadata: Metadata = {
  title: "Settings",
  description: "Choose your wcdraft display theme.",
  robots: { index: false, follow: true },
};

export default function SettingsPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">Preferences</span>
        <h1 className="display">Settings</h1>
        <p className="lede">Choose the display theme for this browser.</p>
        <p className="page-head__note">
          Without a saved choice, wcdraft follows your system theme.
        </p>
      </header>

      <div className="setting">
        <div className="setting__label">
          <b>Theme</b>
          <span>Switch between light and dark.</span>
        </div>
        <div className="setting__control">
          <ThemeSetting />
        </div>
      </div>

      <section className="settings-data" aria-labelledby="your-data-title">
        <h2 id="your-data-title">Your data</h2>
        <p>Runs in this browser are saved locally on this device.</p>
        <p>Completed runs may also be mirrored to the server for history and replay.</p>
        <p>Signed-in Account history follows your account across browsers.</p>
        <p>Leaderboard posts are public season standings and may remain visible.</p>
        <p>Clearing browser data does not delete server history or leaderboard posts.</p>
        <div className="settings-data__links">
          <Link href="/privacy">Read the Privacy Policy</Link>
          <Link href="/account">Manage Account data</Link>
        </div>
      </section>
    </div>
  );
}
