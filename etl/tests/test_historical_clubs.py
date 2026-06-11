from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from wcdraft_etl import historical_clubs


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
