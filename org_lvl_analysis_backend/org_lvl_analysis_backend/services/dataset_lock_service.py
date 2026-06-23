"""
Dataset-level lock service for edit-mode concurrency control.

Lock semantics:
  - One active lock per dataset at a time (keyed by dataset_id)
  - Heartbeat every 20s; lock expires after 90s of no heartbeat
  - Expired locks are cleaned up lazily on acquire/status checks
  - Admins can force-release any lock
  - Enforced: mutation endpoints reject non-holders with 423
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from services.pg_adapter import IntegrityError
from services.db_service import _connect, _connect_ro

LOCK_EXPIRY_SECONDS = 90


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def cleanup_expired() -> int:
    cutoff = (datetime.utcnow() - timedelta(seconds=LOCK_EXPIRY_SECONDS)).isoformat()
    # 1. Quick read check (no write transaction)
    with _connect_ro() as conn:
        has_expired = conn.execute(
            "SELECT 1 FROM dataset_locks WHERE last_heartbeat < ? LIMIT 1", (cutoff,)
        ).fetchone()

    if not has_expired:
        return 0  # Skip the write transaction entirely

    # 2. Only write if there is actually something to clean up
    with _connect() as conn:
        result = conn.execute("DELETE FROM dataset_locks WHERE last_heartbeat < ?", (cutoff,))
        conn.commit()
        return result.rowcount


def get_lock(dataset_id: int) -> Optional[Dict[str, Any]]:
    cleanup_expired()
    with _connect_ro() as conn:
        row = conn.execute(
            "SELECT * FROM dataset_locks WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()
        return dict(row) if row else None


def get_locks_for_project(project_id: int) -> Dict[int, Dict[str, Any]]:
    """Return a map of dataset_id -> lock info for all active locks in a project."""
    cleanup_expired()
    with _connect_ro() as conn:
        rows = conn.execute(
            "SELECT * FROM dataset_locks WHERE project_id = ?", (project_id,)
        ).fetchall()
        return {r["dataset_id"]: dict(r) for r in rows}


def acquire_lock(dataset_id: int, project_id: int, user_id: int, username: str) -> Dict[str, Any]:
    """Try to acquire or reclaim a dataset lock.

    Handles simultaneous-acquire race via IntegrityError catch.
    """
    cleanup_expired()
    now = _now_iso()

    with _connect() as conn:
        existing = conn.execute(
            "SELECT * FROM dataset_locks WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()

        if existing:
            if existing["user_id"] == user_id:
                conn.execute(
                    "UPDATE dataset_locks SET last_heartbeat = ? WHERE dataset_id = ?",
                    (now, dataset_id),
                )
                conn.commit()
                return {
                    "acquired": True, "holder": username, "holder_id": user_id,
                    "acquired_at": existing["acquired_at"], "last_heartbeat": now,
                }
            return {
                "acquired": False,
                "holder": existing["username"],
                "holder_id": existing["user_id"],
                "acquired_at": existing["acquired_at"],
                "last_heartbeat": existing["last_heartbeat"],
            }

        try:
            conn.execute(
                "INSERT INTO dataset_locks (dataset_id, project_id, user_id, username, acquired_at, last_heartbeat) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (dataset_id, project_id, user_id, username, now, now),
            )
            conn.commit()
            return {
                "acquired": True, "holder": username, "holder_id": user_id,
                "acquired_at": now, "last_heartbeat": now,
            }
        except IntegrityError:
            winner = conn.execute(
                "SELECT * FROM dataset_locks WHERE dataset_id = ?", (dataset_id,)
            ).fetchone()
            if winner and winner["user_id"] == user_id:
                return {
                    "acquired": True, "holder": username, "holder_id": user_id,
                    "acquired_at": winner["acquired_at"], "last_heartbeat": winner["last_heartbeat"],
                }
            return {
                "acquired": False,
                "holder": winner["username"] if winner else "unknown",
                "holder_id": winner["user_id"] if winner else None,
                "acquired_at": winner["acquired_at"] if winner else None,
                "last_heartbeat": winner["last_heartbeat"] if winner else None,
            }


def heartbeat(dataset_id: int, user_id: int, username: str = "", project_id: int = 0) -> Optional[Dict[str, Any]]:
    """Update heartbeat. Auto-reacquires if lock expired.

    Returns:
      {"status": "ok"}              -- heartbeat refreshed
      {"status": "reacquired"}      -- lock had expired, re-acquired
      {"status": "lost", ...}       -- someone else holds it now
      None                          -- no lock and no username for re-acquire
    """
    now = _now_iso()
    with _connect() as conn:
        result = conn.execute(
            "UPDATE dataset_locks SET last_heartbeat = ? WHERE dataset_id = ? AND user_id = ?",
            (now, dataset_id, user_id),
        )
        conn.commit()
        if result.rowcount > 0:
            return {"status": "ok"}

    if username and project_id:
        reacquire = acquire_lock(dataset_id, project_id, user_id, username)
        if reacquire["acquired"]:
            return {"status": "reacquired"}
        return {
            "status": "lost",
            "holder": reacquire.get("holder"),
            "holder_id": reacquire.get("holder_id"),
            "last_heartbeat": reacquire.get("last_heartbeat"),
        }
    return None


def release_lock(dataset_id: int, user_id: int) -> bool:
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM dataset_locks WHERE dataset_id = ? AND user_id = ?",
            (dataset_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0


def force_release_lock(dataset_id: int) -> bool:
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM dataset_locks WHERE dataset_id = ?", (dataset_id,)
        )
        conn.commit()
        return result.rowcount > 0


def release_all_user_locks(user_id: int) -> int:
    """Release all dataset locks held by a user (called on logout)."""
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM dataset_locks WHERE user_id = ?", (user_id,)
        )
        conn.commit()
        return result.rowcount


def check_holder(dataset_id: int, user_id: int) -> Optional[Dict[str, Any]]:
    """Check if a dataset is locked by someone other than user_id.

    Returns None if the dataset is unlocked or locked by user_id.
    Returns holder info dict if locked by someone else.
    """
    cleanup_expired()
    with _connect_ro() as conn:
        row = conn.execute(
            "SELECT * FROM dataset_locks WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()
        if not row or row["user_id"] == user_id:
            return None
        return {
            "holder": row["username"],
            "holder_id": row["user_id"],
            "acquired_at": row["acquired_at"],
            "last_heartbeat": row["last_heartbeat"],
        }
