"""MV2-12a — active-career stature intake (FACTS ONLY, structurally inert).

The career-stature archive covers COMPLETED careers: 791 players, peak-year
ceiling 2022, zero entries ≥ 2023 (the MV2-12 audit's confirmed C1 mechanism).
Players whose careers are still running — including every 2026 squad member —
are structurally barred from it. This module extends the merit intake to
in-progress careers WITHOUT touching anything the rating stage consumes:

    etl/output/merit/source_facts_active.json           linked active facts
    etl/output/merit/link_review_active.json            withheld ambiguities
    etl/output/merit/career_stature_active_staging.json per-identity staging
                                                        entries (NO score/index)
    etl/output/merit/ACTIVE_CAREERS.md                  the build report

Two fact channels feed it:

  1. PARSER RECOVERY — the committed, SHA-pinned source snapshots already carry
     recognition records for active players (annual-XI selections, century caps
     rows, annual-award wins) that the main build withholds as ``no_candidate``
     because the player has no historical men's World Cup card. Those records
     are re-linked here against the MINTED 2026 identity space
     (``players_2026.json``) under the same conservative discipline — unique
     high-confidence link only, ambiguity withheld. A record is eligible ONLY
     when the historical canon offers NO candidate at all, so nothing the main
     build linked (or holds in its review queue with candidates) is ever
     re-routed.
  2. ACTIVE NOTES — committed citation-backed notes under ``merit/raw/active/``
     (own SHA-pinned manifest), the MV2-2 research-backstop pattern applied to
     in-progress careers: curated recognition the snapshots cannot yield
     (post-snapshot award wins, standing captaincies, canonical-name recovery
     of withheld longevity rows). An uncited row FAILS the build.

INERTNESS CONTRACT (the load-bearing MV2-12a line):

  * Nothing here writes to — or is read by — ``source_facts.json``,
    ``career_stature.json``, ``rating.py``, ``rating_2026.py`` or any compact
    bundle. The consumed archive stays byte-identical; activation of this
    channel is MV2-12b's explicit, reviewable flip (full Red chain).
  * NO score, index, tier or legend is computed for staged entries: the
    completed-career composite is the wrong model for an in-progress career
    (career-stage normalization is MV2-12b design work). Staging carries facts
    and identity only.
  * A staged fact may not target a player who already has an archive row —
    intake covers the structural gap, never double-credits an identity. The
    build FAILS if curation drifts onto an archived player.
  * Honest-state: a player with no citable post-archive record gets no entry;
    refuted or unverifiable curation attempts are dropped and documented in the
    note files' ``curation_notes``.

IDENTITY: facts are keyed to a single explicit identity — a canonical
historical ``player_id`` (active player with a men's WC card) or a minted 2026
``player_id`` (``P-W26-…``). Minted players whose name + birth date shadow a
fact-carrying historical identity are surfaced in ``identity_bridge_review``
(review-only; the bridge seam itself is MV2-12b scope).

Pure + offline: a re-run over the committed snapshots, notes and canonical
tables reproduces byte-identical outputs. No network, clock, randomness or LLM.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from . import (
    ACTIVE_CUTOFF_DATE,
    ACTIVE_SOURCE_SET_VERSION,
    ACTIVE_SOURCES,
    MeritRecord,
)
from . import build as merit_build
from .link import _candidates, _fact_discriminator, _link_one, build_canon
from .nation import NationResolver
from .paths import ACTIVE_DIR, ACTIVE_MANIFEST_PATH, OUTPUT_DIR
from .text import norm, uppercase_key

# .../etl/src/wcdraft_etl/merit/active.py -> parents[3] == .../etl
_CANON_DIR = Path(__file__).resolve().parents[3] / "output"

# Year-corroboration window for minted identities: a recognition year is
# plausible when the player was at least this old (mirrors the historical
# linker's career-span window in spirit; minted players have no WC span, so the
# committed birth date is the deterministic anchor).
_MIN_RECOGNITION_AGE = 16
# The season the 2026 squads are pinned to — the upper bound for any active
# fact year and for the birth-date plausibility window.
_MAX_FACT_YEAR = 2026


class ActiveIntakeError(RuntimeError):
    """A committed active note is malformed, uncited, out of contract, or the
    staged facts collide with the consumed archive — the build must fail."""


# ─── active note loading (mirrors parse_research, stricter envelope) ──────────


def _read_bytes(raw_file: str) -> bytes:
    return (ACTIVE_DIR.parent / raw_file).read_bytes()


def _load_note(source) -> dict:
    try:
        doc = json.loads(_read_bytes(source.raw_file))
    except FileNotFoundError as exc:  # pragma: no cover - committed file missing
        raise ActiveIntakeError(f"{source.raw_file}: missing committed active note") from exc
    except json.JSONDecodeError as exc:
        raise ActiveIntakeError(f"{source.raw_file}: invalid JSON ({exc})") from exc
    if doc.get("source_id") != source.source_id:
        raise ActiveIntakeError(
            f"{source.raw_file}: source_id {doc.get('source_id')!r} != registry "
            f"{source.source_id!r}"
        )
    if doc.get("family") != source.family:
        raise ActiveIntakeError(
            f"{source.raw_file}: family {doc.get('family')!r} != registry {source.family!r}"
        )
    if doc.get("cutoff_date") != ACTIVE_CUTOFF_DATE:
        raise ActiveIntakeError(
            f"{source.raw_file}: cutoff_date {doc.get('cutoff_date')!r} != "
            f"{ACTIVE_CUTOFF_DATE!r}"
        )
    if not isinstance(doc.get("rows"), list) or not doc["rows"]:
        raise ActiveIntakeError(f"{source.raw_file}: 'rows' must be a non-empty list")
    if not isinstance(doc.get("curation_notes"), list):
        raise ActiveIntakeError(f"{source.raw_file}: 'curation_notes' must be a list")
    return doc


def _record(source, row: dict) -> MeritRecord:
    """Validate one row's citation + shape and build a MeritRecord. Raises on any
    uncited / malformed / out-of-contract row."""
    name = row.get("name")
    if not name or not isinstance(name, str):
        raise ActiveIntakeError(f"{source.raw_file}: row missing 'name'")
    if row.get("scope") != "active_career":
        raise ActiveIntakeError(f"{source.raw_file}: {name!r} scope must be 'active_career'")
    cite = row.get("citation")
    if not isinstance(cite, dict):
        raise ActiveIntakeError(f"{source.raw_file}: {name!r} has no citation object")
    url = cite.get("url")
    claim = cite.get("claim")
    if not url or not isinstance(url, str) or not url.lower().startswith("http"):
        raise ActiveIntakeError(f"{source.raw_file}: {name!r} citation.url is not a real URL")
    if not claim or not isinstance(claim, str):
        raise ActiveIntakeError(f"{source.raw_file}: {name!r} citation.claim is empty")
    pos = row.get("position")
    if pos is not None and pos not in ("GK", "DF", "MF", "FW"):
        raise ActiveIntakeError(f"{source.raw_file}: {name!r} bad position {pos!r}")
    year = row.get("year")
    if year is not None and (not isinstance(year, int) or year > _MAX_FACT_YEAR):
        raise ActiveIntakeError(
            f"{source.raw_file}: {name!r} year {year!r} is invalid or past the cutoff"
        )
    extra: dict = {
        "citation": {"url": url, "claim": claim},
        "scope": row["scope"],
    }
    # Optional ``kind`` keeps genuinely distinct same-year facts from collapsing
    # in the (player, source, year, discriminator) de-dup (e.g. two distinct
    # 2025 distinctions from the same active source).
    kind = row.get("kind")
    if kind is not None:
        if not isinstance(kind, str) or not kind:
            raise ActiveIntakeError(f"{source.raw_file}: {name!r} bad kind {kind!r}")
        extra["selection"] = kind
    return MeritRecord(
        source_id=source.source_id,
        family=source.family,
        name=name,
        nation_token=row.get("nation_token"),
        year=year,
        position=pos,
        detail=row.get("detail", ""),
        extra=extra,
    )


def collect_notes() -> tuple[list[MeritRecord], list[str]]:
    """All active-note records in stable (source, file-order) order, plus the
    sources' curation notes (the documented attempted-but-dropped record)."""
    records: list[MeritRecord] = []
    curation_notes: list[str] = []
    for source in ACTIVE_SOURCES:
        doc = _load_note(source)
        curation_notes.extend(doc["curation_notes"])
        for row in doc["rows"]:
            records.append(_record(source, row))
    return records, curation_notes


