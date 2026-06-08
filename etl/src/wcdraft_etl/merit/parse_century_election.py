"""Parser for the IFFHS Century election lists (``rsssf/iffhs-century.html``):

    iffhs_century -> retrospective_selection family

The page holds many ranked elections under ``<h4>`` headers: world, per-continent
and per-country "Player of the Century" polls, interleaved with "Keeper of the
Century" and "Female Player of the Century" polls. We read ONLY the *player*
elections (header contains "Player of the Century"), skipping keeper and female
polls. Each qualifying section's ranked rows look like::

     1."Pelé"                 (Brazil)        1705  (Edson Arantes do Nascimento)
     4.Alfredo di Stéfano     (Argentina)     1215

i.e. ``rank.Name (Nation) points [(birth name)]`` — the first parenthesis is the
nation; the optional trailing parenthesis (a fuller name) is ignored. A player
chosen in several elections yields several rows (deduplicated to one fact per
player at link time). Pure function of the committed bytes; year is None (a
retrospective poll, bucketed by the player's own era at link time)."""

from __future__ import annotations

import re

from . import SOURCE_BY_ID, MeritRecord
from .paths import read_raw
from .text import collapse_ws, norm, strip_tags, unescape

_SOURCE_ID = "iffhs_century"

# Section headers; capture inner label to decide player-vs-keeper-vs-female.
_HEADER_RE = re.compile(r"<h[34][^>]*>(.*?)</h[34]>", re.IGNORECASE | re.DOTALL)
# World/continental election row: rank . [quote] name [quote] ( nation ) points...
_ROW_NATION_RE = re.compile(r'^\s*\d+\.\s*"?\s*([^"(\n]+?)\s*"?\s*\(([^)\n]+)\)', re.MULTILINE)
# Countrywise election row: rank . name points  (nation implied by the header).
_ROW_PLAIN_RE = re.compile(r"^\s*\d+\.\s*(\S[^(\n]*?)\s+\d+\s*$", re.MULTILINE)

# Header left-of-"-" values that are NOT countries (rows carry an explicit nation).
_CONTINENTAL = frozenset(
    {
        "world",
        "africa",
        "asia",
        "europe",
        "oceania",
        "centralandnorthamerica",
        "southamerica",
    }
)


def _is_player_election(label: str) -> bool:
    low = label.lower()
    return (
        "player of the century" in low
        and "keeper" not in low
        and "female" not in low
    )


def parse(source_id: str = _SOURCE_ID) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = unescape(read_raw(src.raw_file, src.charset))

    headers = list(_HEADER_RE.finditer(raw))
    records: list[MeritRecord] = []
    for i, h in enumerate(headers):
        label = collapse_ws(strip_tags(h.group(1)))
        if not _is_player_election(label):
            continue
        section_start = h.end()
        section_end = headers[i + 1].start() if i + 1 < len(headers) else len(raw)
        region = strip_tags(raw[section_start:section_end])

        header_country = label.split(" - ")[0].strip()
        is_continental = norm(header_country) in _CONTINENTAL
        if is_continental:
            pairs = [
                (collapse_ws(m.group(1)), collapse_ws(m.group(2)))
                for m in _ROW_NATION_RE.finditer(region)
            ]
        else:
            # Countrywise list: nation is the header's country, rows carry none.
            pairs = [
                (collapse_ws(m.group(1)), header_country)
                for m in _ROW_PLAIN_RE.finditer(region)
            ]
        for name, nation_token in pairs:
            if not name or len(name) < 2:
                continue
            records.append(
                MeritRecord(
                    source_id=_SOURCE_ID,
                    family=src.family,
                    name=name,
                    nation_token=nation_token,
                    year=None,
                    detail=f"century election: {label}",
                    extra={"election": label},
                )
            )
    return records
