"""Deterministic merit / career-stature source intake (merit-source-set-2.0.0).

This package SOURCES public, factually-grounded recognition records for players —
global & regional player-of-the-year ballots, position-balanced selections (UEFA
positional awards / Team of the Year, FIFPro World 11, ESM Team of the Season),
all-time dream teams (the Ballon d'Or Dream Team, IFFHS), century international-cap/
goal records, retrospective century elections, and a living-legends list — and LINKS
each record to a canonical ``player_id``. It is the *coverage proof* for the
stature-dominant rating rebase: the base source set feeds ``career_stature.json``,
while rating output remains locked to the row-level compatibility view until the
rating unit deliberately flips the consumer. Its products are linked fact files,
withheld-ambiguity review queues, and coverage reports (``MERIT_SOURCES.md`` /
``ACTIVE_CAREERS.md``).

MV2-1 (this unit) broadened the v1 source set with position-balanced and regional
sources to repair the striker / Ballon-d'Or bias — defenders and goalkeepers
(Baresi, Maldini, Yashin, Buffon, Cafu, Beckenbauer) now carry facts, and the
position-aware sources emit first-class GK/DF/MF/FW positions.

The integrity line mirrors the RSSSF appearance supplement exactly
(``wcdraft_etl.supplement``):

  * We SOURCE and LINK real public records; we never INVENT a player fact.
  * The single networked step (``fetch``) is OFF the deterministic build path and
    SHA-pins every snapshot; parsing + linking are pure functions of the committed
    bytes plus the canonical tables, so outputs reproduce byte-for-byte offline.
  * A source row is linked ONLY when it resolves to exactly one canonical card with
    high confidence (distinctive name, corroborated by nation and/or career year).
    Every ambiguity — surname collision, transliteration the name index can't
    fold, missing candidate, multi-match — is WITHHELD to ``link_review.json``,
    never guessed and never assigned.
  * Missing coverage is coverage: a player with no sourced record simply has no
    fact here. Absence is NEVER written as a zero-stature fact against the player.
  * Native canonical values (Fjelstul tournament awards already carrying a
    ``player_id``) are used as-is and never overwritten by a linked source row.

BRAND NEUTRALITY: source ids, field names, output keys and report text carry no
governing-body or proprietary brand string. The only place a third-party brand
slug survives is a *provenance URL* in ``fetch_manifest.json`` (a verbatim public
address) and inside the committed raw snapshots themselves (verbatim public bytes,
SHA-pinned — altering them would corrupt provenance).

PROPRIETARY-IP WALL: no proprietary game-rating source (the Futbin / EA Sports FC /
Pro Evolution Soccer / eFootball / Konami family, and the SoFIFA database) is ever
fetched, parsed, or referenced. Every signal here is a public, attributable fact.
The block list below is the only place those product tokens appear — as forbidden
strings, never as a source — and the ETL IP audit (``etl/tests/test_rating.py``)
scans this package's ``raw/`` tree to enforce the wall.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ─── version axes (TWO independent versions) ──────────────────────────────────
# The merit package carries TWO version axes that move independently:
#
#   SOURCE_SET_VERSION  the source REGISTRY + parse + link contract (this file,
#                       fetch.py, build.py). Bumping it signals a change to which
#                       public lists are sourced / how they are parsed & linked.
#                       It versions source_facts.json + link_review.json + the
#                       fetch manifest. It is NOT a rating change.
#
#   VERSION             the downstream career-stature TABLE schema produced by
#                       stature.py (career_stature.json). merit-v3 V1 moves this
#                       to 3.0.0 for active facts, person resolution and index
#                       controls, while rating.py keeps consuming the table's
#                       row-level rating_compat view until the V2 rating unit.
#
# Keeping these axes separate is what lets the factual table move without
# accidentally changing historical/projected rating outputs or compact bundles.
SOURCE_SET_VERSION = "merit-source-set-2.0.0"
# career-stature-3.0.0 (merit-v3 V1): the table activates the active-career
# channel through stature.py, adds eligibility-aware family re-normalization,
# sparse-profile controls, person-identity resolution, and the
# club_season_honors family. The base merit source set remains 2.0.0; the active
# source set has its own version below.
VERSION = "career-stature-3.0.0"

# Closed set of player positions a fact may carry. Position-balanced sources
# (positional awards, formation XIs, all-time dream teams) emit a first-class
# position so MV2-3 can score defenders / goalkeepers / midfielders, not just the
# striker-biased annual winners. ``None`` = the source does not state a position.
POSITIONS: tuple[str, ...] = ("GK", "DF", "MF", "FW")

# ─── era buckets ──────────────────────────────────────────────────────────────
# A linked fact's era is the era of the *player* (their earliest World Cup
# tournament), not the publication year of the source — so a retrospective list
# (e.g. a 2004 living-legends selection) correctly credits a pre-1956 great's era.
# 1956 is the first Ballon d'Or year; 1991 opens the modern global-recognition era.
ERA_BUCKETS: tuple[str, ...] = ("pre_1956", "1956_1990", "1991_plus")


def era_bucket(first_wc_year: int) -> str:
    """Map a player's earliest World Cup year to one of ERA_BUCKETS."""
    if first_wc_year < 1956:
        return "pre_1956"
    if first_wc_year <= 1990:
        return "1956_1990"
    return "1991_plus"