# ─── minted 2026 identity canon ───────────────────────────────────────────────


@dataclass
class _MintedCanon:
    """Name indexes over the minted 2026 identity space (players with no
    historical men's WC card; ``player_id`` = ``P-W26-…``)."""

    specific: dict[str, set[str]]
    surname: dict[str, set[str]]
    nations: dict[str, frozenset[str]]
    birth_year: dict[str, int | None]
    display: dict[str, str]


def build_minted_canon(players_2026: list[dict], cards_2026: list[dict]) -> _MintedCanon:
    nat: dict[str, set[str]] = defaultdict(set)
    for c in cards_2026:
        nat[c["player_id"]].add(c["nation_id"])
    specific: dict[str, set[str]] = defaultdict(set)
    surname: dict[str, set[str]] = defaultdict(set)
    display: dict[str, str] = {}
    birth_year: dict[str, int | None] = {}
    for p in players_2026:
        pid = p["player_id"]
        given = p.get("given_name") or ""
        family = p.get("family_name") or ""
        full = p.get("full_name") or ""
        common = p.get("common_name") or ""
        display[pid] = full or common or pid
        bd = p.get("birth_date") or ""
        birth_year[pid] = int(bd[:4]) if len(bd) >= 4 and bd[:4].isdigit() else None
        for key in (norm(full), norm(f"{given} {family}")):
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
    return _MintedCanon(
        specific=specific,
        surname=surname,
        nations={pid: frozenset(ns) for pid, ns in nat.items()},
        birth_year=birth_year,
        display=display,
    )


