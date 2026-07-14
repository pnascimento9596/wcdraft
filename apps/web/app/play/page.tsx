import type { Metadata } from "next";
import { ModeSelect } from "../../components/game/mode-select";
import pageStyles from "./play-page.module.css";

export const metadata: Metadata = {
  title: "Choose a mode",
  description:
    "Pick a wcdraft game mode. Start with Daily or Classic, then try the blind Memory reveal.",
};

export default function ModeSelectPage() {
  return (
    <div className={`container page game-page game-page--mode ${pageStyles.page}`}>
      <header className={`page-head ${pageStyles.pageHead}`}>
        <span className="eyebrow">New draft</span>
        <h1 className={`display ${pageStyles.title}`}>Choose your mode</h1>
        <p className={`lede ${pageStyles.lede}`}>
          Seventeen spins, one all-time XI. Play live on the real 1930–2026 pool, all in your
          browser.
        </p>
      </header>

      <ModeSelect />
    </div>
  );
}