# ─── signal families ──────────────────────────────────────────────────────────
# Families group sourced facts by *kind* of distinction for the coverage table.
# ``weight`` is deliberately NOT set here for the active families: E-4.1 proves
# coverage and assigns no rating weight at all. ``club_honors`` is registered now
# but explicitly weight 0.0 and carries no source — it is deferred to E-4b.
@dataclass(frozen=True)
class SignalFamily:
    key: str
    label: str
    weight: float | None  # None = not yet weighted (E-4b decides); 0.0 = deferred
    note: str


# v2 position-balanced taxonomy. ``weight`` is intentionally NOT set for the active
# families: MV2-1 proves coverage and assigns no rating weight (MV2-3 owns weights).
# One family is reserved (no live source yet): ``club_honors`` (deferred to a later
# approval). ``captaincy`` was reserved in MV2-1 (its only named web source,
# eu-football.info, serves JS-gated empty bodies to non-browser clients and is not
# cleanly SHA-pinnable); MV2-2 ACTIVATES it via the deterministic research backstop
# — citation-backed captaincy records authored from fetched-and-verified public
# sources (see RESEARCH_SOURCES), staged in source_facts.json for MV2-3, still
# weight-less here.
#
# ``annual_recognition`` is a LEGACY family key: no v2 source maps to it. It is
# retained ONLY because the v1 career-stature-1.0.0 table (stature.py) still groups
# the v1 annual sources under it internally; keeping it in the registry lets that v1
# table rebuild byte-identical. MV2-3 splits the v1 annual sources into the
# global_/regional_ families when it rebuilds the table as career-stature-2.0.0.
SIGNAL_FAMILIES: tuple[SignalFamily, ...] = (
    SignalFamily(
        "wc_legacy",
        "World Cup individual legacy",
        None,
        "Native canonical tournament awards (Golden Ball/Boot/Glove, best young "
        "player) already linked to a player_id; cross-checked against a public "
        "World Cup awards list.",
    ),
    SignalFamily(
        "global_annual_recognition",
        "Global annual player-of-the-year recognition",
        None,
        "World-scope annual peer/journalist elections: Ballon d'Or, IFFHS World's "
        "Best, UEFA Men's Player of the Year, World Soccer Player of the Year, and "
        "the Onze d'Or/d'Argent/de Bronze.",
    ),
    SignalFamily(
        "regional_annual_recognition",
        "Regional annual player-of-the-year recognition",
        None,
        "Continental annual elections: South American (Rey de América) winners & "
        "placements, African, Asian, and CONCACAF Player-of-the-Year — recognition "
        "for non-European greats invisible to the global ballots.",
    ),
    SignalFamily(
        "position_balanced_selection",
        "Position-balanced selection (positional awards / formation XIs)",
        None,
        "Position-aware best-of selections: UEFA Club positional awards (GK/DF/MF/"
        "FW), UEFA Team of the Year, FIFPro World 11, ESM Team of the Season. Each "
        "fact carries a first-class position — the defender / goalkeeper repair.",
    ),
    SignalFamily(
        "international_record",
        "International longevity record",
        None,
        "Century-of-caps and 30+ international-goals record lists.",
    ),
    SignalFamily(
        "retrospective_selection",
        "Retrospective / all-time selection",
        None,
        "All-era selections: IFFHS Century player elections, the 2004 living-legends "
        "list, IFFHS All-Time World / continental / national dream teams, and the "
        "Ballon d'Or Dream Team — the position-aware all-time route.",
    ),
    SignalFamily(
        "captaincy",
        "National-team captaincy record",
        None,  # active via the MV2-2 research backstop; MV2-3 decides any weight
        "National-team captaincy records, sourced via the MV2-2 deterministic "
        "research backstop (citation-backed, fetched-and-verified public sources) "
        "since the only named web source is not SHA-pinnable.",
    ),
    SignalFamily(
        "annual_recognition",
        "Annual recognition (legacy v1-table family)",
        None,  # LEGACY: no v2 source maps here; retained for the v1 table rebuild
        "LEGACY v1 career-stature-1.0.0 family. No v2 source maps to it; MV2-3 "
        "splits it into global_/regional_annual_recognition.",
    ),
    SignalFamily(
        "club_honors",
        "Club honours",
        0.0,  # deferred; present for schema stability, no source yet
        "DEFERRED: no source fetched, weight 0.0, zero facts in this build.",
    ),
    SignalFamily(
        "club_season_honors",
        "Club season honours",
        None,
        "Top-tier continental club titles with documented final participation. "
        "Activated in merit-v3 V1 through citation-backed active notes.",
    ),
)

