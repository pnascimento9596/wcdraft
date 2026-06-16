# @WCDraft — X Marketing Playbook (operator deliverables)

Presentation-quality, copy-paste-friendly repackaging of the committed marketing content
into one operator guide, in two formats:

- **`wcdraft-x-playbook.docx`** — Word
- **`wcdraft-x-playbook.pdf`** — PDF

Both hold identical content (cover · how-to · X native scheduler steps · the current week's
posts as individual copy-paste blocks · reply bank · quote-post bank · cadence · guardrails).

## Source of truth — never edited here

All post / reply / quote copy is **parsed verbatim** by `build_playbook.py` from the
committed source files and rendered without alteration:

- `../packs/pack-2026-W25.md` (the current week's posts)
- `../reply-bank.md`, `../quote-bank.md`
- `../ROUTINE.md`, `../README.md` (operating posture)

Char counts shown are the source's stated X-convention counts (t.co wraps every URL to 23
chars); the build re-verifies each one and flags any post over 280 inline (none this week).

## Regenerate

```sh
python3 -m venv .venv && .venv/bin/pip install python-docx reportlab
.venv/bin/python build_playbook.py   # writes the .docx and .pdf next to this README
```

When a new weekly pack lands, update `WEEK_LABEL`, `GENERATED`, and `PACK_FILE` at the top
of `build_playbook.py` and re-run.
