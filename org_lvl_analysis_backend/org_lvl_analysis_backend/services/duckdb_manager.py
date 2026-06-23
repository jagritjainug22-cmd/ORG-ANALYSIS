"""
In-memory DuckDB manager for OrgSight.

One DuckDB instance per authenticated user. PostgreSQL remains the source of
truth; DuckDB is a read-only analytical cache for the future chatbot layer.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional

import duckdb
import pandas as pd

logger = logging.getLogger(__name__)

_DROP_COLS = {"is_flagged_removed", "is_added", "data_json"}

_lock = threading.Lock()
_sessions: "OrderedDict[int, Dict[str, Any]]" = OrderedDict()
_MAX_USER_SESSIONS = max(1, int(os.environ.get("DUCKDB_MAX_USER_SESSIONS", "32")))


def _make_key(project_id: int, dataset_id: int, scenario_id: int) -> str:
    return f"{project_id}:{dataset_id}:{scenario_id}"


def _close_session_unlocked(user_id: int) -> None:
    session = _sessions.pop(user_id, None)
    if session is None:
        return
    try:
        session["conn"].close()
        logger.info("DuckDB closed: user_id=%s key=%s", user_id, session.get("key"))
    except Exception as e:
        logger.warning("Error closing DuckDB for user_id=%s: %s", user_id, e)


def _evict_lru_unlocked() -> None:
    while len(_sessions) >= _MAX_USER_SESSIONS:
        oldest_user_id, oldest = _sessions.popitem(last=False)
        try:
            oldest["conn"].close()
        except Exception:
            pass
        logger.info("DuckDB LRU evicted user_id=%s", oldest_user_id)


def _session_public(session: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": session["user_id"],
        "key": session["key"],
        "project_id": session["project_id"],
        "dataset_id": session["dataset_id"],
        "scenario_id": session["scenario_id"],
        "row_count": session["row_count"],
        "columns": [{"name": n, "type": t} for n, t in session["columns"]],
        "loaded_at": session["loaded_at"],
        "last_used": session["last_used"],
        "scenario_updated_at": session.get("scenario_updated_at"),
    }


def load(
    user_id: int,
    project_id: int,
    dataset_id: int,
    scenario_id: int,
    records: List[Dict[str, Any]],
    scenario_updated_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Load records into this user's in-memory DuckDB (replaces their prior instance)."""
    active_records = [r for r in records if not r.get("is_flagged_removed", False)]
    df = pd.DataFrame(active_records)
    cols_to_drop = [c for c in _DROP_COLS if c in df.columns]
    if cols_to_drop:
        df.drop(columns=cols_to_drop, inplace=True)

    data_key = _make_key(project_id, dataset_id, scenario_id)

    with _lock:
        existing = _sessions.get(user_id)
        if (
            existing
            and existing.get("key") == data_key
            and existing.get("scenario_updated_at") == scenario_updated_at
            and scenario_updated_at is not None
        ):
            existing["last_used"] = time.time()
            _sessions.move_to_end(user_id)
            return {
                **_session_public(existing),
                "row_count": existing["row_count"],
                "column_count": len(existing["columns"]),
            }

        _close_session_unlocked(user_id)
        if user_id not in _sessions:
            _evict_lru_unlocked()

        conn = duckdb.connect(":memory:")
        conn.execute("CREATE TABLE employees AS SELECT * FROM df")
        row_count = conn.execute("SELECT COUNT(*) FROM employees").fetchone()[0]
        col_info = conn.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_name = 'employees' ORDER BY ordinal_position"
        ).fetchall()

        session = {
            "user_id": user_id,
            "key": data_key,
            "project_id": project_id,
            "dataset_id": dataset_id,
            "scenario_id": scenario_id,
            "conn": conn,
            "row_count": row_count,
            "columns": [(name, dtype) for name, dtype in col_info],
            "loaded_at": time.time(),
            "last_used": time.time(),
            "scenario_updated_at": scenario_updated_at,
        }
        _sessions[user_id] = session
        _sessions.move_to_end(user_id)

    logger.info(
        "DuckDB loaded: user_id=%s key=%s rows=%d cols=%d",
        user_id, data_key, row_count, len(col_info),
    )
    return {
        **_session_public(session),
        "column_count": len(col_info),
    }