FAMILY_KEYS: tuple[str, ...] = tuple(f.key for f in SIGNAL_FAMILIES)

# Families a v2 SOURCE may legitimately carry (excludes the legacy/reserved keys).
# ``captaincy`` joins in MV2-2: the research backstop gives it a live, citation-backed
# source, so it is no longer reserved.
ACTIVE_SOURCE_FAMILIES: frozenset[str] = frozenset(
    {
        "wc_legacy",
        "global_annual_recognition",
        "regional_annual_recognition",
        "position_balanced_selection",
        "international_record",
        "retrospective_selection",
        "captaincy",
        "club_season_honors",
    }
)


# ─── proprietary-IP wall ──────────────────────────────────────────────────────
# Block list of proprietary game-rating sources that must NEVER be sourced. Mirror
# of the pattern enforced in etl/tests/test_rating.py so the wall reads identically
# at both layers. (The bare token "pes" is intentionally excluded — it collides
# with real surnames; only the unambiguous, longer tokens are blocked.)
PROPRIETARY_SOURCE_TOKENS: tuple[str, ...] = (
    "sofifa",
    "futbin",
    "easports",
    "ea sports fc",
    "pro evolution soccer",
    "efootball",
    "konami",
)


# ─── source registry ──────────────────────────────────────────────────────────
# Every allowed source: a brand-neutral id, its signal family, the committed raw
# filename, the provenance URL, the page charset, and its role. ``crosscheck``
# sources validate the native canonical data and contribute no linked facts.
@dataclass(frozen=True)
class Source:
    source_id: str  # brand-neutral, stable; appears in output keys
    family: str  # one of FAMILY_KEYS
    raw_file: str  # relative to raw/
    url: str  # provenance URL (may carry a third-party slug)
    charset: str
    role: str  # "fact" (contributes linked facts) | "crosscheck"
    label: str  # human label for the report (brand-neutral)


