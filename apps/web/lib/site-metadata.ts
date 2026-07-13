export const SITE_TITLE = "wcdraft: draft your all-time World Cup XI";
export const SITE_DESCRIPTION =
  "Draft your all-time World Cup XI. 17 spins, one squad, the full 2026 bracket. Free in your browser.";

export const SITE_NAME = "wcdraft";
export const OG_DEFAULT_IMAGE = "/brand/marketing/og-default.png";
export const OG_SQUARE_IMAGE = "/brand/marketing/og-square.png";
export const OG_DEFAULT_IMAGE_ALT =
  "wcdraft social preview with a gold globe over a football pitch";

export function metadataBaseUrl(): URL {
  const raw =
    process.env.WCDRAFT_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.wcdraft.com";
  const url = new URL(raw);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
