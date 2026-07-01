"""Honest-state coercion helpers.

The one rule these enforce: a missing signal becomes ``None`` (JSON null), never
0, never False, never "". Callers opt in per-column — there is no blanket
"clean the dataframe" pass, because what counts as missing is column-specific
(e.g. shirt number 0 means "no shirt assigned" pre-1954, but goal count 0 is a
real measured zero).
"""

from __future__ import annotations

# Coarse position vocabulary, in canonical display/tiebreak order.
POSITIONS = ("GK", "DF", "MF", "FW")
_POS_RANK = {p: i for i, p in enumerate(POSITIONS)}


def s_or_none(v) -> str | None:
    """Empty/whitespace string -> None; otherwise the trimmed string."""
    if v is None:
        return None
    t = str(v).strip()
    return t or None


_NAME_PART_SENTINELS = {"not applicable"}


def name_part_or_none(v) -> str | None:
    """Name component coercion for audited upstream sentinels.

    This is deliberately narrower than ``s_or_none``: tokens such as "Na" can be
    real names, so only source-proven missing-name sentinels are dropped.
    """
    t = s_or_none(v)
    if t is None:
        return None
    return None if t.casefold() in _NAME_PART_SENTINELS else t


def int_or_none(v) -> int | None:
    """Parse an int; blank or unparseable -> None (never a silent 0)."""
    t = s_or_none(v)
    if t is None:
        return None
    try:
        return int(t)
    except ValueError:
        return None


def shirt_or_none(v) -> int | None:
    """Shirt number, honoring the upstream sentinel: 0 means 'no shirt assigned'
    (squad numbers did not exist before 1954) and is preserved as null, not 0."""
    n = int_or_none(v)
    return None if (n is None or n == 0) else n


def sort_positions(codes) -> list[str]:
    """De-duplicate and order coarse positions canonically (GK, DF, MF, FW)."""
    uniq = {c for c in codes if c in _POS_RANK}
    return sorted(uniq, key=lambda c: _POS_RANK[c])