# ── v1 sources (carried over) — families relabelled onto the v2 taxonomy ──
# Bytes & links are UNCHANGED; only the registry ``family`` label moves onto the v2
# taxonomy. The v1 stature table re-derives its own internal v1 family from the
# source_id (stature._V1_SOURCE_FAMILY), so this relabel does NOT move the v1 table.
_V1_SOURCES: tuple[Source, ...] = (
    Source(
        "european_poy",
        "global_annual_recognition",
        "rsssf/europa-poy.html",
        "https://www.rsssf.org/miscellaneous/europa-poy.html",
        "iso-8859-1",
        "fact",
        "European Player of the Year (Ballon d'Or) — annual winners",
    ),
    Source(
        "south_american_poy",
        "regional_annual_recognition",
        "rsssf/sam-poy.html",
        "https://www.rsssf.org/miscellaneous/sam-poy.html",
        "iso-8859-1",
        "fact",
        "South American Player of the Year (Rey de América) — annual winners",
    ),
    Source(
        "iffhs_worlds_best",
        "global_annual_recognition",
        "wiki/iffhs-worlds-best.html",
        "https://en.wikipedia.org/wiki/IFFHS_World%27s_Best_Player",
        "utf-8",
        "fact",
        "IFFHS World's Best Player — annual winners",
    ),
    Source(
        "iffhs_century",
        "retrospective_selection",
        "rsssf/iffhs-century.html",
        "https://www.rsssf.org/miscellaneous/iffhs-century.html",
        "iso-8859-1",
        "fact",
        "IFFHS Century elections — world/continental player-of-the-century polls",
    ),
    Source(
        "international_century_caps",
        "international_record",
        "rsssf/century.html",
        "https://www.rsssf.org/miscellaneous/century.html",
        "iso-8859-1",
        "fact",
        "Players with 100+ international caps / 30+ international goals",
    ),
    Source(
        "living_legends_2004",
        "retrospective_selection",
        "wiki/living-legends-2004.html",
        "https://en.wikipedia.org/wiki/FIFA_100",
        "utf-8",
        "fact",
        "2004 living-legends list — 125 greatest living players selection",
    ),
    Source(
        "wc_awards_crosscheck",
        "wc_legacy",
        "wiki/wc-awards.html",
        "https://en.wikipedia.org/wiki/FIFA_World_Cup_awards",
        "utf-8",
        "crosscheck",
        "World Cup individual awards (public list) — cross-check of native data",
    ),
)

# ── v2 source-set expansion (MV2-1) — Tier-A breadth ──
# Regional player-of-the-year ballots (non-European greats), global recognition
# (UEFA / World Soccer / Onze), and position-balanced selections + all-time dream
# teams (the defender / goalkeeper repair). Every source is a public, attributable
# recognition list — no proprietary game-rating IP (see PROPRIETARY_SOURCE_TOKENS).
_V2_SOURCES: tuple[Source, ...] = (
    # — regional annual recognition —
    Source(
        "south_american_poy_placements",
        "regional_annual_recognition",
        "rsssf/sam-poy.html",  # reuses the committed v1 snapshot (placements region)
        "https://www.rsssf.org/miscellaneous/sam-poy.html",
        "iso-8859-1",
        "fact",
        "South American Player of the Year — annual top-3 placements (2nd/3rd)",
    ),
    Source(
        "african_poy",
        "regional_annual_recognition",
        "rsssf/afr-poy.html",
        "https://www.rsssf.org/miscellaneous/afr-poy.html",
        "iso-8859-1",
        "fact",
        "African Player of the Year — annual winners",
    ),
    Source(
        "asian_poy",
        "regional_annual_recognition",
        "rsssf/as-poy.html",
        "https://www.rsssf.org/miscellaneous/as-poy.html",
        "iso-8859-1",
        "fact",
        "Asian Player of the Year — annual winners",
    ),
    Source(
        "concacaf_poy",
        "regional_annual_recognition",
        "wiki/concacaf-awards.html",
        "https://en.wikipedia.org/wiki/CONCACAF_Awards",
        "utf-8",
        "fact",
        "CONCACAF Player of the Year — annual winners",
    ),
    # — global annual recognition —
    Source(
        "uefa_mens_poy",
        "global_annual_recognition",
        "wiki/uefa-mens-poy.html",
        "https://en.wikipedia.org/wiki/UEFA_Men%27s_Player_of_the_Year_Award",
        "utf-8",
        "fact",
        "UEFA Men's Player of the Year — annual top-three",
    ),
    Source(
        "world_soccer_poy",
        "global_annual_recognition",
        "rsssf/wsoc-awards.html",
        "https://www.rsssf.org/miscellaneous/wsoc-awards.html",
        "iso-8859-1",
        "fact",
        "World Soccer Player of the Year — annual winners",
    ),
    Source(
        "onze_awards",
        "global_annual_recognition",
        "rsssf/onze-awards.html",
        "https://www.rsssf.org/miscellaneous/onze-awards.html",
        "iso-8859-1",
        "fact",
        "Onze d'Or / d'Argent / de Bronze — annual top-three",
    ),
    # — position-balanced selections (the defender / goalkeeper repair) —
    Source(
        "uefa_club_positional",
        "position_balanced_selection",
        "wiki/uefa-club-awards.html",
        "https://en.wikipedia.org/wiki/UEFA_Club_Football_Awards",
        "utf-8",
        "fact",
        "UEFA Club positional awards — Best Goalkeeper/Defender/Midfielder/Forward",
    ),
    Source(
        "uefa_team_of_the_year",
        "position_balanced_selection",
        "wiki/uefa-toty.html",
        "https://en.wikipedia.org/wiki/UEFA_Team_of_the_Year",
        "utf-8",
        "fact",
        "UEFA Team of the Year — annual position-normalised XI",
    ),
    Source(
        "fifpro_world11",
        "position_balanced_selection",
        "wiki/fifpro-world11.html",
        "https://en.wikipedia.org/wiki/FIFPRO_World_11",
        "utf-8",
        "fact",
        "FIFPro World 11 — annual player-voted position XI",
    ),
    Source(
        "esm_team_of_the_season",
        "position_balanced_selection",
        "wiki/esm-tots.html",
        "https://en.wikipedia.org/wiki/ESM_Team_of_the_Season",
        "utf-8",
        "fact",
        "ESM Team of the Season — annual position XI",
    ),
    # — retrospective / all-time selections (position-aware) —
    Source(
        "ballondor_dream_team",
        "retrospective_selection",
        "wiki/ballondor-dreamteam.html",
        "https://en.wikipedia.org/wiki/Ballon_d%27Or_Dream_Team",
        "utf-8",
        "fact",
        "Ballon d'Or Dream Team (2020) — all-time 1st/2nd/3rd position XIs",
    ),
    Source(
        "iffhs_dream_teams",
        "retrospective_selection",
        "iffhs/iffhs-dreamteams.html",
        "https://www.iffhs.com/posts/1110",
        "utf-8",
        "fact",
        "IFFHS All-Time World / continental / national dream teams",
    ),
)

