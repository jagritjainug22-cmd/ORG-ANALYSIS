"""
Soft-lock service for project-level concurrency control.

Lock semantics:
  - One active lock per project at a time
  - Heartbeat every 20s; lock expires after 90s of no heartbeat
  - Expired locks are cleaned up lazily on acquire/status checks
  - Admins can force-release any lock
  - Advisory only: non-holders can still write (enforced locks are a future follow-up)
"""

from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from services.pg_adapter import IntegrityError
from services.db_service import _connect, _connect_ro

LOCK_EXPIRY_SECONDS = 90


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def cleanup_expired() -> int:
    cutoff = (datetime.utcnow() - timedelta(seconds=LOCK_EXPIRY_SECONDS)).isoformat()
    # 1. Quick read check (no write lock)
    with _connect_ro() as conn:
        has_expired = conn.execute(
            "SELECT 1 FROM project_locks WHERE last_heartbeat < ? LIMIT 1", (cutoff,)
        ).fetchone()

    if not has_expired:
        return 0  # Skip the write transaction entirely

    # 2. Only write if there is actually something to clean up
    with _connect() as conn:
        result = conn.execute("DELETE FROM project_locks WHERE last_heartbeat < ?", (cutoff,))
        conn.commit()
        return result.rowcount


def get_lock(project_id: int) -> Optional[Dict[str, Any]]:
    cleanup_expired()
    with _connect_ro() as conn:
        row = conn.execute(
            "SELECT * FROM project_locks WHERE project_id = ?", (project_id,)
        ).fetchone()
        return dict(row) if row else None


def get_all_locks() -> Dict[int, Dict[str, Any]]:
    """Return a map of project_id -> lock info for all active locks."""
    cleanup_expired()
    with _connect_ro() as conn:
        rows = conn.execute("SELECT * FROM project_locks").fetchall()
        return {r["project_id"]: dict(r) for r in rows}


def acquire_lock(project_id: int, user_id: int, username: str) -> Dict[str, Any]:
    """Try to acquire or reclaim a lock. Returns lock status dict.

    Possible outcomes:
      - acquired: True  -> caller now holds the lock
      - acquired: False -> someone else holds it (holder info returned)

    Handles simultaneous-acquire race: if two clients INSERT at the same
    instant, the loser hits an IntegrityError on the PK and falls through
    to re-read the winner's row — never a 500.
    """
    cleanup_expired()
    now = _now_iso()

    with _connect() as conn:
        existing = conn.execute(
            "SELECT * FROM project_locks WHERE project_id = ?", (project_id,)
        ).fetchone()

        if existing:
            if existing["user_id"] == user_id:
                conn.execute(
                    "UPDATE project_locks SET last_heartbeat = ? WHERE project_id = ?",
                    (now, project_id),
                )
                conn.commit()
                return {"acquired": True, "holder": username, "holder_id": user_id, "acquired_at": existing["acquired_at"]}
            return {
                "acquired": False,
                "holder": existing["username"],
                "holder_id": existing["user_id"],
                "acquired_at": existing["acquired_at"],
            }

        try:
            conn.execute(
                "INSERT INTO project_locks (project_id, user_id, username, acquired_at, last_heartbeat) VALUES (?, ?, ?, ?, ?)",
                (project_id, user_id, username, now, now),
            )
            conn.commit()
            return {"acquired": True, "holder": username, "holder_id": user_id, "acquired_at": now}
        except IntegrityError:
            # Lost the race — another client inserted first. Re-read the winner.
            winner = conn.execute(
                "SELECT * FROM project_locks WHERE project_id = ?", (project_id,)
            ).fetchone()
            if winner and winner["user_id"] == user_id:
                return {"acquired": True, "holder": username, "holder_id": user_id, "acquired_at": winner["acquired_at"]}
            return {
                "acquired": False,
                "holder": winner["username"] if winner else "unknown",
                "holder_id": winner["user_id"] if winner else None,
                "acquired_at": winner["acquired_at"] if winner else None,
            }


def heartbeat(project_id: int, user_id: int, username: str = "") -> Dict[str, Any]:
    """Update heartbeat timestamp. If lock was expired/cleaned, attempt re-acquire.

    Returns:
      {"status": "ok"}              — heartbeat refreshed normally
      {"status": "reacquired"}      — lock had expired, successfully re-acquired
      {"status": "lost", ...}       — lock held by someone else after expiry
      None                          — no lock and re-acquire failed
    """
    now = _now_iso()
    with _connect() as conn:
        result = conn.execute(
            "UPDATE project_locks SET last_heartbeat = ? WHERE project_id = ? AND user_id = ?",
            (now, project_id, user_id),
        )
        conn.commit()
        if result.rowcount > 0:
            return {"status": "ok"}

    # Lock gone (expired or force-released). Try to re-acquire silently.
    if username:
        reacquire = acquire_lock(project_id, user_id, username)
        if reacquire["acquired"]:
            return {"status": "reacquired"}
        return {"status": "lost", "holder": reacquire.get("holder"), "holder_id": reacquire.get("holder_id")}
    return None


def release_lock(project_id: int, user_id: int) -> bool:
    """Release lock if held by this user."""
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM project_locks WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0


def force_release_lock(project_id: int) -> bool:
    """Admin force-release regardless of owner."""
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM project_locks WHERE project_id = ?", (project_id,)
        )
        conn.commit()
        return result.rowcount > 0


def release_all_user_locks(user_id: int) -> int:
    """Release all locks held by a user (called on logout)."""
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM project_locks WHERE user_id = ?", (user_id,)
        )
        conn.commit()
        return result.rowcount
