import type { Metadata } from "next";
import { ModeSelect } from "../../components/game/mode-select";

export const metadata: Metadata = {
  title: "Choose a mode",
  description:
    "Pick a wcdraft game mode — start with Daily or Classic, then try the blind Memory reveal.",
};

export default function ModeSelectPage() {
  return (
    <div className="container page game-page game-page--mode">
      <header className="page-head">
        <span className="eyebrow">New draft</span>
        <h1 className="display">Choose your mode</h1>
        <p className="lede">
          Seventeen spins, one all-time XI — live on the real 1930–2026 pool, all in your browser.
        </p>
      </header>

      <ModeSelect />
    </div>
  );
}
