#!/usr/bin/env python3
"""
Automated rehearsal checks for Postgres cutover (run after migrate --fresh).

  python scripts/rehearsal_verify.py
  python scripts/rehearsal_verify.py --scenario-id 3 --manager-emp-id E001

Manual checks still required (see scripts/REHEARSAL_CHECKLIST.md):
  - Browser refresh-token cookie flow
  - Two uvicorn instances / advisory lock
  - ~20 concurrent API requests under load
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "org_lvl_analysis_backend" / "org_lvl_analysis_backend"

load_dotenv(REPO_ROOT / "POSTGRES" / ".env")
load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

from services import db_service  # noqa: E402
from services.pg_adapter import REQUIRED_DATABASE, _connect  # noqa: E402


def _count_subtree(scenario_id: int, root_emp_id: str) -> int:
    """Expected flagged rows = recursive descendant count including root."""
    with _connect() as conn:
        rows = conn.execute(
            """
            WITH RECURSIVE subtree AS (
                SELECT emp_id FROM scenario_records
                WHERE scenario_id = ? AND emp_id = ?
              UNION ALL
                SELECT sr.emp_id FROM scenario_records sr
                JOIN subtree st ON sr.mgr_id = st.emp_id
                WHERE sr.scenario_id = ?
            )
            SELECT COUNT(*) AS n FROM subtree
            """,
            (scenario_id, root_emp_id, scenario_id),
        ).fetchone()
        return rows["n"]


def test_mark_dataset_seen() -> None:
    with _connect() as conn:
        ds = conn.execute("SELECT id FROM datasets ORDER BY id LIMIT 1").fetchone()
        usr = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
        if not ds or not usr:
            print("  SKIP mark_dataset_seen (need at least one dataset and user)")
            return
        dataset_id, user_id = ds["id"], usr["id"]

    ts1 = db_service.mark_dataset_seen(dataset_id, user_id)
    ts2 = db_service.mark_dataset_seen(dataset_id, user_id)

    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, last_seen FROM dataset_user_views
            WHERE dataset_id = ? AND user_id = ?
            """,
            (dataset_id, user_id),
        ).fetchall()
        uniq = conn.execute(
            """
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'dataset_user_views' AND c.contype = 'u'
            """
        ).fetchall()

    if len(rows) != 1:
        raise SystemExit(
            f"FAIL mark_dataset_seen: expected 1 row, got {len(rows)} "
            "(UNIQUE constraint / ON CONFLICT upsert broken)"
        )
    if ts2 <= ts1:
        raise SystemExit("FAIL mark_dataset_seen: last_seen did not advance on second call")
    if not uniq:
        raise SystemExit("FAIL mark_dataset_seen: no UNIQUE constraint on dataset_user_views")
    print(f"  OK  mark_dataset_seen: 1 row, last_seen updated ({ts1} -> {ts2})")


def test_flag_employee_cascade(scenario_id: int, manager_emp_id: str) -> None:
    expected = _count_subtree(scenario_id, manager_emp_id)
    if expected < 2:
        print(
            f"  SKIP flag cascade (manager {manager_emp_id} has <2 subtree nodes; "
            "pick a manager with 3+ levels for full test)"
        )
        return

    db_service.flag_employee(scenario_id, manager_emp_id, flagged=True, username="rehearsal")

    with _connect() as conn:
        flagged = conn.execute(
            """
            SELECT COUNT(*) AS n FROM scenario_records
            WHERE scenario_id = ? AND is_flagged_removed = 1
            """,
            (scenario_id,),
        ).fetchone()["n"]

    if flagged != expected:
        raise SystemExit(
            f"FAIL flag_employee cascade: expected {expected} flagged rows, got {flagged} "
            "(WITH RECURSIVE / type coercion issue?)"
        )
    print(f"  OK  flag_employee cascade: {flagged}/{expected} rows flagged for {manager_emp_id}")

    db_service.flag_employee(scenario_id, manager_emp_id, flagged=False, username="rehearsal")


def test_cli_connection_leak(runs: int = 10) -> None:
    db_check = REPO_ROOT / "db_check.py"
    for _ in range(runs):
        subprocess.run([sys.executable, str(db_check)], check=True, capture_output=True)

    with _connect() as conn:
        leaked = conn.execute(
            """
            SELECT COUNT(*) AS n FROM pg_stat_activity
            WHERE datname = ?
              AND pid <> pg_backend_pid()
              AND application_name NOT LIKE '%pool%'
            """,
            (REQUIRED_DATABASE,),
        ).fetchone()["n"]

    # Pool keeps min connections; we only fail on excessive idle CLI sessions
    if leaked > 12:
        raise SystemExit(
            f"FAIL CLI leak check: {leaked} other sessions on {REQUIRED_DATABASE} "
            f"after {runs} db_check runs (expected pool baseline only)"
        )
    print(f"  OK  CLI leak check: {leaked} non-pool sessions after {runs}x db_check.py")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario-id", type=int, default=None)
    parser.add_argument("--manager-emp-id", type=str, default=None)
    parser.add_argument("--skip-leak", action="store_true")
    args = parser.parse_args()

    print(f"Rehearsal verify — database: {REQUIRED_DATABASE}\n")

    print("--- mark_dataset_seen upsert ---")
    test_mark_dataset_seen()

    print("\n--- flag_employee recursive cascade ---")
    if args.scenario_id and args.manager_emp_id:
        test_flag_employee_cascade(args.scenario_id, args.manager_emp_id)
    else:
        print("  SKIP (pass --scenario-id and --manager-emp-id for cascade test)")

    if not args.skip_leak:
        print("\n--- CLI connection leak ---")
        test_cli_connection_leak()

    print("\nAutomated checks passed. Complete manual items in REHEARSAL_CHECKLIST.md before cutover.")


if __name__ == "__main__":
    main()
