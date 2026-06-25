/**
 * Return the caller IP value used for coarse rate-limit buckets.
 *
 * Vercel forwards the original chain in x-forwarded-for; only the first hop is
 * caller-controlled identity for our purposes. The raw value is consumed by
 * rate limiters that hash before persistence.
 */
export function readClientIp(request: Pick<Request, "headers">): string {
  const fwd = request.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
