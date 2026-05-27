"""
SQLite database service for OrgSight 2.0.

Stores the final processed dataset after the pipeline completes, plus scenarios
that branch off the baseline for org modelling (drag-and-drop moves, edits,
soft-deletes, adds).

Schema:
  datasets         - one row per uploaded Excel (with column mapping metadata)
  baseline_records - immutable snapshot of the post-pipeline data
  scenarios        - named branches off a dataset
  scenario_records - mutable working copy of records per scenario
  change_log       - audit trail of every modelling action

All record rows store the full employee row as a JSON blob in `data_json`
plus a few hot columns (emp_id, mgr_id, level, fte, flc, is_flagged_removed)
that are indexed for fast lookups and aggregations.
"""

import json
import logging
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).resolve().parent.parent / "db"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = DB_DIR / "orgsight.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create tables if they don't already exist. Safe to call on every startup."""
    with _connect() as conn:
        c = conn.cursor()

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS datasets (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL,
                username      TEXT NOT NULL,
                upload_time   TEXT NOT NULL,
                emp_col       TEXT NOT NULL,
                mgr_col       TEXT NOT NULL,
                fte_col       TEXT,
                flc_col       TEXT,
                job_title_col TEXT,
                country_col   TEXT,
                row_count     INTEGER NOT NULL DEFAULT 0
            )
            """
        )

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS baseline_records (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id  INTEGER NOT NULL,
                emp_id      TEXT NOT NULL,
                mgr_id      TEXT,
                level       INTEGER,
                fte         REAL,
                flc         REAL,
                data_json   TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_baseline_dataset ON baseline_records(dataset_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_baseline_emp ON baseline_records(dataset_id, emp_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_baseline_mgr ON baseline_records(dataset_id, mgr_id)")

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS scenarios (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id   INTEGER NOT NULL,
                name         TEXT NOT NULL,
                description  TEXT,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                is_promoted  INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_scenarios_dataset ON scenarios(dataset_id)")

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS scenario_records (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_id        INTEGER NOT NULL,
                emp_id             TEXT NOT NULL,
                mgr_id             TEXT,
                level              INTEGER,
                fte                REAL,
                flc                REAL,
                is_flagged_removed INTEGER NOT NULL DEFAULT 0,
                is_added           INTEGER NOT NULL DEFAULT 0,
                data_json          TEXT NOT NULL,
                FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
                UNIQUE (scenario_id, emp_id)
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_scenario_records_sid ON scenario_records(scenario_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_scenario_records_mgr ON scenario_records(scenario_id, mgr_id)")

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS change_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_id  INTEGER NOT NULL,
                action       TEXT NOT NULL,
                emp_id       TEXT,
                old_mgr_id   TEXT,
                new_mgr_id   TEXT,
                field        TEXT,
                old_value    TEXT,
                new_value    TEXT,
                timestamp    TEXT NOT NULL,
                username     TEXT,
                FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_change_log_sid ON change_log(scenario_id)")

        # --- Phase 1: Auth tables ---
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                username             TEXT NOT NULL UNIQUE,
                display_name         TEXT,
                password_hash        TEXT NOT NULL,
                role                 TEXT NOT NULL DEFAULT 'member',
                is_active            INTEGER NOT NULL DEFAULT 1,
                must_change_password INTEGER NOT NULL DEFAULT 1,
                created_at           TEXT NOT NULL,
                updated_at           TEXT NOT NULL
            )
            """
        )
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)")

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                token_hash  TEXT NOT NULL UNIQUE,
                expires_at  TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                revoked_at  TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)")

        # --- Schema version tracking (Phase 2+) ---
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        if c.execute("SELECT COUNT(*) AS n FROM schema_version").fetchone()["n"] == 0:
            c.execute("INSERT INTO schema_version (version) VALUES (0)")

        conn.commit()

    _seed_admin()
    _migrate_legacy_users()
    _run_migrations()


# ---------------------------------------------------------------------------
# Admin seeding + legacy user migration
# ---------------------------------------------------------------------------

