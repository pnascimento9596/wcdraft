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
    expect(SOURCE).toContain(
      "setRunArrangement(record.run_id, gameData.versions, nextArrangement)",
    );
    expect(SOURCE).toContain("filledSlotInteraction");
    expect(SOURCE).toContain("Confirm team sheet & simulate");
  });

  it("locks team-sheet edits and re-simulation for completed records", () => {
    expect(SOURCE).toContain('record.status !== "simulating"');
    expect(SOURCE).toContain('record.status !== "complete"');
    expect(SOURCE).toContain("Team sheet locked during and after simulation");
    expect(SOURCE).toContain("This completed run is read-only");
    expect(SOURCE).toContain("disabled={!arrangementMutable}");
    expect(SOURCE).toContain("if (!arrangementMutable) return;");
  });

  it("routes delayed team-name writes through the authoritative lock boundary", () => {
    expect(SOURCE).toContain("setRunTeamName(record.run_id, gameData.versions, value)");
    expect(SOURCE).toContain("if (!arrangementMutable) clearTeamNameDebounce()");
    expect(SOURCE).toContain("clearTeamNameDebounce();");
    expect(SOURCE).not.toContain("saveRunRecord(next)");
  });

  it("simulates only the serialized locked record with mandatory ownership", () => {
    expect(SOURCE).toContain("const lock = await beginRunSimulation(");
    expect(SOURCE).toContain("attempt.controller.signal");
    expect(SOURCE).toContain("runSimulation(gameData, scenarioBundle, lockedRecord");
    expect(SOURCE).toContain("simulation lifecycle ownership was lost before persistence");
  });
});
