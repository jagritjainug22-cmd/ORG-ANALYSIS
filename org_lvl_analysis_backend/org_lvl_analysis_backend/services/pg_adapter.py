"""
PostgreSQL connection pool and sqlite-compatible query adapter for db_service.

Connects only to OrgSight_db (PGDATABASE). All other database names are rejected.
"""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional, Sequence

import logging
import threading

from dotenv import load_dotenv
from psycopg import OperationalError
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

logger = logging.getLogger(__name__)

try:
    from psycopg.errors import UniqueViolation

    IntegrityError = UniqueViolation
except ImportError:  # pragma: no cover
    IntegrityError = Exception  # type: ignore[misc, assignment]

REQUIRED_DATABASE = "OrgSight_db"
MIGRATION_LOCK_ID = 987654321

# Tables whose INSERT statements must not append RETURNING id
_NO_RETURNING_ID_TABLES = frozenset({"schema_version", "project_locks", "dataset_locks"})

_pool: Optional[ConnectionPool] = None
_pool_lock = threading.Lock()
_env_loaded = False


def _load_env() -> None:
    global _env_loaded
    if _env_loaded:
        return
    backend_dir = Path(__file__).resolve().parent.parent
    repo_root = backend_dir.parent.parent
    postgres_env = repo_root / "POSTGRES" / ".env"
    if postgres_env.exists():
        load_dotenv(postgres_env)
    load_dotenv(backend_dir / ".env")
    _env_loaded = True


def _env_dbname() -> str:
    return os.environ.get("PGDATABASE", "").strip().strip('"')


def validate_database_name() -> None:
    dbname = _env_dbname()
    if dbname != REQUIRED_DATABASE:
        raise RuntimeError(
            f"PGDATABASE must be '{REQUIRED_DATABASE}' (got {dbname!r}). "
            "Only OrgSight_db may be used — no other database may be touched."
        )


def _conninfo() -> str:
    _load_env()
    validate_database_name()
    host = os.environ["PGHOST"]
    port = os.environ["PGPORT"]
    user = os.environ["PGUSER"]
    password = os.environ["PGPASSWORD"]
    dbname = _env_dbname()
    sslmode = os.environ.get("PGSSLMODE", os.environ.get("DATABASE_SSLMODE", "require"))
    return (
        f"host={host} port={port} dbname={dbname} user={user} "
        f"password={password} sslmode={sslmode}"
    )


def _get_pool() -> ConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool(
                conninfo=_conninfo(),
                min_size=2,
                max_size=20,
                kwargs={"row_factory": dict_row},
                # Azure PG closes idle connections; recycle aggressively.
                max_idle=120,
                max_lifetime=600,
            )
    return _pool


def _reset_pool() -> ConnectionPool:
    """Destroy the current pool (all connections dead) and create a fresh one."""
    global _pool
    with _pool_lock:
        old = _pool
        _pool = None
    if old is not None:
        try:
            old.close()
        except Exception:
            pass
    logger.warning("pg_adapter: connection pool reset due to PoolTimeout")
    return _get_pool()


def _return_conn(pool: ConnectionPool, raw: Any, *, discard: bool) -> None:
    """Return a connection to the pool. If discard=True, close it first so the
    pool sees a broken connection and replaces it automatically."""
    if discard:
        try:
            raw.close()
        except Exception:
            pass
    try:
        pool.putconn(raw)
    except Exception:
        try:
            raw.close()
        except Exception:
            pass