class _NationResolver2026:
    """Historical resolver first (returning nations reuse historical ids), then
    the 2026 nations table for federations with no historical id."""

    def __init__(self, nations: list[dict], nations_2026: list[dict]):
        self._historical = NationResolver(nations)
        self._by_name_2026: dict[str, str] = {}
        for n in nations_2026:
            for nm in (n["canonical_name"], *n.get("aliases", []), n.get("code") or ""):
                key = norm(nm)
                if key:
                    self._by_name_2026.setdefault(key, n["nation_id"])

    def resolve(self, token: str | None) -> frozenset[str]:
        ids = self._historical.resolve(token)
        if ids:
            return ids
        key = norm(token or "")
        nid = self._by_name_2026.get(key)
        return frozenset({nid}) if nid else frozenset()


def _minted_candidates(rec: MeritRecord, mc: _MintedCanon) -> tuple[list[str], str]:
    whole = norm(rec.name)
    if whole and whole in mc.specific:
        return sorted(mc.specific[whole]), "full_name"
    upper = uppercase_key(rec.name)
    if upper and upper in mc.surname:
        return sorted(mc.surname[upper]), "key_name"
    if whole and whole in mc.surname:
        return sorted(mc.surname[whole]), "surname"
    return [], "no_candidate"


def _minted_year_agrees(pid: str, rec: MeritRecord, mc: _MintedCanon) -> bool:
    probe = rec.year or rec.career_end or rec.career_start
    born = mc.birth_year.get(pid)
    if probe is None or born is None:
        return False
    return born + _MIN_RECOGNITION_AGE <= probe <= _MAX_FACT_YEAR


def _link_minted(
    rec: MeritRecord, mc: _MintedCanon, nat: frozenset[str]
) -> tuple[str | None, str, list[str]]:
    """Resolve one record against the minted 2026 identity space — the same
    conservative tiering as ``link._link_one`` (full name links unless nation
    contradicts; weaker tiers need positive corroboration; multi-candidate
    narrows by nation then year; everything else withheld)."""
    cands, tier = _minted_candidates(rec, mc)
    if not cands:
        return None, "no_candidate", []

    if len(cands) == 1:
        pid = cands[0]
        nation_ok = bool(nat) and bool(mc.nations.get(pid, frozenset()) & nat)
        nation_contradicts = bool(nat) and not nation_ok
        year_ok = _minted_year_agrees(pid, rec, mc)
        if tier == "full_name":
            if not nation_contradicts:
                return pid, "minted:full_name" + ("+nation" if nation_ok else ""), cands
            if year_ok:
                return pid, "minted:full_name+year", cands
            return None, "nation_divergent", cands
        if nation_ok:
            return pid, f"minted:{tier}+nation", cands
        if not nat and year_ok:
            return pid, f"minted:{tier}+year", cands
        reason = "nation_mismatch" if nation_contradicts else "weak_unverified"
        return None, reason, cands

    narrowed = [p for p in cands if mc.nations.get(p, frozenset()) & nat] if nat else cands
    if len(narrowed) == 1:
        return narrowed[0], f"minted:{tier}+nation", cands
    pool = narrowed or cands
    year_hits = [p for p in pool if _minted_year_agrees(p, rec, mc)]
    if len(year_hits) == 1:
        return year_hits[0], f"minted:{tier}+year", cands
    return None, "multi_candidate", cands