SOURCES: tuple[Source, ...] = _V1_SOURCES + _V2_SOURCES

# ── research backstop sources (MV2-2) — DELIBERATELY SEPARATE from SOURCES ──
# These are NOT fetched web snapshots: each is a committed, citation-backed research
# note authored from fetched-and-verified public sources, pinned in its OWN manifest
# (merit/raw/research/manifest.json), not fetch_manifest.json. They are kept out of
# ``SOURCES`` so the fetch path (fetch_manifest, ``fetch --verify``) is untouched;
# they are added to SOURCE_BY_ID only so the report can label them. ``url`` is a
# marker, never fetched — the real provenance is the per-row ``citation.url``.
_RESEARCH_SOURCES: tuple[Source, ...] = (
    Source(
        "research_captaincy",
        "captaincy",
        "research/captaincy.json",
        "(research backstop — per-row citations in merit/raw/research/manifest.json)",
        "utf-8",
        "fact",
        "National-team captaincy records (research backstop, citation-backed)",
    ),
    Source(
        "research_global_annual",
        "global_annual_recognition",
        "research/global-annual.json",
        "(research backstop — per-row citations in merit/raw/research/manifest.json)",
        "utf-8",
        "fact",
        "Global annual recognition recovered under canonical names (research backstop)",
    ),
    # MV2-3.5 — defender / goalkeeper recognition gap-fill (position-appropriate).
    # Both are citation-backed, SHA-pinned committed notes (same discipline as the
    # MV2-2 research sources); they route through the EXISTING wc_legacy and
    # position_balanced_selection scorers and add NO new model parameter.
    Source(
        "research_wc_all_star",
        "wc_legacy",
        "research/wc-all-star.json",
        "(research backstop — per-row citations in merit/raw/research/manifest.json)",
        "utf-8",
        "fact",
        "World Cup All-Star Team / Team-of-the-Tournament selections (research backstop)",
    ),
    Source(
        "research_gk_award",
        "position_balanced_selection",
        "research/gk-awards.json",
        "(research backstop — per-row citations in merit/raw/research/manifest.json)",
        "utf-8",
        "fact",
        "World's Best Goalkeeper annual award wins (research backstop)",
    ),
)
RESEARCH_SOURCES: tuple[Source, ...] = _RESEARCH_SOURCES
RESEARCH_SOURCE_IDS: frozenset[str] = frozenset(s.source_id for s in _RESEARCH_SOURCES)

