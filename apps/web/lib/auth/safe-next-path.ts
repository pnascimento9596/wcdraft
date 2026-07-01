/**
 * Whitelist `next` targets to same-origin pathnames so auth endpoints never
 * become open redirects.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/play";
  if (!/^\/[A-Za-z0-9_\-./?&=%]*$/.test(raw)) return "/play";
  if (raw.startsWith("//")) return "/play";
  try {
    const decoded = decodeURIComponent(raw);
    // eslint-disable-next-line no-control-regex -- explicit C0 + DEL guard
    if (/[\x00-\x1f\x7f]/.test(decoded)) return "/play";
  } catch {
    return "/play";
  }
  return raw;
}