# ─── fact assembly ────────────────────────────────────────────────────────────


def _fact(rec: MeritRecord, pid: str, name: str, identity_space: str, method: str) -> dict:
    fact = {
        "player_id": pid,
        "player_name": name,
        "identity_space": identity_space,
        "source_id": rec.source_id,
        "family": rec.family,
        "year": rec.year,
        "position": rec.position,
        "method": method,
        "raw_name": rec.name,
        "nation_token": rec.nation_token,
        "detail": rec.detail,
    }
    citation = (rec.extra or {}).get("citation")
    if citation:
        fact["citation"] = citation
    return fact


def _sort_facts(facts: list[dict]) -> list[dict]:
    return sorted(
        facts,
        key=lambda f: (
            f["player_id"],
            f["source_id"],
            f["year"] if f["year"] is not None else -1,
            f["detail"],
            f["position"] or "",
        ),
    )


# ─── build ────────────────────────────────────────────────────────────────────


def _load(name: str):
    return json.loads((_CANON_DIR / name).read_text(encoding="utf-8"))


def build(write: bool = True) -> dict:
    players = _load("players.json")
    cards = _load("player_tournaments.json")
    tournaments = _load("tournaments.json")
    nations = _load("nations.json")
    players_2026 = _load("players_2026.json")
    cards_2026 = _load("player_tournaments_2026.json")
    nations_2026 = _load("nations_2026.json")

    canon = build_canon(players, cards, tournaments, nations)
    minted = build_minted_canon(players_2026, cards_2026)
    resolver = _NationResolver2026(nations, nations_2026)
    squad_pids = {c["player_id"] for c in cards_2026}

    facts_by_key: dict[tuple, dict] = {}
    review_acc: dict[tuple, dict] = {}

    def _withhold(rec: MeritRecord, reason: str, cands: list[str], channel: str) -> None:
        rkey = (rec.source_id, reason, norm(rec.name), rec.nation_token or "")
        row = review_acc.get(rkey)
        if row is None:
            review_acc[rkey] = {
                "channel": channel,
                "source_id": rec.source_id,
                "family": rec.family,
                "reason": reason,
                "raw_name": rec.name,
                "nation_token": rec.nation_token,
                "year": rec.year,
                "candidates": [
                    {"player_id": p, "player_name": minted.display.get(p, canon.display.get(p, p))}
                    for p in cands
                ],
                "occurrences": 1,
            }
        else:
            row["occurrences"] += 1

    def _add_fact(rec: MeritRecord, pid: str, name: str, space: str, method: str) -> None:
        key = (pid, rec.source_id, rec.year, _fact_discriminator(rec))
        if key in facts_by_key:
            return  # exact repeat folds; parse order is most-significant-first
        facts_by_key[key] = _fact(rec, pid, name, space, method)

    # Channel 1 — parser recovery against the minted 2026 identity space. A
    # record is eligible ONLY when the HISTORICAL canon has no candidate at all:
    # everything else belongs to the main build (linked there, or withheld there
    # with its candidates intact).
    for rec in merit_build.collect_records():
        hist_cands, _ = _candidates(rec, canon)
        if hist_cands:
            continue
        nat = resolver.resolve(rec.nation_token)
        pid, method, cands = _link_minted(rec, minted, nat)
        if pid is not None:
            _add_fact(rec, pid, minted.display[pid], "minted_2026", method)
        elif method != "no_candidate":
            # no_candidate stays silent here — those records are already in the
            # MAIN review queue; only genuine minted-space ambiguities surface.
            _withhold(rec, method, cands, "parser_recovery")

    # Channel 2 — citation-backed active notes: historical canon first (active
    # players with a men's WC card keep their canonical id), then minted.
    note_records, curation_notes = collect_notes()
    for rec in note_records:
        pid, method, cands = _link_one(rec, canon)
        if pid is not None:
            _add_fact(rec, pid, canon.display.get(pid, pid), "historical", method)
            continue
        if method == "no_candidate":
            nat = resolver.resolve(rec.nation_token)
            mpid, mmethod, mcands = _link_minted(rec, minted, nat)
            if mpid is not None:
                _add_fact(rec, mpid, minted.display[mpid], "minted_2026", mmethod)
            else:
                _withhold(rec, mmethod, mcands, "active_note")
        else:
            _withhold(rec, method, cands, "active_note")

    facts = _sort_facts(list(facts_by_key.values()))

    # INERTNESS GUARD — staged facts may not target an identity the consumed
    # archive already scores; intake covers the structural gap, never
    # double-credits. Curation drift onto an archived player fails the build.
    archive = json.loads((_CANON_DIR / "career_stature.json").read_text(encoding="utf-8"))
    archived_pids = {r["player_id"] for r in archive["career_stature"]}
    collisions = sorted({f["player_id"] for f in facts} & archived_pids)
    if collisions:
        raise ActiveIntakeError(
            "active intake targets archived identities (double-credit): "
            + ", ".join(collisions)
        )

    review = sorted(
        review_acc.values(),
        key=lambda r: (r["source_id"], r["reason"], norm(r["raw_name"]), r["nation_token"] or ""),
    )

    # Staging entries: identity + facts only. NO score / index / tier / legend —
    # scoring an in-progress career needs the career-stage-normalized model that
    # MV2-12b owns; their absence here is the explicit-flip seam.
    by_pid: dict[str, list[dict]] = defaultdict(list)
    for f in facts:
        by_pid[f["player_id"]].append(f)
    entries = []
    for pid in sorted(by_pid):
        pfacts = by_pid[pid]
        entries.append(
            {
                "player_id": pid,
                "identity_space": pfacts[0]["identity_space"],
                "player_name": pfacts[0]["player_name"],
                "in_2026_squad": pid in squad_pids,
                "fact_count": len(pfacts),
                "families": sorted({f["family"] for f in pfacts}),
                "positions": sorted({f["position"] for f in pfacts if f["position"]}),
                "source_refs": sorted({f"{f['source_id']}:{f['detail']}" for f in pfacts}),
            }
        )

    bridges = _identity_bridge_review(players_2026, cards_2026, canon, archived_pids, set(by_pid))

    facts_doc = {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "cutoff_date": ACTIVE_CUTOFF_DATE,
        "fact_count": len(facts),
        "linked_player_count": len(by_pid),
        "facts": facts,
    }
    review_doc = {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "cutoff_date": ACTIVE_CUTOFF_DATE,
        "review_count": len(review),
        "withheld_occurrences": sum(r["occurrences"] for r in review),
        "review": review,
    }
    staging_doc = {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "cutoff_date": ACTIVE_CUTOFF_DATE,
        "inert": True,
        "note": (
            "Active-career staging entries (MV2-12a). Facts + identity only: no "
            "career_stature_score, index, tier or legend is computed — the "
            "completed-career composite is the wrong model for an in-progress "
            "career. Nothing in the rating stage reads this file; MV2-12b "
            "activates the channel explicitly (career-stage-normalized index, "
            "full Red chain)."
        ),
        "entry_count": len(entries),
        "entries": entries,
        "identity_bridge_review": bridges,
        "curation_notes": curation_notes,
    }
    report_md = _render_report(facts, entries, review, bridges, curation_notes)

    if write:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        _write_json(OUTPUT_DIR / "source_facts_active.json", facts_doc)
        _write_json(OUTPUT_DIR / "link_review_active.json", review_doc)
        _write_json(OUTPUT_DIR / "career_stature_active_staging.json", staging_doc)
        (OUTPUT_DIR / "ACTIVE_CAREERS.md").write_text(report_md, encoding="utf-8")

    return {
        "facts": facts,
        "entries": entries,
        "review": review,
        "bridges": bridges,
        "facts_doc": facts_doc,
        "review_doc": review_doc,
        "staging_doc": staging_doc,
        "report_md": report_md,
    }


