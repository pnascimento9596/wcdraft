"""Render ``MERIT_SOURCES.md`` — the E-4.1 COVERAGE REPORT.

This report is the de-risk artifact: it proves, before any rating integration, how
much career-stature signal each source actually links, broken down by signal
family and player era, and shows a fixed checklist of canonical greats picking up
stature. It asserts nothing about ratings — E-4.1 changes no rating output.

Pure function of the linked facts + review queue + cross-check result."""

from __future__ import annotations

from collections import Counter, defaultdict

from . import (
    ATTRIBUTION,
    ERA_BUCKETS,
    SIGNAL_FAMILIES,
    VERSION,
)
from .link import source_label

# Active families in column order (club_honors is deferred — shown, not counted).
_ACTIVE_FAMILIES = (
    "wc_legacy",
    "annual_recognition",
    "international_record",
    "retrospective_selection",
)

_ERA_LABEL = {"pre_1956": "pre-1956", "1956_1990": "1956–1990", "1991_plus": "1991+"}

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


def _families_by_player(facts: list[dict]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for f in facts:
        out[f["player_id"]].add(f["family"])
    return out


def render_report(facts: list[dict], review: list[dict], crosscheck: dict, canon) -> str:
    # (family, era) -> distinct player ids
    cov: dict[tuple[str, str], set[str]] = defaultdict(set)
    for f in facts:
        cov[(f["family"], f["era"])].add(f["player_id"])

    fam_players = _families_by_player(facts)
    linked_players = len(fam_players)

    L: list[str] = []
    L.append("# Career-stature source coverage (ENGINE-V2 E-4.1)\n")
    L.append(f"> {ATTRIBUTION}\n")
    L.append(
        f"- **Intake version:** `{VERSION}`\n"
        f"- **Scope:** coverage proof only — **no rating output, engine, or compact "
        f"data is changed by this build.**\n"
        f"- **Linked facts:** {len(facts):,} across {linked_players:,} distinct "
        f"players (men's World Cup pool).\n"
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
        L.append(f"| {fam} | " + " | ".join(cells) + f" | {len(total_ids)} |")
    # deferred family row
    deferred = next(f for f in SIGNAL_FAMILIES if f.key == "club_honors")
    L.append(
        f"| club_honors | — | — | — | _deferred (E-4b), weight {deferred.weight:.1f}_ |"
    )

    # ─── per-source linked-fact counts ───
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

    # ─── canonical-greats checklist (the de-risk signal) ───
    L.append("\n## Canonical-greats checklist (the de-risk signal)\n")
    L.append(
        "Each legend should visibly pick up stature across families before the lift "
        "is integrated. ✓ = at least one linked fact in that family.\n"
    )
    col = {
        "wc_legacy": "WC legacy",
        "annual_recognition": "Annual",
        "international_record": "Int'l record",
        "retrospective_selection": "Retrospective",
    }
    L.append(
        "| Great | Era | " + " | ".join(col[f] for f in _ACTIVE_FAMILIES) + " | Families |"
    )
    L.append("|" + "---|" * (len(_ACTIVE_FAMILIES) + 3))
    for name, pid in _GREATS:
        fams = fam_players.get(pid, set())
        years = canon.wc_years.get(pid)
        from . import era_bucket

        era = _ERA_LABEL[era_bucket(years[0])] if years else "—"
        marks = ["✓" if f in fams else "—" for f in _ACTIVE_FAMILIES]
        n = sum(1 for f in _ACTIVE_FAMILIES if f in fams)
        L.append(f"| {name} | {era} | " + " | ".join(marks) + f" | {n}/4 |")

    covered = sum(1 for _n, pid in _GREATS if fam_players.get(pid))
    L.append(
        f"\n**{covered}/{len(_GREATS)}** canonical greats picked up at least one "
        "linked stature fact.\n"
    )
    return "\n".join(L) + "\n"
