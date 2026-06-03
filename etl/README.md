# wcdraft-etl

Python ETL skeleton for wcdraft.

**Status (WS-0):** empty skeleton — `pyproject.toml`, package stub, and this
README only. There is **no pipeline logic yet**: no extraction, transformation,
loading, scheduling, or data. That work is deferred to a later workstream.

This project is intentionally **not** a pnpm workspace member; it is a standalone
Python project managed independently of the JS/TS monorepo.

## Layout

```
etl/
├── pyproject.toml          # PEP 621 metadata (hatchling build backend)
├── README.md
└── src/wcdraft_etl/
    └── __init__.py         # version stub
```

## Local setup (later)

```bash
cd etl
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Data sourcing & licensing

When the pipeline is built, it will ingest **CC-BY-SA** sources (the Fjelstul
World Cup Database and Wikipedia/Wikidata). All outputs written into
`packages/data` must carry the required attribution and ShareAlike metadata —
see `packages/data/README.md`.
