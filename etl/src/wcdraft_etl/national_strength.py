"""National-team strength priors for merit-v4 raw-only rating ceilings.

This stage turns public national-team strength facts into a deterministic
``etl/output/national_strength.json`` artifact. The rating stages consume that
artifact read-only; they never fetch network data while building ratings.

Sources:
  * World Football Elo tournament-start TSVs, which carry each World Cup
    participant's global Elo rank and rating at tournament start.
  * FIFA/Coca-Cola Men's World Ranking table snapshots from the official FIFA
    ranking API, using the latest ranking release at or before tournament start
    from 1994 onward.

The output intentionally contains both the raw source ranks and the derived
ceiling. A low-strength nation does not become a zero: it simply receives a lower
smooth raw-only ceiling prior, while material career-stature and award-gated
paths remain separate signals.
"""

from __future__ import annotations

import argparse
import json
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"
SOURCES_DIR = Path(__file__).resolve().parents[2] / "sources" / "national_strength"

WORLD_FOOTBALL_ELO_BASE_URL = "https://www.eloratings.net"
FIFA_RANKING_OVERVIEW_URL = "https://inside.fifa.com/api/ranking-overview"
RETRIEVED_DATE = "2026-06-13"

RAW_ONLY_CEILING_FLOOR = 0.500
RAW_ONLY_CEILING_TOP = 0.625
ELO_WEIGHT_POST_1994 = 0.72
FIFA_WEIGHT_POST_1994 = 0.28

MEN_WORLD_CUP_YEARS = (
    1930,
    1934,
    1938,
    1950,
    1954,
    1958,
    1962,
    1966,
    1970,
    1974,
    1978,
    1982,
    1986,
    1990,
    1994,
    1998,
    2002,
    2006,
    2010,
    2014,
    2018,
    2022,
    2026,
)

# Latest official FIFA ranking release at or before each men's World Cup opener.
# 2026 uses the official June 11 release. The ranking page currently exposes that
# date through an FRS_* display id, but the full-table API resolves through the
# schedule id carried on per-country rows: id15136.
FIFA_RANKING_SNAPSHOTS: dict[int, dict[str, str]] = {
    1994: {"date_id": "id11", "release_date": "1994-06-14"},
    1998: {"date_id": "id50", "release_date": "1998-05-20"},
    2002: {"date_id": "id97", "release_date": "2002-05-15"},
    2006: {"date_id": "id145", "release_date": "2006-05-17"},
    2010: {"date_id": "id9276", "release_date": "2010-05-26"},
    2014: {"date_id": "id10747", "release_date": "2014-06-05"},
    2018: {"date_id": "id12210", "release_date": "2018-06-07"},
    2022: {"date_id": "id13792", "release_date": "2022-10-06"},
    2026: {"date_id": "id15136", "release_date": "2026-06-11"},
}

# Name/code reconciliation is explicit for the historical team states and places
# where repo terminology diverges from the source vocabularies. Everything else
# is resolved by source aliases first, then by source-specific code overrides.
ELO_CODE_BY_NATION_NAME: dict[str, str] = {
    "Czech Republic": "CZ",  # Elo uses Czechia.
    "Republic of Ireland": "IE",  # Elo's row is "Ireland".
}

ELO_CODE_BY_NATION_CODE: dict[str, str] = {
    "CPV": "CV",
    "CUW": "CW",
    "CSK": "CS",
    "DDR": "DD",
    "DEU": "DE",
    "SCG": "RM",
    "SUN": "SU",
    "YUG": "YU",
}

FIFA_CODE_BY_NATION_CODE: dict[str, str] = {
    "ARE": "UAE",
    "CHE": "SUI",
    "CIV": "CIV",
    "CPV": "CPV",
    "CSK": "TCH",
    "CUW": "CUW",
    "DDR": "GDR",
    "DEU": "GER",
    "DNK": "DEN",
    "DZA": "ALG",
    "HTI": "HAI",
    "NLD": "NED",
    "PRK": "PRK",
    "SAU": "KSA",
    "SCG": "SCG",
    "SUN": "URS",
    "TWN": "TPE",
    "YUG": "YUG",
    "ZAF": "RSA",
}

