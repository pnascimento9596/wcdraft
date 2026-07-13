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
});
