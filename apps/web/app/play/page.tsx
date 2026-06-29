import type { Metadata } from "next";
import Link from "next/link";
import { ModeSelect } from "../../components/game/mode-select";

export const metadata: Metadata = {
  title: "Choose a mode",
  description:
    "Pick a wcdraft game mode — Classic with ratings visible, or the hidden Memory mode.",
};

export default function ModeSelectPage() {
  return (
    <div className="container page game-page game-page--mode">
      <header className="page-head">
        <span className="eyebrow">New draft</span>
        <h1 className="display">Choose your mode</h1>
        {/* ws-ux/mobile-polish-2: subtitle + pool note merged into one line —
            the header must leave both mode cards visible in a ~390×664
            viewport with zero scroll. */}
        <p className="lede">
          Seventeen spins, one all-time XI — live on the real 1930–2026 pool, all in your browser.
        </p>
      </header>

      <p className="lede">
        <Link href="/play/daily" className="btn btn--primary">
          Today's Draft
        </Link>
      </p>

      <ModeSelect />
    </div>
  );
}
