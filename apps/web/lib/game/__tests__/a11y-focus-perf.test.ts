// Bounded platform follow-ups: a11y focus wiring, live-region consolidation,
// and CandidateCard render-skip wiring. These components are client-heavy, so
// this file combines static React markup checks with source probes matching the
// existing web test style.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SpinStage,
  skipSpinAnimState,
  spinEraRangeLabel,
} from "@/components/game/slot-machine";
import type { SlotRevealFace, SlotRevealModel, SlotRevealReel } from "../slot-reveal";

function face(nationName: string, yearLabel: string, key: string): SlotRevealFace {
  return {
    key,
    nationId: key,
    nationName,
    nationCode: nationName.slice(0, 3).toUpperCase(),
    flagSrc: null,
    flagLabel: `${nationName} flag`,
    yearLabel,
  };
}

function reel(key: SlotRevealReel["key"], landingFace: SlotRevealFace): SlotRevealReel {
  return { key, landingFace, trackFaces: [landingFace] };
}

function rareModel(): SlotRevealModel {
  const left = face("Brazil", "1994", "left");
  const center = face("France", "1998", "center");
  const right = face("Germany", "2002", "right");
  return {
    pickLabel: "PICK 01 OF 17",
    resultLine: "SPIN RESULT — France 1998",
    result: center,
    reels: [reel("left", left), reel("center", center), reel("right", right)],
    rare: true,
    drawProbability: 0.042,
    drawProbabilityLabel: "4.2%",
    eraPresetLabel: null,
  };
}

describe("a11y follow-ups", () => {
  it("spin result, tagline, and rare message share one live region", () => {
    const html = renderToStaticMarkup(
      createElement(SpinStage, {
        model: rareModel(),
        pickNumber: 1,
        totalPicks: 17,
        formationId: "4-3-3",
        synergyOverall: 42,
        synergyMultiplier: 1.04,
        playerPoolCount: 23,
        modeLabel: "Classic",
        modeCue: "Ranked-capable",
        pickSpace: "3-player choice",
        anim: "settled",
        onSpin: () => undefined,
        onSettle: () => undefined,
        onSkip: () => undefined,
        onReveal: () => undefined,
        canSkip: false,
        showSkipHint: false,
      }),
    );

    expect(html.match(/aria-live="polite"/g)?.length).toBe(1);
    expect(html).toContain("Rare pick. Draw probability 4.2%.");
    expect(html).not.toContain('role="status"');
  });

  it("account menu and slot picker carry focus trap, restore, and Escape wiring", () => {
    const accountMenu = readFileSync(
      new URL("../../../components/account-menu.tsx", import.meta.url),
      "utf8",
    );
    const draftScreen = readFileSync(
      new URL("../../../components/game/draft-screen/index.tsx", import.meta.url),
      "utf8",
    );

    expect(accountMenu).toContain("trapTabWithin(e, menuRef.current)");
    expect(accountMenu).toContain("restoreFocusRef");
    expect(accountMenu).toContain('aria-controls="account-menu-popover"');
    expect(accountMenu).toContain('e.key === "Escape"');

    expect(draftScreen).toContain('aria-modal="true"');
    expect(draftScreen).toContain("trapTabWithin(event, sheetRef.current)");
    expect(draftScreen).toContain("sheetRestoreFocusRef");
    expect(draftScreen).toContain("lineupHeadingRef.current?.focus");
    expect(draftScreen).toContain('event.key === "Escape"');
  });

  it("uses range vocabulary for the spin ERA chip", () => {
    expect(spinEraRangeLabel("2002")).toBe("ERA 2002–13");
    expect(spinEraRangeLabel("2022")).toBe("ERA 2022–26");
    expect(spinEraRangeLabel("2026")).toBe("ERA 2026");
  });

  it("spin skip only settles the existing deterministic reveal", () => {
    expect(skipSpinAnimState("spinning", true)).toBe("settled");
    expect(skipSpinAnimState("spinning", false)).toBe("spinning");
    expect(skipSpinAnimState("idle", true)).toBe("idle");
    expect(skipSpinAnimState("settled", true)).toBe("settled");

    const draftScreen = readFileSync(
      new URL("../../../components/game/draft-screen/index.tsx", import.meta.url),
      "utf8",
    );
    expect(draftScreen).toContain("skipSpinAnimState(current, spinSkipReady)");
    expect(draftScreen).toContain("canSkip={spinSkipReady}");
  });
});

describe("CandidateCard render-skip wiring", () => {
  it("memoizes row components and removes parent inline selection closures", () => {
    const candidateCard = readFileSync(
      new URL("../../../components/game/candidate-card.tsx", import.meta.url),
      "utf8",
    );
    const draftScreen = readFileSync(
      new URL("../../../components/game/draft-screen/index.tsx", import.meta.url),
      "utf8",
    );

    expect(candidateCard).toContain("export const CandidateCard = memo");
    expect(candidateCard).toContain("export const ManagerCandidate = memo");
    expect(candidateCard).toContain("onSelect: (card: PlayerCardView) => void");
    expect(candidateCard).toContain("onSelect: (manager: ManagerCardView) => void");

    expect(draftScreen).toContain("const selectPlayer = useCallback");
    expect(draftScreen).toContain("const selectManager = useCallback");
    expect(draftScreen).not.toContain("onSelect={() => selectPlayer(card)}");
    expect(draftScreen).not.toContain("onSelect={() => selectManager");
  });
});
