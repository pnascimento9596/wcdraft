"""Link parsed merit records to canonical ``player_id`` values — conservatively.

The contract (identical in spirit to the RSSSF appearance supplement):

  * A record is LINKED only when it resolves to exactly ONE canonical men's card
    with high confidence. A distinctive full name links on its own; a less-specific
    key (an emphasised surname / mononym) links only when nation or career year
    positively corroborates it.
  * Every ambiguity is WITHHELD to the review queue with a machine-readable reason
    and the candidate ids — never guessed, never assigned.
  * The canonical pool is restricted to players with a men's World Cup card, so a
    men's recognition record can never cross-link to a women's player who happens
    to share a normalized name.
  * Native canonical facts (Fjelstul World Cup individual awards, which already
    carry a ``player_id``) are emitted as-is and never overwritten by a source row;
    a public World Cup awards list is used only to CROSS-CHECK them.

Everything here is a pure, deterministic function of the parsed records plus the
canonical tables; outputs are sorted so a re-run is byte-identical.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from . import (
    FAMILY_KEYS,
    NATIVE_WC_AWARDS_SOURCE,
    SOURCE_BY_ID,
    MeritRecord,
    era_bucket,
)
from .nation import NationResolver
from .text import norm, uppercase_key

# How many years a recognition may sit outside a player's World Cup span and still
# be considered year-corroborated (a peak season often follows the last finals).
_YEAR_WINDOW = 8

_NOT_APPLICABLE = "not applicable"


def _clean(name: str | None) -> str:
    """Drop the Fjelstul "not applicable" placeholder from a name field."""
    if not name:
        return ""
    return name.replace(_NOT_APPLICABLE, " ").strip()


@dataclass
class _Canon:
    """Pre-built canonical indexes over the men's-eligible player pool."""

    specific: dict[str, set[str]]  # distinctive full-name key -> player_ids
    surname: dict[str, set[str]]  # surname / mononym key -> player_ids
    nations: dict[str, frozenset[str]]  # player_id -> nation_ids (men's cards)
    wc_years: dict[str, tuple[int, ...]]  # player_id -> sorted men's WC years
    display: dict[str, str]  # player_id -> readable name
    resolver: NationResolver


def _build_canon(
    players: list[dict], cards: list[dict], tournaments: list[dict], nations: list[dict]
) -> _Canon:
    mens_tids = {t["tournament_id"] for t in tournaments if not t.get("womens", False)}
    mens_cards = [c for c in cards if c["tournament_id"] in mens_tids]

    pid_nations: dict[str, set[str]] = defaultdict(set)
    pid_years: dict[str, set[int]] = defaultdict(set)
    for c in mens_cards:
        pid_nations[c["player_id"]].add(c["nation_id"])
        pid_years[c["player_id"]].add(int(c["tournament_id"].split("-")[1]))
    mens_pids = set(pid_nations)

    specific: dict[str, set[str]] = defaultdict(set)
    surname: dict[str, set[str]] = defaultdict(set)
    display: dict[str, str] = {}
    for p in players:
        pid = p["player_id"]
        if pid not in mens_pids:
            continue
        given = _clean(p.get("given_name"))
        family = _clean(p.get("family_name"))
        full = _clean(p.get("full_name"))
        common = _clean(p.get("common_name"))
        display[pid] = full or common or f"{given} {family}".strip() or pid

        for key in (norm(full), norm(f"{given} {family}")):
            # "distinctive" = at least a forename + surname (>= 2 tokens worth)
            if key and (given and family):
                specific[key].add(pid)
        if common and " " in common:
            k = norm(common)
            if k:
                specific[k].add(pid)
        for key in (norm(family), norm(common)):
            if key:
                surname[key].add(pid)
        if full:
            last = norm(full.split()[-1])
            if last:
                surname[last].add(pid)

    return _Canon(
        specific=specific,
        surname=surname,
        nations={pid: frozenset(ns) for pid, ns in pid_nations.items()},
        wc_years={pid: tuple(sorted(ys)) for pid, ys in pid_years.items()},
        display=display,
        resolver=NationResolver(nations),
    )


def _candidates(rec: MeritRecord, canon: _Canon) -> tuple[list[str], str]:
    """(candidate player_ids, tier) for a record, most-specific tier first."""
    whole = norm(rec.name)
    if whole and whole in canon.specific:
        return sorted(canon.specific[whole]), "full_name"
    upper = uppercase_key(rec.name)
    if upper and upper in canon.surname:
        return sorted(canon.surname[upper]), "key_name"
    if whole and whole in canon.surname:
        return sorted(canon.surname[whole]), "surname"
    return [], "no_candidate"


