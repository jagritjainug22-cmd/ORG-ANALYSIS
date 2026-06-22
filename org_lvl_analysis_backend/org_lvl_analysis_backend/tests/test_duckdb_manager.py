"""Unit tests for per-user DuckDB session manager."""

import os

import pytest

from services import duckdb_manager

_SAMPLE = [
    {
        "Employee ID": "E1",
        "Manager ID": None,
        "Level": 1,
        "Department": "Finance",
        "is_flagged_removed": False,
    },
    {
        "Employee ID": "E2",
        "Manager ID": "E1",
        "Level": 2,
        "Department": "Finance",
        "is_flagged_removed": False,
    },
]


@pytest.fixture(autouse=True)
def _clean_sessions():
    duckdb_manager.close()
    yield
    duckdb_manager.close()


def test_per_user_isolation():
    duckdb_manager.load(1, 1, 10, 100, _SAMPLE, "2026-01-01T00:00:00")
    duckdb_manager.load(2, 1, 10, 101, _SAMPLE, "2026-01-01T00:00:00")

    assert duckdb_manager.active_user_count() == 2
    assert duckdb_manager.is_loaded_for(1, 1, 10, 100)
    assert duckdb_manager.is_loaded_for(2, 1, 10, 101)

    duckdb_manager.close(1)
    assert duckdb_manager.get_status(1) is None
    assert duckdb_manager.get_status(2) is not None


def test_query_scoped_to_user():
    duckdb_manager.load(1, 1, 10, 100, _SAMPLE, "2026-01-01T00:00:00")

    result = duckdb_manager.query(1, "SELECT COUNT(*) AS n FROM employees")
    assert result["data"][0]["n"] == 2

    with pytest.raises(RuntimeError):
        duckdb_manager.query(99, "SELECT COUNT(*) AS n FROM employees")


def test_lru_eviction(monkeypatch):
    monkeypatch.setattr(duckdb_manager, "_MAX_USER_SESSIONS", 2)

    duckdb_manager.load(1, 1, 10, 100, _SAMPLE, "t1")
    duckdb_manager.load(2, 1, 10, 101, _SAMPLE, "t2")
    duckdb_manager.load(3, 1, 10, 102, _SAMPLE, "t3")

    assert duckdb_manager.active_user_count() == 2
    assert duckdb_manager.get_status(1) is None
    assert duckdb_manager.get_status(2) is not None
    assert duckdb_manager.get_status(3) is not None


def test_skip_reload_when_updated_at_unchanged():
    meta1 = duckdb_manager.load(1, 1, 10, 100, _SAMPLE, "2026-01-01T00:00:00")
    meta2 = duckdb_manager.load(1, 1, 10, 100, _SAMPLE, "2026-01-01T00:00:00")
    assert meta1["row_count"] == meta2["row_count"]
    assert meta1["loaded_at"] == meta2["loaded_at"]
