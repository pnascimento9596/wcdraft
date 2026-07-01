const NAME_PART_SENTINELS = new Set(["not applicable"]);

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function withoutLeadingSentinel(value: string): string {
  const cleaned = normalizeSpaces(value);
  const folded = cleaned.toLowerCase();
  for (const sentinel of NAME_PART_SENTINELS) {
    if (folded === sentinel) return "";
    if (folded.startsWith(`${sentinel} `)) {
      return cleaned.slice(sentinel.length).trimStart();
    }
  }
  return cleaned;
}

export function displayNameFromNames(
  commonName: string | null | undefined,
  fullName: string,
): string {
  const common = withoutLeadingSentinel(commonName ?? "");
  if (common.length > 0) return common;
  const full = withoutLeadingSentinel(fullName);
  return full.length > 0 ? full : "—";
}

export function fullDisplayName(fullName: string): string {
  const full = withoutLeadingSentinel(fullName);
  return full.length > 0 ? full : "—";
}
