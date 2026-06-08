"""Pure text helpers shared by the merit parsers and linker.

No network, no state — deterministic functions of their input. ``norm`` is the
single accent-folding key used on both source names and canonical names so a
transliteration of diacritics never blocks an otherwise-exact link (identical in
spirit to the RSSSF supplement's ``_norm``)."""

from __future__ import annotations

import html
import re
import unicodedata

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t ]+")


def norm(name: str | None) -> str:
    """Accent-fold + lowercase + drop every non-alphanumeric character."""
    decomposed = unicodedata.normalize("NFKD", name or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", stripped.lower())


def strip_tags(text: str) -> str:
    """Remove HTML tags (entities are NOT decoded here — call ``unescape`` first
    if the caller needs real Unicode)."""
    return _TAG_RE.sub("", text)


def unescape(text: str) -> str:
    return html.unescape(text)


def collapse_ws(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


# A name written in a recognition list often marks the player's *key* name in
# UPPERCASE (a surname like "MATTHEWS", or a mononym like "PELÉ" / "RONALDINHO").
# We pull that run out as an additional, more-distinctive match key.
_UC = r"A-ZÀ-ÖØ-Þ"
_UPPER_RUN_RE = re.compile(rf"\b([{_UC}][{_UC}'’.\-]{{1,}}(?:\s+[{_UC}][{_UC}'’.\-]+)*)\b")


def uppercase_key(name: str) -> str | None:
    """Return the normalized longest UPPERCASE run in ``name`` (the source's
    emphasised key name), or None if there is no multi-letter uppercase run."""
    best = ""
    for m in _UPPER_RUN_RE.finditer(name):
        run = m.group(1).strip(" .'’-")
        if len(run) > len(best):
            best = run
    key = norm(best)
    return key or None
