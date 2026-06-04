"""Deterministic parsers for the pinned 2026 Wikipedia raw-wikitext snapshots.

Three parsers, each reading ONE pinned snapshot (see ``source_2026``):

  * ``parse_squads``  — the squads page: 48 teams (12 groups x 4), each with its
    real 23-26 man roster and the factual career signals per player (shirt,
    position, name, date of birth, international caps, international goals, club).
  * ``parse_draw``    — the final-draw result table: each team's drawn group slot
    (A1..L4), keyed by FIFA tri-code.
  * ``parse_bracket`` — the knockout page: the real R32..Final tree as match
    records whose two feeders are group winners / runners-up / best-thirds (R32)
    or earlier match winners (R16+).

HONEST-STATE: a field absent for a player stays ``None`` — never a fabricated 0.
caps and goals are real measured integers (a current player always has both, even
if 0), so they are required and an absent value RAISES rather than defaulting.

The parsers are pure string transforms over the committed snapshot bytes — no
network, no globals, no randomness — so the same snapshot yields identical output.
"""

from __future__ import annotations

import re

# ─── wikitext tokenization ────────────────────────────────────────────────────


def _split_top_level(body: str, sep: str = "|") -> list[str]:
    """Split ``body`` on ``sep`` at brace/bracket depth 0 only.

    Template params can embed ``[[a|b]]`` wikilinks and ``{{t|x}}`` templates whose
    own ``|`` must NOT split the outer param list. We track ``[[``/``]]`` and
    ``{{``/``}}`` nesting and only break on a top-level separator.
    """
    parts: list[str] = []
    depth = 0
    buf: list[str] = []
    i = 0
    n = len(body)
    while i < n:
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
    """Turn ``name=val`` template params into a dict (positional params ignored)."""
    out: dict[str, str] = {}
    for p in params:
        if "=" in p:
            k, v = p.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _strip_link(s: str) -> str:
    """Display text of a wikilink: ``[[Target|Display]]`` -> ``Display``,
    ``[[Target]]`` -> ``Target``; plain text returned trimmed. Trailing ref/comment
    noise is dropped."""
    s = s.strip()
    m = re.search(r"\[\[([^\]]+)\]\]", s)
    if m:
        inner = m.group(1)
        return inner.split("|", 1)[1].strip() if "|" in inner else inner.strip()
    # No link: cut at the first template/ref/comment boundary.
    s = re.split(r"\{\{|<ref|<!--", s)[0]
    return s.strip()


def _dob_from_age(age_val: str) -> str | None:
    """Extract ISO ``YYYY-MM-DD`` birth date from a ``{{birth date and age...}}``.

    ``birth date and age2|REF_Y|REF_M|REF_D|BIRTH_Y|BIRTH_M|BIRTH_D`` -> last triple
    is the DOB. The plain ``birth date and age|Y|M|D`` (3 ints) -> that triple.
    Returns ``None`` when no birth template is present (honest unknown, never faked).
    """
    # Match only the template's PARAMS so the trailing "2" in "age2" is not read
    # as a date digit.
    m = re.search(r"\{\{\s*[Bb]irth date and age2?\b\s*\|([^}]*)\}\}", age_val)
    if not m:
        return None
    nums = [int(x) for x in re.findall(r"\d+", m.group(1))]
    if len(nums) >= 6:
        y, m, d = nums[3], nums[4], nums[5]
    elif len(nums) == 3:
        y, m, d = nums[0], nums[1], nums[2]
    else:
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


def _require_int(kv: dict[str, str], key: str, ctx: str) -> int:
    raw = kv.get(key, "").strip()
    m = re.match(r"-?\d+", raw)
    if not m:
        raise ValueError(f"{ctx}: expected integer {key!r}, got {raw!r}")
    return int(m.group(0))


# ─── squads ─────────────────────────────────────────────────────────────────

_GROUP_RE = re.compile(r"^==\s*Group ([A-L])\s*==\s*$", re.M)
_TEAM_RE = re.compile(r"^===\s*(.+?)\s*===\s*$", re.M)
_PLAYER_RE = re.compile(r"\{\{nat fs g player\s*\|(.*?)\}\}\s*(?=\{\{nat fs|\Z)", re.S)
_COARSE = {"GK", "DF", "MF", "FW"}


def parse_squads(wikitext: str) -> list[dict]:
    """Return one record per team (48), in group then page order.

    Each record: ``group`` (A..L), ``team_name`` (section header, verbatim), and
    ``players`` — a list of dicts with shirt/pos/name/sortname/family/given/dob/
    caps/goals/club/clubnat. Only ``===sections===`` that actually contain players
    are treated as teams (the trailing Statistics subsections are skipped).
    """
    # The statistics tables live after the last group; cut them so their
    # ===subsections=== are never mistaken for teams.
    stat = wikitext.find("==Statistics==")
    body = wikitext[:stat] if stat != -1 else wikitext

    teams: list[dict] = []
    gmatches = list(_GROUP_RE.finditer(body))
    for gi, gm in enumerate(gmatches):
        group = gm.group(1)
        gstart = gm.end()
        gend = gmatches[gi + 1].start() if gi + 1 < len(gmatches) else len(body)
        gbody = body[gstart:gend]

        tmatches = list(_TEAM_RE.finditer(gbody))
        for ti, tm in enumerate(tmatches):
            tstart = tm.end()
            tend = tmatches[ti + 1].start() if ti + 1 < len(tmatches) else len(gbody)
            tbody = gbody[tstart:tend]
            players = _parse_players(tbody, tm.group(1))
            if not players:
                continue  # not a squad section (e.g. a stray subsection)
            teams.append({"group": group, "team_name": tm.group(1).strip(), "players": players})
    return teams


