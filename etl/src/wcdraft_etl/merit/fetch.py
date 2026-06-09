"""Fetch + provenance for the merit raw snapshots (RUN-ONCE maintenance script).

This is the ONLY networked step and is deliberately NOT on the deterministic build
path: ``build`` reads the committed ``merit/raw/`` bytes, never the live web.

    python -m wcdraft_etl.merit.fetch            # (re)download every source + write manifest
    python -m wcdraft_etl.merit.fetch --pin      # manifest from COMMITTED bytes (no network)
    python -m wcdraft_etl.merit.fetch --verify   # recompute sha256 of committed bytes vs manifest

``--pin`` records the SHA256 of the snapshots already committed to the repo (the
exact bytes parsing runs against), so the manifest is the audit trail without a
re-download that could capture different live bytes. ``--verify`` fails on any
drift, so CI can prove the parsed bytes are unchanged. The only third-party brand
string anywhere in the manifest is inside a *provenance URL* — a verbatim public
address — never in a field name, source name, or value.
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request

from . import SOURCE_SET_VERSION, SOURCES
from .paths import MANIFEST_PATH, RAW_DIR

_USER_AGENT = "wcdraft-etl/1.0 (research; contact via repo)"
# Retrieval date of the committed snapshots (fixed for reproducibility).
_RETRIEVED = "2026-06-08"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _unique_sources() -> list:
    """One source per unique raw_file (first registration wins), in a stable order.
    A snapshot can back more than one logical source (e.g. the SAM page backs both
    the winners and the placements parser); it is pinned ONCE."""
    seen: set[str] = set()
    out = []
    for s in SOURCES:
        if s.raw_file in seen:
            continue
        seen.add(s.raw_file)
        out.append(s)
    return out


def _entry(source, data: bytes, retrieved: str) -> dict:
    return {
        "source_id": source.source_id,
        "family": source.family,
        "role": source.role,
        "file": source.raw_file,
        "url": source.url,
        "bytes": len(data),
        "sha256": _sha256(data),
        "charset": source.charset,
        "retrieved": retrieved,
    }


def _manifest(files: list[dict]) -> dict:
    return {
        "version": SOURCE_SET_VERSION,
        "note": "SHA-pinned public snapshots; fetch is OFF the deterministic build path.",
        "files": sorted(files, key=lambda f: f["file"]),
    }


def fetch_all(retrieved: str = _RETRIEVED) -> dict:
    """Download every pinned snapshot into RAW_DIR and return the manifest dict."""
    files: list[dict] = []
    for source in _unique_sources():
        out = RAW_DIR / source.raw_file
        out.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(source.url, headers={"User-Agent": _USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (pinned https hosts)
            data = resp.read()
        out.write_bytes(data)
        files.append(_entry(source, data, retrieved))
    return _manifest(files)


def manifest_from_committed(retrieved: str = _RETRIEVED) -> dict:
    """Build the manifest from the bytes ALREADY committed under RAW_DIR (no net)."""
    files = [
        _entry(s, (RAW_DIR / s.raw_file).read_bytes(), retrieved)
        for s in _unique_sources()
    ]
    return _manifest(files)


def write_manifest(manifest: dict) -> None:
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def verify() -> int:
    """Recompute sha256 of committed snapshots against the manifest. 0 if clean."""
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    bad = 0
    for f in manifest["files"]:
        actual = _sha256((RAW_DIR / f["file"]).read_bytes())
        if actual != f["sha256"]:
            print(f"DRIFT {f['file']}: manifest={f['sha256'][:16]} actual={actual[:16]}")
            bad += 1
    print("merit fetch manifest verify:", "OK" if not bad else f"{bad} drifted")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--verify" in sys.argv:
        raise SystemExit(verify())
    if "--pin" in sys.argv:
        write_manifest(manifest_from_committed())
        print(f"pinned {len(_unique_sources())} committed snapshots -> {MANIFEST_PATH}")
    else:
        write_manifest(fetch_all())
        print(f"fetched {len(_unique_sources())} snapshots -> {RAW_DIR}")
        print(f"manifest -> {MANIFEST_PATH}")