def _seed_admin() -> None:
    """Create the first admin user from environment variables.

    Requires SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD to both be set.
    If an admin already exists, this is a no-op.
    If neither env var is set and no admin exists, exits with a clear error.
    SEED_ADMIN_PASSWORD is never logged.
    """
    from argon2 import PasswordHasher

    with _connect() as conn:
        admin_exists = conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"
        ).fetchone()["n"]
        if admin_exists:
            return

    seed_username = os.environ.get("SEED_ADMIN_USERNAME")
    seed_password = os.environ.get("SEED_ADMIN_PASSWORD")

    if not seed_username or not seed_password:
        logger.critical(
            "No admin user exists and SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD "
            "environment variables are not both set. Cannot start without an admin. "
            "Set both env vars and restart."
        )
        sys.exit(1)

    ph = PasswordHasher()
    now = datetime.utcnow().isoformat()

    with _connect() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (seed_username,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE users SET role = 'admin', updated_at = ? WHERE username = ?",
                (now, seed_username),
            )
        else:
            conn.execute(
                """
                INSERT INTO users
                    (username, display_name, password_hash, role, is_active,
                     must_change_password, created_at, updated_at)
                VALUES (?, ?, ?, 'admin', 1, 1, ?, ?)
                """,
                (seed_username, seed_username, ph.hash(seed_password), now, now),
            )
        conn.commit()
    logger.info("Seeded admin user: %s", seed_username)


def _migrate_legacy_users() -> None:
    """Migrate the hardcoded VALID_USERS dict into the users table.

    Existing usernames are skipped. All migrated users get
    must_change_password=true so they set a real password on first login.
    """
    from argon2 import PasswordHasher

    LEGACY_USERS = {
        "aishwaryajain": "shwryjn",
        "dmirakhur": "dmrkhr",
        "sparashar": "sprshr",
        "abhishek.singh": "bhshksngh",
        "varun.singh": "vrnsngh",
        "ankit.arora": "nktrr",
        "jnad": "jytsnd>",
        "sroutray": "srtry>",
        "a.goel": "dtygl",
        "ppruthi": "pprth",
        "arao": "bhnvr",
        "rraj": "rhlrj",
        "ashish.mehta": "shshmht",
        "hmakkar": "hmkkr",
        "gbhatia": "gbht",
    }

    ph = PasswordHasher()
    now = datetime.utcnow().isoformat()
    migrated = 0

    with _connect() as conn:
        for username, password in LEGACY_USERS.items():
            existing = conn.execute(
                "SELECT id FROM users WHERE username = ?", (username,)
            ).fetchone()
            if existing:
                continue
            conn.execute(
                """
                INSERT INTO users
                    (username, display_name, password_hash, role, is_active,
                     must_change_password, created_at, updated_at)
                VALUES (?, ?, ?, 'member', 1, 1, ?, ?)
                """,
                (username, username, ph.hash(password), now, now),
            )
            migrated += 1
        conn.commit()

    if migrated:
        logger.info("Migrated %d legacy users into users table", migrated)


# ---------------------------------------------------------------------------
# Schema migrations (Phase 2+)
# ---------------------------------------------------------------------------