def ensure_fresh(
    user_id: int,
    project_id: int,
    dataset_id: int,
    scenario_id: int,
) -> Dict[str, Any]:
    """Reload DuckDB from Postgres when scenarios.updated_at is newer than loaded snapshot."""
    from services import db_service

    scenario = db_service.get_scenario(scenario_id)
    if not scenario:
        raise ValueError(f"Scenario {scenario_id} not found")
    if scenario.get("dataset_id") != dataset_id:
        raise ValueError("Scenario does not belong to dataset")

    current_updated_at = scenario.get("updated_at")
    with _lock:
        session = _sessions.get(user_id)
        fresh = (
            session is not None
            and session.get("key") == _make_key(project_id, dataset_id, scenario_id)
            and session.get("scenario_updated_at") == current_updated_at
            and current_updated_at is not None
        )

    if fresh:
        with _lock:
            session = _sessions.get(user_id)
            if session:
                session["last_used"] = time.time()
                _sessions.move_to_end(user_id)
        return {**_session_public(session), "reloaded": False}

    records = db_service.get_scenario_records(scenario_id)
    if not records:
        raise ValueError(f"No records found for scenario {scenario_id}")

    # Apply user-defined formula columns so they are queryable via chat
    try:
        from services import formula_service
        formulas = db_service.list_formulas(dataset_id)
        if formulas:
            records = formula_service.apply_formulas_to_records(records, formulas)
    except Exception as e:
        logger.warning("Failed to apply formulas to DuckDB records: %s", e)

    meta = load(
        user_id=user_id,
        project_id=project_id,
        dataset_id=dataset_id,
        scenario_id=scenario_id,
        records=records,
        scenario_updated_at=current_updated_at,
    )
    return {**meta, "reloaded": True}


def get_status(user_id: int) -> Optional[Dict[str, Any]]:
    with _lock:
        session = _sessions.get(user_id)
        if session is None:
            return None
        session["last_used"] = time.time()
        _sessions.move_to_end(user_id)
        return _session_public(session)


def get_schema(user_id: int) -> Optional[Dict[str, Any]]:
    with _lock:
        session = _sessions.get(user_id)
        if session is None:
            return None
        session["last_used"] = time.time()
        _sessions.move_to_end(user_id)
        conn = session["conn"]
        columns = session["columns"]
        row_count = session["row_count"]
        meta = {
            "user_id": session["user_id"],
            "key": session["key"],
            "dataset_id": session["dataset_id"],
            "scenario_id": session["scenario_id"],
        }

        schema = []
        for col_name, col_type in columns:
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

    return {**meta, "row_count": row_count, "columns": schema}


def query(user_id: int, sql: str, max_rows: int = 10_000) -> Dict[str, Any]:
    from services.sql_sanitizer import sanitize_sql

    with _lock:
        session = _sessions.get(user_id)
        if session is None:
            raise RuntimeError("No DuckDB instance is loaded for this user")
        session["last_used"] = time.time()
        _sessions.move_to_end(user_id)
        conn = session["conn"]

        # Sanitize SQL before execution — catches semicolons, DDL, invalid refs
        known_cols = None
        if session.get("columns"):
            known_cols = {name for name, _ in session["columns"]}

        cleaned_sql, error = sanitize_sql(sql, known_columns=known_cols)
        if error:
            raise ValueError(f"SQL validation failed: {error}")

        result = conn.execute(cleaned_sql)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchmany(max_rows)
        data = [dict(zip(columns, row)) for row in rows]
        total = conn.execute(f"SELECT COUNT(*) FROM ({cleaned_sql}) _q").fetchone()[0]

    return {
        "columns": columns,
        "data": data,
        "row_count": len(data),
        "total_rows": total,
        "truncated": total > max_rows,
    }


def sample_rows(user_id: int, n: int = 5) -> Optional[List[Dict[str, Any]]]:
    with _lock:
        session = _sessions.get(user_id)
        if session is None:
            return None
        session["last_used"] = time.time()
        _sessions.move_to_end(user_id)
        conn = session["conn"]
        result = conn.execute(f"SELECT * FROM employees LIMIT {int(n)}")
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()

    return [dict(zip(columns, row)) for row in rows]


def is_loaded_for(
    user_id: int,
    project_id: int,
    dataset_id: int,
    scenario_id: int,
) -> bool:
    with _lock:
        session = _sessions.get(user_id)
        if session is None:
            return False
        return session["key"] == _make_key(project_id, dataset_id, scenario_id)


def close(user_id: Optional[int] = None) -> None:
    """Close one user's session, or all sessions when user_id is omitted."""
    with _lock:
        if user_id is not None:
            _close_session_unlocked(user_id)
            return
        for uid in list(_sessions.keys()):
            _close_session_unlocked(uid)


def active_user_count() -> int:
    with _lock:
        return len(_sessions)