FIFA_CODE_BY_NATION_NAME: dict[str, str] = {
    "Cape Verde": "CPV",  # FIFA's display name is Cabo Verde.
    "South Korea": "KOR",  # FIFA's display name is Korea Republic.
    "United States": "USA",  # FIFA's display name is USA.
}


@dataclass(frozen=True)
class EloRow:
    source_rank: int
    global_rank: int
    code: str
    rating: int


@dataclass(frozen=True)
class FifaRow:
    rank: int
    code: str
    name: str
    points: float
    release_datetime: str


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "wcdraft-etl/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def _fetch_json(url: str) -> Any:
    return json.loads(_fetch_text(url))


def _elo_event_filename(year: int) -> str:
    return f"{year}_World_Cup_start.tsv"


def _elo_event_url(year: int) -> str:
    return f"{WORLD_FOOTBALL_ELO_BASE_URL}/{_elo_event_filename(year)}"


def _fifa_snapshot_url(date_id: str) -> str:
    qs = urllib.parse.urlencode(
        {"locale": "en", "dateId": date_id, "rankingType": "football"}
    )
    return f"{FIFA_RANKING_OVERVIEW_URL}?{qs}"


def fetch_sources(sources_dir: Path = SOURCES_DIR) -> None:
    """Fetch and write pinned source snapshots.

    Normal ETL/test paths do not call this. It is an explicit refresh command so
    output builds remain offline and byte-deterministic.
    """
    elo_dir = sources_dir / "elo"
    fifa_dir = sources_dir / "fifa"
    elo_dir.mkdir(parents=True, exist_ok=True)
    fifa_dir.mkdir(parents=True, exist_ok=True)

    source_refs: dict[str, Any] = {
        "retrieved_date": RETRIEVED_DATE,
        "world_football_elo": {
            "base_url": WORLD_FOOTBALL_ELO_BASE_URL,
            "license_note": (
                "World Football Elo Ratings public TSV pages; rank/rating facts "
                "are used as public national-team strength inputs."
            ),
            "files": [],
        },
        "fifa_ranking": {
            "base_url": FIFA_RANKING_OVERVIEW_URL,
            "license_note": (
                "Official FIFA/Coca-Cola Men's World Ranking API snapshots; "
                "rank/points facts are used as public national-team strength inputs."
            ),
            "files": [],
        },
    }

    teams_text = _fetch_text(f"{WORLD_FOOTBALL_ELO_BASE_URL}/en.teams.tsv")
    (elo_dir / "en.teams.tsv").write_text(teams_text, encoding="utf-8")
    source_refs["world_football_elo"]["files"].append(
        {"file": "elo/en.teams.tsv", "url": f"{WORLD_FOOTBALL_ELO_BASE_URL}/en.teams.tsv"}
    )

    for year in MEN_WORLD_CUP_YEARS:
        filename = _elo_event_filename(year)
        url = _elo_event_url(year)
        (elo_dir / filename).write_text(_fetch_text(url), encoding="utf-8")
        source_refs["world_football_elo"]["files"].append(
            {"file": f"elo/{filename}", "url": url, "year": year}
        )

    for year, snap in FIFA_RANKING_SNAPSHOTS.items():
        date_id = snap["date_id"]
        url = _fifa_snapshot_url(date_id)
        data = _fetch_json(url)
        if not data.get("rankings"):
            raise ValueError(f"FIFA ranking snapshot {date_id} for {year} returned no rows")
        filename = f"{year}_{date_id}.json"
        _write_json(fifa_dir / filename, data)
        source_refs["fifa_ranking"]["files"].append(
            {
                "file": f"fifa/{filename}",
                "url": url,
                "year": year,
                "date_id": date_id,
                "release_date": snap["release_date"],
            }
        )

    _write_json(sources_dir / "SOURCES.json", source_refs)


def _rank_score(rank: int) -> float:
    return _clamp01((50.0 - rank) / 49.0)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _smoothstep(x: float) -> float:
    x = _clamp01(x)
    return x * x * (3.0 - 2.0 * x)


def raw_only_ceiling_for_strength(strength: float) -> float:
    return RAW_ONLY_CEILING_FLOOR + (
        RAW_ONLY_CEILING_TOP - RAW_ONLY_CEILING_FLOOR
    ) * _smoothstep(strength)


