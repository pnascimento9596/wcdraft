"""wcdraft ETL package.

WS-A Phase-1a: ingest the Fjelstul World Cup Database (CC-BY-SA 4.0) into
canonical normalized tables (nations, players, player_tournaments cards,
managers, manager_tournaments, tournaments + goals/appearances/awards fact
tables), with identity-QA regression guards and an honest-state coverage report.

Run: ``python -m wcdraft_etl`` (writes JSON artifacts to ``etl/output/``).

This is the canonical *intermediate* layer. The contract-shaped emit into
``packages/data`` is a later, thin mapping step (out of scope here).
"""

__version__ = "0.1.0"
