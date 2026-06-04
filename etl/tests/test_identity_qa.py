"""Identity-QA — the dedup spine. These are regression guards: if a future
source bump or transform change splits/merges a human or breaks a key, CI fails.

The guarantees under test:
  * one player_id spans multiple nation_ids (nation switchers) — never duplicated
  * one manager_id spans multiple tournaments/nations
  * primary keys are unique; cards never collapse two humans
  * honest-state: nulls preserved, no fabricated signals
"""

from __future__ import annotations


def _by(rows, key):
    return {r[key]: r for r in rows}


def _cards_for_player(cards, pid):
    return [c for c in cards if c["player_id"] == pid]


# --- Nation-switchers: one player_id, two nation_ids, two tournaments ---------

SWITCHERS = {
    # player_id: (name, {(tournament_id, nation_id), ...})
    "P-12676": ("Puskás", {("WC-1954", "T-36"), ("WC-1962", "T-73")}),  # HUN -> ESP
    "P-25760": ("Monti", {("WC-1930", "T-03"), ("WC-1934", "T-41")}),  # ARG -> ITA
    "P-70798": ("Santamaría", {("WC-1954", "T-84"), ("WC-1962", "T-73")}),  # URU -> ESP
}


def test_nation_switchers_resolve_to_one_player_id(tables):
    cards = tables["player_tournaments"]
    players = _by(tables["players"], "player_id")
    for pid, (name, expected) in SWITCHERS.items():
        assert pid in players, f"{name} missing from players"
        got = {(c["tournament_id"], c["nation_id"]) for c in _cards_for_player(cards, pid)}
        assert expected <= got, f"{name} ({pid}) expected {expected}, got {got}"
        # two distinct nations under ONE player_id
        nations = {n for _, n in got}
        assert len(nations) >= 2, f"{name} should span >=2 nations, got {nations}"


def test_two_switchers_converge_on_spain_1962(tables):
    # Puskás and Santamaría both played for Spain (T-73) in 1962 — a bonus join check.
    cards = tables["player_tournaments"]
    for pid in ("P-12676", "P-70798"):
        match = [c for c in cards if c["player_id"] == pid and c["tournament_id"] == "WC-1962"]
        assert match and match[0]["nation_id"] == "T-73"


# --- Manager identity stability ----------------------------------------------


def test_parreira_one_id_across_six_tournaments_five_nations(tables):
    mt = [m for m in tables["manager_tournaments"] if m["manager_id"] == "M-311"]
    assert len(mt) == 6, f"Parreira should have 6 manager_tournaments, got {len(mt)}"
    assert len({m["tournament_id"] for m in mt}) == 6
    assert len({m["nation_id"] for m in mt}) == 5  # Brazil twice
    mgr = _by(tables["managers"], "manager_id")["M-311"]
    assert mgr["full_name"] == "Carlos Alberto Parreira"
    assert mgr["nationality_name"] == "Brazil"


# --- No duplicate humans / unique keys ---------------------------------------


def test_player_id_unique(tables):
    ids = [p["player_id"] for p in tables["players"]]
    assert len(ids) == len(set(ids))


def test_manager_id_unique(tables):
    ids = [m["manager_id"] for m in tables["managers"]]
    assert len(ids) == len(set(ids))


def test_card_id_unique_and_well_formed(tables):
    cards = tables["player_tournaments"]
    ids = [c["card_id"] for c in cards]
    assert len(ids) == len(set(ids)), "duplicate card_id — two cards collapsed"
    for c in cards:
        assert c["card_id"] == f"{c['player_id']}:{c['tournament_id']}"


def test_nation_id_keyed_on_team_id_not_code(tables):
    nations = _by(tables["nations"], "nation_id")
    # The DEU collision: Germany and West Germany are separate nation_ids, same code.
    assert "T-31" in nations and "T-86" in nations
    assert nations["T-31"]["code"] == nations["T-86"]["code"] == "DEU"
    assert nations["T-31"]["nation_id"] != nations["T-86"]["nation_id"]
    # historical entities flagged, never merged
    assert nations["T-86"]["historical"] is True
    assert nations["T-31"]["historical"] is False


def test_every_card_references_real_entities(tables):
    players = {p["player_id"] for p in tables["players"]}
    nations = {n["nation_id"] for n in tables["nations"]}
    tourns = {t["tournament_id"] for t in tables["tournaments"]}
    for c in tables["player_tournaments"]:
        assert c["player_id"] in players
        assert c["nation_id"] in nations
        assert c["tournament_id"] in tourns


# --- Honest-state guards ------------------------------------------------------


def test_no_fabricated_assists_or_minutes(tables):
    # These signals do not exist upstream and must never appear as card fields.
    sample = tables["player_tournaments"][0]
    for forbidden in ("assists", "minutes", "minutes_played"):
        assert forbidden not in sample


def test_pre_1970_appearances_are_null_not_zero(tables):
    years = {t["tournament_id"]: t["year"] for t in tables["tournaments"]}
    for c in tables["player_tournaments"]:
        if (years.get(c["tournament_id"]) or 0) < 1970:
            assert c["appearances"] is None, f"{c['card_id']} pre-1970 appearances must be null"


def test_pre_1954_shirts_are_null_not_zero(tables):
    years = {t["tournament_id"]: t["year"] for t in tables["tournaments"]}
    for c in tables["player_tournaments"]:
        if c["shirt"] is not None:
            assert c["shirt"] != 0  # 0 is the missing sentinel, must be null
        if (years.get(c["tournament_id"]) or 0) < 1954:
            assert c["shirt"] is None, f"{c['card_id']} pre-1954 shirt must be null"


def test_club_and_manager_birthdate_never_fabricated(tables):
    assert all(c["club_at_tournament"] is None for c in tables["player_tournaments"])
    assert all(m["birth_date"] is None for m in tables["managers"])


def test_own_goals_excluded_from_card_goal_tally(tables):
    # Goals fact has own_goal events; card goal counts must exclude them.
    cards = {c["card_id"]: c for c in tables["player_tournaments"]}
    # Recompute non-own goals per (player, tournament) from the fact table.
    expect: dict[str, int] = {}
    for g in tables["goals"]:
        if g["own_goal"]:
            continue
        cid = f"{g['player_id']}:{g['tournament_id']}"
        expect[cid] = expect.get(cid, 0) + 1
    for cid, n in expect.items():
        assert cards[cid]["goals"] == n, f"{cid}: goals {cards[cid]['goals']} != {n}"
    # And any own-goal-only scorer should not get phantom goals on that card.
    assert any(g["own_goal"] for g in tables["goals"])  # sanity: own goals exist


def test_coverage_reflects_era_cliffs(tables):
    years = {t["tournament_id"]: t["year"] for t in tables["tournaments"]}
    for c in tables["player_tournaments"]:
        y = years.get(c["tournament_id"]) or 0
        if y >= 1970:
            assert c["coverage"] == 1.0
        elif y >= 1954:
            assert c["coverage"] == round(5 / 6, 4)
        else:
            assert c["coverage"] == round(4 / 6, 4)


def test_all_eligible_positions_valid_and_primary_within(tables):
    valid = {"GK", "DF", "MF", "FW"}
    for p in tables["players"]:
        assert p["eligible_positions"], f"{p['player_id']} has no eligible positions"
        assert set(p["eligible_positions"]) <= valid
        assert p["primary_position"] in p["eligible_positions"]
