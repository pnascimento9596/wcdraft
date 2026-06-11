"""Pinned Wikipedia historical squad pages -> club-at-tournament lookup.

The Fjelstul source has no club column for historical player-tournament cards.
This module backfills factual club names from committed English Wikipedia squad
page revisions, one snapshot per men's World Cup from 1930 through 2022. The
network fetch is off the deterministic build path; the pipeline reads only the
committed wikitext files and verifies their sha256 hashes against the manifest.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, unquote, urlencode

import pandas as pd

SOURCE_ROOT = Path(__file__).resolve().parents[2] / "sources"
MANIFEST_PATH = SOURCE_ROOT / "wikipedia_historical_squads" / "fetch_manifest.json"

SOURCE_NAME = "Wikipedia historical FIFA World Cup squads"
SOURCE_PUBLISHER = "Wikipedia (Wikimedia Foundation)"
SOURCE_LICENSE = "CC-BY-SA 4.0"
SOURCE_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
RETRIEVED_DATE = "2026-06-11"
SOURCE_SET_VERSION = "wikipedia-historical-squad-clubs-1.0.0"
HISTORICAL_YEARS = (
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
)

ATTRIBUTION = (
    "Historical club-at-tournament names for men's World Cup player cards are factual "
    "text parsed from English Wikipedia squad-page revisions, used under CC-BY-SA 4.0 "
    f"({SOURCE_LICENSE_URL}). One revision is pinned per tournament in "
    "etl/sources/wikipedia_historical_squads/fetch_manifest.json; raw wikitext is "
    "committed under etl/sources/wikipedia_<year>/. Modifications by wcdraft: parsed "
    "only factual club names, joined them to canonical player-tournament cards by "
    "deterministic entity-resolution keys, and preserved null where the source or join "
    "is absent/ambiguous. No crests, badges, kits, or proprietary ratings are ingested."
)

_USER_AGENT = "wcdraft-etl/1.0 (research; contact via repo)"
_API = (
    "https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvslots=main&"
    "rvprop=content|ids|timestamp|comment|user"
)
_PLAYER_TEMPLATE_RE = re.compile(
    r"\{\{(?:nat fs(?: g)? player|National football squad player)\s*\|",
    re.I,
)
_HEADING_RE = re.compile(r"^(={2,3})\s*(.+?)\s*\1\s*$", re.M)
_STOP_MARKERS = (
    "==Coaches representation",
    "==Statistics==",
    "==References==",
    "==Notes and references==",
)
_TEAM_ALIASES = {
    (1998, "fr yugoslavia"): "yugoslavia",
    (2002, "china pr"): "china",
}
_RESOLUTION_RANK = {
    "club_alias_bridge": 0,
    "wiki_title": 1,
    "name": 2,
    "birth_date": 3,
    "shirt": 4,
}


@dataclass(frozen=True)
class ParsedClubRow:
    tournament_id: str
    year: int
    team_name: str
    player_name: str
    player_title: str | None
    birth_date: str | None
    shirt: int | None
    position: str | None
    club: str | None
    club_title: str | None
    source_revid: int


@dataclass(frozen=True)
class ClubAliasBridge:
    source_player_name: str
    source_player_title: str
    source_revid: int
    expected_club: str
    corroboration_note: str


@dataclass(frozen=True)
class ClubBackfillResult:
    clubs: dict[tuple[str, str], str]
    methods: dict[str, int]
    review: list[dict]


# Pinned alias bridges for card rows whose canonical Fjelstul identity is represented
# under a different player-title row in the committed Wikipedia squad table. Runtime
# resolution remains deterministic: this table points from the canonical card natural
# key (player_id, tournament_id, team_id) to the pinned source row. The live redirect
# checks named below were review-time corroboration only; the build never performs
# live redirect resolution.
CLUB_ALIAS_BRIDGES: dict[tuple[str, str, str], ClubAliasBridge] = {
    (
        "P-83291",
        "WC-1930",
        "T-46",
    ): ClubAliasBridge(
        source_player_name="Alfredo Sánchez",
        source_player_title="Alfredo Sánchez (footballer, born 1904)",
        source_revid=1353483110,
        expected_club="Club América",
        corroboration_note=(
            "Review verified Alfredo Viejo Sánchez redirects to the pinned Alfredo "
            "Sánchez row; same Mexico 1930 squad context. Pinned source DOB differs, "
            "so this remains an explicit bridge, not generalized DOB resolution."
        ),
    ),
    (
        "P-44010",
        "WC-1930",
        "T-56",
    ): ClubAliasBridge(
        source_player_name="Luis de Souza",
        source_player_title="Luis de Souza",
        source_revid=1353483110,
        expected_club="Universitario de Deportes",
        corroboration_note=(
            "Review verified Luis Souza Ferreira redirects to the pinned Luis de Souza "
            "row; same Peru 1930 squad context. Pinned source DOB differs, so this is "
            "kept as a documented alias bridge."
        ),
    ),
    (
        "P-70294",
        "WC-1930",
        "T-61",
    ): ClubAliasBridge(
        source_player_name="Nicolae Kovács",
        source_player_title="Nicolae Kovács",
        source_revid=1353483110,
        expected_club="Banatul Timișoara",
        corroboration_note=(
            "Review verified Miklós Kovács redirects to the pinned Nicolae Kovács "
            "row; same Romania 1930 squad context with a six-day DOB discrepancy "
            "recorded in the pinned/canonical sources."
        ),
    ),
    (
        "P-56198",
        "WC-1938",
        "T-23",
    ): ClubAliasBridge(
        source_player_name="Frans G. Hukom",
        source_player_title="Frans G. Hukom",
        source_revid=1353856728,
        expected_club="Sparta Bandung",
        corroboration_note=(
            "Review verified Frans Hu Kon redirects to the pinned Frans G. Hukom row; "
            "same Dutch East Indies 1938 squad context. Canonical DOB is absent, so "
            "the bridge documents the title-equivalence evidence."
        ),
    ),
    (
        "P-92151",
        "WC-1998",
        "T-63",
    ): ClubAliasBridge(
        source_player_name="Ibrahim Suwayed",
        source_player_title="Ibrahim Suwayed",
        source_revid=1358659668,
        expected_club="Al-Ahli",
        corroboration_note=(
            "Review verified Ibrahim Al-Shahrani redirects to the pinned Ibrahim "
            "Suwayed row; same Saudi Arabia 1998 squad, matching DOB, and matching "
            "shirt number 7."
        ),
    ),
}


TAIL_NULL_CLASSIFICATIONS: dict[tuple[str, str], str] = {
    ("P-83291", "WC-1930"): "bridged",
    ("P-44010", "WC-1930"): "bridged",
    ("P-70294", "WC-1930"): "bridged",
    ("P-56198", "WC-1938"): "bridged",
    ("P-92151", "WC-1998"): "bridged",
    ("P-11648", "WC-1930"): "source_lacks_club",
    ("P-58460", "WC-1930"): "source_lacks_club",
    ("P-29687", "WC-1930"): "source_lacks_club",
    ("P-41536", "WC-1930"): "source_lacks_club",
    ("P-63886", "WC-1934"): "source_lacks_club",
    ("P-01918", "WC-1934"): "source_lacks_club",
    ("P-92190", "WC-1934"): "source_lacks_club",
    ("P-44740", "WC-1934"): "source_lacks_club",
    ("P-16278", "WC-1938"): "source_lacks_club",
    ("P-92120", "WC-1938"): "source_lacks_club",
    ("P-54466", "WC-1950"): "source_lacks_club",
    ("P-46561", "WC-1950"): "source_lacks_club",
    ("P-79649", "WC-1950"): "source_lacks_club",
    ("P-71162", "WC-1950"): "source_lacks_club",
    ("P-53883", "WC-1950"): "source_lacks_club",
    ("P-79551", "WC-2010"): "source_lacks_club",
}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_dump(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _normalize_key(value: str | None) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _normalize_title(value: str | None) -> str | None:
    if not value:
        return None
    title = unquote(value).replace("_", " ").split("#", 1)[0].strip()
    return unicodedata.normalize("NFC", title).casefold() or None


def _title_from_url(url: str | None) -> str | None:
    if not url or "/wiki/" not in url:
        return None
    return _normalize_title(url.rsplit("/wiki/", 1)[1])


def _bridge_source_key(
    tournament_id: str,
    team_id: str,
    source_player_name: str,
    source_player_title: str | None,
    source_revid: int,
) -> tuple[str, str, str, str | None, int]:
    return (
        tournament_id,
        team_id,
        _normalize_key(source_player_name),
        _normalize_title(source_player_title),
        source_revid,
    )


def _club_alias_bridges_by_source() -> dict[
    tuple[str, str, str, str | None, int], tuple[str, ClubAliasBridge]
]:
    by_source: dict[tuple[str, str, str, str | None, int], tuple[str, ClubAliasBridge]] = {}
    for (player_id, tournament_id, team_id), bridge in CLUB_ALIAS_BRIDGES.items():
        source_key = _bridge_source_key(
            tournament_id,
            team_id,
            bridge.source_player_name,
            bridge.source_player_title,
            bridge.source_revid,
        )
        if source_key in by_source:
            raise ValueError(f"duplicate club alias bridge source key: {source_key}")
        by_source[source_key] = (player_id, bridge)
    return by_source


def _split_top_level(body: str, sep: str = "|") -> list[str]:
    parts: list[str] = []
    depth = 0
    buf: list[str] = []
    i = 0
    while i < len(body):
        two = body[i : i + 2]
        if two in ("[[", "{{"):
            depth += 1
            buf.append(two)
            i += 2
            continue
        if two in ("]]", "}}"):
            depth = max(0, depth - 1)
            buf.append(two)
            i += 2
            continue
        ch = body[i]
        if ch == sep and depth == 0:
            parts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def _params_to_kv(params: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for param in params:
        if "=" in param:
            key, value = param.split("=", 1)
            out[key.strip()] = value.strip()
    return out


def _strip_link(value: str) -> str:
    value = value.strip()
    match = re.search(r"\[\[([^\]]+)\]\]", value)
    if match:
        inner = match.group(1)
        return inner.split("|", 1)[1].strip() if "|" in inner else inner.strip()
    return re.split(r"\{\{|<ref|<!--", value)[0].strip()


def _link_target(value: str) -> str | None:
    match = re.search(r"\[\[([^\]]+)\]\]", value.strip())
    if not match:
        return None
    return match.group(1).split("|", 1)[0].strip() or None


def _dob_from_age(value: str) -> str | None:
    match = re.search(r"\{\{\s*[Bb]irth date and age2?\b\s*\|([^}]*)\}\}", value)
    if not match:
        return None
    nums = [int(x) for x in re.findall(r"\d+", match.group(1))]
    if len(nums) >= 6:
        year, month, day = nums[3], nums[4], nums[5]
    elif len(nums) == 3:
        year, month, day = nums
    else:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _parse_int(value: str | None) -> int | None:
    if not value:
        return None
    value = value.strip()
    return int(value) if value.isdigit() else None


def _player_template_body(segment: str, match: re.Match[str]) -> str | None:
    depth = 0
    i = match.start()
    while i < len(segment):
        two = segment[i : i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            if depth == 0:
                return segment[match.end() : i]
            i += 2
            continue
        i += 1
    return None


def _clean_heading(value: str) -> str:
    return _strip_link(re.sub(r"<!--.*?-->", "", value).strip())


def parse_squad_wikitext(wikitext: str, year: int, source_revid: int = 0) -> list[ParsedClubRow]:
    """Parse factual club rows from one pinned historical squad-page revision."""
    stops = [wikitext.find(marker) for marker in _STOP_MARKERS if wikitext.find(marker) != -1]
    body = wikitext[: min(stops)] if stops else wikitext

    rows: list[ParsedClubRow] = []
    team_name: str | None = None
    headings = list(_HEADING_RE.finditer(body))
    for idx, heading in enumerate(headings):
        title = _clean_heading(heading.group(2))
        start = heading.end()
        end = headings[idx + 1].start() if idx + 1 < len(headings) else len(body)
        if re.match(r"Group\b", title, re.I):
            team_name = None
            continue
        team_name = title
        segment = body[start:end]
        for match in _PLAYER_TEMPLATE_RE.finditer(segment):
            template_body = _player_template_body(segment, match)
            if template_body is None:
                continue
            kv = _params_to_kv(_split_top_level(template_body))
            player_name_raw = kv.get("name", "")
            club_raw = kv.get("club", "")
            rows.append(
                ParsedClubRow(
                    tournament_id=f"WC-{year}",
                    year=year,
                    team_name=team_name,
                    player_name=_strip_link(player_name_raw),
                    player_title=_link_target(player_name_raw),
                    birth_date=_dob_from_age(kv.get("age", "")),
                    shirt=_parse_int(kv.get("no")),
                    position=(kv.get("pos", "").strip().upper() or None),
                    club=_strip_link(club_raw) or None,
                    club_title=_link_target(club_raw),
                    source_revid=source_revid,
                )
            )
    return rows


def _raw_file_for(year: int) -> str:
    return f"wikipedia_{year}/{year}_fifa_world_cup_squads.wikitext"


def _manifest_entry(page: dict, revision: dict, text: str, retrieved: str) -> dict:
    year = int(page["title"][:4])
    data = text.encode("utf-8")
    return {
        "bytes": len(data),
        "charset": "utf-8",
        "file": _raw_file_for(year),
        "pageid": page["pageid"],
        "retrieved": retrieved,
        "revid": revision["revid"],
        "role": "PRIMARY - per-team squad table club names for club_at_tournament",
        "selection_rationale": (
            "Selected current revision after parser/table sanity check against canonical "
            "tournament squads; factual club names only, no crests/badges/kits."
        ),
        "sha256": _sha256(data),
        "timestamp": revision["timestamp"],
        "title": page["title"],
        "tournament_id": f"WC-{year}",
        "url": f"https://en.wikipedia.org/wiki/{quote(page['title'].replace(' ', '_'))}",
        "user": revision.get("user"),
        "year": year,
    }


def _manifest(files: list[dict], retrieved: str) -> dict:
    return {
        "api": _API,
        "attribution": ATTRIBUTION,
        "license": SOURCE_LICENSE,
        "license_url": SOURCE_LICENSE_URL,
        "note": "SHA-pinned Wikipedia wikitext snapshots; fetch is OFF the build path.",
        "publisher": SOURCE_PUBLISHER,
        "retrieved_date": retrieved,
        "version": SOURCE_SET_VERSION,
        "files": sorted(files, key=lambda f: f["year"]),
    }


def fetch_current(retrieved: str = RETRIEVED_DATE) -> dict:
    """Fetch current page revisions, write committed snapshots, and return manifest."""
    titles = "|".join(f"{year} FIFA World Cup squads" for year in HISTORICAL_YEARS)
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "revisions",
        "titles": titles,
        "rvslots": "main",
        "rvprop": "ids|timestamp|content|comment|user",
        "redirects": "1",
    }
    url = "https://en.wikipedia.org/w/api.php?" + urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as response:  # noqa: S310
        data = json.load(response)

    files: list[dict] = []
    for page in data["query"]["pages"]:
        revision = page["revisions"][0]
        text = revision["slots"]["main"]["content"]
        year = int(page["title"][:4])
        raw_path = SOURCE_ROOT / _raw_file_for(year)
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(text, encoding="utf-8")
        files.append(_manifest_entry(page, revision, text, retrieved))

    manifest = _manifest(files, retrieved)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(_json_dump(manifest), encoding="utf-8")
    return manifest


def load_manifest(path: Path = MANIFEST_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def verify_manifest(manifest: dict | None = None, source_root: Path = SOURCE_ROOT) -> list[str]:
    manifest = manifest or load_manifest()
    failures: list[str] = []
    for entry in manifest["files"]:
        path = source_root / entry["file"]
        if not path.is_file():
            failures.append(f"MISSING {entry['file']}")
            continue
        data = path.read_bytes()
        actual_sha = _sha256(data)
        if actual_sha != entry["sha256"]:
            failures.append(
                f"DRIFT {entry['file']}: manifest={entry['sha256'][:16]} "
                f"actual={actual_sha[:16]}"
            )
        if len(data) != entry["bytes"]:
            failures.append(
                f"SIZE {entry['file']}: manifest={entry['bytes']} actual={len(data)}"
            )
    return failures


def assert_manifest_verified() -> None:
    failures = verify_manifest()
    if failures:
        raise ValueError("historical Wikipedia squad source drift:\n" + "\n".join(failures))


def _iter_pinned_rows() -> list[ParsedClubRow]:
    assert_manifest_verified()
    rows: list[ParsedClubRow] = []
    for entry in load_manifest()["files"]:
        text = (SOURCE_ROOT / entry["file"]).read_text(encoding="utf-8")
        rows.extend(parse_squad_wikitext(text, int(entry["year"]), int(entry["revid"])))
    return rows


def _unique(values: list[str]) -> str | None:
    uniq = sorted(set(values))
    return uniq[0] if len(uniq) == 1 else None


def _clean_name_part(value: str | None) -> str | None:
    key = _normalize_key(value)
    if key in ("", "not applicable", "not available"):
        return None
    return value


def _player_name_keys(*parts: str | None) -> set[str]:
    cleaned = [_clean_name_part(part) for part in parts]
    return {_normalize_key(" ".join(p for p in cleaned if p))} - {""}


def _tokens(value: str | None) -> set[str]:
    return {token for token in _normalize_key(value).split() if len(token) >= 3}


def _team_key(year: int, team_name: str) -> str:
    key = _normalize_key(team_name)
    return _TEAM_ALIASES.get((year, key), key)


def _resolve_player(
    row: ParsedClubRow,
    team_id: str,
    player_title_to_id: dict[str, str],
    squad_keys: set[tuple[str, str, str]],
    by_name: dict[tuple[str, str, str], list[str]],
    by_birth_date: dict[tuple[str, str, str], list[str]],
    by_shirt: dict[tuple[str, str, int], list[str]],
    family_tokens_by_player: dict[str, set[str]],
) -> tuple[str | None, str | None]:
    candidates: list[tuple[str, str]] = []
    title = _normalize_title(row.player_title)
    if title and title in player_title_to_id:
        candidates.append(("wiki_title", player_title_to_id[title]))

    name_hit = _unique(by_name[(row.tournament_id, team_id, _normalize_key(row.player_name))])
    if name_hit:
        candidates.append(("name", name_hit))

    if row.birth_date:
        dob_hit = _unique(by_birth_date[(row.tournament_id, team_id, row.birth_date)])
        if dob_hit:
            candidates.append(("birth_date", dob_hit))

    # Shirt is intentionally last and must also agree on a canonical family token.
    # Linked alternates/replacements can share a shirt with canonical players.
    if row.shirt is not None:
        shirt_hit = _unique(by_shirt[(row.tournament_id, team_id, row.shirt)])
        if shirt_hit and (_tokens(row.player_name) & family_tokens_by_player[shirt_hit]):
            candidates.append(("shirt", shirt_hit))

    candidates.sort(key=lambda c: _RESOLUTION_RANK[c[0]])
    for method, player_id in candidates:
        if (player_id, row.tournament_id, team_id) in squad_keys:
            return player_id, method
    return None, None


def build_club_lookup(
    squads: pd.DataFrame,
    players: pd.DataFrame,
    teams: pd.DataFrame,
) -> ClubBackfillResult:
    """Return club names keyed by ``(player_id, tournament_id)`` plus review stats."""
    parsed_rows = _iter_pinned_rows()
    bridge_by_source = _club_alias_bridges_by_source()

    team_id_by_name = {
        _normalize_key(t.team_name): t.team_id for t in teams.itertuples(index=False)
    }
    player_by_id = {p.player_id: p for p in players.itertuples(index=False)}
    player_title_to_id: dict[str, str] = {}
    duplicate_titles: set[str] = set()
    for player in players.itertuples(index=False):
        title = _title_from_url(player.player_wikipedia_link)
        if not title:
            continue
        if title in player_title_to_id and player_title_to_id[title] != player.player_id:
            duplicate_titles.add(title)
            continue
        player_title_to_id[title] = player.player_id
    for title in duplicate_titles:
        player_title_to_id.pop(title, None)

    squad_keys: set[tuple[str, str, str]] = set()
    by_name: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    by_birth_date: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    by_shirt: dict[tuple[str, str, int], list[str]] = defaultdict(list)
    family_tokens_by_player: dict[str, set[str]] = {}

    for squad in squads.itertuples(index=False):
        try:
            year = int(str(squad.tournament_id).removeprefix("WC-"))
        except ValueError:
            continue
        if year not in HISTORICAL_YEARS:
            continue
        player = player_by_id[squad.player_id]
        family_tokens_by_player[squad.player_id] = _tokens(player.family_name) | _tokens(
            squad.family_name
        )
        squad_keys.add((squad.player_id, squad.tournament_id, squad.team_id))
        for key in (
            *_player_name_keys(player.given_name, player.family_name),
            *_player_name_keys(player.family_name, player.given_name),
            *_player_name_keys(player.family_name),
            *_player_name_keys(squad.given_name, squad.family_name),
            *_player_name_keys(squad.family_name),
        ):
            by_name[(squad.tournament_id, squad.team_id, key)].append(squad.player_id)
        if player.birth_date:
            by_birth_date[(squad.tournament_id, squad.team_id, player.birth_date)].append(
                squad.player_id
            )
        shirt = _parse_int(squad.shirt_number)
        if shirt:
            by_shirt[(squad.tournament_id, squad.team_id, shirt)].append(squad.player_id)

    clubs: dict[tuple[str, str], str] = {}
    method_by_key: dict[tuple[str, str], str] = {}
    review: list[dict] = []
    methods: Counter[str] = Counter()

    for row in parsed_rows:
        team_id = team_id_by_name.get(_team_key(row.year, row.team_name))
        if team_id is None:
            review.append(
                {
                    "reason": "team_unresolved",
                    "tournament_id": row.tournament_id,
                    "team_name": row.team_name,
                    "player_name": row.player_name,
                }
            )
            continue
        mechanism_player_id, mechanism_method = _resolve_player(
            row,
            team_id,
            player_title_to_id,
            squad_keys,
            by_name,
            by_birth_date,
            by_shirt,
            family_tokens_by_player,
        )

        bridge_entry = bridge_by_source.get(
            _bridge_source_key(
                row.tournament_id,
                team_id,
                row.player_name,
                row.player_title,
                row.source_revid,
            )
        )
        if bridge_entry is not None:
            bridged_player_id, bridge = bridge_entry
            card_key = (bridged_player_id, row.tournament_id, team_id)
            if card_key not in squad_keys:
                raise ValueError(f"club alias bridge target is not a squad card: {card_key}")
            if row.club != bridge.expected_club:
                raise ValueError(
                    f"club alias bridge {card_key} expected club {bridge.expected_club!r} "
                    f"but pinned source row has {row.club!r}"
                )
            if mechanism_player_id is not None and mechanism_player_id != bridged_player_id:
                raise ValueError(
                    f"club alias bridge {card_key} -> {bridged_player_id} disagrees with "
                    f"resolver mechanism result {mechanism_player_id!r}"
                )
            player_id, method = bridged_player_id, "club_alias_bridge"
        else:
            player_id, method = mechanism_player_id, mechanism_method

        if player_id is None or method is None:
            review.append(
                {
                    "reason": "player_unresolved",
                    "tournament_id": row.tournament_id,
                    "team_name": row.team_name,
                    "player_name": row.player_name,
                    "player_title": row.player_title,
                }
            )
            continue
        if row.club is None:
            review.append(
                {
                    "reason": "club_blank",
                    "tournament_id": row.tournament_id,
                    "team_name": row.team_name,
                    "player_id": player_id,
                    "player_name": row.player_name,
                }
            )
            continue

        key = (player_id, row.tournament_id)
        existing = clubs.get(key)
        if existing is None:
            clubs[key] = row.club
            method_by_key[key] = method
            methods[method] += 1
            continue
        if existing == row.club:
            continue

        old_method = method_by_key[key]
        if _RESOLUTION_RANK[method] < _RESOLUTION_RANK[old_method]:
            methods[old_method] -= 1
            clubs[key] = row.club
            method_by_key[key] = method
            methods[method] += 1
            kept = row.club
            dropped = existing
        else:
            kept = existing
            dropped = row.club
        review.append(
            {
                "reason": "conflicting_lower_confidence_row",
                "tournament_id": row.tournament_id,
                "team_name": row.team_name,
                "player_id": player_id,
                "player_name": row.player_name,
                "kept": kept,
                "dropped": dropped,
                "kept_method": method_by_key[key],
                "dropped_method": method,
            }
        )

    return ClubBackfillResult(clubs=clubs, methods=dict(+methods), review=review)


def coverage_by_tournament(cards: list[dict]) -> list[dict]:
    by_tid: dict[str, list[dict]] = defaultdict(list)
    for card in cards:
        try:
            year = int(str(card["tournament_id"]).removeprefix("WC-"))
        except ValueError:
            continue
        if year in HISTORICAL_YEARS:
            by_tid[card["tournament_id"]].append(card)

    rows: list[dict] = []
    for tid in sorted(by_tid, key=lambda t: int(t.removeprefix("WC-"))):
        total = len(by_tid[tid])
        populated = sum(1 for card in by_tid[tid] if card.get("club_at_tournament") is not None)
        rows.append(
            {
                "tournament_id": tid,
                "cards": total,
                "club_populated": populated,
                "club_null": total - populated,
                "coverage_pct": round(100 * populated / total, 2) if total else 0.0,
            }
        )
    return rows


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    if "--verify" in argv:
        failures = verify_manifest()
        print(
            "historical club Wikipedia fetch manifest verify:",
            "OK" if not failures else f"{len(failures)} drifted",
        )
        for failure in failures:
            print(failure)
        return 1 if failures else 0
    if "--fetch" in argv:
        manifest = fetch_current()
        print(f"fetched {len(manifest['files'])} Wikipedia squad pages -> {SOURCE_ROOT}/")
        print(f"manifest -> {MANIFEST_PATH}")
        return 0
    print("usage: python -m wcdraft_etl.historical_clubs --fetch|--verify")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
