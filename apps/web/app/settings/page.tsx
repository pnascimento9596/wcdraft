import type { Metadata } from "next";
import { ThemeSetting } from "../../components/theme-setting";

export const metadata: Metadata = {
  title: "Settings",
  description: "Choose your wcdraft display theme.",
};

export default function SettingsPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">Preferences</span>
        <h1 className="display">Settings</h1>
        <p className="lede">Choose the display theme for this session.</p>
        <p className="page-head__note">
          Your theme choice lives in memory for this browser tab; it resets when the page reloads.
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
