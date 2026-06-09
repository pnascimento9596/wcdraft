"""Deterministic factual research backstop (MV2-2).

Citation-backed public facts for the coverage gaps that the parser-only public
lists still miss — the curated historical defender / goalkeeper / non-European
gap list, and the bounded top-5-per-2026-team linked slice. Every row carries a
REAL, fetchable public citation URL and the specific claim it supports; an
**uncited row FAILS the build** (``ResearchError``). The records are then handed to
the SAME conservative linker as parser rows — unique high-confidence link only,
ambiguous withheld to ``link_review.json`` — so there is no path for a research row
to bypass the link discipline.

Strict scope of a research fact (enforced by structure, not trust): only a factual
claim that would ALSO be valid parser output — a captaincy record or an award /
recognition placement. NO rating numbers, rankings, OVR / channel / boost /
override, and NO LLM-generated facts. The only fields a row carries are the
player's display name, nation, year, source-stated position, a human ``detail``,
and the ``citation`` (url + claim).

Pure + offline: reads ONLY the committed notes under ``merit/raw/research/`` plus
their pinned manifest. No network, clock, randomness, fuzzy lookup, or LLM call —
two consecutive builds are byte-identical. The 2026 review set (top-5-per-linked-
team by projected score) was selected OFFLINE at authoring time from the committed
projected-rating and 2026 player-tournament tables; the committed notes are static,
so this module never imports the rating layer (kept honest by
``test_no_rating_artifact_is_imported_or_written``).
"""

from __future__ import annotations

import hashlib
import json

# SOURCE_SET_VERSION stamps the research manifest (mirrors fetch_manifest).
from . import RESEARCH_SOURCES, SOURCE_SET_VERSION, MeritRecord
from .paths import RESEARCH_DIR, RESEARCH_MANIFEST_PATH


class ResearchError(RuntimeError):
    """A committed research note is malformed or uncited — the build must fail."""


def _read_bytes(raw_file: str) -> bytes:
    return (RESEARCH_DIR.parent / raw_file).read_bytes()


def _load_note(source) -> dict:
    """Parse one committed research note, validating its envelope."""
    try:
        doc = json.loads(_read_bytes(source.raw_file))
    except FileNotFoundError as exc:  # pragma: no cover - committed file missing
        raise ResearchError(f"{source.raw_file}: missing committed research note") from exc
    except json.JSONDecodeError as exc:
        raise ResearchError(f"{source.raw_file}: invalid JSON ({exc})") from exc
    if doc.get("source_id") != source.source_id:
        raise ResearchError(
            f"{source.raw_file}: source_id {doc.get('source_id')!r} != registry "
            f"{source.source_id!r}"
        )
    if doc.get("family") != source.family:
        raise ResearchError(
            f"{source.raw_file}: family {doc.get('family')!r} != registry "
            f"{source.family!r}"
        )
    if not isinstance(doc.get("rows"), list) or not doc["rows"]:
        raise ResearchError(f"{source.raw_file}: 'rows' must be a non-empty list")
    return doc


def _record(source, row: dict) -> MeritRecord:
    """Validate one row's citation + shape and build a MeritRecord. Raises on any
    uncited / malformed row so a hand-edit that drops a citation fails the build."""
    name = row.get("name")
    if not name or not isinstance(name, str):
        raise ResearchError(f"{source.raw_file}: row missing 'name'")
    cite = row.get("citation")
    if not isinstance(cite, dict):
        raise ResearchError(f"{source.raw_file}: {name!r} has no citation object")
    url = cite.get("url")
    claim = cite.get("claim")
    if not url or not isinstance(url, str) or not url.lower().startswith("http"):
        raise ResearchError(f"{source.raw_file}: {name!r} citation.url is not a real URL")
    if not claim or not isinstance(claim, str):
        raise ResearchError(f"{source.raw_file}: {name!r} citation.claim is empty")
    pos = row.get("position")
    if pos is not None and pos not in ("GK", "DF", "MF", "FW"):
        raise ResearchError(f"{source.raw_file}: {name!r} bad position {pos!r}")
    year = row.get("year")
    if year is not None and not isinstance(year, int):
        raise ResearchError(f"{source.raw_file}: {name!r} bad year {year!r}")
    return MeritRecord(
        source_id=source.source_id,
        family=source.family,
        name=name,
        nation_token=row.get("nation_token"),
        year=year,
        position=pos,
        detail=row.get("detail", ""),
        extra={
            "citation": {"url": url, "claim": claim},
            "scope": row.get("scope", ""),
        },
    )


def collect() -> list[MeritRecord]:
    """Every research record, in stable (source, file-order) order. Raises
    ResearchError on the first uncited / malformed row — uncited fails the build."""
    records: list[MeritRecord] = []
    for source in RESEARCH_SOURCES:
        doc = _load_note(source)
        for row in doc["rows"]:
            records.append(_record(source, row))
    return records


# ─── research manifest (own SHA-pin; separate from fetch_manifest.json) ───────
def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest_from_committed() -> dict:
    """Build the research manifest from the committed note bytes (no network). Each
    file entry pins sha256 + the distinct cited URLs, so editing ANY citation changes
    the bytes and therefore the pinned sha256 — ``verify`` then fails on drift."""
    files = []
    for source in RESEARCH_SOURCES:
        data = _read_bytes(source.raw_file)
        doc = json.loads(data)
        cited = sorted({r["citation"]["url"] for r in doc["rows"]})
        files.append(
            {
                "file": source.raw_file,
                "source_id": source.source_id,
                "family": source.family,
                "bytes": len(data),
                "sha256": _sha256(data),
                "row_count": len(doc["rows"]),
                "cited_urls": cited,
            }
        )
    return {
        "version": SOURCE_SET_VERSION,
        "note": (
            "MV2-2 deterministic factual research backstop. Citation-backed public "
            "facts for coverage gaps the parser-only lists miss (curated historical "
            "defender/GK/non-European greats + the bounded top-5-per-2026-linked-team "
            "slice). Each note is SHA-pinned and every row carries a fetchable public "
            "citation URL plus the specific claim it supports; editing a citation "
            "changes the bytes and therefore the pinned sha256. The linker treats "
            "research rows identically to parser rows; an uncited row fails the build."
        ),
        "files": sorted(files, key=lambda f: f["file"]),
    }


def write_manifest(manifest: dict) -> None:
    RESEARCH_MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def verify() -> int:
    """Recompute sha256 of every committed research note against the manifest. 0 if
    clean. A changed citation (changed bytes) trips a sha mismatch here."""
    manifest = json.loads(RESEARCH_MANIFEST_PATH.read_text(encoding="utf-8"))
    pinned = {f["file"]: f["sha256"] for f in manifest["files"]}
    bad = 0
    for source in RESEARCH_SOURCES:
        actual = _sha256(_read_bytes(source.raw_file))
        want = pinned.get(source.raw_file)
        if want != actual:
            print(
                f"DRIFT {source.raw_file}: manifest={(want or '')[:16]} "
                f"actual={actual[:16]}"
            )
            bad += 1
    if set(pinned) != {s.raw_file for s in RESEARCH_SOURCES}:
        print("DRIFT research manifest file set != registry research sources")
        bad += 1
    print("merit research manifest verify:", "OK" if not bad else f"{bad} drifted")
    return 1 if bad else 0


if __name__ == "__main__":
    import sys

    if "--verify" in sys.argv:
        raise SystemExit(verify())
    write_manifest(manifest_from_committed())
    print(f"pinned {len(RESEARCH_SOURCES)} research notes -> {RESEARCH_MANIFEST_PATH}")
