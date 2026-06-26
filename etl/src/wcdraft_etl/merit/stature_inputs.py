"""Career-stature input loading helpers."""

from __future__ import annotations

import json
from pathlib import Path


def load_build_inputs(output_dir: Path, canon_dir: Path) -> dict[str, list[dict] | dict]:
    return {
        "source_facts": json.loads((output_dir / "source_facts.json").read_text(encoding="utf-8")),
        "active_facts": json.loads(
            (output_dir / "source_facts_active.json").read_text(encoding="utf-8")
        ),
        "active_staging": json.loads(
            (output_dir / "career_stature_active_staging.json").read_text(encoding="utf-8")
        ),
        "players": json.loads((canon_dir / "players.json").read_text("utf-8")),
        "cards": json.loads((canon_dir / "player_tournaments.json").read_text("utf-8")),
        "tournaments": json.loads((canon_dir / "tournaments.json").read_text("utf-8")),
        "nations": json.loads((canon_dir / "nations.json").read_text("utf-8")),
        "players_2026": json.loads((canon_dir / "players_2026.json").read_text("utf-8")),
        "cards_2026": json.loads((canon_dir / "player_tournaments_2026.json").read_text("utf-8")),
        "tournaments_2026": json.loads((canon_dir / "tournaments_2026.json").read_text("utf-8")),
        "nations_2026": json.loads((canon_dir / "nations_2026.json").read_text("utf-8")),
    }