def _year_agrees(pid: str, rec: MeritRecord, canon: _Canon) -> bool:
    years = canon.wc_years.get(pid)
    if not years:
        return False
    probe = rec.year or rec.career_end or rec.career_start
    if probe is None:
        return False
    return (years[0] - _YEAR_WINDOW) <= probe <= (years[-1] + _YEAR_WINDOW)


def _nation_ids(rec: MeritRecord, canon: _Canon) -> frozenset[str]:
    return canon.resolver.resolve(rec.nation_token)


def _fact_discriminator(rec: MeritRecord) -> str:
    """The sub-identity that distinguishes genuinely-different facts which share the
    same ``(player_id, source_id, year)``.

    For the year-less ranked lists this is the *metric* the row records — the
    century-caps page emits BOTH a ``caps=…`` and a ``goals=…`` row per player
    (year ``None``), and the IFFHS page elects one player in several distinct
    century polls. Without a discriminator those distinct facts collapse to one,
    understating ``international_record`` / ``retrospective_selection`` for the most
    decorated players. The single-fact-per-year award sources carry no discriminator
    (``""``) — their year already makes the key unique. An EXACT repeat of the same
    row keeps the same discriminator and still collapses to a single fact."""
    extra = rec.extra or {}
    if "list" in extra:  # century-caps page: caps vs goals
        return f"list={extra['list']}"
    if "election" in extra:  # IFFHS century: one election vs another
        return f"election={extra['election']}"
    return ""


def _link_one(rec: MeritRecord, canon: _Canon) -> tuple[str | None, str, list[str]]:
    """Resolve one record. Returns (player_id, method, candidate_ids).
    player_id is None when withheld; ``method`` then carries the review reason."""
    cands, tier = _candidates(rec, canon)
    if not cands:
        return None, "no_candidate", []

    nat = _nation_ids(rec, canon)

    if len(cands) == 1:
        pid = cands[0]
        nation_ok = bool(nat) and bool(canon.nations.get(pid, frozenset()) & nat)
        nation_contradicts = bool(nat) and not nation_ok
        year_ok = _year_agrees(pid, rec, canon)
        if tier == "full_name":
            # A distinctive full name links on its own ONLY while nothing contradicts
            # it. A resolved nation that does not overlap the card (after successor-
            # lineage expansion) is a contradiction — it may be a coincidental
            # namesake from another country (e.g. a modern player sharing a name with
            # a non-World-Cup great), so the link is WITHHELD unless career year
            # independently corroborates it. Nation simply being unknown never blocks.
            if not nation_contradicts:
                return pid, "full_name" + ("+nation" if nation_ok else ""), cands
            if year_ok:
                return pid, "full_name+year", cands
            return None, "nation_divergent", cands
        # Weaker tier (surname / key name): require positive corroboration.
        if nation_ok:
            return pid, f"{tier}+nation", cands
        if not nat and year_ok:
            return pid, f"{tier}+year", cands
        reason = "nation_mismatch" if nation_contradicts else "weak_unverified"
        return None, reason, cands

    # More than one candidate — narrow by nation, then by year.
    narrowed = [p for p in cands if canon.nations.get(p, frozenset()) & nat] if nat else cands
    if len(narrowed) == 1:
        return narrowed[0], f"{tier}+nation", cands
    pool = narrowed or cands
    year_hits = [p for p in pool if _year_agrees(p, rec, canon)]
    if len(year_hits) == 1:
        return year_hits[0], f"{tier}+year", cands
    return None, "multi_candidate", cands


