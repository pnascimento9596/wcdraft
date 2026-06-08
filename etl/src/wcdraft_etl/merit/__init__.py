"""ENGINE-V2 E-4.1 — deterministic merit / career-stature source intake.

This package SOURCES public, factually-grounded recognition records for players
(annual player-of-the-year awards, century international-cap/goal records,
retrospective century elections, and a living-legends list) and LINKS each record
to a canonical ``player_id``. It is the *coverage proof* for a later career-lift
integration (E-4b): it changes **no rating output, no engine, no compact data**.
Its only products are a linked-fact file, a withheld-ambiguity review queue, and a
coverage report (``MERIT_SOURCES.md``).

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

# Intake schema version. Bumping it signals a change to the source set, the parse,
# or the link contract — NOT a rating change (this package emits no rating).
VERSION = "career-stature-1.0.0"

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
        "annual_recognition",
        "Annual player-of-the-year recognition",
        None,
        "Ballon d'Or, South American Player of the Year, and IFFHS World's Best "
        "Player — annual peer/journalist elections.",
    ),
    SignalFamily(
        "international_record",
        "International longevity record",
        None,
        "Century-of-caps and 30+ international-goals record lists.",
    ),
    SignalFamily(
        "retrospective_selection",
        "Retrospective century selection",
        None,
        "IFFHS Century player elections and the 2004 living-legends list.",
    ),
    SignalFamily(
        "club_honors",
        "Club honours",
        0.0,  # deferred to E-4b; present for schema stability, no source yet
        "DEFERRED (E-4b): no source fetched, weight 0.0, zero facts in this build.",
    ),
)

FAMILY_KEYS: tuple[str, ...] = tuple(f.key for f in SIGNAL_FAMILIES)


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


SOURCES: tuple[Source, ...] = (
    Source(
        "european_poy",
        "annual_recognition",
        "rsssf/europa-poy.html",
        "https://www.rsssf.org/miscellaneous/europa-poy.html",
        "iso-8859-1",
        "fact",
        "European Player of the Year (Ballon d'Or) — annual winners",
    ),
    Source(
        "south_american_poy",
        "annual_recognition",
        "rsssf/sam-poy.html",
        "https://www.rsssf.org/miscellaneous/sam-poy.html",
        "iso-8859-1",
        "fact",
        "South American Player of the Year — annual winners",
    ),
    Source(
        "iffhs_worlds_best",
        "annual_recognition",
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

# Source id used for the native, pre-linked World Cup individual awards drawn from
# the canonical Fjelstul awards table (etl/output/awards.json). It is NOT fetched.
NATIVE_WC_AWARDS_SOURCE = "wc_individual_awards_native"

SOURCE_BY_ID: dict[str, Source] = {s.source_id: s for s in SOURCES}
FACT_SOURCES: tuple[Source, ...] = tuple(s for s in SOURCES if s.role == "fact")

ATTRIBUTION = (
    "Career-stature records sourced from public archives — the Rec.Sport.Soccer "
    "Statistics Foundation (RSSSF, https://www.rsssf.org/) and Wikipedia "
    "(https://en.wikipedia.org/, CC BY-SA) — used with acknowledgement. Each "
    "record is transcribed from a SHA-pinned snapshot and linked to a canonical "
    "player_id only when the match is unique and high-confidence; ambiguous names "
    "are withheld for human review and never assigned."
)


@dataclass(frozen=True)
class MeritRecord:
    """One parsed source row, before linking. A pure transcription of the snapshot:
    the player's name as written, the nation token as written, the relevant year
    (award year, election year, or None), an optional career-year span (caps
    lists), and a free-text ``detail`` for the review/report. ``name`` is the raw
    display string; normalization for matching happens in ``link``."""

    source_id: str
    family: str
    name: str
    nation_token: str | None = None
    year: int | None = None
    career_start: int | None = None
    career_end: int | None = None
    detail: str = ""
    extra: dict = field(default_factory=dict)
