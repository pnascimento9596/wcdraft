"""Render ``MERIT_SOURCES.md`` — the merit source-set COVERAGE REPORT.

This report is the de-risk artifact: it proves, before any rating integration, how
much career-stature signal each source actually links, broken down by signal family
and player era, and shows fixed checklists of canonical greats — including an
explicit defender / goalkeeper section — picking up stature. It asserts nothing
about ratings: the MV2-1 source-set expansion changes no rating output (the v2
source families are staged in ``source_facts.json`` for MV2-3).

Pure function of the linked facts + review queue + cross-check result."""

from __future__ import annotations

from collections import Counter, defaultdict

from . import (
    ACTIVE_SOURCE_FAMILIES,
    ATTRIBUTION,
    ERA_BUCKETS,
    SIGNAL_FAMILIES,
    SOURCE_SET_VERSION,
)
from .link import source_label

# Active families in report column order (legacy/reserved keys are shown as notes,
# not counted columns).
_ACTIVE_FAMILIES = (
    "wc_legacy",
    "global_annual_recognition",
    "regional_annual_recognition",
    "position_balanced_selection",
    "international_record",
    "retrospective_selection",
)
_FAMILY_SHORT = {
    "wc_legacy": "WC legacy",
    "global_annual_recognition": "Global annual",
    "regional_annual_recognition": "Regional annual",
    "position_balanced_selection": "Position XI",
    "international_record": "Int'l record",
    "retrospective_selection": "Retrospective",
}

_ERA_LABEL = {"pre_1956": "pre-1956", "1956_1990": "1956–1990", "1991_plus": "1991+"}

# Native World Cup awards carry no source row; every other source is fetched. Used to
# split parser-derived facts from the native canonical facts in the report.
_NATIVE_SOURCE = "wc_individual_awards_native"

# Fixed checklist of canonical greats across eras + positions. Player ids are pinned
# so the de-risk signal is stable run-to-run; era is derived from the canonical data.
_GREATS: tuple[tuple[str, str], ...] = (
    ("Pelé", "P-38906"),
    ("Alfredo Di Stéfano", "P-34403"),
    ("Garrincha", "P-46080"),
    ("Ferenc Puskás", "P-12676"),
    ("Lev Yashin (GK)", "P-09317"),
    ("Bobby Charlton", "P-08601"),
    ("Eusébio", "P-74747"),
    ("Franz Beckenbauer", "P-72864"),
    ("Johan Cruyff", "P-50564"),
    ("Gerd Müller", "P-72441"),
    ("Diego Maradona", "P-80404"),
    ("Michel Platini", "P-08939"),
    ("Zico", "P-37483"),
    ("Karl-Heinz Rummenigge", "P-59574"),
    ("Franco Baresi (DF)", "P-42920"),
    ("Lothar Matthäus", "P-49502"),
    ("Marco van Basten", "P-76874"),
    ("Roberto Baggio", "P-78756"),
    ("Zinedine Zidane", "P-56430"),
    ("Ronaldo", "P-62722"),
    ("Ronaldinho", "P-57361"),
    ("Cafu (DF)", "P-91718"),
    ("Gianluigi Buffon (GK)", "P-11392"),
    ("Paolo Maldini (DF)", "P-43222"),
    ("Lionel Messi", "P-14758"),
    ("Cristiano Ronaldo", "P-70442"),
)

# Defender / goalkeeper coverage checklist — the v2 source-set repair target. These
# legends were under-sourced by the striker-biased v1 ballots; the position-balanced
# and all-time sources must now give them facts (and, where the source states it, a
# first-class DF/GK position).
_DEF_GK_CHECKLIST: tuple[tuple[str, str], ...] = (
    ("Franco Baresi", "P-42920"),
    ("Paolo Maldini", "P-43222"),
    ("Lev Yashin", "P-09317"),
    ("Gianluigi Buffon", "P-11392"),
    ("Cafu", "P-91718"),
    ("Franz Beckenbauer", "P-72864"),
)