# ─── identity-bridge review (review-only; the seam itself is MV2-12b) ─────────


def _identity_bridge_review(
    players_2026: list[dict],
    cards_2026: list[dict],
    canon,
    archived_pids: set[str],
    active_fact_pids: set[str],
) -> list[dict]:
    """Minted 2026 identities that shadow a fact-carrying historical identity:
    the SAME human appears to hold a historical ``player_id`` (with an archive
    row or staged active facts) AND a minted 2026 card. Review-only — never
    asserted, never merged here. Requires a unique historical name candidate
    whose nation overlaps the minted card's and whose birth date matches exactly
    (when both sides carry one)."""
    nat_by_pid: dict[str, set[str]] = defaultdict(set)
    for c in cards_2026:
        nat_by_pid[c["player_id"]].add(c["nation_id"])
    bridges: list[dict] = []
    players_by_id = {p["player_id"]: p for p in players_2026}
    # canon does not carry birth dates; they come straight from players.json.
    hist_players = json.loads((_CANON_DIR / "players.json").read_text(encoding="utf-8"))
    hist_birth = {p["player_id"]: p.get("birth_date") for p in hist_players}

    for p in sorted(players_by_id.values(), key=lambda r: r["player_id"]):
        mpid = p["player_id"]
        rec = MeritRecord(
            source_id="identity_bridge",
            family="captaincy",  # unused; _candidates only reads the name
            name=p.get("full_name") or p.get("common_name") or "",
        )
        cands, tier = _candidates(rec, canon)
        if not cands:
            continue
        mnat = nat_by_pid.get(mpid, set())
        mbirth = p.get("birth_date")
        narrowed = []
        for h in cands:
            if mnat and not (canon.nations.get(h, frozenset()) & mnat):
                continue
            hb = hist_birth.get(h)
            if mbirth and hb and mbirth != hb:
                continue
            narrowed.append(h)
        if len(narrowed) != 1:
            continue
        h = narrowed[0]
        if h not in archived_pids and h not in active_fact_pids:
            continue
        hb = hist_birth.get(h)
        bridges.append(
            {
                "minted_player_id": mpid,
                "minted_name": p.get("full_name") or p.get("common_name") or mpid,
                "historical_player_id": h,
                "historical_name": canon.display.get(h, h),
                "historical_has_archive_row": h in archived_pids,
                "historical_has_active_facts": h in active_fact_pids,
                "method": tier
                + "+nation"
                + ("+birth_date" if (mbirth and hb and mbirth == hb) else ""),
            }
        )
    return bridges