def _migrate_v1(conn: sqlite3.Connection) -> None:
    """v1: projects + project_assignments + audit_log tables."""
    c = conn.cursor()

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT,
            deadline    TEXT,
            status      TEXT NOT NULL DEFAULT 'active',
            created_by  INTEGER NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
        """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS project_assignments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id  INTEGER NOT NULL,
            user_id     INTEGER NOT NULL,
            role        TEXT NOT NULL DEFAULT 'member',
            assigned_at TEXT NOT NULL,
            assigned_by INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id)    REFERENCES users(id),
            FOREIGN KEY (assigned_by) REFERENCES users(id),
            UNIQUE (project_id, user_id)
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_pa_project ON project_assignments(project_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_pa_user ON project_assignments(user_id)")

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER,
            action        TEXT NOT NULL,
            resource_type TEXT,
            resource_id   INTEGER,
            details_json  TEXT,
            ip_address    TEXT,
            created_at    TEXT NOT NULL
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)")


def _migrate_v2(conn: sqlite3.Connection) -> None:
    """v2: Add project_id to datasets + backfill Legacy project."""
    c = conn.cursor()

    # Add column (SQLite ignores IF NOT EXISTS for ALTER TABLE, so check first)
    cols = [row["name"] for row in c.execute("PRAGMA table_info(datasets)").fetchall()]
    if "project_id" not in cols:
        c.execute("ALTER TABLE datasets ADD COLUMN project_id INTEGER REFERENCES projects(id)")

    # Always ensure a Legacy project exists and assign all active users to it
    now = datetime.utcnow().isoformat()
    admin = c.execute(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
    ).fetchone()
    admin_id = admin["id"] if admin else 1

    existing_legacy = c.execute(
        "SELECT id FROM projects WHERE name = 'Legacy' LIMIT 1"
    ).fetchone()

    if existing_legacy:
        legacy_project_id = existing_legacy["id"]
    else:
        c.execute(
            """
            INSERT INTO projects (name, description, status, created_by, created_at, updated_at)
            VALUES ('Legacy', 'Auto-created project for pre-existing datasets', 'active', ?, ?, ?)
            """,
            (admin_id, now, now),
        )
        legacy_project_id = c.lastrowid

    # Backfill orphaned datasets
    orphan_count = c.execute(
        "SELECT COUNT(*) AS n FROM datasets WHERE project_id IS NULL"
    ).fetchone()["n"]
    if orphan_count > 0:
        c.execute(
            "UPDATE datasets SET project_id = ? WHERE project_id IS NULL",
            (legacy_project_id,),
        )

    # Assign all active users to the Legacy project
    active_users = c.execute("SELECT id FROM users WHERE is_active = 1").fetchall()
    for user_row in active_users:
        try:
            c.execute(
                """
                INSERT INTO project_assignments (project_id, user_id, role, assigned_at, assigned_by)
                VALUES (?, ?, 'member', ?, ?)
                """,
                (legacy_project_id, user_row["id"], now, admin_id),
            )
        except sqlite3.IntegrityError:
            pass  # already assigned

    if orphan_count > 0:
        logger.info(
            "Legacy project (id=%d), %d orphaned datasets backfilled, %d users assigned",
            legacy_project_id, orphan_count, len(active_users),
        )
    else:
        logger.info(
            "Legacy project ensured (id=%d), %d users assigned",
            legacy_project_id, len(active_users),
        )


def _migrate_v3(conn: sqlite3.Connection) -> None:
    """v3: project_locks table for soft-locking."""
    c = conn.cursor()
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS project_locks (
            project_id     INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            user_id        INTEGER NOT NULL REFERENCES users(id),
            username       TEXT NOT NULL,
            acquired_at    TEXT NOT NULL,
            last_heartbeat TEXT NOT NULL
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_locks_heartbeat ON project_locks(last_heartbeat)")


_MIGRATIONS = [
    (1, "projects + assignments + audit_log tables", _migrate_v1),
    (2, "project_id on datasets + Legacy project backfill", _migrate_v2),
    (3, "project_locks table", _migrate_v3),
]


def _run_migrations() -> None:
    """Run pending schema migrations in order."""
    with _connect() as conn:
        current = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
        for version, description, fn in _MIGRATIONS:
            if version > current:
                logger.info("Running migration v%d: %s", version, description)
                fn(conn)
                conn.execute("UPDATE schema_version SET version = ?", (version,))
                conn.commit()
                logger.info("Migration v%d complete", version)


# ---------------------------------------------------------------------------
# User queries (used by auth dependencies)
# ---------------------------------------------------------------------------

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        return dict(row) if row else None


def create_user(
    username: str,
    password_hash: str,
    display_name: Optional[str] = None,
    role: str = "member",
) -> int:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO users
                (username, display_name, password_hash, role, is_active,
                 must_change_password, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, 1, ?, ?)
            """,
            (username, display_name or username, password_hash, role, now, now),
        )
        conn.commit()
        return c.lastrowid


def update_user_password(user_id: int, password_hash: str, clear_must_change: bool = True) -> None:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        if clear_must_change:
            conn.execute(
                "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
                (password_hash, now, user_id),
            )
        else:
            conn.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (password_hash, now, user_id),
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Refresh token persistence
# ---------------------------------------------------------------------------

def store_refresh_token(user_id: int, token_hash: str, expires_at: str) -> int:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, token_hash, expires_at, now),
        )
        conn.commit()
        return c.lastrowid


