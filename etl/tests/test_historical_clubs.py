from __future__ import annotations

from collections import Counter
from pathlib import Path

import pandas as pd
import pytest

from wcdraft_etl import historical_clubs, source


def test_parse_nat_fs_and_national_squad_templates():
    rows = historical_clubs.parse_squad_wikitext(
        "\n".join(
            [
                "==Group A==",
                "===Brazil===",
                "{{nat fs start}}",
                "{{nat fs player|no=10|pos=FW|name=[[Pelé]]"
                "|age={{Birth date and age2|df=yes|1970|5|31|1940|10|23}}"
                "|caps=91|club=[[Santos FC|Santos]]|clubnat=Brazil}}",
                "{{nat fs end}}",
                "===France===",
                "{{National football squad start}}",
                "{{National football squad player|no=1|pos=GK|name=[[Fabien Barthez]]"
                "|age={{birth date and age2|df=y|2006|6|9|1971|6|28}}"
                "|caps=80|club=[[Olympique de Marseille|Marseille]]|clubnat=FRA}}",
                "{{National football squad end}}",
            ]
        ),
        1970,
        source_revid=123,
    )
    assert [(r.team_name, r.player_name, r.club, r.shirt) for r in rows] == [
        ("Brazil", "Pelé", "Santos", 10),
        ("France", "Fabien Barthez", "Marseille", 1),
    ]
    assert rows[0].player_title == "Pelé"
    assert rows[0].birth_date == "1940-10-23"


def test_club_join_prefers_wikipedia_title_and_preserves_null(monkeypatch):
    parsed = [
        historical_clubs.ParsedClubRow(
            tournament_id="WC-1970",
            year=1970,
            team_name="Brazil",
            player_name="Pelé",
            player_title="Pelé",
            birth_date="1940-10-23",
            shirt=10,
            position="FW",
            club="Santos",
            club_title="Santos FC",
            source_revid=123,
        ),
        historical_clubs.ParsedClubRow(
            tournament_id="WC-1970",
            year=1970,
            team_name="Brazil",
            player_name="Unlinked Reserve",
            player_title=None,
            birth_date=None,
            shirt=None,
            position="FW",
            club="Reserve Club",
            club_title=None,
            source_revid=123,
        ),
    ]
    monkeypatch.setattr(historical_clubs, "_iter_pinned_rows", lambda: parsed)

    squads = pd.DataFrame(
        [
            {
                "player_id": "P-pele",
                "tournament_id": "WC-1970",
                "team_id": "T-bra",
                "given_name": "Edson",
                "family_name": "Pelé",
                "shirt_number": "10",
            },
            {
                "player_id": "P-null",
                "tournament_id": "WC-1970",
                "team_id": "T-bra",
                "given_name": "Null",
                "family_name": "Player",
                "shirt_number": "11",
            },
        ]
    )
    players = pd.DataFrame(
        [
            {
                "player_id": "P-pele",
                "given_name": "Edson",
                "family_name": "Pelé",
                "birth_date": "1940-10-23",
                "player_wikipedia_link": "https://en.wikipedia.org/wiki/Pel%C3%A9",
            },
            {
                "player_id": "P-null",
                "given_name": "Null",
                "family_name": "Player",
                "birth_date": "1940-01-01",
                "player_wikipedia_link": "",
            },
        ]
    )
    teams = pd.DataFrame([{"team_id": "T-bra", "team_name": "Brazil"}])

    result = historical_clubs.build_club_lookup(squads, players, teams)

    assert result.clubs == {("P-pele", "WC-1970"): "Santos"}
    assert result.methods == {"wiki_title": 1}
    assert any(r["reason"] == "player_unresolved" for r in result.review)


def test_club_alias_bridges_populate_reviewer_verified_tail_rows():
    result = historical_clubs.build_club_lookup(
        source.load("squads"),
        source.load("players"),
        source.load("teams"),
    )

    assert result.methods["club_alias_bridge"] == 5
    assert {
        key: result.clubs[key]
        for key in [
            ("P-83291", "WC-1930"),
            ("P-44010", "WC-1930"),
            ("P-70294", "WC-1930"),
            ("P-56198", "WC-1938"),
            ("P-92151", "WC-1998"),
        ]
    } == {
        ("P-83291", "WC-1930"): "Club América",
        ("P-44010", "WC-1930"): "Universitario de Deportes",
        ("P-70294", "WC-1930"): "Banatul Timișoara",
        ("P-56198", "WC-1938"): "Sparta Bandung",
        ("P-92151", "WC-1998"): "Al-Ahli",
    }


