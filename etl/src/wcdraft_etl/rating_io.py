"""Historical rating input and output helpers."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import output_contracts

# ─── INPUT LOADING ────────────────────────────────────────────────────────────


def _load(output_dir: Path, name: str) -> list[dict]:
    return json.loads((output_dir / f"{name}.json").read_text(encoding="utf-8"))


def _load_career_stature(output_dir: Path) -> dict[str, dict]:
    """player_id -> career-stature row from the offline merit composite.

    Missing file is tolerated (returns {}): the rating stage then degrades to the
    pre-career behavior with every lift = 0, so rating.py never hard-depends on the
    merit artifact existing. A present file must carry unique player_id keys.
    Historical and projected rating stages consume the full row directly.
    """
    path = output_dir / "career_stature.json"
    if not path.exists():
        return {}
    table = json.loads(path.read_text(encoding="utf-8"))
    by_player: dict[str, dict] = {}
    for row in table["career_stature"]:
        pid = row["player_id"]
        if pid in by_player:
            raise ValueError(f"duplicate career_stature row for {pid}")
        by_player[pid] = row
    return by_player


def _career_stature_rating_version(output_dir: Path) -> str | None:
    path = output_dir / "career_stature.json"
    if not path.exists():
        return None
    table = json.loads(path.read_text(encoding="utf-8"))
    return table.get("version")


def _json_text(obj) -> str:
    # ratings.json is large enough that pretty indentation can cross GitHub's
    # hard blob limit; keep deterministic ordering while using compact JSON.
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def _write_json(path: Path, obj) -> None:
    # Byte-identical on rebuild: sorted keys, trailing newline, no timestamps.
    path.write_text(
        _json_text(obj),
        encoding="utf-8",
    )


def _write_ratings_with_lock(
    output_dir: Path, ratings: list[dict], *, rating_version: str
) -> None:
    output_contracts.validate_historical_rating_rows(ratings)
    text = _json_text(ratings)
    raw = text.encode("utf-8")
    (output_dir / "ratings.json").write_text(text, encoding="utf-8")
    _write_json(
        output_dir / "ratings.lock.json",
        {
            "path": "ratings.json",
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "rating_version": rating_version,
            "ratings": len(ratings),
            "generated_by": "python -m wcdraft_etl.rating",
        },
    )
