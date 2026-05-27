"""
Unit tests for flag_employee cascade behavior (recursive CTE).

Uses an in-memory SQLite database with the 16-node fixture.
Run: python -m pytest tests/test_flag_cascade.py -v
  or: python tests/test_flag_cascade.py
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services.db_service as db

# ---------------------------------------------------------------------------
# Fixture: 16-node org tree
# ---------------------------------------------------------------------------
FIXTURE = [
    ("CEO", None, 1, 500000, "Exec"),
    ("VP-Eng", "CEO", 2, 300000, "Engineering"),
    ("Dir-FE", "VP-Eng", 3, 200000, "Engineering"),
    ("Dev1", "Dir-FE", 4, 100000, "Engineering"),
    ("Dev2", "Dir-FE", 4, 100000, "Engineering"),
    ("Dev3", "Dir-FE", 4, 100000, "Engineering"),
    ("Dev8", "Dir-FE", 4, 100000, "Engineering"),
    ("Dir-BE", "VP-Eng", 3, 200000, "Engineering"),
    ("Dev4", "Dir-BE", 4, 100000, "Engineering"),
    ("Dev5", "Dir-BE", 4, 100000, "Engineering"),
    ("Dev6", "Dir-BE", 4, 100000, "Engineering"),
    ("Dev7", "Dir-BE", 4, 100000, "Engineering"),
    ("VP-Sales", "CEO", 2, 300000, "Sales"),
    ("Mgr-East", "VP-Sales", 3, 150000, "Sales"),
    ("Rep1", "Mgr-East", 4, 80000, "Sales"),
    ("Mgr-West", "VP-Sales", 3, 150000, "Sales"),
    ("CFO", "CEO", 2, 350000, "Finance"),
]

SCENARIO_ID = 1
DATASET_ID = 1


def _setup_db():
    """Patch db_service to use an in-memory SQLite and seed the fixture."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    conn.execute("""
        CREATE TABLE datasets (
            id INTEGER PRIMARY KEY, name TEXT, username TEXT,
            upload_time TEXT, emp_col TEXT, mgr_col TEXT,
            fte_col TEXT, flc_col TEXT, job_title_col TEXT,
            country_col TEXT, row_count INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE scenarios (
            id INTEGER PRIMARY KEY, dataset_id INTEGER, name TEXT,
            description TEXT, created_at TEXT, updated_at TEXT,
            is_promoted INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE scenario_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id INTEGER, emp_id TEXT, mgr_id TEXT,
            level INTEGER, fte REAL, flc REAL,
            is_flagged_removed INTEGER DEFAULT 0,
            is_added INTEGER DEFAULT 0, data_json TEXT,
            UNIQUE (scenario_id, emp_id)
        )
    """)
    conn.execute("""
        CREATE TABLE change_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id INTEGER, action TEXT, emp_id TEXT,
            old_mgr_id TEXT, new_mgr_id TEXT, field TEXT,
            old_value TEXT, new_value TEXT, timestamp TEXT, username TEXT
        )
    """)

    conn.execute(
        "INSERT INTO datasets VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (DATASET_ID, "test", "tester", "2026-01-01", "emp_id", "mgr_id",
         "FTE", "FLC", "Job_Title", "Country", len(FIXTURE)),
    )
    conn.execute(
        "INSERT INTO scenarios VALUES (?,?,?,?,?,?,?)",
        (SCENARIO_ID, DATASET_ID, "Baseline", "", "2026-01-01", "2026-01-01", 0),
    )

    for emp_id, mgr_id, level, flc, dept in FIXTURE:
        data = {
            "__emp_id": emp_id,
            "__mgr_id": mgr_id,
            "Level": level,
            "FLC": flc,
            "Department": dept,
            "FTE": 1,
        }
        conn.execute(
            "INSERT INTO scenario_records (scenario_id, emp_id, mgr_id, level, fte, flc, data_json) VALUES (?,?,?,?,?,?,?)",
            (SCENARIO_ID, emp_id, mgr_id, level, 1, flc, json.dumps(data)),
        )
    conn.commit()

    original_connect = db._connect

    def _mock_connect():
        return conn

    db._connect = _mock_connect
    return conn, original_connect


def _get_flagged_ids(conn):
    rows = conn.execute(
        "SELECT emp_id FROM scenario_records WHERE scenario_id = ? AND is_flagged_removed = 1",
        (SCENARIO_ID,),
    ).fetchall()
    return {r["emp_id"] for r in rows}


def _get_change_log_count(conn):
    row = conn.execute(
        "SELECT COUNT(*) as cnt FROM change_log WHERE scenario_id = ?",
        (SCENARIO_ID,),
    ).fetchone()
    return row["cnt"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_flag_dir_fe_cascades_to_descendants():
    conn, restore = _setup_db()
    try:
        db.flag_employee(SCENARIO_ID, "Dir-FE", True, "test")
        flagged = _get_flagged_ids(conn)
        expected = {"Dir-FE", "Dev1", "Dev2", "Dev3", "Dev8"}
        assert flagged == expected, f"Expected {expected}, got {flagged}"
        assert _get_change_log_count(conn) == 1, "Single change_log entry"

        log = conn.execute(
            "SELECT action, emp_id FROM change_log WHERE scenario_id = ? ORDER BY id DESC LIMIT 1",
            (SCENARIO_ID,),
        ).fetchone()
        assert log["action"] == "flag_remove"
        assert log["emp_id"] == "Dir-FE"
        print("  PASS: flag Dir-FE cascades to 5 descendants")
    finally:
        db._connect = restore


def test_unflag_dir_fe_restores_all():
    conn, restore = _setup_db()
    try:
        db.flag_employee(SCENARIO_ID, "Dir-FE", True, "test")
        db.flag_employee(SCENARIO_ID, "Dir-FE", False, "test")
        flagged = _get_flagged_ids(conn)
        assert len(flagged) == 0, f"Expected 0 flagged, got {flagged}"
        assert _get_change_log_count(conn) == 2, "Two change_log entries"
        print("  PASS: unflag Dir-FE restores all descendants")
    finally:
        db._connect = restore


def test_flag_ceo_cascades_to_all():
    conn, restore = _setup_db()
    try:
        db.flag_employee(SCENARIO_ID, "CEO", True, "test")
        flagged = _get_flagged_ids(conn)
        assert len(flagged) == len(FIXTURE), f"Expected {len(FIXTURE)} flagged, got {len(flagged)}"
        assert _get_change_log_count(conn) == 1, "Single change_log entry for CEO flag"
        print("  PASS: flag CEO cascades to all 17 nodes")
    finally:
        db._connect = restore


def test_flag_leaf_only_affects_leaf():
    conn, restore = _setup_db()
    try:
        db.flag_employee(SCENARIO_ID, "Dev1", True, "test")
        flagged = _get_flagged_ids(conn)
        assert flagged == {"Dev1"}, f"Expected only Dev1, got {flagged}"
        print("  PASS: flag leaf Dev1 only affects Dev1")
    finally:
        db._connect = restore


def test_cascade_unflag_overrides_individual_flag():
    """v1 behavior: unflag parent un-flags everything, even individually flagged children."""
    conn, restore = _setup_db()
    try:
        db.flag_employee(SCENARIO_ID, "Dev1", True, "test")
        db.flag_employee(SCENARIO_ID, "Dir-FE", True, "test")
        db.flag_employee(SCENARIO_ID, "Dir-FE", False, "test")
        flagged = _get_flagged_ids(conn)
        assert len(flagged) == 0, f"v1: Dev1 should be unflagged, got {flagged}"
        print("  PASS: v1 cascade unflag overrides individual flag on Dev1")
    finally:
        db._connect = restore


def test_recursive_cte_returns_correct_set():
    """Directly verify the recursive CTE returns the right descendant set."""
    conn, restore = _setup_db()
    try:
        rows = conn.execute("""
            WITH RECURSIVE subtree AS (
                SELECT emp_id FROM scenario_records
                WHERE scenario_id = ? AND emp_id = ?
              UNION ALL
                SELECT sr.emp_id FROM scenario_records sr
                JOIN subtree st ON sr.mgr_id = st.emp_id
                WHERE sr.scenario_id = ?
            )
            SELECT emp_id FROM subtree
        """, (SCENARIO_ID, "VP-Eng", SCENARIO_ID)).fetchall()
        ids = {r["emp_id"] for r in rows}
        expected = {"VP-Eng", "Dir-FE", "Dir-BE", "Dev1", "Dev2", "Dev3", "Dev4", "Dev5", "Dev6", "Dev7", "Dev8"}
        assert ids == expected, f"CTE expected {expected}, got {ids}"
        assert len(ids) == 11, f"CTE should return 11 nodes, got {len(ids)}"
        print("  PASS: recursive CTE returns correct 11-node subtree for VP-Eng")
    finally:
        db._connect = restore


if __name__ == "__main__":
    print("\n--- Backend flag_employee cascade tests ---")
    test_flag_dir_fe_cascades_to_descendants()
    test_unflag_dir_fe_restores_all()
    test_flag_ceo_cascades_to_all()
    test_flag_leaf_only_affects_leaf()
    test_cascade_unflag_overrides_individual_flag()
    test_recursive_cte_returns_correct_set()
    print("\n=== All backend tests passed ===")
