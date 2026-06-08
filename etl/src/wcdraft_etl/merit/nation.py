"""Resolve a source's nation token to a set of canonical ``nation_id`` values.

Nation is a *corroboration / disambiguation* signal only — never the primary key.
A distinctive name links on its own; nation (and career year) are used to break a
collision when one normalized name maps to more than one canonical card. Because a
token can legitimately denote a state and its football successors (e.g. RSSSF
"Ger" spans Germany / West Germany / East Germany, "SU" spans the Soviet Union and
Russia), ``resolve`` returns a *set* of acceptable ids: a candidate corroborates
the nation when its card's ``nation_id`` is in that set.

Two token shapes occur across the sources:
  * Full country names (the Wikipedia tables and the RSSSF century/election lists):
    resolved against the canonical ``nations`` table (``canonical_name`` + aliases),
    plus a tiny supplemental alias map for abbreviations the table doesn't carry.
  * RSSSF 3-letter codes (the two Player-of-the-Year winner lists): resolved via an
    explicit, documented country-code legend — a standard transliteration of the
    codes that actually appear in the committed pages, NOT a synthesised fact.
Unmapped tokens resolve to the empty set (nation simply unavailable for that row).
"""

from __future__ import annotations

from .text import norm

# Abbreviations that appear in the sources but are not canonical aliases. Each maps
# a normalized token to a canonical_name that MUST exist in nations.json.
_SUPPLEMENTAL_ALIASES: dict[str, str] = {
    "usa": "United States",
    "nireland": "Northern Ireland",
    "northireland": "Northern Ireland",
    "uaemirates": "United Arab Emirates",
    "ireland": "Republic of Ireland",
}

# RSSSF 3-letter (occasionally 2-letter) country-code legend, restricted to the
# codes appearing in the committed POY winner pages. A code maps to one or more
# canonical_names — multiple where it spans football-successor states, so a
# corroboration check accepts any of them. ("Nil" is RSSSF's verbatim rendering
# for George Best's Northern Ireland; kept as-written, SHA-pinned.)
_RSSSF_CODE_LEGEND: dict[str, tuple[str, ...]] = {
    "arg": ("Argentina",),
    "bra": ("Brazil",),
    "eng": ("England",),
    "ita": ("Italy",),
    "uru": ("Uruguay",),
    "spa": ("Spain",),
    "fra": ("France",),
    "ger": ("Germany", "West Germany", "East Germany"),
    "frg": ("West Germany", "Germany"),
    "col": ("Colombia",),
    "por": ("Portugal",),
    "net": ("Netherlands",),
    "cze": ("Czechoslovakia", "Czech Republic"),
    "chi": ("Chile",),
    "par": ("Paraguay",),
    "su": ("Soviet Union", "Russia"),
    "sco": ("Scotland",),
    "hun": ("Hungary",),
    "nil": ("Northern Ireland",),
    "den": ("Denmark",),
    "bul": ("Bulgaria",),
    "lib": ("Liberia",),
    "ukr": ("Ukraine",),
    "cro": ("Croatia",),
    "rom": ("Romania",),
    "swe": ("Sweden",),
    "per": ("Peru",),
}


class NationResolver:
    """Built once from the canonical nations table, then queried per source row."""

    def __init__(self, nations: list[dict]):
        self._by_name: dict[str, str] = {}
        for n in nations:
            for nm in (n["canonical_name"], *n.get("aliases", [])):
                key = norm(nm)
                if key:
                    self._by_name.setdefault(key, n["nation_id"])
        # Supplemental abbreviations -> canonical_name -> nation_id.
        for key, canonical in _SUPPLEMENTAL_ALIASES.items():
            nid = self._by_name.get(norm(canonical))
            if nid is not None:
                self._by_name.setdefault(key, nid)

        # Successor closure: a nation and the football-successor states it lists in
        # its ``successor`` field (by T-id) form one equivalence group, so a token
        # naming the predecessor corroborates a card on a successor and vice-versa
        # (e.g. "Germany" <-> West/East Germany, "Russia" <-> Soviet Union). This is
        # a SAME-LINEAGE relaxation; it does NOT merge unrelated nations.
        self._succ: dict[str, frozenset[str]] = _successor_groups(nations)

    def _ids_for_names(self, names: tuple[str, ...]) -> frozenset[str]:
        ids = {self._by_name[norm(nm)] for nm in names if norm(nm) in self._by_name}
        return self._expand(ids)

    def _expand(self, ids: set[str] | frozenset[str]) -> frozenset[str]:
        """Grow an id set to include each id's successor-lineage group."""
        out: set[str] = set()
        for nid in ids:
            out |= self._succ.get(nid, {nid})
        return frozenset(out)

    def resolve(self, token: str | None) -> frozenset[str]:
        """Acceptable nation_ids for a raw token (successor-lineage expanded), or
        the empty set if the token is unmapped."""
        if not token:
            return frozenset()
        key = norm(token)
        if not key:
            return frozenset()
        # Full-name / alias match first (covers wiki + century/election lists).
        if key in self._by_name:
            return self._expand({self._by_name[key]})
        # RSSSF 3-letter code legend (the two POY winner lists).
        if key in _RSSSF_CODE_LEGEND:
            return self._ids_for_names(_RSSSF_CODE_LEGEND[key])
        return frozenset()


def _successor_groups(nations: list[dict]) -> dict[str, frozenset[str]]:
    """Union-find over nation_ids: a nation is unioned with every T-id referenced in
    its ``successor`` field. Returns id -> the full lineage group it belongs to."""
    import re

    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    ids = {n["nation_id"] for n in nations}
    for n in nations:
        nid = n["nation_id"]
        find(nid)
        for ref in re.findall(r"T-\d+", str(n.get("successor") or "")):
            if ref in ids:
                union(nid, ref)
    groups: dict[str, set[str]] = {}
    for nid in ids:
        groups.setdefault(find(nid), set()).add(nid)
    return {nid: frozenset(groups[find(nid)]) for nid in ids}
