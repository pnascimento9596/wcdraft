"""Entry point: ``python -m wcdraft_etl`` runs the full pipeline."""

from .pipeline import OUTPUT_DIR, run

if __name__ == "__main__":
    tables = run()
    total = sum(len(r) for r in tables.values())
    print(f"wcdraft ETL: wrote {len(tables)} tables, {total:,} rows -> {OUTPUT_DIR}/")
    for name in sorted(tables):
        print(f"  {name:24s} {len(tables[name]):>7,}")
