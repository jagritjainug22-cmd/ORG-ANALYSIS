"""
In-memory DuckDB manager for OrgSight.

Maintains a single active DuckDB instance loaded from the current dataset's
scenario records. Used as a fast analytical query layer — PostgreSQL remains
the source of truth for all writes.
"""

import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import duckdb
import pandas as pd

logger = logging.getLogger(__name__)

_DROP_COLS = {"is_flagged_removed", "is_added", "data_json"}

_lock = threading.Lock()
_active: Optional[Dict[str, Any]] = None


def _make_key(project_id: int, dataset_id: int, scenario_id: int) -> str:
    return f"{project_id}:{dataset_id}:{scenario_id}"


def load(
    project_id: int,
    dataset_id: int,
    scenario_id: int,
    records: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Load records into a fresh in-memory DuckDB instance.

    Replaces any previously active instance (only one is kept at a time).
    Records should be the flat merged dicts returned by
    ``db_service.get_scenario_records()`` or equivalent — each dict is one
    employee row with all columns from the original upload plus computed
    hierarchy columns.

    Returns metadata about the loaded instance.
    """
    global _active

    active_records = [
        r for r in records if not r.get("is_flagged_removed", False)
    ]

    df = pd.DataFrame(active_records)

    cols_to_drop = [c for c in _DROP_COLS if c in df.columns]
    if cols_to_drop:
        df.drop(columns=cols_to_drop, inplace=True)

    key = _make_key(project_id, dataset_id, scenario_id)

    with _lock:
        _close_active_unlocked()

        conn = duckdb.connect(":memory:")
        conn.execute("CREATE TABLE employees AS SELECT * FROM df")

        row_count = conn.execute("SELECT COUNT(*) FROM employees").fetchone()[0]
        col_info = conn.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_name = 'employees' ORDER BY ordinal_position"
        ).fetchall()

        _active = {
            "key": key,
            "project_id": project_id,
            "dataset_id": dataset_id,
            "scenario_id": scenario_id,
            "conn": conn,
            "row_count": row_count,
            "columns": [(name, dtype) for name, dtype in col_info],
            "loaded_at": time.time(),
            "last_used": time.time(),
        }

    logger.info(
        "DuckDB loaded: key=%s rows=%d cols=%d",
        key, row_count, len(col_info),
    )

    return {
        "key": key,
        "row_count": row_count,
        "column_count": len(col_info),
        "columns": [{"name": name, "type": dtype} for name, dtype in col_info],
    }


def get_status() -> Optional[Dict[str, Any]]:
    """Return metadata about the currently active DuckDB instance, or None."""
    with _lock:
        if _active is None:
            return None
        return {
            "key": _active["key"],
            "project_id": _active["project_id"],
            "dataset_id": _active["dataset_id"],
            "scenario_id": _active["scenario_id"],
            "row_count": _active["row_count"],
            "columns": [{"name": n, "type": t} for n, t in _active["columns"]],
            "loaded_at": _active["loaded_at"],
            "last_used": _active["last_used"],
        }


def get_schema() -> Optional[Dict[str, Any]]:
    """Return column schema with sample values from the active instance."""
    with _lock:
        if _active is None:
            return None
        conn = _active["conn"]
        _active["last_used"] = time.time()

    schema = []
    for col_name, col_type in _active["columns"]:
        try:
            samples = conn.execute(
                f'SELECT DISTINCT "{col_name}" FROM employees '
                f"WHERE \"{col_name}\" IS NOT NULL LIMIT 5"
            ).fetchall()
            sample_values = [str(row[0]) for row in samples]
        except Exception:
            sample_values = []

        try:
            unique_count = conn.execute(
                f'SELECT COUNT(DISTINCT "{col_name}") FROM employees'
            ).fetchone()[0]
        except Exception:
            unique_count = 0

        schema.append({
            "name": col_name,
            "type": col_type,
            "unique_count": unique_count,
            "sample_values": sample_values,
        })

    return {
        "key": _active["key"],
        "dataset_id": _active["dataset_id"],
        "scenario_id": _active["scenario_id"],
        "row_count": _active["row_count"],
        "columns": schema,
    }


def query(sql: str, max_rows: int = 10_000) -> Dict[str, Any]:
    """Execute a read-only SQL query against the active DuckDB instance.

    Returns the result as a list of dicts plus column names.
    Raises RuntimeError if no instance is loaded.
    """
    with _lock:
        if _active is None:
            raise RuntimeError("No DuckDB instance is loaded")
        conn = _active["conn"]
        _active["last_used"] = time.time()

    result = conn.execute(sql)
    columns = [desc[0] for desc in result.description]
    rows = result.fetchmany(max_rows)
    data = [dict(zip(columns, row)) for row in rows]
    total = conn.execute(f"SELECT COUNT(*) FROM ({sql}) _q").fetchone()[0]

    return {
        "columns": columns,
        "data": data,
        "row_count": len(data),
        "total_rows": total,
        "truncated": total > max_rows,
    }


def sample_rows(n: int = 5) -> Optional[List[Dict[str, Any]]]:
    """Return n sample rows from the active instance for verification."""
    with _lock:
        if _active is None:
            return None
        conn = _active["conn"]
        _active["last_used"] = time.time()

    result = conn.execute(f"SELECT * FROM employees LIMIT {int(n)}")
    columns = [desc[0] for desc in result.description]
    rows = result.fetchall()
    return [dict(zip(columns, row)) for row in rows]


def is_loaded_for(project_id: int, dataset_id: int, scenario_id: int) -> bool:
    """Check if DuckDB is loaded for the given key."""
    with _lock:
        if _active is None:
            return False
        return _active["key"] == _make_key(project_id, dataset_id, scenario_id)


def close():
    """Tear down the active DuckDB instance."""
    global _active
    with _lock:
        _close_active_unlocked()


def _close_active_unlocked():
    """Close the active connection (caller must hold _lock)."""
    global _active
    if _active is not None:
        try:
            _active["conn"].close()
            logger.info("DuckDB closed: key=%s", _active["key"])
        except Exception as e:
            logger.warning("Error closing DuckDB: %s", e)
        _active = None
