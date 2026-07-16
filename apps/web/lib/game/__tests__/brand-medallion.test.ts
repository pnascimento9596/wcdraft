import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("vector medallion source", () => {
  it("keeps the header on the crisp vector asset", () => {
    const header = source("../../../components/site-header.tsx");
    expect(header).toContain('src="/brand/medallion-badge.svg"');
    expect(header).not.toContain('src="/brand/logo-header.png"');
  });

  it("uses one 1024-unit vector source for web and iOS rasterization", () => {
    const vector = source("../../../assets/brand/medallion-badge.svg");
    const publicVector = source("../../../public/brand/medallion-badge.svg");
    const webGenerator = source("../../../scripts/generate-icons.mjs");
    const mobileGenerator = source("../../../../mobile/scripts/generate-ios-assets.mjs");

    expect(vector).toContain('viewBox="0 0 1024 1024"');
    expect(vector).toContain("Space Grotesk 700 outlines");
    expect(vector).toContain("#2ecf92");
    expect(vector).toContain("#f5b62a");
    expect(publicVector).toBe(vector);
    expect(webGenerator).toContain("medallion-badge.svg");
    expect(mobileGenerator).toContain("medallion-badge.svg");
    expect(webGenerator).not.toContain("medallion-badge-master.webp");
    expect(mobileGenerator).not.toContain("medallion-badge-master.webp");
  });

  it("keeps the default-share medallion geometry and literals byte-locked", () => {
    const share = source("../../../public/og/share-default.svg");
    const start = share.indexOf("  <!-- Brand mark:");
    const end = share.indexOf("  <!-- Wordmark -->", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    // Remove one of the two separator newlines. The remaining newline belongs
    // to the medallion block and keeps this hash stable across outer-art edits.
    const medallion = share.slice(start, end).replace(/\n$/u, "");
    expect(createHash("sha256").update(medallion).digest("hex")).toBe(
      "7f4de85f6ace928938bd53bbf0bcdeb496b1c20dfebe1ca14951d0d0472600b6",
    );
  });
});
