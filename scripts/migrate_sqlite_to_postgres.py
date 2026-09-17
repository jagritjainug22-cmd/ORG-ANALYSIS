#!/usr/bin/env python3
"""
Partial migration: copy irreplaceable SQLite rows into OrgSight_db.

Skips datasets, baseline, scenarios, etc. — recreate those via the UI
(upload pipeline → save baseline per project).

Prerequisite: Postgres schema must already exist (run backend once, or init_db).
This script does NOT call init_db().

Usage (from repo root):
  python scripts/migrate_sqlite_to_postgres.py --dry-run
  python scripts/migrate_sqlite_to_postgres.py --empty-skipped-tables
  python scripts/migrate_sqlite_to_postgres.py --fresh --empty-skipped-tables

refresh_tokens are NOT migrated (log in fresh after migration).
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Any, List, Sequence, Tuple

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "org_lvl_analysis_backend"
SQLITE_PATH = BACKEND_DIR / "db" / "orgsight.db"

load_dotenv(REPO_ROOT / "POSTGRES" / ".env")
load_dotenv(BACKEND_DIR / ".env")

sys.path.insert(0, str(BACKEND_DIR))

from services.pg_adapter import REQUIRED_DATABASE, _connect, validate_database_name  # noqa: E402

# Irreplaceable config/auth — copy from SQLite (preserve integer IDs).
TABLES_TO_MIGRATE: List[Tuple[str, List[str]]] = [
    ("users", []),
    ("projects", ["users"]),
    ("project_assignments", ["projects", "users"]),
    ("audit_log", []),  # keep dev audit history (resource_id may reference old dataset ids)
    ("schema_version", []),
]

# Recreate via UI / transient — never copied; must be empty before truncating projects.
SKIPPED_TABLES: List[str] = [
    "datasets",
    "baseline_records",
    "scenarios",
    "scenario_records",
    "change_log",
    "dataset_user_views",
    "project_locks",
    "dataset_locks",
]

# Not migrated (sessions); may remain on PG until users truncate cascades — harmless.
NOT_MIGRATED_NOTE = ["refresh_tokens"]

# Reverse FK order for TRUNCATE of migrated tables only (children before parents).
MIGRATE_TRUNCATE_ORDER = [t for t, _ in reversed(TABLES_TO_MIGRATE)]

# Child-first order for emptying skipped data tables.
SKIPPED_TRUNCATE_ORDER = [
    "change_log",
    "scenario_records",
    "scenarios",
    "baseline_records",
    "dataset_user_views",
    "dataset_locks",
    "project_locks",
    "datasets",
]

SERIAL_TABLES_MIGRATED = [
    "users",
    "projects",
    "project_assignments",
    "audit_log",
]

REQUIRED_SCHEMA_VERSION = 5

SKIPPED_RECREATE_MSG = (
    "Recreate via UI: open each project → run upload pipeline → save baseline "
    "(populates datasets, baseline_records, scenarios, scenario_records)."
)


def _sqlite_connect() -> sqlite3.Connection:
    if not SQLITE_PATH.exists():
        raise SystemExit(f"SQLite source not found: {SQLITE_PATH}")
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _sqlite_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def _sqlite_rows(conn: sqlite3.Connection, table: str) -> List[sqlite3.Row]:
    return conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()


def _require_schema_v5(pg: Any) -> None:
    """Refuse to migrate unless base schema exists and migrations reached v5."""
    users = pg.execute(
        """
        SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
        """
    ).fetchone()
    if not users or users["n"] == 0:
        raise SystemExit(
            "Postgres schema not found (users table missing).\n"
            "Create schema first: start the backend once, or run:\n"
            "  cd org_lvl_analysis_backend\n"
            "  python -c \"from services import db_service; db_service.init_db()\""
        )

    ver_table = pg.execute(
        """
        SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'schema_version'
        """
    ).fetchone()
    if not ver_table or ver_table["n"] == 0:
        raise SystemExit(
            f"Postgres schema is at version unknown, expected {REQUIRED_SCHEMA_VERSION}.\n"
            "Start the backend once to run migrations, then re-run this script."
        )

    version_row = pg.execute("SELECT version FROM schema_version").fetchone()
    if not version_row:
        raise SystemExit(
            f"Postgres schema is at version unknown, expected {REQUIRED_SCHEMA_VERSION}.\n"
            "Start the backend once to run migrations, then re-run this script."
        )

    current = version_row["version"]
    if current != REQUIRED_SCHEMA_VERSION:
        raise SystemExit(
            f"Postgres schema is at version {current}, expected {REQUIRED_SCHEMA_VERSION}.\n"
            "Start the backend once to run migrations, then re-run this script."
        )

    print(f"     schema_version: {current} (required: {REQUIRED_SCHEMA_VERSION})")


def _skipped_tables_with_data(pg: Any) -> List[Tuple[str, int]]:
    """Return skipped tables that have at least one row in Postgres."""
    nonempty = []
    for table in SKIPPED_TABLES:
        row = pg.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()
        n = row["n"] if row else 0
        if n > 0:
            nonempty.append((table, n))
    return nonempty


def _empty_skipped_tables(pg: Any) -> None:
    names = ", ".join(SKIPPED_TRUNCATE_ORDER)
    pg.execute(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE")
    print(f"     emptied skipped tables: {', '.join(SKIPPED_TRUNCATE_ORDER)}")


def _require_skipped_empty(pg: Any) -> None:
    nonempty = _skipped_tables_with_data(pg)
    if not nonempty:
        return
    lines = [f"  {table}: {n} rows" for table, n in nonempty]
    raise SystemExit(
        "Skipped tables have data in Postgres (blocks truncating projects).\n"
        + "\n".join(lines)
        + "\n\nRun with --empty-skipped-tables first (or clear manually), then --fresh:\n"
        "  python scripts/migrate_sqlite_to_postgres.py --empty-skipped-tables\n"
        "  python scripts/migrate_sqlite_to_postgres.py --fresh --empty-skipped-tables"
    )


def _reset_sequence(conn: Any, table: str) -> None:
    """Next insert id = MAX(id)+1, or 1 if table is empty."""
    seq = conn.execute(
        f"SELECT pg_get_serial_sequence('{table}', 'id') AS seq"
    ).fetchone()
    if not seq or not seq["seq"]:
        return
    conn.execute(
        f"""
        SELECT setval(
            '{seq["seq"]}',
            COALESCE((SELECT MAX(id) FROM {table}), 0) + 1,
            false
        )
        """
    )


def _truncate_migrated(conn: Any) -> None:
    names = ", ".join(MIGRATE_TRUNCATE_ORDER)
    conn.execute(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE")


def _insert_rows(pg: Any, table: str, columns: List[str], rows: Sequence[sqlite3.Row]) -> int:
    if not rows:
        return 0
    col_list = ", ".join(columns)
    placeholders = ", ".join(["?"] * len(columns))
    sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"
    for row in rows:
        pg.execute(sql, tuple(row[c] for c in columns))
    return len(rows)


def _verify_counts(sqlite: sqlite3.Connection, pg: Any, tables: List[Tuple[str, List[str]]]) -> None:
    mismatches = []
    for table, _ in tables:
        s_count = sqlite.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
        p_count = pg.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
        if s_count != p_count:
            mismatches.append((table, s_count, p_count))
        else:
            print(f"  OK  {table}: {s_count} rows")
    if mismatches:
        print("\nCOUNT MISMATCH:")
        for table, s, p in mismatches:
            print(f"  {table}: sqlite={s} postgres={p}")
        raise SystemExit(1)


def _assert_sequences(pg: Any) -> None:
    """Spot-check: next id = MAX(id)+1 for users and projects."""
    for table in ("users", "projects"):
        max_row = pg.execute(f"SELECT COALESCE(MAX(id), 0) AS m FROM {table}").fetchone()
        max_id = max_row["m"] if max_row else 0
        next_row = pg.execute(
            f"SELECT nextval(pg_get_serial_sequence('{table}', 'id')) AS n"
        ).fetchone()
        expected = max_id + 1
        if next_row["n"] != expected:
            raise SystemExit(
                f"Sequence check failed for {table}: expected next {expected}, got {next_row['n']}"
            )
        pg.execute(
            f"""
            SELECT setval(
                pg_get_serial_sequence('{table}', 'id'),
                {expected},
                false
            )
            """
        )
        print(f"  OK  sequence {table}: next id would be {expected}")


def _print_skip_summary() -> None:
    skipped = ", ".join(SKIPPED_TABLES)
    not_migrated = ", ".join(NOT_MIGRATED_NOTE)
    print(f"\nSkipped (not copied): {skipped}")
    print(f"Not migrated: {not_migrated} — log in fresh after migration.")
    print(f"Skipped tables: {SKIPPED_RECREATE_MSG}")


def migrate(
    *,
    fresh: bool,
    dry_run: bool,
    empty_skipped_tables: bool,
) -> None:
    validate_database_name()
    print(f"Target PostgreSQL database: {REQUIRED_DATABASE}")
    print(f"Source SQLite file: {SQLITE_PATH}\n")

    migrate_names = [t for t, _ in TABLES_TO_MIGRATE]
    print(f"Tables to migrate: {', '.join(migrate_names)}")
    print(f"Tables skipped: {', '.join(SKIPPED_TABLES)}\n")

    sqlite = _sqlite_connect()
    try:
        if dry_run:
            print("DRY RUN — SQLite row counts (migrate set only):")
            for table, _ in TABLES_TO_MIGRATE:
                n = sqlite.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
                print(f"  {table}: {n}")
            print("\nSkipped in SQLite (for reference, not copied):")
            for table in SKIPPED_TABLES:
                try:
                    n = sqlite.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
                    print(f"  {table}: {n}")
                except sqlite3.OperationalError:
                    print(f"  {table}: (missing)")
            _print_skip_summary()
            return

        if empty_skipped_tables and not fresh:
            with _connect() as pg:
                _require_schema_v5(pg)
                print("Emptying skipped tables only...")
                _empty_skipped_tables(pg)
                pg.commit()
            print("\nSkipped tables emptied. Run --fresh --empty-skipped-tables to migrate.")
            return

        if not fresh:
            raise SystemExit(
                "Refusing to copy without --fresh.\n"
                "Use: python scripts/migrate_sqlite_to_postgres.py --fresh --empty-skipped-tables"
            )

        with _connect() as pg:
            print("1/6  Connected to Postgres (no init_db, no seeding)")
            _require_schema_v5(pg)

            if empty_skipped_tables:
                print("2/6  Emptying skipped tables (explicit --empty-skipped-tables)...")
                _empty_skipped_tables(pg)
                pg.commit()
            else:
                print("2/6  Checking skipped tables are empty...")
                _require_skipped_empty(pg)

            print("3/6  Truncating migrated tables (reverse FK order, CASCADE)...")
            pre_users = pg.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
            if pre_users:
                print(f"     (clearing {pre_users} existing user rows incl. any init_db seeds)")
            _truncate_migrated(pg)
            pg.commit()
            post_users = pg.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
            if post_users != 0:
                raise SystemExit(f"Truncate failed: users still has {post_users} rows")

            print("4/6  Copying SQLite data (FK order, preserving IDs)...")
            for table, _ in TABLES_TO_MIGRATE:
                cols = _sqlite_columns(sqlite, table)
                if not cols:
                    print(f"     SKIP {table} (not in SQLite)")
                    continue
                rows = _sqlite_rows(sqlite, table)
                n = _insert_rows(pg, table, cols, rows)
                print(f"     copied {table}: {n} rows")

            print("5/6  Resetting sequences (migrated tables only)...")
            for table in SERIAL_TABLES_MIGRATED:
                _reset_sequence(pg, table)
            _assert_sequences(pg)

            pg.commit()

            print("6/6  Verifying row counts (migrated tables only)...")
            _verify_counts(sqlite, pg, TABLES_TO_MIGRATE)

        print("\nMigration complete.")
        _print_skip_summary()
    finally:
        sqlite.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Partial migrate: SQLite orgsight.db -> OrgSight_db (config/auth only)"
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Required for copy. TRUNCATE migrated tables before copy (clears init_db seeds)",
    )
    parser.add_argument(
        "--empty-skipped-tables",
        action="store_true",
        help="TRUNCATE skipped data tables (datasets, baseline, etc.). Use before --fresh if they have rows.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show SQLite row counts for migrate/skip lists; no writes",
    )
    args = parser.parse_args()
    migrate(
        fresh=args.fresh,
        dry_run=args.dry_run,
        empty_skipped_tables=args.empty_skipped_tables,
    )


if __name__ == "__main__":
    main()