# ── active-career intake sources (MV2-12a → merit-v3 V1 activated channel) ──
# Citation-backed notes for IN-PROGRESS careers (players whose careers continue
# past the archive's 2022 peak-year ceiling, incl. 2026 squad members). They are
# kept out of ``SOURCES`` AND out of the research backstop: their facts are
# staged in ``output/merit/source_facts_active.json`` and are consumed only by
# stature.py's person-level active merge. Same discipline as the research
# backstop otherwise: every row carries a fetchable public citation (url +
# claim) verified before commit; an uncited row fails the build; the notes are
# SHA-pinned in their own manifest (merit/raw/active/manifest.json).
ACTIVE_SOURCE_SET_VERSION = "active-career-source-set-2.0.0"
# Curation cutoff: a note in this set may only assert facts established on or
# before this date (the 2026 squad-pin season boundary). Re-curation of active
# careers is expected each dataset revision — active records drift by nature.
ACTIVE_CUTOFF_DATE = "2026-06-01"
_ACTIVE_SOURCES: tuple[Source, ...] = (
    Source(
        "active_global_annual",
        "global_annual_recognition",
        "active/global-annual.json",
        "(active-career intake — per-row citations in merit/raw/active/manifest.json)",
        "utf-8",
        "fact",
        "Global annual recognition for in-progress careers (citation-backed)",
    ),
    Source(
        "active_gk_award",
        "position_balanced_selection",
        "active/gk-awards.json",
        "(active-career intake — per-row citations in merit/raw/active/manifest.json)",
        "utf-8",
        "fact",
        "Best-goalkeeper annual award wins for in-progress careers (citation-backed)",
    ),
    Source(
        "active_captaincy",
        "captaincy",
        "active/captaincy.json",
        "(active-career intake — per-row citations in merit/raw/active/manifest.json)",
        "utf-8",
        "fact",
        "National-team captaincy records for in-progress careers (citation-backed)",
    ),
    Source(
        "active_international_record",
        "international_record",
        "active/international-record.json",
        "(active-career intake — per-row citations in merit/raw/active/manifest.json)",
        "utf-8",
        "fact",
        "International longevity records for in-progress careers (citation-backed)",
    ),
    Source(
        "active_club_season_honors",
        "club_season_honors",
        "active/club-season-honors.json",
        "(active-career intake — per-row citations in merit/raw/active/manifest.json)",
        "utf-8",
        "fact",
        "Top-tier continental club titles with documented final participation",
    ),
)
ACTIVE_SOURCES: tuple[Source, ...] = _ACTIVE_SOURCES
ACTIVE_SOURCE_IDS: frozenset[str] = frozenset(s.source_id for s in _ACTIVE_SOURCES)

# Source id used for the native, pre-linked World Cup individual awards drawn from
# the canonical Fjelstul awards table (etl/output/awards.json). It is NOT fetched.
NATIVE_WC_AWARDS_SOURCE = "wc_individual_awards_native"

# SOURCE_BY_ID spans fetched + research sources (for report labels); FACT_SOURCES and
# the fetch manifest see ONLY the fetched ``SOURCES`` (research has its own manifest).
SOURCE_BY_ID: dict[str, Source] = {s.source_id: s for s in (SOURCES + _RESEARCH_SOURCES)}
FACT_SOURCES: tuple[Source, ...] = tuple(s for s in SOURCES if s.role == "fact")

ATTRIBUTION = (
    "Career-stature records sourced from public archives — the Rec.Sport.Soccer "
    "Statistics Foundation (RSSSF, https://www.rsssf.org/), Wikipedia "
    "(https://en.wikipedia.org/, CC BY-SA), and the IFFHS (https://www.iffhs.com/) "
    "— used with acknowledgement. Each record is transcribed from a SHA-pinned "
    "snapshot and linked to a canonical player_id only when the match is unique and "
    "high-confidence; ambiguous names are withheld for human review and never "
    "assigned."
)


@dataclass(frozen=True)
class MeritRecord:
    """One parsed source row, before linking. A pure transcription of the snapshot:
    the player's name as written, the nation token as written, the relevant year
    (award year, election year, or None), an optional career-year span (caps
    lists), an optional ``position`` (GK/DF/MF/FW) for position-balanced sources,
    and a free-text ``detail`` for the review/report. ``name`` is the raw display
    string; normalization for matching happens in ``link``."""

    source_id: str
    family: str
    name: str
    nation_token: str | None = None
    year: int | None = None
    career_start: int | None = None
    career_end: int | None = None
    position: str | None = None  # one of POSITIONS, or None when not stated
    detail: str = ""
    extra: dict = field(default_factory=dict)
