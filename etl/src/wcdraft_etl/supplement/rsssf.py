"""Deterministic parser for RSSSF ``{yy}full.html`` World Cup archive pages.

No network and no LLM: a pure function of the committed raw bytes. We extract the
per-match starting XIs and nothing else. The structure of every page is:

    <H2>Group A - ...</H2>
    <B>FRA</B>: Thepot (24 Chantrel) - Capelle, Mattler - Chantrel, Pinel,
    Villaplane (c) - Liberati, Delfour, Maschinot, L.Laurent, Langiller
    <B>MEX</B>: Bonfiglio - ...

    0:1 ...                          <- goal lines (start with a score)
    ...
    <H2>Scorers' list</H2>           <- everything from here down is NOT a lineup
    <H2>Coaches, ... reserve players</H2>
    <B>ARG</B>: J. Tramutola | ...   <- coach/reserve blocks reuse <B>CODE</B>:

So two anchors make the extraction exact and auditable:

  * a starting-XI line is ``<B>{3-letter code}</B>: ...`` continued over wrapped
    lines until a blank line / a tag / a goal line;
  * we hard-stop at the first "Scorers / Coaches / reserve / squad / records"
    header so the coach + reserve-player blocks (same ``<B>CODE</B>:`` shape) can
    never be mistaken for a lineup.

Counting rule (see package docstring): pre-1970 had no substitutes, so each block
is one match-appearance set for that team; a parenthetical ``(NN Name)`` keeper
swap names a player already in the XI but is still captured defensively. The
match count the parser recovers is cross-checked against KNOWN_MATCH_COUNT by the
linker as a completeness gate.
"""

from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

# Package location (etl/src/wcdraft_etl/supplement -> etl/supplement/raw/rsssf).
RAW_DIR = Path(__file__).resolve().parents[3] / "supplement" / "raw" / "rsssf"

# 3-letter <B> codes that are NOT national teams (annotations that share the tag).
_NON_TEAM_CODES = frozenset({"NOTE", "PEN"})

# First header that ends the match-lineup region: everything below is scorers,
# coaches, reserve players, squad info, age records — never a starting XI.
_CUTOFF_RE = re.compile(
    r"<H[1-3]>[^<]*(?:scorer|goalscorer|coach|reserve|squad|oldest|youngest|record)",
    re.IGNORECASE,
)
_BLOCK_RE = re.compile(r"^<B>([A-Z]{3})</B>:\s*(.*)$")
_GOAL_LINE_RE = re.compile(r"^\s*\d+:\d+")


def _norm(name: str) -> str:
    """Accent-fold + lowercase + strip non-alphanumerics. The matching key used
    on both RSSSF surnames and canonical family names so transliteration of
    diacritics never blocks an otherwise-exact link."""
    decomposed = unicodedata.normalize("NFKD", name or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", stripped.lower())


@dataclass(frozen=True)
class PlayerToken:
    """One appeared player as written in a lineup: the match key, the (upper)
    initial if RSSSF gave one (``L.Laurent`` -> "L"), and the raw surname for
    review readability."""

    key: str
    initial: str | None
    raw: str


@dataclass(frozen=True)
class Lineup:
    """One team's starting XI in one match."""

    team_code: str
    players: tuple[PlayerToken, ...]


def _split_tokens(buf: str) -> list[PlayerToken]:
    """Split a lineup string into appeared players.

    Players are separated by ``,`` and position groups by `` - ``. Two RSSSF
    quirks are normalised to a comma first because the characters never occur
    inside a real name: `` = `` (a stray group separator, e.g. ``Ostrovski =
    Sabo``) and a period BETWEEN full names (``Ademir. Jair``) — the lookbehind
    requires >=2 letters so a genuine initial (``J. Charlton``) is left intact.
    """
    buf = buf.replace("=", ", ")
    buf = re.sub(r"(?<=[A-Za-z]{2})\.\s+", ", ", buf)
    out: list[PlayerToken] = []
    for part in re.split(r"\s-\s|,", buf):
        part = part.strip()
        if not part:
            continue
        # A parenthetical is either the captain mark "(c)" or an in-match keeper
        # swap "(24 Chantrel)" naming a player already in the XI — captured
        # defensively. Both are then stripped from the base surname.
        swaps = [
            swap.group(1).strip()
            for inner in re.findall(r"\(([^)]*)\)", part)
            if (swap := re.match(r"^\d+\s+(.+)$", inner.strip()))
        ]
        base = re.sub(r"\([^)]*\)", "", part).strip()
        for blob in [base, *swaps]:
            blob = blob.strip().strip(".")
            if not blob:
                continue
            im = re.match(r"^([A-Za-z])\.\s*(.+)$", blob)  # leading initial "L.Laurent"
            initial, surname = (im.group(1).upper(), im.group(2).strip()) if im else (None, blob)
            key = _norm(surname)
            if key:
                out.append(PlayerToken(key=key, initial=initial, raw=surname.strip()))
    return out


def parse_lineups(raw_text: str) -> list[Lineup]:
    """Extract every starting XI from a raw RSSSF ``{yy}full.html`` page.

    Pure function of the input text. HTML entities are unescaped first so names
    written as entities (``Carre&ntilde;o``) decode to real Unicode before the
    accent-fold. The result is one Lineup per (match, team).
    """
    text = html.unescape(raw_text)
    cut = _CUTOFF_RE.search(text)
    if cut:
        text = text[: cut.start()]
    lines = text.split("\n")
    lineups: list[Lineup] = []
    i = 0
    while i < len(lines):
        m = _BLOCK_RE.match(lines[i])
        if not m or m.group(1) in _NON_TEAM_CODES:
            i += 1
            continue
        code, buf = m.group(1), m.group(2)
        j = i + 1
        while j < len(lines):  # gather wrapped continuation lines
            nxt = lines[j]
            if nxt.strip() == "" or nxt.lstrip().startswith("<") or _GOAL_LINE_RE.match(nxt):
                break
            # Join wrapped lines with a space (the player separators "," / " - "
            # already sit at the wrap boundary). A continuation that begins with a
            # captain mark ("Villaplane\n(c) - ...") is kept, not dropped — that is
            # why there is no "starts with (" break. A multi-word surname stays
            # intact this way (e.g. "Van Heel", "del Sol") so it matches its
            # canonical family name directly. The rare case where the wrap DROPS a
            # comma and merges two players ("Murray\nMudie") is repaired downstream
            # by the linker's canonical-verified de-merge, so it is never a ghost.
            buf += " " + nxt.strip()
            j += 1
        players = tuple(_split_tokens(buf))
        if players:
            lineups.append(Lineup(team_code=code, players=players))
        i = j
    return lineups


def load_lineups(raw_filename: str, raw_dir: Path = RAW_DIR) -> list[Lineup]:
    """Parse a committed RSSSF snapshot (read as iso-8859-2, the page's charset)."""
    raw = (raw_dir / raw_filename).read_text(encoding="iso-8859-2")
    return parse_lineups(raw)