def test_club_alias_bridge_raises_if_mechanism_resolves_differently(monkeypatch):
    monkeypatch.setattr(
        historical_clubs,
        "_iter_pinned_rows",
        lambda: [
            historical_clubs.ParsedClubRow(
                tournament_id="WC-1930",
                year=1930,
                team_name="Mexico",
                player_name="Alfredo Sánchez",
                player_title="Alfredo Sánchez (footballer, born 1904)",
                birth_date=None,
                shirt=None,
                position="FW",
                club="Club América",
                club_title=None,
                source_revid=1353483110,
            )
        ],
    )
    squads = pd.DataFrame(
        [
            {
                "player_id": "P-83291",
                "tournament_id": "WC-1930",
                "team_id": "T-46",
                "given_name": "Alfredo",
                "family_name": "Viejo Sánchez",
                "shirt_number": "0",
            },
            {
                "player_id": "P-other",
                "tournament_id": "WC-1930",
                "team_id": "T-46",
                "given_name": "Alfredo",
                "family_name": "Sánchez",
                "shirt_number": "0",
            },
        ]
    )
    players = pd.DataFrame(
        [
            {
                "player_id": "P-83291",
                "given_name": "Alfredo",
                "family_name": "Viejo Sánchez",
                "birth_date": "1908-05-24",
                "player_wikipedia_link": "https://en.wikipedia.org/wiki/Alfredo_Viejo_S%C3%A1nchez",
            },
            {
                "player_id": "P-other",
                "given_name": "Alfredo",
                "family_name": "Sánchez",
                "birth_date": "1904-05-28",
                "player_wikipedia_link": "https://en.wikipedia.org/wiki/Alfredo_S%C3%A1nchez_(footballer,_born_1904)",
            },
        ]
    )
    teams = pd.DataFrame([{"team_id": "T-46", "team_name": "Mexico"}])

    with pytest.raises(ValueError, match="disagrees with resolver mechanism"):
        historical_clubs.build_club_lookup(squads, players, teams)


def test_tail_null_classification_census_is_pinned():
    census = Counter(historical_clubs.TAIL_NULL_CLASSIFICATIONS.values())

    assert sum(census.values()) == 21
    assert census == {
        "bridged": 5,
        "source_lacks_club": 16,
    }


def test_lower_confidence_conflict_cannot_override_exact_title(monkeypatch):
    parsed = [
        historical_clubs.ParsedClubRow(
            tournament_id="WC-1990",
            year=1990,
            team_name="Argentina",
            player_name="Nery Pumpido",
            player_title="Nery Pumpido",
            birth_date="1957-07-30",
            shirt=1,
            position="GK",
            club="Real Betis",
            club_title=None,
            source_revid=1,
        ),
        historical_clubs.ParsedClubRow(
            tournament_id="WC-1990",
            year=1990,
            team_name="Argentina",
            player_name="Pumpido alternate",
            player_title=None,
            birth_date=None,
            shirt=1,
            position="GK",
            club="River Plate",
            club_title=None,
            source_revid=1,
        ),
    ]
    monkeypatch.setattr(historical_clubs, "_iter_pinned_rows", lambda: parsed)

    squads = pd.DataFrame(
        [
            {
                "player_id": "P-nery",
                "tournament_id": "WC-1990",
                "team_id": "T-arg",
                "given_name": "Nery",
                "family_name": "Pumpido",
                "shirt_number": "1",
            }
        ]
    )
    players = pd.DataFrame(
        [
            {
                "player_id": "P-nery",
                "given_name": "Nery",
                "family_name": "Pumpido",
                "birth_date": "1957-07-30",
                "player_wikipedia_link": "https://en.wikipedia.org/wiki/Nery_Pumpido",
            }
        ]
    )
    teams = pd.DataFrame([{"team_id": "T-arg", "team_name": "Argentina"}])

    result = historical_clubs.build_club_lookup(squads, players, teams)

    assert result.clubs == {("P-nery", "WC-1990"): "Real Betis"}
    assert any(r["reason"] == "conflicting_lower_confidence_row" for r in result.review)


def test_manifest_verify_detects_tamper(tmp_path: Path):
    raw_dir = tmp_path / "sources"
    raw_file = raw_dir / "wikipedia_1970" / "1970_fifa_world_cup_squads.wikitext"
    raw_file.parent.mkdir(parents=True)
    raw_file.write_text("original", encoding="utf-8")
    manifest = {
        "files": [
            {
                "file": "wikipedia_1970/1970_fifa_world_cup_squads.wikitext",
                "bytes": len(b"original"),
                "sha256": historical_clubs._sha256(b"original"),
            }
        ]
    }
    assert historical_clubs.verify_manifest(manifest, raw_dir) == []

    raw_file.write_text("tampered", encoding="utf-8")
    failures = historical_clubs.verify_manifest(manifest, raw_dir)
    assert failures
    assert "DRIFT wikipedia_1970/1970_fifa_world_cup_squads.wikitext" in failures[0]


@pytest.mark.parametrize("year", historical_clubs.HISTORICAL_YEARS)
def test_committed_pinned_revisions_parse_players(year):
    manifest = historical_clubs.load_manifest()
    entry = next(f for f in manifest["files"] if f["year"] == year)
    text = (historical_clubs.SOURCE_ROOT / entry["file"]).read_text(encoding="utf-8")
    rows = historical_clubs.parse_squad_wikitext(text, year, entry["revid"])
    assert rows, year
    assert any(r.club for r in rows), year
