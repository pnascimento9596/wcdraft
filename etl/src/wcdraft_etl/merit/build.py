"""Deterministic build of the merit coverage artifacts (NO rating output).

Reads the committed canonical tables + the committed raw snapshots, runs every
parser, links conservatively, and emits:

    etl/output/merit/source_facts.json   linked facts per player_id
    etl/output/merit/link_review.json    withheld ambiguities (never assigned)
    etl/output/merit/MERIT_SOURCES.md    the coverage report (families x eras +
                                         canonical-greats checklist)

Pure + offline: no network here (fetch is a separate maintenance step). A re-run
reproduces byte-identical outputs.

    python -m wcdraft_etl.merit.build            # write the three artifacts
"""

from __future__ import annotations

import json
from pathlib import Path

from . import (
    SOURCE_SET_VERSION,
    parse_century_caps,
    parse_century_election,
    parse_iffhs_dreamteams,
    parse_poy,
    parse_research,
    parse_rsssf_awards,
    parse_wiki,
    parse_wiki_awards,
    parse_wiki_xi,
)
from .link import (
    build_canon,
    crosscheck_golden_ball,
    link_records,
    native_wc_legacy_facts,
)
from .paths import OUTPUT_DIR
from .report import render_report

# .../etl/src/wcdraft_etl/merit/build.py -> parents[3] == .../etl
_CANON_DIR = Path(__file__).resolve().parents[3] / "output"


def _load(name: str):
    return json.loads((_CANON_DIR / name).read_text(encoding="utf-8"))


def collect_records() -> list:
    """Run every fact-producing parser; return the combined record list."""
    records = []
    # v1 sources (carried over).
    records += parse_poy.parse("european_poy")
    records += parse_poy.parse("south_american_poy")
    records += parse_wiki.parse_iffhs_best()
    records += parse_century_election.parse()
    records += parse_century_caps.parse()
    records += parse_wiki.parse_living_legends()
    # v2 source-set expansion (MV2-1).
    #   regional annual recognition
    records += parse_rsssf_awards.parse_african_poy()
    records += parse_rsssf_awards.parse_asian_poy()
    records += parse_rsssf_awards.parse_sam_placements()
    records += parse_wiki_awards.parse_concacaf_poy()
    #   global annual recognition
    records += parse_wiki_awards.parse_uefa_mens_poy()
    records += parse_rsssf_awards.parse_world_soccer_poy()
    records += parse_rsssf_awards.parse_swedish_footballer_of_year()
    records += parse_rsssf_awards.parse_onze_awards()
    #   position-balanced selections (the defender / goalkeeper repair)
    records += parse_wiki_xi.parse_uefa_club_positional()
    records += parse_wiki_xi.parse_fifpro_world11()
    records += parse_wiki_xi.parse_esm_team_of_the_season()
    #   retrospective / all-time selections (position-aware)
    records += parse_wiki_xi.parse_ballondor_dream_team()
    records += parse_iffhs_dreamteams.parse()
    records += parse_wiki.parse_iffhs_men_legends()
    # MV2-2 deterministic factual research backstop (citation-backed; uncited fails
    # the build). Linked identically to parser rows downstream.
    records += parse_research.collect()
    return records


def build(write: bool = True) -> dict:
    players = _load("players.json")
    cards = _load("player_tournaments.json")
    tournaments = _load("tournaments.json")
    nations = _load("nations.json")
    awards = _load("awards.json")

    canon = build_canon(players, cards, tournaments, nations)

    records = collect_records()
    linked_facts, review = link_records(records, canon)
    native_facts = native_wc_legacy_facts(awards, canon)

    facts = sorted(
        native_facts + linked_facts,
        key=lambda f: (
            f["family"],
            f["player_id"],
            f["source_id"],
            f["year"] if f["year"] is not None else -1,
            f["detail"],
            f["position"] or "",
        ),
    )

    crosscheck = crosscheck_golden_ball(
        parse_wiki.parse_wc_awards_crosscheck(), awards, canon
    )

    source_facts = {
        "version": SOURCE_SET_VERSION,
        "fact_count": len(facts),
        "linked_player_count": len({f["player_id"] for f in facts}),
        "facts": facts,
    }
    review_doc = {
        "version": SOURCE_SET_VERSION,
        "review_count": len(review),
        "withheld_occurrences": sum(r["occurrences"] for r in review),
        "review": review,
    }

    report_md = render_report(facts, review, crosscheck, canon)

    if write:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        _write_json(OUTPUT_DIR / "source_facts.json", source_facts)
        _write_json(OUTPUT_DIR / "link_review.json", review_doc)
        (OUTPUT_DIR / "MERIT_SOURCES.md").write_text(report_md, encoding="utf-8")

    return {
        "facts": facts,
        "review": review,
        "crosscheck": crosscheck,
        "report_md": report_md,
        "source_facts": source_facts,
        "review_doc": review_doc,
    }


def _write_json(path: Path, obj: dict) -> None:
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    out = build(write=True)
    print(f"merit build {SOURCE_SET_VERSION}")
    print(f"  facts:  {len(out['facts'])}  ({out['source_facts']['linked_player_count']} players)")
    print(f"  review: {len(out['review'])}")
    cc = out["crosscheck"]
    print(f"  golden-ball cross-check: {cc['agree']}/{cc['checked']} agree")
    print(f"  -> {OUTPUT_DIR}")
