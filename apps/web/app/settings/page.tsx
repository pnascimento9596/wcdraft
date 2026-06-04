import type { Metadata } from "next";
import { ThemeSetting } from "../../components/theme-setting";

export const metadata: Metadata = {
  title: "Settings",
  description: "Adjust your wcdraft preferences. Theme is the only live control for now.",
};

export default function SettingsPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">Preferences</span>
        <h1 className="display">Settings</h1>
        <p className="lede">
          Theme is the only live control for now. More settings unlock as the game comes online.
        </p>
        <p className="page-head__note">
          Your theme choice lives in this session only — it isn&rsquo;t saved to your device.
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

      <div className="setting">
        <div className="setting__label">
          <b>Account</b>
          <span>Sign-in and profile options.</span>
        </div>
        <div className="setting__control">
          <span className="tag-soon">Coming soon</span>
        </div>
      </div>

      <div className="setting">
        <div className="setting__label">
          <b>Notifications</b>
          <span>Run reminders and leaderboard updates.</span>
        </div>
        <div className="setting__control">
          <span className="tag-soon">Coming soon</span>
        </div>
      </div>

      <div className="setting">
        <div className="setting__label">
          <b>Ad-free upgrade</b>
          <span>One-time purchase to remove ads.</span>
        </div>
        <div className="setting__control">
          <span className="tag-soon">Coming soon</span>
        </div>
      </div>
    </div>
  );
}