# ─── report ───────────────────────────────────────────────────────────────────


def _render_report(facts, entries, review, bridges, curation_notes) -> str:
    L: list[str] = []
    L.append(f"# Active-career intake ({ACTIVE_SOURCE_SET_VERSION})\n")
    L.append(
        "MV2-12a facts-only intake for IN-PROGRESS careers (archive peak-year "
        f"ceiling 2022). Curation cutoff **{ACTIVE_CUTOFF_DATE}**. STRUCTURALLY "
        "INERT: no rating-stage module reads these artifacts; no score/index is "
        "computed. Activation is MV2-12b (career-stage-normalized index, full "
        "Red chain).\n"
    )
    L.append(f"- Linked active facts: **{len(facts)}**")
    L.append(f"- Players staged: **{len(entries)}**")
    L.append(f"- Withheld (review): **{len(review)}**")
    L.append(f"- Identity-bridge review entries: **{len(bridges)}**\n")

    L.append("## Facts by family\n")
    L.append("| Family | facts |")
    L.append("|---|---:|")
    fam_counts: dict[str, int] = defaultdict(int)
    for f in facts:
        fam_counts[f["family"]] += 1
    for fam in sorted(fam_counts):
        L.append(f"| `{fam}` | {fam_counts[fam]} |")

    L.append("\n## Facts by stated position\n")
    L.append("| Position | facts |")
    L.append("|---|---:|")
    pos_counts: dict[str, int] = defaultdict(int)
    for f in facts:
        pos_counts[f["position"] or "(unstated)"] += 1
    for pos in ("GK", "DF", "MF", "FW", "(unstated)"):
        if pos in pos_counts:
            L.append(f"| {pos} | {pos_counts[pos]} |")

    L.append("\n## Staged players\n")
    L.append("| Player | Identity | 2026 squad | Facts | Families |")
    L.append("|---|---|---|---:|---|")
    for e in entries:
        L.append(
            f"| {e['player_name']} (`{e['player_id']}`) | {e['identity_space']} "
            f"| {'✓' if e['in_2026_squad'] else '—'} | {e['fact_count']} "
            f"| {', '.join(e['families'])} |"
        )

    L.append("\n## Identity-bridge review (review-only; MV2-12b seam)\n")
    if bridges:
        L.append("| Minted 2026 id | Historical id | Archive row | Method |")
        L.append("|---|---|---|---|")
        for b in bridges:
            L.append(
                f"| {b['minted_name']} (`{b['minted_player_id']}`) "
                f"| {b['historical_name']} (`{b['historical_player_id']}`) "
                f"| {'✓' if b['historical_has_archive_row'] else '—'} | {b['method']} |"
            )
    else:
        L.append("(none detected)")

    L.append("\n## Curation notes (attempted-but-dropped, documented gaps)\n")
    for n in curation_notes:
        L.append(f"- {n}")
    if not curation_notes:
        L.append("(none)")

    L.append(
        "\n_Conservative linking throughout: a parser record is recovered against "
        "the minted 2026 identity space ONLY when the historical canon offers no "
        "candidate; note rows link historical-first; every ambiguity is withheld, "
        "never assigned. A staged fact may not target an identity the consumed "
        "archive already scores (build-enforced)._\n"
    )
    return "\n".join(L) + "\n"


