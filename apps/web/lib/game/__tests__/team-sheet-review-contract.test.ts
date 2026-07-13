import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("../../../components/game/review-screen.tsx", import.meta.url),
  "utf8",
);

describe("team-sheet review contract", () => {
  it("reveals Memory and Blind Open information before arrangement", () => {
    expect(SOURCE).toContain("hiddenModeRevealed = isBlindDraftMode");
    expect(SOURCE).toContain("reveal complete — arrange with full card information");
    expect(SOURCE).not.toContain("blindRatings: blind");
    expect(SOURCE).not.toContain("hidden until you simulate");
  });

  it("persists only base draft plus arrangement and exposes tap-to-swap controls", () => {
    expect(SOURCE).toContain("materializeTeamSheetDraft(gameData, sourceDraft, arrangement)");
    expect(SOURCE).toContain("arrangement: nextArrangement");
    expect(SOURCE).toContain("filledSlotInteraction");
    expect(SOURCE).toContain("Confirm team sheet & simulate");
  });
});
