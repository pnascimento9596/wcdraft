"""WS-A-2026 ingest orchestration — emit the data the sim plays against in 2026.

Reads the pinned Wikipedia snapshots (``source_2026``), parses them
(``wiki2026``), resolves identity against the committed 1930-2022 canonical tables
(``identity_2026``), projects ratings (``rating_2026``), and emits the contract-
shaped 2026 artifacts under ``etl/output/`` as their own ``*_2026.json`` files —
the locked 1930-2022 tables are left byte-for-byte untouched.

Emitted artifacts:
  * ``nations_2026.json``            — the 5 minted debutant nations.
  * ``players_2026.json``            — minted person records (linked players keep
                                       their canonical record in players.json).
  * ``player_tournaments_2026.json`` — the 1,246 real 2026 cards (card_id =
                                       player_id:WC-2026), with career signals.
  * ``ratings_2026.json``            — projected_career ratings (rating_2026).
  * ``teams_2026.json``              — 48 Team2026 (group, slot, squad, aggregate).
  * ``bracket_2026.json``            — Bracket2026 (12 groups + knockout slots).
  * ``tournaments_2026.json``        — the WC-2026 tournament record.
  * ``manifest_2026.json``           — provenance, attribution, honest-state, counts.

DETERMINISM: pure function of the committed snapshots + canonical tables. Rows are
sorted by primary key, object keys sorted, no timestamps — same inputs → identical
bytes (the git-diff guard enforces it). Minted ids are assigned in a sorted,
input-order-independent sequence so they never churn between runs.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import identity_2026 as idn
from . import manual_overrides, rating_2026, source_2026, wiki2026

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"
TOURNAMENT_ID = source_2026.TOURNAMENT_ID  # "WC-2026"

# 2026 hosts (canonical nation_ids): Canada, Mexico, United States.
HOST_NATION_IDS = ["T-12", "T-46", "T-83"]
FORMAT_VERSION = "wc2026-48team-1.0.0"

# Team2026.squad_status per the core contract semantics (tournament.ts):
#   'locked' = official roster published but tournament has NOT started.
#   'final'  = official roster + tournament started; no further changes.
# The final 26-man lists were published 2026-06-02, but the opening match is
# 2026-06-11 — so as of the pinned 2026-06-04 snapshot the contract-correct state
# is 'locked', NOT 'final' (an injury replacement is still permitted up to 24h
# before a team's first match). Flips to 'final' on re-pin after kickoff.
SQUAD_STATUS = "locked"

# Knockout round order, for a semantic (not lexicographic) slot sort.
_ROUND_ORDER = {"R32": 0, "R16": 1, "QF": 2, "SF": 3, "F": 4}


def _load(name: str, output_dir: Path = OUTPUT_DIR) -> list[dict]:
    return json.loads((output_dir / f"{name}.json").read_text(encoding="utf-8"))


# ─── identity resolution over the parsed squads ─────────────────────────────────


def _resolve(
    teams: list[dict],
    existing_players: list[dict],
    existing_cards: list[dict],
    nations: list[dict],
):
    """Resolve every 2026 player to a (linked | minted) player_id and return
    (rows, minted_person_records). ``rows`` augments each parsed player with its
    nation_id, resolved player_id and link_status."""
    by_name = {n["canonical_name"]: n["nation_id"] for n in nations}
    index = idn.build_player_index(existing_players, existing_cards)

    # First pass: link where possible; collect unlinked for deterministic minting.
    rows: list[dict] = []
    unlinked: list[dict] = []
    for t in teams:
        nation_id = idn.nation_id_for_team(t["team_name"], by_name)
        for p in t["players"]:
            pid = idn.link_player(
                nation_id, p["birth_date"], p["family_name"], p["given_name"], p["name"], index
            )
            row = {**p, "group": t["group"], "team_name": t["team_name"], "nation_id": nation_id}
            if pid is not None:
                row["player_id"] = pid
                row["link_status"] = "linked"
            else:
                row["link_status"] = "minted"
                unlinked.append(row)
            rows.append(row)

    # Mint stable ids in a sorted, iteration-order-independent sequence.
    unlinked.sort(
        key=lambda r: (
            r["nation_id"],
            r["birth_date"] or "",
            idn.normalize_name(r["name"]),
            r["shirt"] or 0,
        )
    )
    minted_people: list[dict] = []
    for i, row in enumerate(unlinked, start=1):
        pid = f"P-W26-{i:04d}"
        row["player_id"] = pid
        minted_people.append(
            {
                "player_id": pid,
                "full_name": row["name"],
                "common_name": row["family_name"] or row["name"],
                "given_name": row["given_name"],
                "family_name": row["family_name"],
                "birth_date": row["birth_date"],
                "female": False,
                "eligible_positions": [row["position"]],
                "primary_position": row["position"],
            }
        )

    pids = [r["player_id"] for r in rows]
    if len(pids) != len(set(pids)):
        raise ValueError("resolved 2026 player_ids are not unique — identity linkage collision")
    minted_people.sort(key=lambda p: p["player_id"])
    return rows, minted_people


# ─── cards ──────────────────────────────────────────────────────────────────────


def _build_cards(rows: list[dict]) -> list[dict]:
    cards: list[dict] = []
    for r in rows:
        card = {
            "card_id": f"{r['player_id']}:{TOURNAMENT_ID}",
            "player_id": r["player_id"],
            "nation_id": r["nation_id"],
            "tournament_id": TOURNAMENT_ID,
            "group": r["group"],
            "shirt": r["shirt"],
            "position_listed": r["position"],
            "club": r["club"],
            "club_nation_code": r["club_nation_code"],
            "caps": r["caps"],
            "intl_goals": r["goals"],
            "birth_date": r["birth_date"],
            "captain": r["captain"],
            "link_status": r["link_status"],
        }
        card["coverage"] = rating_2026.career_coverage(card)
        cards.append(card)
    cards.sort(key=lambda c: c["card_id"])
    return cards


# ─── Team2026 + aggregate TeamStrength ──────────────────────────────────────────


def _team_strength(squad_ratings: list[dict], internal_score_by_card: dict[str, float]) -> dict:
    """Aggregate a squad's per-card ratings into a TeamStrength.

    Best-available-XI semantics: take the 11 cards with the highest INTERNAL
    ``score_0_100`` (tiebreak card_id) and average each sim channel + coverage
    over them. The internal score is curve-invariant: display ``overall`` is a
    monotone map of it (MV2-6), so selecting on the internal float preserves the
    display ordering MINUS the integer-rounding ties display introduces — the
    MV2-10 decoupling fix that removes the display→sim leak (a display-curve
    re-fit can no longer flip which XI a team aggregates over). A stronger
    squad's best XI carries higher channels, so strong nations aggregate higher.
    NOTE: this is the OPPONENT squad aggregation; the user-XI aggregator (core
    ``aggregateUserXiStrength``, which folds synergy + manager) is a separate
    WS-B concern. The averaging choice is locked here and re-calibratable in WS-B.
    """
    best = sorted(
        squad_ratings, key=lambda r: (-internal_score_by_card[r["card_id"]], r["card_id"])
    )[:11]
    n = len(best)
    agg: dict[str, float] = {
        ch: round(sum(r[ch] for r in best) / n)
        for ch in ("attack", "midfield", "defense", "goalkeeping")
    }
    agg["coverage"] = round(sum(r["coverage"] for r in best) / n, 4)
    return agg


def _build_teams(
    cards: list[dict],
    ratings: list[dict],
    draw: dict[str, dict[int, str]],
    internal_score_by_card: dict[str, float],
) -> list[dict]:
    rating_by_card = {r["card_id"]: r for r in ratings}
    # nation_id -> drawn slot, via the draw's FIFA code map.
    slot_of_nation: dict[str, tuple[str, int]] = {}
    for group, slots in draw.items():
        for slot, code in slots.items():
            slot_of_nation[idn.FIFA_TO_NATION[code]] = (group, slot)

    cards_by_nation: dict[str, list[dict]] = {}
    for c in cards:
        cards_by_nation.setdefault(c["nation_id"], []).append(c)

    teams: list[dict] = []
    for nation_id, squad in cards_by_nation.items():
        group, slot = slot_of_nation[nation_id]
        squad_card_ids = sorted(c["card_id"] for c in squad)
        squad_ratings = [rating_by_card[cid] for cid in squad_card_ids]
        teams.append(
            {
                "team_id": f"WC2026-{group}{slot}",
                "nation_id": nation_id,
                "group": group,
                "group_slot": slot,
                "squad_card_ids": squad_card_ids,
                "aggregate_rating": _team_strength(squad_ratings, internal_score_by_card),
                "squad_status": SQUAD_STATUS,
                "rating_version": rating_2026.RATING_VERSION,
                "sources": [
                    source_2026.source_ref("squads"),
                    # group / group_slot are derived from the final-draw table.
                    source_2026.source_ref("draw", field="group_slot"),
                ],
            }
        )
    teams.sort(key=lambda t: t["team_id"])
    return teams


# ─── Bracket2026 ─────────────────────────────────────────────────────────────────


def _feeder_to_source(feeder: str, match_id_of: dict[int, str]) -> dict:
    """Map a published feeder label to a Bracket2026 SlotSource.

    ``best_third`` is an HONEST extension of the core SlotSource union (which only
    models group_position | match_winner): the 8 best third-placed teams cannot be
    a single group_position — the qualifying group is resolved at runtime from a
    fixed candidate set. Surfaced for the core contract follow-up (see README).
    """
    if feeder.startswith("Winner Group "):
        return {"kind": "group_position", "group_id": feeder[-1], "position": 1}
    if feeder.startswith("Runner-up Group "):
        return {"kind": "group_position", "group_id": feeder[-1], "position": 2}
    if feeder.startswith("3rd Group "):
        groups = feeder[len("3rd Group "):].split("/")
        return {"kind": "best_third", "candidate_groups": groups}
    if feeder.startswith("Winner Match "):
        num = int(feeder.rsplit(" ", 1)[1])
        return {"kind": "match_winner", "match_slot_id": match_id_of[num]}
    raise ValueError(f"unrecognized bracket feeder {feeder!r}")


def _build_bracket(teams: list[dict], bracket_matches: list[dict]) -> dict:
    groups: dict[str, list[str]] = {}
    for t in teams:
        groups.setdefault(t["group"], []).append(t["team_id"])
    group_blocks = [
        {"group_id": g, "team_ids": sorted(groups[g])} for g in sorted(groups)
    ]

    match_id_of = {m["match"]: f"{m['round']}-M{m['match']}" for m in bracket_matches}
    slots: list[dict] = []
    for m in bracket_matches:
        mid = match_id_of[m["match"]]
        for side, feeder in enumerate(m["feeders"], start=1):
            slots.append(
                {
                    "slot_id": f"{mid}/{side}",
                    "match_id": mid,
                    "round": m["round"],
                    "source": _feeder_to_source(feeder, match_id_of),
                }
            )
    # Semantic order: round, then match number, then seat side (not lexicographic,
    # which would interleave F-* before QF-*).
    def _slot_key(s: dict) -> tuple[int, int, str]:
        return (_ROUND_ORDER[s["round"]], int(s["match_id"].split("-M")[1]), s["slot_id"])

    slots.sort(key=_slot_key)
    return {
        "format_version": FORMAT_VERSION,
        "groups": group_blocks,
        "knockout_slots": slots,
    }


# ─── emit ────────────────────────────────────────────────────────────────────────


def _write_json(path: Path, obj) -> None:
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def build_all(output_dir: Path = OUTPUT_DIR) -> dict:
    """Build every 2026 artifact and return them keyed by output name."""
    squads = wiki2026.parse_squads(source_2026.load_wikitext("squads"))
    draw = wiki2026.parse_draw(source_2026.load_wikitext("draw"))
    bracket_matches = wiki2026.parse_bracket(source_2026.load_wikitext("knockout"))

    rows, minted_people = _resolve(
        squads,
        _load("players", output_dir),
        _load("player_tournaments", output_dir),
        _load("nations", output_dir),
    )
    cards = _build_cards(rows)
    # MV2-5: linked-material 2026 players reconcile onto the career-stature scale.
    # career_stature.json is consumed READ-ONLY (missing → {} → every card on the
    # projected raw path); rating_2026 only consults it for link_status=="linked".
    # Non-material cards are quantile-mapped onto the committed historical raw-only
    # internal distribution (ratings.json, READ-ONLY) for cross-era density parity.
    career = rating_2026._load_career_stature(output_dir)
    historical_raw_only = rating_2026._historical_raw_only_internal(output_dir)
    # Pass 1 computed ONCE: the same internal rows materialize the Rating rows AND
    # carry the curve-invariant score_0_100 the best-XI selection keys on (MV2-10).
    internal_rows = rating_2026.build_internal_view(cards, career, historical_raw_only, output_dir)
    ratings = rating_2026.build_ratings(
        cards, career, historical_raw_only, output_dir, internal_rows=internal_rows
    )
    internal_score_by_card = {r["card_id"]: r["score_0_100"] for r in internal_rows}
    teams = _build_teams(cards, ratings, draw, internal_score_by_card)
    bracket = _build_bracket(teams, bracket_matches)

    tournament = {
        "tournament_id": TOURNAMENT_ID,
        "year": 2026,
        "name": "2026 FIFA Men's World Cup",
        "host_nation_ids": HOST_NATION_IDS,
        "champion_nation_id": None,
        "format_version": FORMAT_VERSION,
        "womens": False,
    }

    return {
        "nations_2026": idn.NEW_NATIONS,
        "players_2026": minted_people,
        "player_tournaments_2026": cards,
        "ratings_2026": ratings,
        "teams_2026": teams,
        "bracket_2026": bracket,
        "tournaments_2026": [tournament],
    }


def _manifest(tables: dict) -> dict:
    snaps = source_2026.snapshot_meta()
    return {
        "attribution": source_2026.ATTRIBUTION,
        "license": source_2026.SOURCE_LICENSE,
        "license_url": source_2026.SOURCE_LICENSE_URL,
        "retrieved_date": source_2026.RETRIEVED_DATE,
        "sources": {
            k: {
                "title": v["title"],
                "url": v["url"],
                "revid": v["revid"],
                "timestamp": v["timestamp"],
            }
            for k, v in snaps.items()
        },
        "tournament_id": TOURNAMENT_ID,
        "rating_version": rating_2026.RATING_VERSION,
        "provenance": rating_2026.PROVENANCE,
        "coverage_basis": rating_2026.COVERAGE_BASIS,
        "honest_state": {
            "projected_anchors_dropped": ["award_score", "team_finish"],
            "never_fabricated": [
                "club-competition minutes (not in source)",
                "qualification goals/assists (not in source)",
                "EA Sports / proprietary ratings (firewall — never ingested)",
            ],
            "overall_null_2026_cards": 0,
        },
        "counts": {
            "nations_minted": len(tables["nations_2026"]),
            "players_minted": len(tables["players_2026"]),
            "cards": len(tables["player_tournaments_2026"]),
            "cards_linked": sum(
                1 for c in tables["player_tournaments_2026"] if c["link_status"] == "linked"
            ),
            "ratings": len(tables["ratings_2026"]),
            "teams": len(tables["teams_2026"]),
            "knockout_slots": len(tables["bracket_2026"]["knockout_slots"]),
        },
    }


def run(output_dir: Path = OUTPUT_DIR) -> dict:
    """Build all 2026 artifacts and emit JSON + manifest."""
    tables = build_all(output_dir)
    for name, rows in tables.items():
        _write_json(output_dir / f"{name}.json", rows)
    _write_json(output_dir / "manifest_2026.json", _manifest(tables))
    manual_overrides.write_resolution_artifacts(output_dir)
    # MV2-5 accuracy-eyeball sample: rewrite MERIT_V2_SAMPLE.md as the historical
    # MV2-4 section + the 2026 reconciliation section. Runs LAST (after the 2026
    # tables are on disk) and regenerates the whole file deterministically.
    rating_2026.write_merit_v2_sample(output_dir)
    return tables


if __name__ == "__main__":
    t = run()
    print(f"wcdraft 2026 ingest -> {OUTPUT_DIR}/")
    print(f"  nations minted     {len(t['nations_2026']):>5}")
    print(f"  players minted     {len(t['players_2026']):>5}")
    cards = t["player_tournaments_2026"]
    linked = sum(1 for c in cards if c["link_status"] == "linked")
    print(f"  cards (2026)       {len(cards):>5}  (linked {linked}, minted {len(cards) - linked})")
    print(f"  teams              {len(t['teams_2026']):>5}")
    print(f"  knockout slots     {len(t['bracket_2026']['knockout_slots']):>5}")
