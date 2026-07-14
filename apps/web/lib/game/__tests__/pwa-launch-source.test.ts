import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("PWA launch hardening source guards", () => {
  it("renders a setup-shaped loading shell instead of a bare loading line", () => {
    const draftScreen = source("../../../components/game/draft-screen/index.tsx");
    const gameFallback = source("../../../components/game/game-fallback.tsx");
    expect(draftScreen).toContain("function DraftLoadingShell()");
    expect(draftScreen).toContain('<GameFallback title="Loading draft setup" />');
    expect(gameFallback).toContain("Fetching and parsing the real 1930-2026 draft pool");
    expect(gameFallback).toContain('role="status"');
    expect(gameFallback).toContain('aria-live="polite"');
    expect(gameFallback).toContain("setupSkeletonGrid");
  });

  it("puts candidates before the formation panel on mobile post-reveal layouts", () => {
    const draftScreen = source("../../../components/game/draft-screen/index.tsx");
    const polishCss = source("../../../components/game/game-styles/draft-polish.module.css");
    expect(draftScreen).toContain("s.candidatePanel");
    expect(draftScreen).toContain("candidatePanelRef");
    expect(draftScreen).toContain("compactDraftLayout ? (");
    expect(draftScreen).toContain(
      'revealFocusTargetRef.current = compactDraftLayout ? "candidates" : "formation"',
    );
    expect(draftScreen).toContain("focusFirstWithin(candidatePanelRef.current");
    expect(draftScreen).toContain("Pick your draft candidate");
    expect(draftScreen).toMatch(/\{candidateSection\}\s*\{formationSection\}/u);
    expect(polishCss).toMatch(/\.candidatePanel\s*\{\s*order:\s*1;/u);
    expect(polishCss).toMatch(/\.formationPanel\s*\{\s*order:\s*2;/u);
  });

  it("keeps replay sharing available while signed OG preview upgrades independently", () => {
    const shareScreen = source("../../../components/game/share-screen.tsx");
    const runOgClient = source("../run-og-client.ts");
    expect(shareScreen).toContain("isRecipient: resolved.isReplayedFromToken");
    expect(shareScreen).toContain("draft your own all-time XI");
    expect(shareScreen).toContain("optionalScenarioForLocalRun: true");
    expect(shareScreen).toContain(
      "buildShareView(resolved.gameData, resolved.record, resolved.scenario)",
    );
    expect(shareScreen).toContain("requestRunOgSign(shareLink.token");
    expect(runOgClient).toContain('fetch("/api/og/sign"');
    expect(shareScreen).not.toContain("initialSignedOg");
    expect(shareScreen).not.toContain("signedRunOgPayloadTokenHash");
    expect(shareScreen).toContain(
      'const signedOg = ogSign.kind === "ready" ? ogSign.signed : null',
    );
    expect(shareScreen).toContain("shareHref(shareLink.token)");
    expect(shareScreen).toContain("shareHref(shareLink.token, signedOg)");
    expect(runOgClient).toContain("boundedRequest(");
    expect(runOgClient).toContain("RUN_OG_SIGN_RESPONSE_MAX_BYTES");
    expect(shareScreen).toContain("timeoutMs: OG_SIGN_BUDGET_MS");
    expect(shareScreen).not.toContain("disabled={shareLinkPending}");
    expect(shareScreen).toContain('tabIndex={0} aria-label="Share caption"');
    expect(shareScreen).toContain("preview unavailable, link works");
    expect(shareScreen).toContain("Retry only refreshes the preview");
  });
});