def _source_name_map(elo_teams_text: str) -> dict[str, str]:
    name_to_code: dict[str, str] = {}
    for line in elo_teams_text.splitlines():
        cols = line.split("\t")
        if len(cols) < 2 or cols[0].endswith("_loc"):
            continue
        code = cols[0]
        for name in cols[1:]:
            name_to_code[name.casefold()] = code
    return name_to_code


def _elo_code(nation: dict, name_to_code: dict[str, str]) -> str:
    name = nation["canonical_name"]
    if name in ELO_CODE_BY_NATION_NAME:
        return ELO_CODE_BY_NATION_NAME[name]
    candidates = [name, *nation.get("aliases", [])]
    for cand in candidates:
        source_code = name_to_code.get(cand.casefold())
        if source_code is not None:
            return source_code
    code = nation.get("code")
    if code in ELO_CODE_BY_NATION_CODE:
        return ELO_CODE_BY_NATION_CODE[code]
    raise ValueError(f"no World Football Elo code mapping for nation {nation}")


def _norm_name(name: str) -> str:
    deaccented = "".join(
        ch for ch in unicodedata.normalize("NFKD", name) if not unicodedata.combining(ch)
    )
    return " ".join(
        "".join(ch.lower() if ch.isalnum() else " " for ch in deaccented).split()
    )


def _fifa_code(nation: dict, fifa_rows: dict[str, FifaRow]) -> str:
    name = nation["canonical_name"]
    if name in FIFA_CODE_BY_NATION_NAME:
        code = FIFA_CODE_BY_NATION_NAME[name]
        if code in fifa_rows:
            return code
    code = nation.get("code")
    if code in FIFA_CODE_BY_NATION_CODE:
        mapped = FIFA_CODE_BY_NATION_CODE[code]
        if mapped in fifa_rows:
            return mapped
    if code in fifa_rows:
        return code

    source_name_to_code = {_norm_name(row.name): code for code, row in fifa_rows.items()}
    for candidate in (name, *nation.get("aliases", [])):
        mapped = source_name_to_code.get(_norm_name(candidate))
        if mapped is not None:
            return mapped
    if not code:
        raise ValueError(f"no FIFA code mapping for nation {nation}")
    return code


def _parse_elo_event(text: str) -> dict[str, EloRow]:
    rows: dict[str, EloRow] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        cols = line.split("\t")
        if len(cols) < 4:
            raise ValueError(f"unexpected Elo event row: {line!r}")
        row = EloRow(
            source_rank=int(cols[0]),
            global_rank=int(cols[1]),
            code=cols[2],
            rating=int(cols[3]),
        )
        rows[row.code] = row
    return rows


def _parse_fifa_snapshot(data: dict) -> dict[str, FifaRow]:
    rows: dict[str, FifaRow] = {}
    for raw in data.get("rankings", []):
        item = raw["rankingItem"]
        code = item["countryCode"]
        rows[code] = FifaRow(
            rank=int(item["rank"]),
            code=code,
            name=item["name"],
            points=float(item["totalPoints"]),
            release_datetime=raw["lastUpdateDate"],
        )
    return rows