def get_refresh_token(token_hash: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None


def revoke_refresh_token(token_hash: str) -> None:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        conn.execute(
            "UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?",
            (now, token_hash),
        )
        conn.commit()


def revoke_all_user_tokens(user_id: int) -> None:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        conn.execute(
            "UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (now, user_id),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# Dataset + baseline persistence
# ---------------------------------------------------------------------------

def save_baseline(
    name: str,
    username: str,
    records: List[Dict[str, Any]],
    emp_col: str,
    mgr_col: str,
    fte_col: Optional[str] = None,
    flc_col: Optional[str] = None,
    job_title_col: Optional[str] = None,
    country_col: Optional[str] = None,
    project_id: Optional[int] = None,
) -> int:
    """Persist a fully-processed dataset as the baseline and create a default
    'Baseline' scenario that mirrors it. Returns the new dataset_id."""
    now = datetime.utcnow().isoformat()

    with _connect() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO datasets
                (name, username, upload_time, emp_col, mgr_col, fte_col, flc_col,
                 job_title_col, country_col, row_count, project_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, username, now, emp_col, mgr_col, fte_col, flc_col,
             job_title_col, country_col, len(records), project_id),
        )
        dataset_id = c.lastrowid

        rows = []
        for row in records:
            emp_id = _to_str(row.get(emp_col))
            mgr_id = _to_str(row.get(mgr_col))
            level = _to_int(row.get("Level"))
            fte = _to_float(row.get(fte_col)) if fte_col else None
            flc = _to_float(row.get(flc_col)) if flc_col else None
            rows.append((dataset_id, emp_id, mgr_id, level, fte, flc, json.dumps(row, default=str)))

        c.executemany(
            """
            INSERT INTO baseline_records
                (dataset_id, emp_id, mgr_id, level, fte, flc, data_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )

        # Auto-create a default scenario that mirrors the baseline
        c.execute(
            """
            INSERT INTO scenarios (dataset_id, name, description, created_at, updated_at, is_promoted)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (dataset_id, "Baseline", "Default working scenario (mirrors baseline)", now, now),
        )
        scenario_id = c.lastrowid

        scenario_rows = []
        for row in records:
            emp_id = _to_str(row.get(emp_col))
            mgr_id = _to_str(row.get(mgr_col))
            level = _to_int(row.get("Level"))
            fte = _to_float(row.get(fte_col)) if fte_col else None
            flc = _to_float(row.get(flc_col)) if flc_col else None
            scenario_rows.append(
                (scenario_id, emp_id, mgr_id, level, fte, flc, 0, 0, json.dumps(row, default=str))
            )

        c.executemany(
            """
            INSERT INTO scenario_records
                (scenario_id, emp_id, mgr_id, level, fte, flc,
                 is_flagged_removed, is_added, data_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            scenario_rows,
        )

        conn.commit()
        return dataset_id


def list_datasets(username: Optional[str] = None, project_id: Optional[int] = None) -> List[Dict[str, Any]]:
    with _connect() as conn:
        clauses, params = [], []
        if username:
            clauses.append("username = ?")
            params.append(username)
        if project_id is not None:
            clauses.append("project_id = ?")
            params.append(project_id)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        cur = conn.execute(
            f"SELECT * FROM datasets{where} ORDER BY upload_time DESC",
            params,
        )
        return [dict(r) for r in cur.fetchall()]


def get_dataset(dataset_id: int) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
        return dict(row) if row else None


def get_baseline_records(dataset_id: int) -> List[Dict[str, Any]]:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT data_json FROM baseline_records WHERE dataset_id = ?",
            (dataset_id,),
        )
        return [json.loads(r["data_json"]) for r in cur.fetchall()]


def delete_dataset(dataset_id: int) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        conn.commit()


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def list_scenarios(dataset_id: int) -> List[Dict[str, Any]]:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT * FROM scenarios WHERE dataset_id = ? ORDER BY created_at",
            (dataset_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_scenario(scenario_id: int) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
        return dict(row) if row else None


def create_scenario(
    dataset_id: int,
    name: str,
    description: str = "",
    source_scenario_id: Optional[int] = None,
) -> int:
    """Create a new scenario. If `source_scenario_id` is provided, the new
    scenario starts as a deep copy of that scenario's current state; otherwise
    it forks the baseline."""
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO scenarios (dataset_id, name, description, created_at, updated_at, is_promoted)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (dataset_id, name, description, now, now),
        )
        new_id = c.lastrowid

        if source_scenario_id is not None:
            c.execute(
                """
                INSERT INTO scenario_records
                    (scenario_id, emp_id, mgr_id, level, fte, flc,
                     is_flagged_removed, is_added, data_json)
                SELECT ?, emp_id, mgr_id, level, fte, flc,
                       is_flagged_removed, is_added, data_json
                FROM scenario_records WHERE scenario_id = ?
                """,
                (new_id, source_scenario_id),
            )
        else:
            c.execute(
                """
                INSERT INTO scenario_records
                    (scenario_id, emp_id, mgr_id, level, fte, flc,
                     is_flagged_removed, is_added, data_json)
                SELECT ?, emp_id, mgr_id, level, fte, flc, 0, 0, data_json
                FROM baseline_records WHERE dataset_id = ?
                """,
                (new_id, dataset_id),
            )

        conn.commit()
        return new_id


def rename_scenario(scenario_id: int, new_name: str, description: Optional[str] = None) -> None:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        if description is not None:
            conn.execute(
                "UPDATE scenarios SET name = ?, description = ?, updated_at = ? WHERE id = ?",
                (new_name, description, now, scenario_id),
            )
        else:
            conn.execute(
                "UPDATE scenarios SET name = ?, updated_at = ? WHERE id = ?",
                (new_name, now, scenario_id),
            )
        conn.commit()


def delete_scenario(scenario_id: int) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))
        conn.commit()


def get_scenario_records(scenario_id: int) -> List[Dict[str, Any]]:
    """Return all records for a scenario as merged dicts.

    Each record's stored JSON is merged with the mutable scenario columns
    (mgr_id, level, is_flagged_removed, is_added) so the frontend always sees
    the current state.
    """
    with _connect() as conn:
        cur = conn.execute(
            """
            SELECT emp_id, mgr_id, level, fte, flc,
                   is_flagged_removed, is_added, data_json
            FROM scenario_records WHERE scenario_id = ?
            """,
            (scenario_id,),
        )
        records = []
        for r in cur.fetchall():
            data = json.loads(r["data_json"])
            data["__emp_id"] = r["emp_id"]
            data["__mgr_id"] = r["mgr_id"]
            data["Level"] = r["level"]
            data["is_flagged_removed"] = bool(r["is_flagged_removed"])
            data["is_added"] = bool(r["is_added"])
            records.append(data)
        return records


def promote_scenario(scenario_id: int) -> None:
    """Promote a scenario to be the new baseline.

    The scenario's current state replaces the dataset's baseline_records.
    The scenario itself is marked as is_promoted = 1.
    """
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()

        scenario = c.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
        if not scenario:
            raise ValueError(f"Scenario {scenario_id} not found")
        dataset_id = scenario["dataset_id"]

        c.execute("DELETE FROM baseline_records WHERE dataset_id = ?", (dataset_id,))
        c.execute(
            """
            INSERT INTO baseline_records (dataset_id, emp_id, mgr_id, level, fte, flc, data_json)
            SELECT ?, emp_id, mgr_id, level, fte, flc, data_json
            FROM scenario_records
            WHERE scenario_id = ? AND is_flagged_removed = 0
            """,
            (dataset_id, scenario_id),
        )

        c.execute(
            "UPDATE scenarios SET is_promoted = 0 WHERE dataset_id = ?",
            (dataset_id,),
        )
        c.execute(
            "UPDATE scenarios SET is_promoted = 1, updated_at = ? WHERE id = ?",
            (now, scenario_id),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# Scenario mutations (move / edit / add / flag)
# ---------------------------------------------------------------------------

def move_employee(
    scenario_id: int,
    emp_id: str,
    new_mgr_id: Optional[str],
    username: str = "",
) -> Dict[str, Any]:
    """Reassign an employee to a new manager. Returns the updated record."""
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        cur = c.execute(
            "SELECT mgr_id, data_json FROM scenario_records WHERE scenario_id = ? AND emp_id = ?",
            (scenario_id, emp_id),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError(f"Employee {emp_id} not found in scenario {scenario_id}")
        old_mgr_id = row["mgr_id"]
        data = json.loads(row["data_json"])

        c.execute(
            "UPDATE scenario_records SET mgr_id = ? WHERE scenario_id = ? AND emp_id = ?",
            (new_mgr_id, scenario_id, emp_id),
        )
        c.execute(
            """
            INSERT INTO change_log
                (scenario_id, action, emp_id, old_mgr_id, new_mgr_id, timestamp, username)
            VALUES (?, 'move', ?, ?, ?, ?, ?)
            """,
            (scenario_id, emp_id, old_mgr_id, new_mgr_id, now, username),
        )
        c.execute("UPDATE scenarios SET updated_at = ? WHERE id = ?", (now, scenario_id))
        conn.commit()

        data["__emp_id"] = emp_id
        data["__mgr_id"] = new_mgr_id
        return data


def edit_employee(
    scenario_id: int,
    emp_id: str,
    updates: Dict[str, Any],
    username: str = "",
) -> Dict[str, Any]:
    """Edit arbitrary fields on an employee. Updates JSON blob + hot columns."""
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        row = c.execute(
            """
            SELECT mgr_id, level, fte, flc, data_json
            FROM scenario_records WHERE scenario_id = ? AND emp_id = ?
            """,
            (scenario_id, emp_id),
        ).fetchone()
        if not row:
            raise ValueError(f"Employee {emp_id} not found in scenario {scenario_id}")

        data = json.loads(row["data_json"])
        new_mgr_id = row["mgr_id"]
        new_level = row["level"]
        new_fte = row["fte"]
        new_flc = row["flc"]

        for field, new_value in updates.items():
            old_value = data.get(field)
            data[field] = new_value
            c.execute(
                """
                INSERT INTO change_log
                    (scenario_id, action, emp_id, field, old_value, new_value, timestamp, username)
                VALUES (?, 'edit', ?, ?, ?, ?, ?, ?)
                """,
                (scenario_id, emp_id, field, _to_str(old_value), _to_str(new_value), now, username),
            )
            # Mirror updates to hot columns where applicable
            if field == "Level":
                new_level = _to_int(new_value)
            elif field == "fte" or field.lower() == "fte":
                new_fte = _to_float(new_value)
            elif field == "flc" or field.lower() == "flc":
                new_flc = _to_float(new_value)

        c.execute(
            """
            UPDATE scenario_records
            SET data_json = ?, level = ?, fte = ?, flc = ?
            WHERE scenario_id = ? AND emp_id = ?
            """,
            (json.dumps(data, default=str), new_level, new_fte, new_flc, scenario_id, emp_id),
        )
        c.execute("UPDATE scenarios SET updated_at = ? WHERE id = ?", (now, scenario_id))
        conn.commit()

        data["__emp_id"] = emp_id
        data["__mgr_id"] = new_mgr_id
        return data


def add_employee(
    scenario_id: int,
    record: Dict[str, Any],
    emp_id: str,
    mgr_id: Optional[str],
    level: Optional[int] = None,
    fte: Optional[float] = None,
    flc: Optional[float] = None,
    username: str = "",
) -> Dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO scenario_records
                (scenario_id, emp_id, mgr_id, level, fte, flc,
                 is_flagged_removed, is_added, data_json)
            VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)
            """,
            (scenario_id, emp_id, mgr_id, level, fte, flc, json.dumps(record, default=str)),
        )
        c.execute(
            """
            INSERT INTO change_log
                (scenario_id, action, emp_id, new_mgr_id, timestamp, username)
            VALUES (?, 'add', ?, ?, ?, ?)
            """,
            (scenario_id, emp_id, mgr_id, now, username),
        )
        c.execute("UPDATE scenarios SET updated_at = ? WHERE id = ?", (now, scenario_id))
        conn.commit()

        record = dict(record)
        record["__emp_id"] = emp_id
        record["__mgr_id"] = mgr_id
        record["is_added"] = True
        record["is_flagged_removed"] = False
        return record


def flag_employee(
    scenario_id: int,
    emp_id: str,
    flagged: bool,
    username: str = "",
) -> Dict[str, Any]:
    """Flag/unflag an employee and cascade to all descendants."""
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        root_row = c.execute(
            "SELECT mgr_id, data_json FROM scenario_records WHERE scenario_id = ? AND emp_id = ?",
            (scenario_id, emp_id),
        ).fetchone()
        if not root_row:
            raise ValueError(f"Employee {emp_id} not found in scenario {scenario_id}")

        subtree_rows = c.execute(
            """
            WITH RECURSIVE subtree AS (
                SELECT emp_id FROM scenario_records
                WHERE scenario_id = ? AND emp_id = ?
              UNION ALL
                SELECT sr.emp_id FROM scenario_records sr
                JOIN subtree st ON sr.mgr_id = st.emp_id
                WHERE sr.scenario_id = ?
            )
            SELECT emp_id FROM subtree
            """,
            (scenario_id, emp_id, scenario_id),
        ).fetchall()

        affected_ids = [r["emp_id"] for r in subtree_rows]
        placeholders = ",".join("?" * len(affected_ids))
        c.execute(
            f"UPDATE scenario_records SET is_flagged_removed = ? "
            f"WHERE scenario_id = ? AND emp_id IN ({placeholders})",
            [1 if flagged else 0, scenario_id] + affected_ids,
        )
        c.execute(
            """
            INSERT INTO change_log
                (scenario_id, action, emp_id, timestamp, username)
            VALUES (?, ?, ?, ?, ?)
            """,
            (scenario_id, "flag_remove" if flagged else "unflag_restore", emp_id, now, username),
        )
        c.execute("UPDATE scenarios SET updated_at = ? WHERE id = ?", (now, scenario_id))
        conn.commit()

        data = json.loads(root_row["data_json"])
        data["__emp_id"] = emp_id
        data["__mgr_id"] = root_row["mgr_id"]
        data["is_flagged_removed"] = flagged
        return data


def delete_scenario_record(scenario_id: int, emp_id: str, username: str = "") -> None:
    """Hard-delete a scenario record (use sparingly -- soft-delete via flag is preferred).
    Only allowed for records added in this scenario (is_added = 1)."""
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        row = c.execute(
            "SELECT is_added FROM scenario_records WHERE scenario_id = ? AND emp_id = ?",
            (scenario_id, emp_id),
        ).fetchone()
        if not row:
            raise ValueError(f"Employee {emp_id} not found in scenario {scenario_id}")
        if not row["is_added"]:
            raise ValueError("Cannot hard-delete baseline records; use flag_employee instead")

        c.execute(
            "DELETE FROM scenario_records WHERE scenario_id = ? AND emp_id = ?",
            (scenario_id, emp_id),
        )
        c.execute(
            """
            INSERT INTO change_log (scenario_id, action, emp_id, timestamp, username)
            VALUES (?, 'delete', ?, ?, ?)
            """,
            (scenario_id, emp_id, now, username),
        )
        c.execute("UPDATE scenarios SET updated_at = ? WHERE id = ?", (now, scenario_id))
        conn.commit()


# ---------------------------------------------------------------------------
# Revert / undo
# ---------------------------------------------------------------------------

def reset_scenario_to_baseline(scenario_id: int, username: str = "") -> None:
    """Wipe all changes in a scenario and re-copy from the dataset baseline."""
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        scenario = c.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
        if not scenario:
            raise ValueError(f"Scenario {scenario_id} not found")
        dataset_id = scenario["dataset_id"]

        c.execute("DELETE FROM scenario_records WHERE scenario_id = ?", (scenario_id,))
        c.execute("DELETE FROM change_log WHERE scenario_id = ?", (scenario_id,))
        c.execute(
            """
            INSERT INTO scenario_records
                (scenario_id, emp_id, mgr_id, level, fte, flc,
                 is_flagged_removed, is_added, data_json)
            SELECT ?, emp_id, mgr_id, level, fte, flc, 0, 0, data_json
            FROM baseline_records WHERE dataset_id = ?
            """,
            (scenario_id, dataset_id),
        )
        c.execute(
            """
            INSERT INTO change_log (scenario_id, action, emp_id, timestamp, username)
            VALUES (?, 'reset', '', ?, ?)
            """,
            (scenario_id, now, username),
        )
        c.execute("UPDATE scenarios SET updated_at = ? WHERE id = ?", (now, scenario_id))
        conn.commit()


def undo_last_change(scenario_id: int, username: str = "") -> Optional[Dict[str, Any]]:
    """Reverse the most recent change_log entry for a scenario.

    Returns the reversed log entry dict, or None if there's nothing to undo.
    Only move, edit, flag_remove, unflag_restore, and add actions can be undone.
    """
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        last = c.execute(
            "SELECT * FROM change_log WHERE scenario_id = ? ORDER BY id DESC LIMIT 1",
            (scenario_id,),
        ).fetchone()
        if not last:
            return None
        entry = dict(last)
        action = entry["action"]

        if action == "move":
            c.execute(
                "UPDATE scenario_records SET mgr_id = ? WHERE scenario_id = ? AND emp_id = ?",
                (entry["old_mgr_id"], scenario_id, entry["emp_id"]),
            )
        elif action == "edit":
            row = c.execute(
                "SELECT data_json FROM scenario_records WHERE scenario_id = ? AND emp_id = ?",
                (scenario_id, entry["emp_id"]),
            ).fetchone()
            if row:
                data = json.loads(row["data_json"])
                data[entry["field"]] = entry["old_value"]
                new_level = data.get("Level")
                new_fte = _to_float(data.get("fte", data.get("FTE")))
                new_flc = _to_float(data.get("flc", data.get("FLC")))
                if entry["field"] == "Level":
                    new_level = _to_int(entry["old_value"])
                elif entry["field"].lower() == "fte":
                    new_fte = _to_float(entry["old_value"])
                elif entry["field"].lower() == "flc":
                    new_flc = _to_float(entry["old_value"])
                c.execute(
                    """
                    UPDATE scenario_records
                    SET data_json = ?, level = ?, fte = ?, flc = ?
                    WHERE scenario_id = ? AND emp_id = ?
                    """,
                    (json.dumps(data, default=str), new_level, new_fte, new_flc,
                     scenario_id, entry["emp_id"]),
                )
        elif action == "flag_remove":
            c.execute(
                "UPDATE scenario_records SET is_flagged_removed = 0 WHERE scenario_id = ? AND emp_id = ?",
                (scenario_id, entry["emp_id"]),
            )
        elif action == "unflag_restore":
            c.execute(
                "UPDATE scenario_records SET is_flagged_removed = 1 WHERE scenario_id = ? AND emp_id = ?",
                (scenario_id, entry["emp_id"]),
            )
        elif action == "add":
            c.execute(
                "DELETE FROM scenario_records WHERE scenario_id = ? AND emp_id = ? AND is_added = 1",
                (scenario_id, entry["emp_id"]),
            )
        elif action == "reset":
            c.execute("DELETE FROM change_log WHERE id = ?", (entry["id"],))
            conn.commit()
            return entry
        else:
            c.execute("DELETE FROM change_log WHERE id = ?", (entry["id"],))
            conn.commit()
            return entry

        c.execute("DELETE FROM change_log WHERE id = ?", (entry["id"],))
        c.execute("UPDATE scenarios SET updated_at = ? WHERE id = ?", (now, scenario_id))
        conn.commit()
        return entry


# ---------------------------------------------------------------------------
# Change log + summary stats
# ---------------------------------------------------------------------------

def get_change_log(scenario_id: int) -> List[Dict[str, Any]]:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT * FROM change_log WHERE scenario_id = ? ORDER BY id",
            (scenario_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_scenario_summary(scenario_id: int) -> Dict[str, Any]:
    """Aggregate summary stats for a scenario, excluding flagged-removed rows."""
    with _connect() as conn:
        scenario = conn.execute(
            "SELECT * FROM scenarios WHERE id = ?", (scenario_id,)
        ).fetchone()
        if not scenario:
            raise ValueError(f"Scenario {scenario_id} not found")
        dataset_id = scenario["dataset_id"]

        active = conn.execute(
            """
            SELECT COUNT(*) AS headcount,
                   COALESCE(SUM(fte), 0) AS total_fte,
                   COALESCE(SUM(flc), 0) AS total_cost
            FROM scenario_records
            WHERE scenario_id = ? AND is_flagged_removed = 0
            """,
            (scenario_id,),
        ).fetchone()

        flagged = conn.execute(
            """
            SELECT COUNT(*) AS removed_count,
                   COALESCE(SUM(fte), 0) AS removed_fte,
                   COALESCE(SUM(flc), 0) AS removed_cost
            FROM scenario_records
            WHERE scenario_id = ? AND is_flagged_removed = 1
            """,
            (scenario_id,),
        ).fetchone()

        baseline = conn.execute(
            """
            SELECT COUNT(*) AS headcount,
                   COALESCE(SUM(fte), 0) AS total_fte,
                   COALESCE(SUM(flc), 0) AS total_cost
            FROM baseline_records WHERE dataset_id = ?
            """,
            (dataset_id,),
        ).fetchone()

        change_count = conn.execute(
            "SELECT COUNT(*) AS n FROM change_log WHERE scenario_id = ?",
            (scenario_id,),
        ).fetchone()

    return {
        "scenario_id": scenario_id,
        "dataset_id": dataset_id,
        "scenario_name": scenario["name"],
        "is_promoted": bool(scenario["is_promoted"]),
        "current": {
            "headcount": active["headcount"],
            "total_fte": float(active["total_fte"] or 0),
            "total_cost": float(active["total_cost"] or 0),
        },
        "baseline": {
            "headcount": baseline["headcount"],
            "total_fte": float(baseline["total_fte"] or 0),
            "total_cost": float(baseline["total_cost"] or 0),
        },
        "flagged_removed": {
            "count": flagged["removed_count"],
            "fte": float(flagged["removed_fte"] or 0),
            "cost": float(flagged["removed_cost"] or 0),
        },
        "delta": {
            "headcount": active["headcount"] - baseline["headcount"],
            "fte": float(active["total_fte"] or 0) - float(baseline["total_fte"] or 0),
            "cost": float(active["total_cost"] or 0) - float(baseline["total_cost"] or 0),
        },
        "change_count": change_count["n"],
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v)
    if s.lower() in ("nan", "none", ""):
        return None
    return s


def _to_int(v: Any) -> Optional[int]:
    try:
        if v is None or v == "":
            return None
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _to_float(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        f = float(v)
        if f != f:  # NaN
            return None
        return f
    except (TypeError, ValueError):
        return None


init_db()