def link_records(
    records: list[MeritRecord], canon: _Canon
) -> tuple[list[dict], list[dict]]:
    """Link every record. Returns (facts, review). Facts are de-duplicated to one
    per (player_id, source_id, year, fact-discriminator) — the discriminator (caps
    vs goals, a specific election) keeps genuinely distinct facts that share a
    null year from collapsing, while an exact repeat of the same row still folds to
    one. Review rows aggregate per distinct (source_id, reason, raw name, nation)."""
    facts_by_key: dict[tuple, dict] = {}
    review_acc: dict[tuple, dict] = {}

    for rec in records:
        pid, method, cands = _link_one(rec, canon)
        if pid is not None:
            key = (pid, rec.source_id, rec.year, _fact_discriminator(rec))
            if key in facts_by_key:
                continue  # keep first (parse order is most-significant-first)
            facts_by_key[key] = {
                "player_id": pid,
                "player_name": canon.display.get(pid, pid),
                "source_id": rec.source_id,
                "family": rec.family,
                "year": rec.year,
                "era": era_bucket(canon.wc_years[pid][0]),
                "method": method,
                "raw_name": rec.name,
                "nation_token": rec.nation_token,
                "detail": rec.detail,
            }
        else:
            rkey = (rec.source_id, method, norm(rec.name), rec.nation_token or "")
            row = review_acc.get(rkey)
            if row is None:
                review_acc[rkey] = {
                    "source_id": rec.source_id,
                    "family": rec.family,
                    "reason": method,
                    "raw_name": rec.name,
                    "nation_token": rec.nation_token,
                    "year": rec.year,
                    "candidates": [
                        {"player_id": p, "player_name": canon.display.get(p, p)} for p in cands
                    ],
                    "occurrences": 1,
                }
            else:
                row["occurrences"] += 1

    facts = sorted(
        facts_by_key.values(),
        key=lambda f: (
            f["player_id"],
            f["source_id"],
            f["year"] if f["year"] is not None else -1,
            f["detail"],
        ),
    )
    review = sorted(
        review_acc.values(),
        key=lambda r: (r["source_id"], r["reason"], norm(r["raw_name"]), r["nation_token"] or ""),
    )
    return facts, review


def native_wc_legacy_facts(awards: list[dict], canon: _Canon) -> list[dict]:
    """Emit the native, pre-linked World Cup individual-award facts (wc_legacy).
    Drawn straight from the canonical awards table — no source row, no guessing."""
    facts: dict[tuple, dict] = {}
    for a in awards:
        pid = a.get("player_id")
        if not pid or pid not in canon.wc_years:
            continue  # men's-eligible only; honest-state if absent
        year = int(a["tournament_id"].split("-")[1]) if a.get("tournament_id") else None
        key = (pid, a["award_name"], year)
        facts[key] = {
            "player_id": pid,
            "player_name": canon.display.get(pid, pid),
            "source_id": NATIVE_WC_AWARDS_SOURCE,
            "family": "wc_legacy",
            "year": year,
            "era": era_bucket(canon.wc_years[pid][0]),
            "method": "native_canonical",
            "raw_name": a["award_name"],
            "nation_token": None,
            "detail": f"{a['award_name']} {a.get('tournament_id', '')}".strip(),
        }
    return sorted(
        facts.values(),
        key=lambda f: (f["player_id"], f["year"] if f["year"] is not None else -1, f["detail"]),
    )


def crosscheck_golden_ball(
    crosscheck_rows: list[dict], awards: list[dict], canon: _Canon
) -> dict:
    """Validate the native Golden Ball winners against the public list. For each
    canonical Golden Ball award, compare the canonical winner's normalized name to
    the public row for that World Cup year. Returns agreement/mismatch counts and
    the (few) mismatches — the native data stays canonical regardless."""
    public_by_year = {r["year"]: r for r in crosscheck_rows}
    agree = 0
    mismatches: list[dict] = []
    missing: list[int] = []
    checked = 0
    for a in awards:
        if a.get("award_name") != "Golden Ball" or not a.get("player_id"):
            continue
        if a["player_id"] not in canon.wc_years:
            continue  # men's pool only — the public list is the men's World Cup
        year = int(a["tournament_id"].split("-")[1])
        pub = public_by_year.get(year)
        if pub is None:
            missing.append(year)
            continue
        checked += 1
        canon_name = canon.display.get(a["player_id"], "")
        canon_key = norm(canon_name)
        # Agreement = the public key is contained in, or contains, the canonical key
        # (handles "Ronaldo" vs "Ronaldo Nazário" style short/long renderings).
        pk = pub["name_key"]
        if pk and canon_key and (pk in canon_key or canon_key in pk):
            agree += 1
        else:
            mismatches.append(
                {"year": year, "canonical": canon_name, "public": pub["name"]}
            )
    return {
        "checked": checked,
        "agree": agree,
        "mismatch": len(mismatches),
        "mismatches": sorted(mismatches, key=lambda m: m["year"]),
        "public_years_missing_native": sorted(missing),
        "public_rows": len(crosscheck_rows),
    }


def build_canon(players, cards, tournaments, nations) -> _Canon:
    """Public entry to build the canonical index (used by build + tests)."""
    return _build_canon(players, cards, tournaments, nations)


def family_keys() -> tuple[str, ...]:
    return FAMILY_KEYS


def source_label(source_id: str) -> str:
    src = SOURCE_BY_ID.get(source_id)
    return src.label if src else source_id
