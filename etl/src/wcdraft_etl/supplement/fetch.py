"""Fetch + provenance for the RSSSF raw snapshots (RUN-ONCE maintenance script).

This is the ONLY networked step and is deliberately NOT on the deterministic
build path: ``pipeline``/``rating`` read the committed ``supplement/raw/`` bytes,
never the live web. Running this re-downloads each pinned RSSSF page and writes
``supplement/fetch_manifest.json`` recording, per file, the source URL, byte
size, sha256, charset and retrieval date — the audit trail proving every sourced
appearance traces to a fixed public snapshot.

    python -m wcdraft_etl.supplement.fetch            # (re)download + write manifest
    python -m wcdraft_etl.supplement.fetch --verify   # check committed files vs manifest

``--verify`` recomputes sha256 of the committed snapshots and fails if any drift
from the manifest, so CI can prove the bytes parsing ran against are unchanged.
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request

from . import (
    RSSSF_ATTRIBUTION,
    RSSSF_BASE_URL,
    RSSSF_LICENSE,
    RSSSF_LICENSE_URL,
    RSSSF_SOURCE_NAME,
    RSSSF_TOURNAMENTS,
)
from .rsssf import RAW_DIR

# RAW_DIR is etl/supplement/raw/rsssf; the manifest sits at etl/supplement/ and
# its file paths are recorded relative to that directory.
MANIFEST_PATH = RAW_DIR.parents[1] / "fetch_manifest.json"
_CHARSET = "iso-8859-2"  # declared by every RSSSF {yy}full.html page
_USER_AGENT = "wcdraft-etl/1.0 (research; contact via repo)"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_all(retrieved: str) -> dict:
    """Download every pinned RSSSF page to RAW_DIR and return the manifest dict.

    ``retrieved`` (an ISO date string) is recorded as provenance; it is passed in
    rather than read from the clock so a re-run is reproducible.
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    files: list[dict] = []
    for tournament_id, raw_file in RSSSF_TOURNAMENTS.items():
        url = f"{RSSSF_BASE_URL}{raw_file}"
        req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (pinned https host)
            data = resp.read()
        (RAW_DIR / raw_file).write_bytes(data)
        files.append(
            {
                "tournament_id": tournament_id,
                "file": f"raw/rsssf/{raw_file}",
                "url": url,
                "bytes": len(data),
                "sha256": _sha256(data),
                "charset": _CHARSET,
                "retrieved": retrieved,
            }
        )
    return {
        "source_name": RSSSF_SOURCE_NAME,
        "license": RSSSF_LICENSE,
        "license_url": RSSSF_LICENSE_URL,
        "attribution": RSSSF_ATTRIBUTION,
        "files": sorted(files, key=lambda f: f["file"]),
    }


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
        path = MANIFEST_PATH.parent / f["file"]
        actual = _sha256(path.read_bytes())
        if actual != f["sha256"]:
            print(f"DRIFT {f['file']}: manifest={f['sha256'][:16]} actual={actual[:16]}")
            bad += 1
    print("fetch manifest verify:", "OK" if not bad else f"{bad} drifted")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--verify" in sys.argv:
        raise SystemExit(verify())
    # Retrieval date of the committed snapshots (kept fixed for reproducibility).
    manifest = fetch_all(retrieved="2026-06-04")
    write_manifest(manifest)
    print(f"fetched {len(manifest['files'])} RSSSF pages -> {RAW_DIR}")
    print(f"manifest -> {MANIFEST_PATH}")