def _parse_players(tbody: str, team_name: str) -> list[dict]:
    players: list[dict] = []
    for m in _PLAYER_RE.finditer(tbody):
        params = _split_top_level(m.group(1))
        kv = _params_to_kv(params)
        pos = kv.get("pos", "").strip().upper()
        if pos not in _COARSE:
            raise ValueError(f"{team_name}: player has non-coarse position {pos!r}")
        sortname = kv.get("sortname", "").strip()
        family, given = None, None
        if "," in sortname:
            fam, giv = sortname.split(",", 1)
            family, given = fam.strip() or None, giv.strip() or None
        players.append(
            {
                "shirt": _require_int(kv, "no", f"{team_name} shirt") if kv.get("no") else None,
                "position": pos,
                "name": _strip_link(kv.get("name", "")),
                "sortname": sortname or None,
                "family_name": family,
                "given_name": given,
                "birth_date": _dob_from_age(kv.get("age", "")),
                "caps": _require_int(kv, "caps", f"{team_name} {kv.get('name')}"),
                "goals": _require_int(kv, "goals", f"{team_name} {kv.get('name')}"),
                "club": _strip_link(kv.get("club", "")) or None,
                "club_nation_code": (kv.get("clubnat", "").strip() or None),
                "captain": kv.get("captain", "").strip().lower() in ("yes", "true", "1"),
            }
        )
    return players


# ─── draw (group slots) ───────────────────────────────────────────────────────

_SLOT_RE = re.compile(
    r"\|\s*([A-L])([1-4])\s*\|\|[^{]*\{\{#invoke:flag\|fb\|([A-Z]{3})\}\}",
)


def parse_draw(wikitext: str) -> dict[str, dict[int, str]]:
    """Return ``{group: {slot: fifa_code}}`` from the Final-draw result table.

    Only the result section is read; the slot label (A1..L4) is authoritative for
    each team's drawn position (NOT the pot, and NOT the alphabetical squads-page
    order).
    """
    start = wikitext.find("<section begin=Result")
    end = wikitext.find("<section end=Result")
    region = wikitext[start:end] if start != -1 and end != -1 else wikitext
    out: dict[str, dict[int, str]] = {}
    for g, slot, code in _SLOT_RE.findall(region):
        out.setdefault(g, {})[int(slot)] = code
    return out


# ─── knockout bracket ─────────────────────────────────────────────────────────

# Section-tag prefix -> round label. The tag (R32-1.. / R16-1.. / QF1.. / SF1..)
# is the authoritative round marker; the match NUMBER is read from the score link.
_TAG_ROUND = (("R32-", "R32"), ("R16-", "R16"), ("QF", "QF"), ("SF", "SF"))

_FEEDER_RE = re.compile(
    r"team([12])\s*=\s*(?:<!--.*?-->)?\s*"
    r"(Winner Group [A-L]|Runner-up Group [A-L]|3rd Group [A-L/]+|"
    r"Winner Match \d+|Loser Match \d+)"
)
# The football box's OWN match number lives in its score link, NOT in team1/team2
# (which may themselves read "Winner Match NN" and must not be mistaken for it).
_SCORE_MATCH_RE = re.compile(r"score\s*=\s*\{\{score link\|[^}|]*\|Match (\d+)\}\}")


def _tag_round(tag: str) -> str | None:
    for prefix, label in _TAG_ROUND:
        if tag.startswith(prefix):
            return label
    return None


def parse_bracket(wikitext: str) -> list[dict]:
    """Return the knockout matches, sorted by match number.

    Each record: ``match`` (int), ``round`` (R32/R16/QF/SF/F), ``feeders`` — the
    two team-source strings exactly as published (``Winner Group E``,
    ``3rd Group A/B/C/D/F``, ``Winner Match 77`` ...).

    The R32..SF football boxes live in ``<section begin=TAG/>`` blocks on this page.
    The Final is transcluded from a separate page, so it is reconstructed here from
    the two semi-final match numbers (Final = winner SF1 vs winner SF2); its match
    number 104 follows the third-place play-off 103, which IS present in the
    snapshot (the ``Match for third place`` anchor) — so 104 is verified, not guessed.
    The third-place play-off itself is excluded (off every advancement path).
    """
    matches: dict[int, dict] = {}
    sf_nums: list[int] = []
    for m in re.finditer(
        r"<section begin=([A-Za-z0-9-]+)\s*/>(.*?)<section end=\1\s*/>", wikitext, re.S
    ):
        tag, seg = m.group(1), m.group(2)
        rnd = _tag_round(tag)
        if rnd is None or "football box" not in seg:
            continue
        sm = _SCORE_MATCH_RE.search(seg)
        if not sm:
            raise ValueError(f"knockout section {tag} has no score-link match number")
        match_num = int(sm.group(1))
        feeders = [f for _, f in sorted(_FEEDER_RE.findall(seg), key=lambda t: t[0])]
        if len(feeders) != 2:
            raise ValueError(f"knockout section {tag} (match {match_num}): expected 2 feeders")
        matches[match_num] = {"match": match_num, "round": rnd, "feeders": feeders}
        if rnd == "SF":
            sf_nums.append(match_num)

    if len(sf_nums) == 2:
        a, b = sorted(sf_nums)
        matches[104] = {
            "match": 104,
            "round": "F",
            "feeders": [f"Winner Match {a}", f"Winner Match {b}"],
        }
    return [matches[k] for k in sorted(matches)]