def _participant_pairs(output_dir: Path) -> list[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    mens_tournaments = {
        row["tournament_id"]
        for row in _load_json(output_dir / "tournaments.json")
        if row.get("womens") is False
    }
    for card in _load_json(output_dir / "player_tournaments.json"):
        if card["tournament_id"] in mens_tournaments:
            pairs.add((card["tournament_id"], card["nation_id"]))
    cards_2026 = output_dir / "player_tournaments_2026.json"
    if cards_2026.exists():
        for card in _load_json(cards_2026):
            pairs.add((card["tournament_id"], card["nation_id"]))
    return sorted(pairs)


def _tournament_years(output_dir: Path) -> dict[str, int]:
    years: dict[str, int] = {}
    for row in _load_json(output_dir / "tournaments.json"):
        if row.get("womens") is False:
            years[row["tournament_id"]] = int(row["year"])
    t2026 = output_dir / "tournaments_2026.json"
    if t2026.exists():
        for row in _load_json(t2026):
            years[row["tournament_id"]] = int(row["year"])
    return years


def build_all(
    output_dir: Path = OUTPUT_DIR,
    sources_dir: Path = SOURCES_DIR,
) -> list[dict]:
    nations = _load_json(output_dir / "nations.json")
    n2026 = output_dir / "nations_2026.json"
    if n2026.exists():
        nations += _load_json(n2026)
    nation_by_id = {n["nation_id"]: n for n in nations}
    tournament_year = _tournament_years(output_dir)

    elo_team_names = _source_name_map((sources_dir / "elo" / "en.teams.tsv").read_text())
    elo_by_year = {
        year: _parse_elo_event((sources_dir / "elo" / _elo_event_filename(year)).read_text())
        for year in MEN_WORLD_CUP_YEARS
    }
    fifa_by_year = {
        year: _parse_fifa_snapshot(
            _load_json(
                sources_dir
                / "fifa"
                / f"{year}_{FIFA_RANKING_SNAPSHOTS[year]['date_id']}.json"
            )
        )
        for year in FIFA_RANKING_SNAPSHOTS
    }

    rows: list[dict] = []
    for tournament_id, nation_id in _participant_pairs(output_dir):
        year = tournament_year[tournament_id]
        nation = nation_by_id[nation_id]

        elo_code = _elo_code(nation, elo_team_names)
        elo_rows = elo_by_year[year]
        if elo_code not in elo_rows:
            raise ValueError(
                f"{tournament_id} {nation['canonical_name']} ({elo_code}) missing from "
                f"World Football Elo {year} tournament-start snapshot"
            )
        elo = elo_rows[elo_code]
        elo_score = _rank_score(elo.global_rank)

        fifa: FifaRow | None = None
        fifa_score: float | None = None
        if year >= 1994:
            fifa_rows = fifa_by_year[year]
            fifa_code = _fifa_code(nation, fifa_rows)
            if fifa_code not in fifa_rows:
                raise ValueError(
                    f"{tournament_id} {nation['canonical_name']} ({fifa_code}) missing from "
                    f"FIFA {FIFA_RANKING_SNAPSHOTS[year]['date_id']} snapshot"
                )
            fifa = fifa_rows[fifa_code]
            fifa_score = _rank_score(fifa.rank)
            strength = ELO_WEIGHT_POST_1994 * elo_score + FIFA_WEIGHT_POST_1994 * fifa_score
            strength_basis = "elo_rank_plus_fifa_rank"
        else:
            strength = elo_score
            strength_basis = "elo_rank"

        ceiling = raw_only_ceiling_for_strength(strength)
        row = {
            "tournament_id": tournament_id,
            "year": year,
            "nation_id": nation_id,
            "nation_code": nation["code"],
            "nation_name": nation["canonical_name"],
            "elo_code": elo.code,
            "elo_global_rank": elo.global_rank,
            "elo_rating": elo.rating,
            "elo_rank_score": round(elo_score, 6),
            "fifa_code": fifa.code if fifa else None,
            "fifa_date_id": FIFA_RANKING_SNAPSHOTS[year]["date_id"] if fifa else None,
            "fifa_release_date": FIFA_RANKING_SNAPSHOTS[year]["release_date"] if fifa else None,
            "fifa_rank": fifa.rank if fifa else None,
            "fifa_points": round(fifa.points, 2) if fifa else None,
            "fifa_rank_score": round(fifa_score, 6) if fifa_score is not None else None,
            "strength": round(strength, 6),
            "strength_basis": strength_basis,
            "raw_only_ceiling": round(ceiling, 6),
        }
        rows.append(row)

    rows.sort(key=lambda r: (r["tournament_id"], r["nation_id"]))
    return rows


def load_by_key(output_dir: Path = OUTPUT_DIR) -> dict[tuple[str, str], dict]:
    path = output_dir / "national_strength.json"
    rows = _load_json(path)
    return {(r["tournament_id"], r["nation_id"]): r for r in rows}


def run(
    output_dir: Path = OUTPUT_DIR,
    sources_dir: Path = SOURCES_DIR,
) -> list[dict]:
    rows = build_all(output_dir, sources_dir)
    _write_json(output_dir / "national_strength.json", rows)
    return rows


def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="refresh source snapshots")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--sources-dir", type=Path, default=SOURCES_DIR)
    args = parser.parse_args()

    if args.fetch:
        fetch_sources(args.sources_dir)
    rows = run(args.output_dir, args.sources_dir)
    print(
        f"national_strength: wrote {len(rows):,} rows -> "
        f"{args.output_dir}/national_strength.json"
    )


if __name__ == "__main__":
    _main()