def _families_by_player(facts: list[dict]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for f in facts:
        out[f["player_id"]].add(f["family"])
    return out


def _positions_by_player(facts: list[dict]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for f in facts:
        if f.get("position"):
            out[f["player_id"]].add(f["position"])
    return out


def render_report(facts: list[dict], review: list[dict], crosscheck: dict, canon) -> str:
    from . import era_bucket

    cov: dict[tuple[str, str], set[str]] = defaultdict(set)
    for f in facts:
        cov[(f["family"], f["era"])].add(f["player_id"])

    fam_players = _families_by_player(facts)
    pos_players = _positions_by_player(facts)
    linked_players = len(fam_players)
    parser_facts = sum(1 for f in facts if f["source_id"] != _NATIVE_SOURCE)
    native_facts = len(facts) - parser_facts
    position_facts = sum(1 for f in facts if f.get("position"))

    L: list[str] = []
    L.append("# Career-stature source coverage (merit-source-set v2)\n")
    L.append(f"> {ATTRIBUTION}\n")
    L.append(
        f"- **Source-set version:** `{SOURCE_SET_VERSION}`\n"
        f"- **Scope:** coverage only — **no rating output, engine, or compact data "
        f"is changed by this build.** The v2 source families are staged in "
        f"`source_facts.json` for the career-stature-2.0.0 table (MV2-3).\n"
        f"- **Linked facts:** {len(facts):,} across {linked_players:,} distinct "
        f"players (men's World Cup pool) — **{parser_facts:,} parser-derived** + "
        f"**{native_facts:,} native** World Cup awards.\n"
        f"- **First-class position facts:** {position_facts:,} (GK/DF/MF/FW) from "
        f"the position-balanced + all-time sources.\n"
        f"- **Withheld to review (never assigned):** {len(review):,} distinct "
        f"ambiguities.\n"
    )

    # ─── coverage table: family x era (distinct linked players) ───
    L.append("\n## Linked players by signal family × player era\n")
    header = "| Signal family | " + " | ".join(_ERA_LABEL[e] for e in ERA_BUCKETS) + " | Total |"
    L.append(header)
    L.append("|" + "---|" * (len(ERA_BUCKETS) + 2))
    for fam in _ACTIVE_FAMILIES:
        cells = []
        total_ids: set[str] = set()
        for e in ERA_BUCKETS:
            ids = cov.get((fam, e), set())
            total_ids |= ids
            cells.append(str(len(ids)))
        L.append(f"| {_FAMILY_SHORT[fam]} | " + " | ".join(cells) + f" | {len(total_ids)} |")
    reserved = [
        f for f in SIGNAL_FAMILIES if f.key not in ACTIVE_SOURCE_FAMILIES
    ]
    for f in reserved:
        L.append(f"| {f.key} | — | — | — | _reserved / legacy (no v2 source)_ |")

    # ─── per-source linked-fact counts (parser vs native split) ───
    L.append("\n## Linked facts per source\n")
    by_source = Counter(f["source_id"] for f in facts)
    L.append("| Source | Family | Linked facts |\n|---|---|---|")
    for sid in sorted(by_source):
        fam = next((f["family"] for f in facts if f["source_id"] == sid), "")
        L.append(f"| {source_label(sid)} | {fam} | {by_source[sid]:,} |")

    # ─── Golden Ball cross-check ───
    cc = crosscheck
    L.append("\n## World Cup Golden Ball cross-check (native data is canonical)\n")
    L.append(
        f"- Native Golden Ball awards checked against the public list: "
        f"**{cc['agree']}/{cc['checked']} agree** "
        f"({cc['public_rows']} public rows).\n"
    )
    if cc["mismatches"]:
        L.append("- Divergences (canonical retained, flagged for a human):")
        for m in cc["mismatches"]:
            L.append(f"  - {m['year']}: canonical `{m['canonical']}` vs public `{m['public']}`")
    else:
        L.append(
            "- No divergences: every checked native Golden Ball winner matches the public list."
        )

    # ─── review queue breakdown ───
    L.append("\n## Review queue (withheld — null coverage, never a zero-fact)\n")
    by_reason = Counter(r["reason"] for r in review)
    L.append("| Reason | Distinct names |\n|---|---|")
    for reason in sorted(by_reason):
        L.append(f"| {reason} | {by_reason[reason]} |")
    L.append(
        "\nEvery row in `link_review.json` carries the source, raw name, nation "
        "token, year and any candidate ids — a human can resolve it without "
        "re-deriving the link. Missing coverage is coverage: an unlinked record is "
        "absent, never recorded as a zero-stature fact against a player.\n"
    )

    # ─── defender / goalkeeper coverage (the v2 repair target) ───
    L.append("\n## Defender / goalkeeper coverage (the v2 repair)\n")
    L.append(
        "The striker-biased v1 ballots under-sourced these legends. The "
        "position-balanced (UEFA positional / ESM) and all-time (Ballon d'Or Dream "
        "Team / IFFHS) sources must now give each of them facts — and, where the "
        "source states it, a first-class position. ✓ = at least one fact.\n"
    )
    L.append("| Defender / keeper | Era | Facts | Positions | Families |")
    L.append("|---|---|---:|---|---|")
    for name, pid in _DEF_GK_CHECKLIST:
        fams = fam_players.get(pid, set())
        poss = sorted(pos_players.get(pid, set()))
        years = canon.wc_years.get(pid)
        era = _ERA_LABEL[era_bucket(years[0])] if years else "—"
        n = sum(1 for f in facts if f["player_id"] == pid)
        fam_list = ", ".join(_FAMILY_SHORT.get(f, f) for f in _ACTIVE_FAMILIES if f in fams)
        pos_str = ", ".join(poss) if poss else "—"
        L.append(f"| {name} | {era} | {n} | {pos_str} | {fam_list or '—'} |")
    L.append(
        "\n_Position is read from each source's own structure (a positional section "
        "or a formation column), never inferred from a player's identity. A mononym "
        "with no corroborating nation/year (e.g. an all-time-XI 'Cafu') is withheld "
        "by the conservative linker, so a great may carry facts without a positioned "
        "row — honest under-coverage, never a guess._\n"
    )

    # ─── canonical-greats checklist (the de-risk signal) ───
    L.append("\n## Canonical-greats checklist (the de-risk signal)\n")
    L.append(
        "Each legend should visibly pick up stature across families. ✓ = at least "
        "one linked fact in that family.\n"
    )
    cols = " | ".join(_FAMILY_SHORT[f] for f in _ACTIVE_FAMILIES)
    L.append(f"| Great | Era | {cols} | Families |")
    L.append("|" + "---|" * (len(_ACTIVE_FAMILIES) + 3))
    for name, pid in _GREATS:
        fams = fam_players.get(pid, set())
        years = canon.wc_years.get(pid)
        era = _ERA_LABEL[era_bucket(years[0])] if years else "—"
        marks = ["✓" if f in fams else "—" for f in _ACTIVE_FAMILIES]
        n = sum(1 for f in _ACTIVE_FAMILIES if f in fams)
        L.append(f"| {name} | {era} | " + " | ".join(marks) + f" | {n}/{len(_ACTIVE_FAMILIES)} |")

    covered = sum(1 for _n, pid in _GREATS if fam_players.get(pid))
    L.append(
        f"\n**{covered}/{len(_GREATS)}** canonical greats picked up at least one "
        "linked stature fact.\n"
    )
    return "\n".join(L) + "\n"