def close_pool() -> None:
    """Release pool resources (tests / graceful shutdown)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def _qmark_to_percent(sql: str) -> str:
    return sql.replace("?", "%s")


def _insert_table_name(sql: str) -> Optional[str]:
    match = re.search(r"INSERT\s+INTO\s+(\w+)", sql, re.IGNORECASE)
    return match.group(1).lower() if match else None


def _should_returning_id(sql: str) -> bool:
    stripped = sql.lstrip()
    if not stripped.upper().startswith("INSERT"):
        return False
    if "RETURNING" in stripped.upper():
        return False
    table = _insert_table_name(sql)
    return table not in _NO_RETURNING_ID_TABLES if table else False


class PgCursor:
    """Cursor wrapper mimicking sqlite3 cursor patterns used in db_service."""

    def __init__(self, raw_conn: Any) -> None:
        self._raw = raw_conn
        self._cur = raw_conn.cursor()
        self.lastrowid: Optional[int] = None
        self.rowcount: int = -1

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> PgCursor:
        sql_pg = _qmark_to_percent(sql)
        params = params or ()
        try:
            if _should_returning_id(sql):
                sql_pg = sql_pg.rstrip().rstrip(";") + " RETURNING id"
                self._cur.execute(sql_pg, params)
                row = self._cur.fetchone()
                self.lastrowid = row["id"] if row else None
            else:
                self._cur.execute(sql_pg, params)
                self.lastrowid = None
            self.rowcount = self._cur.rowcount
        except UniqueViolation:
            raise IntegrityError from None
        return self

    def executemany(self, sql: str, params_list: Sequence[Sequence[Any]]) -> PgCursor:
        sql_pg = _qmark_to_percent(sql)
        try:
            self._cur.executemany(sql_pg, params_list)
        except UniqueViolation:
            raise IntegrityError from None
        self.rowcount = self._cur.rowcount
        self.lastrowid = None
        return self

    def fetchone(self) -> Any:
        return self._cur.fetchone()

    def fetchall(self) -> list[Any]:
        return self._cur.fetchall()


class PgConnection:
    """Connection wrapper mimicking sqlite3 connection patterns used in db_service."""

    def __init__(self, raw_conn: Any) -> None:
        self._raw = raw_conn

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> PgCursor:
        return PgCursor(self._raw).execute(sql, params)

    def cursor(self) -> PgCursor:
        return PgCursor(self._raw)

    def commit(self) -> None:
        self._raw.commit()


@contextmanager
def _connect(autocommit: bool = False) -> Iterator[PgConnection]:
    """Yield a PgConnection with guaranteed transaction cleanup.

    autocommit=True sets the connection to autocommit mode (each statement
    commits immediately). Use for read-only operations to avoid opening a
    transaction at all.

    If all pool connections are dead (PoolTimeout), the pool is recreated once
    and the request is retried — transparent reconnect after Azure drops idle
    TCP connections.
    """
    pool = _get_pool()
    try:
        raw = pool.getconn(timeout=10)
    except PoolTimeout:
        pool = _reset_pool()
        raw = pool.getconn(timeout=15)

    prev_autocommit = raw.autocommit
    discard = False
    try:
        if autocommit:
            raw.autocommit = True
        yield PgConnection(raw)
        if not autocommit:
            raw.commit()
    except OperationalError:
        discard = True
        if not autocommit:
            try:
                raw.rollback()
            except OperationalError:
                pass
        raise
    except BaseException:
        if not autocommit:
            try:
                raw.rollback()
            except OperationalError:
                discard = True
        raise
    finally:
        if discard or getattr(raw, "closed", False):
            _return_conn(pool, raw, discard=True)
        else:
            try:
                raw.autocommit = prev_autocommit
                _return_conn(pool, raw, discard=False)
            except OperationalError:
                _return_conn(pool, raw, discard=True)


@contextmanager
def _connect_ro() -> Iterator[PgConnection]:
    """Read-only connection shortcut — autocommit, no transaction overhead."""
    with _connect(autocommit=True) as conn:
        yield conn


def run_with_migration_lock(conn: PgConnection, fn: Any) -> Any:
    conn.execute("SELECT pg_advisory_lock(?)", (MIGRATION_LOCK_ID,))
    try:
        return fn(conn)
    finally:
        conn.execute("SELECT pg_advisory_unlock(?)", (MIGRATION_LOCK_ID,))