def _write_json(path: Path, obj: dict) -> None:
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


# ─── active manifest (own SHA-pin; separate from fetch + research manifests) ──


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest_from_committed() -> dict:
    files = []
    for source in ACTIVE_SOURCES:
        data = _read_bytes(source.raw_file)
        doc = json.loads(data)
        cited = sorted({r["citation"]["url"] for r in doc["rows"]})
        files.append(
            {
                "file": source.raw_file,
                "source_id": source.source_id,
                "family": source.family,
                "bytes": len(data),
                "sha256": _sha256(data),
                "row_count": len(doc["rows"]),
                "cited_urls": cited,
            }
        )
    return {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "cutoff_date": ACTIVE_CUTOFF_DATE,
        "note": (
            "MV2-12a active-career intake notes. Citation-backed public facts for "
            "in-progress careers, staged in the inert active channel. Each note is "
            "SHA-pinned and every row carries a fetchable public citation URL plus "
            "the specific claim it supports; editing a citation changes the bytes "
            "and therefore the pinned sha256. An uncited row fails the build."
        ),
        "files": sorted(files, key=lambda f: f["file"]),
    }


def write_manifest(manifest: dict) -> None:
    ACTIVE_MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def verify() -> int:
    manifest = json.loads(ACTIVE_MANIFEST_PATH.read_text(encoding="utf-8"))
    pinned = {f["file"]: f["sha256"] for f in manifest["files"]}
    bad = 0
    for source in ACTIVE_SOURCES:
        actual = _sha256(_read_bytes(source.raw_file))
        want = pinned.get(source.raw_file)
        if want != actual:
            print(
                f"DRIFT {source.raw_file}: manifest={(want or '')[:16]} actual={actual[:16]}"
            )
            bad += 1
    if set(pinned) != {s.raw_file for s in ACTIVE_SOURCES}:
        print("DRIFT active manifest file set != registry active sources")
        bad += 1
    print("merit active manifest verify:", "OK" if not bad else f"{bad} drifted")
    return 1 if bad else 0


if __name__ == "__main__":
    import sys

    if "--verify" in sys.argv:
        raise SystemExit(verify())
    if "--pin" in sys.argv:
        write_manifest(manifest_from_committed())
        print(f"pinned {len(ACTIVE_SOURCES)} active notes -> {ACTIVE_MANIFEST_PATH}")
        raise SystemExit(0)
    out = build(write=True)
    print(f"active-career intake {ACTIVE_SOURCE_SET_VERSION} (cutoff {ACTIVE_CUTOFF_DATE})")
    print(f"  facts:   {len(out['facts'])}  ({len(out['entries'])} players)")
    print(f"  review:  {len(out['review'])}")
    print(f"  bridges: {len(out['bridges'])}")
    print(f"  -> {OUTPUT_DIR}")
