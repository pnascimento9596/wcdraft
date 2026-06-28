import type { Metadata } from "next";
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
    </div>
  );
}
