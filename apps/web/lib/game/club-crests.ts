import manifest from "../../public/clubs/manifest.json";

const CURRENT_CREST_YEAR = manifest.resolution_policy.current_tournament_year;
const GENERIC_PREFIXES = new Set(["fc", "afc", "ac", "as", "cf", "cd", "sc", "sv", "rc"]);

interface ClubCrestManifestEntry {
  normalized_club_string: string;
  canonical_club_id: string;
  display_name: string;
  crest_asset_ref: `/clubs/${string}.svg`;
  asset_file: string;
  wikidata_qid: string;
  commons_file: string;
  commons_page: string;
  source_url: string;
  license: string;
  usage_terms: string;
  restrictions: string;
  resolved_years: number[];
}

export interface ResolvedClubCrest {
  kind: "crest";
  clubName: string;
  normalizedClubString: string;
  canonicalClubKey: string;
  src: `/clubs/${string}.svg`;
  alt: string;
  sourceUrl: string;
}

export interface ClubMonogramFallback {
  kind: "monogram";
  clubName: string;
  normalizedClubString: string;
  canonicalClubKey: string;
  initials: string;
  tone: number;
  reason: "ambiguous" | "historical" | "unmapped";
}

export type ClubCrestResolution = ResolvedClubCrest | ClubMonogramFallback;

const ENTRIES_BY_NORMALIZED_CLUB = new Map<string, ClubCrestManifestEntry>(
  (manifest.entries as ClubCrestManifestEntry[]).map((entry) => [
    entry.normalized_club_string,
    entry,
  ]),
);

const AMBIGUOUS_NORMALIZED_CLUBS = new Set<string>(manifest.ambiguous_normalized_strings);

export function normalizeClubString(clubName: string): string {
  const normalized = clubName
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b([A-Za-z])\.\s*([A-Za-z])\./gu, "$1$2")
    .replace(/&/gu, " and ")
    .replace(/['’`]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");

  const tokens = normalized.split(" ").filter(Boolean);
  while (tokens.length > 1 && GENERIC_PREFIXES.has(tokens[0]!)) {
    tokens.shift();
  }
  return tokens.join(" ");
}

function hashClubKey(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clubInitials(clubName: string): string {
  const normalized = normalizeClubString(clubName);
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length > 0 && !GENERIC_PREFIXES.has(token));
  const useful = tokens.filter(
    (token) => !["and", "club", "de", "da", "do", "the"].includes(token),
  );
  const basis = useful.length > 0 ? useful : tokens;
  const alphaBasis = basis.map((token) => token.replace(/[^a-z]/gu, "")).filter(Boolean);
  const letterBasis = alphaBasis.length > 0 ? alphaBasis : basis;
  const letters =
    letterBasis.length === 1
      ? letterBasis[0]!.slice(0, 2).toUpperCase()
      : letterBasis
          .slice(0, 2)
          .map((token) => token[0] ?? "")
          .join("")
          .toUpperCase();
  return letters || "FC";
}

function monogramResolution(
  clubName: string,
  normalizedClubString: string,
  reason: ClubMonogramFallback["reason"],
): ClubMonogramFallback {
  const canonicalClubKey = normalizedClubString || normalizeClubString(clubName);
  return {
    kind: "monogram",
    clubName,
    normalizedClubString,
    canonicalClubKey,
    initials: clubInitials(clubName),
    tone: hashClubKey(canonicalClubKey) % 8,
    reason,
  };
}

export function resolveClubCrest(
  clubName: string | null | undefined,
  tournamentYear: number,
): ClubCrestResolution | null {
  if (!clubName) return null;

  const normalizedClubString = normalizeClubString(clubName);
  if (AMBIGUOUS_NORMALIZED_CLUBS.has(normalizedClubString)) {
    return monogramResolution(clubName, normalizedClubString, "ambiguous");
  }

  const entry = ENTRIES_BY_NORMALIZED_CLUB.get(normalizedClubString);
  if (!entry || !entry.resolved_years.includes(tournamentYear)) {
    return monogramResolution(
      clubName,
      normalizedClubString,
      tournamentYear === CURRENT_CREST_YEAR ? "unmapped" : "historical",
    );
  }

  return {
    kind: "crest",
    clubName,
    normalizedClubString,
    canonicalClubKey: entry.canonical_club_id,
    src: entry.crest_asset_ref,
    alt: `${entry.display_name} club crest`,
    sourceUrl: entry.source_url,
  };
}

export function allClubCrestManifestEntries(): readonly ClubCrestManifestEntry[] {
  return manifest.entries as ClubCrestManifestEntry[];
}
