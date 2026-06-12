// Pull a wcdraft share token out of inbound text — a bare `tN.<base64url>`
// token or a wcdraft.com/play/share?run=<token> URL. Used by Phase B to decode
// the run a person posted (with the REAL decoder) and reference a true stat.

const BARE_TOKEN_RX = /\bt\d{1,4}\.[A-Za-z0-9_-]{16,8192}\b/;
const SHARE_URL_RX = /wcdraft\.com\/play\/share\?run=(t\d{1,4}\.[A-Za-z0-9_-]{16,8192})/i;

export function extractShareToken(text: string): string | null {
  const url = SHARE_URL_RX.exec(text);
  if (url) return url[1]!;
  const bare = BARE_TOKEN_RX.exec(text);
  if (bare) return bare[0];
  return null;
}
