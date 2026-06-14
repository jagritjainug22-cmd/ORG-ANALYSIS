"""
OrgSight database CLI — CRUD for all tables in orgsight.db.

Run from repo root. See DB_COMMANDS.md for the full command list.

Quick examples:
  python manage_db.py tables
  python manage_db.py users list
  python manage_db.py users set-password jagrit.m Pass123!
  python manage_db.py projects create "My Project" --deadline 2026-12-31
  python manage_db.py assignments assign --project 1 --user jagrit.m
  python manage_db.py datasets list --project 1
  python manage_db.py audit list --limit 20
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "org_lvl_analysis_backend" / "org_lvl_analysis_backend"
REGISTRY_PATH = BACKEND_DIR / "db" / "credentials.local.json"

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / "POSTGRES" / ".env")
load_dotenv(BACKEND_DIR / ".env")

sys.path.insert(0, str(BACKEND_DIR))

from services import db_service  # noqa: E402
from services import project_service  # noqa: E402
from services.pg_adapter import REQUIRED_DATABASE  # noqa: E402
from services.user_service import hash_password  # noqa: E402
from services.audit_service import query_audit_log  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_db() -> None:
    try:
        with db_service._connect() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception as exc:
        raise SystemExit(
            f"Cannot connect to PostgreSQL database '{REQUIRED_DATABASE}': {exc}\n"
            "Check POSTGRES/.env and that the backend can reach the server."
        ) from exc


def _admin_id() -> int:
    with db_service._connect() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1"
        ).fetchone()
    if not row:
        raise SystemExit("No active admin user in database.")
    return row["id"]


def _resolve_user(ref: str) -> Dict[str, Any]:
    if ref.isdigit():
        user = db_service.get_user_by_id(int(ref))
    else:
        user = db_service.get_user_by_username(ref)
    if not user:
        raise SystemExit(f"User not found: {ref}")
    return user


def _resolve_project(ref: str) -> Dict[str, Any]:
    if ref.isdigit():
        project = project_service.get_project(int(ref))
    else:
        with db_service._connect() as conn:
            row = conn.execute(
                "SELECT * FROM projects WHERE LOWER(name) = LOWER(?) LIMIT 1", (ref,)
            ).fetchone()
        project = dict(row) if row else None
    if not project:
        raise SystemExit(f"Project not found: {ref}")
    return project


def _print_json(data: Any) -> None:
    print(json.dumps(data, indent=2, default=str))


def _print_rows(rows: List[Dict], columns: List[str]) -> None:
    if not rows:
        print("(none)")
        return
    widths = {c: max(len(c), max(len(str(r.get(c, ""))) for r in rows)) for c in columns}
    header = " ".join(c.ljust(widths[c]) for c in columns)
    print(header)
    print("-" * len(header))
    for r in rows:
        print(" ".join(str(r.get(c, "")).ljust(widths[c]) for c in columns))


def _load_registry_users() -> Dict[str, str]:
    if not REGISTRY_PATH.exists():
        return {}
    with REGISTRY_PATH.open(encoding="utf-8") as f:
        raw = json.load(f)
    return raw.get("users", raw) if isinstance(raw, dict) else {}


def _save_registry(users: Dict[str, str]) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_note": "Dev-only plaintext passwords. Do NOT commit.",
        "_updated_at": datetime.now(timezone.utc).isoformat(),
        "users": users,
    }
    with REGISTRY_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def _record_password(username: str, password: str) -> None:
    users = _load_registry_users()
    users[username] = password
    _save_registry(users)


# ---------------------------------------------------------------------------
# tables
# ---------------------------------------------------------------------------

def cmd_tables(_: argparse.Namespace) -> None:
    _ensure_db()
    with db_service._connect() as conn:
        tables = [
            r["table_name"]
            for r in conn.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            ).fetchall()
        ]
        print(f"Database: {REQUIRED_DATABASE}\n")
        for t in tables:
            n = conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"]
            print(f"  {t}: {n} rows")


def cmd_sql(args: argparse.Namespace) -> None:
    _ensure_db()
    with db_service._connect() as conn:
        cur = conn.execute(args.query)
        if args.query.strip().upper().startswith("SELECT"):
            rows = cur.fetchall()
            print(json.dumps([dict(r) for r in rows], indent=2, default=str))
        else:
            conn.commit()
            print(f"OK ({cur.rowcount} row(s) affected)")


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------

def users_list(_: argparse.Namespace) -> None:
    _ensure_db()
    registry = _load_registry_users()
    with db_service._connect() as conn:
        rows = [dict(r) for r in conn.execute(
            """
            SELECT id, username, display_name, role, is_active, must_change_password,
                   created_at, updated_at
            FROM users ORDER BY role DESC, username
            """
        ).fetchall()]
    for r in rows:
        r["registry_password"] = "yes" if r["username"] in registry else "-"
    _print_rows(rows, ["id", "username", "role", "is_active", "must_change_password", "registry_password", "display_name"])


def users_show(args: argparse.Namespace) -> None:
    user = _resolve_user(args.user)
    registry = _load_registry_users()
    out = {k: user[k] for k in user if k != "password_hash"}
    out["registry_password"] = registry.get(user["username"], "(not saved)")
    _print_json(out)


def users_create(args: argparse.Namespace) -> None:
    _ensure_db()
    if len(args.password) < 8:
        raise SystemExit("Password must be at least 8 characters.")
    if db_service.get_user_by_username(args.username):
        raise SystemExit(f"User exists: {args.username}")
    uid = db_service.create_user(
        username=args.username,
        password_hash=hash_password(args.password),
        display_name=args.display_name or args.username,
        role=args.role,
    )
    if not args.no_registry:
        _record_password(args.username, args.password)
    print(f"Created user id={uid} username={args.username} role={args.role}")


def users_update(args: argparse.Namespace) -> None:
    user = _resolve_user(args.user)
    uid = user["id"]
    now = datetime.utcnow().isoformat()
    updates, params = [], []

    if args.display_name is not None:
        updates.append("display_name = ?")
        params.append(args.display_name)
    if args.role is not None:
        if args.role not in ("admin", "member"):
            raise SystemExit("role must be admin or member")
        updates.append("role = ?")
        params.append(args.role)
    if args.active is not None:
        updates.append("is_active = ?")
        params.append(1 if args.active == "yes" else 0)

    if args.password:
        if len(args.password) < 8:
            raise SystemExit("Password must be at least 8 characters.")
        updates.append("password_hash = ?")
        params.append(hash_password(args.password))
        updates.append("must_change_password = ?")
        params.append(1 if args.force_change else 0)
        if not args.no_registry:
            _record_password(user["username"], args.password)

    if not updates:
        raise SystemExit("Nothing to update. Use --display-name, --role, --active, or --password")

    updates.append("updated_at = ?")
    params.append(now)
    params.append(uid)

    with db_service._connect() as conn:
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    print(f"Updated user {user['username']} (id={uid})")


def users_set_password(args: argparse.Namespace) -> None:
    args.password = args.password
    user = _resolve_user(args.user)
    db_service.update_user_password(user["id"], hash_password(args.password), clear_must_change=True)
    if not args.no_registry:
        _record_password(user["username"], args.password)
    print(f"Password set for {user['username']}")


def users_deactivate(args: argparse.Namespace) -> None:
    user = _resolve_user(args.user)
    now = datetime.utcnow().isoformat()
    with db_service._connect() as conn:
        conn.execute("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?", (now, user["id"]))
        conn.commit()
    db_service.revoke_all_user_tokens(user["id"])
    print(f"Deactivated {user['username']}")


def users_activate(args: argparse.Namespace) -> None:
    user = _resolve_user(args.user)
    now = datetime.utcnow().isoformat()
    with db_service._connect() as conn:
        conn.execute("UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?", (now, user["id"]))
        conn.commit()
    print(f"Activated {user['username']}")


def users_delete(args: argparse.Namespace) -> None:
    if not args.force:
        raise SystemExit("Permanent delete requires --force")
    user = _resolve_user(args.user)
    uid = user["id"]
    with db_service._connect() as conn:
        conn.execute("DELETE FROM refresh_tokens WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM project_assignments WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM dataset_user_views WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        conn.commit()
    reg = _load_registry_users()
    reg.pop(user["username"], None)
    _save_registry(reg)
    print(f"Deleted user {user['username']} (id={uid})")


def users_registry(_: argparse.Namespace) -> None:
    if not REGISTRY_PATH.exists():
        print(f"No file: {REGISTRY_PATH}")
        return
    print(REGISTRY_PATH.read_text(encoding="utf-8"))


def users_sync(args: argparse.Namespace) -> None:
    _ensure_db()
    users = _load_registry_users()
    for username, password in users.items():
        if username.startswith("_") or not isinstance(password, str) or len(password) < 8:
            continue
        u = db_service.get_user_by_username(username)
        if not u:
            print(f"  SKIP {username}: not in DB")
            continue
        if args.dry_run:
            print(f"  WOULD update {username}")
        else:
            db_service.update_user_password(u["id"], hash_password(password), clear_must_change=True)
            print(f"  OK {username}")


# ---------------------------------------------------------------------------
# projects
# ---------------------------------------------------------------------------

def projects_list(_: argparse.Namespace) -> None:
    _ensure_db()
    rows = project_service.list_all_projects()
    _print_rows(rows, ["id", "name", "status", "deadline", "created_by", "updated_at"])


def projects_show(args: argparse.Namespace) -> None:
    _print_json(_resolve_project(args.project))


def projects_create(args: argparse.Namespace) -> None:
    _ensure_db()
    p = project_service.create_project(
        name=args.name,
        created_by=_admin_id(),
        description=args.description,
        deadline=args.deadline,
    )
    print(f"Created project id={p['id']} name={p['name']}")


def projects_update(args: argparse.Namespace) -> None:
    p = _resolve_project(args.project)
    updated = project_service.update_project(
        p["id"],
        name=args.name,
        description=args.description,
        deadline=args.deadline,
        status=args.status,
    )
    _print_json(updated)


def projects_archive(args: argparse.Namespace) -> None:
    p = _resolve_project(args.project)
    project_service.delete_project(p["id"])
    print(f"Archived project id={p['id']} ({p['name']})")


def projects_delete(args: argparse.Namespace) -> None:
    if not args.force:
        raise SystemExit("Permanent delete requires --force")
    p = _resolve_project(args.project)
    project_service.hard_delete_project(p["id"])
    print(f"Deleted project id={p['id']} and all datasets/scenarios")


# ---------------------------------------------------------------------------
# assignments
# ---------------------------------------------------------------------------

def assignments_list(args: argparse.Namespace) -> None:
    p = _resolve_project(args.project)
    rows = project_service.list_project_assignments(p["id"])
    _print_rows(rows, ["user_id", "username", "display_name", "role", "user_role", "is_active", "assigned_at"])


def assignments_assign(args: argparse.Namespace) -> None:
    p = _resolve_project(args.project)
    u = _resolve_user(args.user)
    if project_service.get_assignment(p["id"], u["id"]):
        raise SystemExit("Already assigned")
    project_service.assign_user(p["id"], u["id"], _admin_id(), role=args.role)
    print(f"Assigned {u['username']} to project {p['name']} as {args.role}")


def assignments_unassign(args: argparse.Namespace) -> None:
    p = _resolve_project(args.project)
    u = _resolve_user(args.user)
    if not project_service.remove_assignment(p["id"], u["id"]):
        raise SystemExit("Assignment not found")
    print(f"Unassigned {u['username']} from {p['name']}")


# ---------------------------------------------------------------------------
# datasets
# ---------------------------------------------------------------------------

def datasets_list(args: argparse.Namespace) -> None:
    _ensure_db()
    project_id = None
    if args.project:
        project_id = _resolve_project(args.project)["id"]
    rows = db_service.list_datasets(username=args.username, project_id=project_id)
    _print_rows(rows, ["id", "name", "username", "project_id", "row_count", "upload_time"])


def datasets_show(args: argparse.Namespace) -> None:
    ds = db_service.get_dataset(int(args.id))
    if not ds:
        raise SystemExit(f"Dataset not found: {args.id}")
    meta = db_service.get_dataset_meta(int(args.id))
    _print_json({**ds, **meta})


def datasets_delete(args: argparse.Namespace) -> None:
    if not args.force:
        raise SystemExit("Delete requires --force")
    db_service.delete_dataset(int(args.id))
    print(f"Deleted dataset id={args.id}")


# ---------------------------------------------------------------------------
# scenarios
# ---------------------------------------------------------------------------

def scenarios_list(args: argparse.Namespace) -> None:
    rows = db_service.list_scenarios(int(args.dataset))
    _print_rows(rows, ["id", "dataset_id", "name", "is_promoted", "updated_at"])


def scenarios_show(args: argparse.Namespace) -> None:
    s = db_service.get_scenario(int(args.id))
    if not s:
        raise SystemExit(f"Scenario not found: {args.id}")
    _print_json(s)


def scenarios_delete(args: argparse.Namespace) -> None:
    if not args.force:
        raise SystemExit("Delete requires --force")
    db_service.delete_scenario(int(args.id))
    print(f"Deleted scenario id={args.id}")


# ---------------------------------------------------------------------------
# audit, tokens, locks
# ---------------------------------------------------------------------------

def audit_list(args: argparse.Namespace) -> None:
    rows = query_audit_log(
        user_id=args.user_id,
        action=args.action,
        resource_type=args.resource_type,
        limit=args.limit,
        offset=args.offset,
    )
    for r in rows:
        print(f"[{r.get('created_at')}] user={r.get('user_id')} {r.get('action')} "
              f"{r.get('resource_type')}:{r.get('resource_id')} {r.get('details_json', '')}")


def tokens_list(args: argparse.Namespace) -> None:
    _ensure_db()
    clauses, params = [], []
    if args.user:
        u = _resolve_user(args.user)
        clauses.append("user_id = ?")
        params.append(u["id"])
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with db_service._connect() as conn:
        rows = [dict(r) for r in conn.execute(
            f"SELECT id, user_id, expires_at, created_at, revoked_at FROM refresh_tokens{where} ORDER BY id DESC LIMIT ?",
            (*params, args.limit),
        ).fetchall()]
    _print_rows(rows, ["id", "user_id", "expires_at", "created_at", "revoked_at"])


def tokens_revoke(args: argparse.Namespace) -> None:
    u = _resolve_user(args.user)
    db_service.revoke_all_user_tokens(u["id"])
    print(f"Revoked all refresh tokens for {u['username']}")


def locks_list(args: argparse.Namespace) -> None:
    _ensure_db()
    with db_service._connect() as conn:
        if args.kind in ("project", "all"):
            rows = [dict(r) for r in conn.execute("SELECT * FROM project_locks").fetchall()]
            print("--- project_locks ---")
            _print_rows(rows, ["project_id", "user_id", "username", "acquired_at", "last_heartbeat"])
        if args.kind in ("dataset", "all"):
            rows = [dict(r) for r in conn.execute("SELECT * FROM dataset_locks").fetchall()]
            print("--- dataset_locks ---")
            _print_rows(rows, ["dataset_id", "project_id", "user_id", "username", "acquired_at", "last_heartbeat"])


def locks_clear(args: argparse.Namespace) -> None:
    _ensure_db()
    with db_service._connect() as conn:
        if args.kind == "project":
            conn.execute("DELETE FROM project_locks")
        elif args.kind == "dataset":
            conn.execute("DELETE FROM dataset_locks")
        else:
            conn.execute("DELETE FROM project_locks")
            conn.execute("DELETE FROM dataset_locks")
        conn.commit()
    print(f"Cleared {args.kind} locks")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="OrgSight DB manager (CRUD)")
    sub = parser.add_subparsers(dest="entity", required=True)

    p_tables = sub.add_parser("tables", help="Row counts for all tables")
    p_tables.set_defaults(func=cmd_tables)

    p_sql = sub.add_parser("sql", help="Run raw SQL (SELECT or mutating)")
    p_sql.add_argument("query")
    p_sql.set_defaults(func=cmd_sql)

    # --- users ---
    pu = sub.add_parser("users", help="User CRUD")
    su = pu.add_subparsers(dest="action", required=True)

    su.add_parser("list").set_defaults(func=users_list)
    p = su.add_parser("show"); p.add_argument("user"); p.set_defaults(func=users_show)
    p = su.add_parser("create")
    p.add_argument("username"); p.add_argument("password")
    p.add_argument("--role", default="member", choices=("admin", "member"))
    p.add_argument("--display-name", default=None)
    p.add_argument("--no-registry", action="store_true")
    p.set_defaults(func=users_create)
    p = su.add_parser("update"); p.add_argument("user")
    p.add_argument("--display-name"); p.add_argument("--role", choices=("admin", "member"))
    p.add_argument("--active", choices=("yes", "no"))
    p.add_argument("--password"); p.add_argument("--force-change", action="store_true")
    p.add_argument("--no-registry", action="store_true")
    p.set_defaults(func=users_update)
    p = su.add_parser("set-password"); p.add_argument("user"); p.add_argument("password")
    p.add_argument("--no-registry", action="store_true")
    p.set_defaults(func=users_set_password)
    p = su.add_parser("deactivate"); p.add_argument("user"); p.set_defaults(func=users_deactivate)
    p = su.add_parser("activate"); p.add_argument("user"); p.set_defaults(func=users_activate)
    p = su.add_parser("delete"); p.add_argument("user"); p.add_argument("--force", action="store_true")
    p.set_defaults(func=users_delete)
    su.add_parser("registry").set_defaults(func=users_registry)
    p = su.add_parser("sync"); p.add_argument("--dry-run", action="store_true"); p.set_defaults(func=users_sync)

    # --- projects ---
    pp = sub.add_parser("projects", help="Project CRUD")
    sp = pp.add_subparsers(dest="action", required=True)
    sp.add_parser("list").set_defaults(func=projects_list)
    p = sp.add_parser("show"); p.add_argument("project"); p.set_defaults(func=projects_show)
    p = sp.add_parser("create"); p.add_argument("name")
    p.add_argument("--description"); p.add_argument("--deadline")
    p.set_defaults(func=projects_create)
    p = sp.add_parser("update"); p.add_argument("project")
    p.add_argument("--name"); p.add_argument("--description"); p.add_argument("--deadline")
    p.add_argument("--status", choices=("active", "archived", "closed"))
    p.set_defaults(func=projects_update)
    p = sp.add_parser("archive"); p.add_argument("project"); p.set_defaults(func=projects_archive)
    p = sp.add_parser("delete"); p.add_argument("project"); p.add_argument("--force", action="store_true")
    p.set_defaults(func=projects_delete)

    # --- assignments ---
    pa = sub.add_parser("assignments", help="Project assignment CRUD")
    sa = pa.add_subparsers(dest="action", required=True)
    p = sa.add_parser("list"); p.add_argument("--project", required=True); p.set_defaults(func=assignments_list)
    p = sa.add_parser("assign"); p.add_argument("--project", required=True); p.add_argument("--user", required=True)
    p.add_argument("--role", default="member"); p.set_defaults(func=assignments_assign)
    p = sa.add_parser("unassign"); p.add_argument("--project", required=True); p.add_argument("--user", required=True)
    p.set_defaults(func=assignments_unassign)

    # --- datasets ---
    pd = sub.add_parser("datasets", help="Dataset CRUD")
    sd = pd.add_subparsers(dest="action", required=True)
    p = sd.add_parser("list")
    p.add_argument("--project"); p.add_argument("--username")
    p.set_defaults(func=datasets_list)
    p = sd.add_parser("show"); p.add_argument("id", type=int); p.set_defaults(func=datasets_show)
    p = sd.add_parser("delete"); p.add_argument("id", type=int); p.add_argument("--force", action="store_true")
    p.set_defaults(func=datasets_delete)

    # --- scenarios ---
    ps = sub.add_parser("scenarios", help="Scenario CRUD")
    ss = ps.add_subparsers(dest="action", required=True)
    p = ss.add_parser("list"); p.add_argument("--dataset", required=True, type=int); p.set_defaults(func=scenarios_list)
    p = ss.add_parser("show"); p.add_argument("id", type=int); p.set_defaults(func=scenarios_show)
    p = ss.add_parser("delete"); p.add_argument("id", type=int); p.add_argument("--force", action="store_true")
    p.set_defaults(func=scenarios_delete)

    # --- audit ---
    pau = sub.add_parser("audit", help="Audit log (read)")
    sau = pau.add_subparsers(dest="action", required=True)
    p = sau.add_parser("list")
    p.add_argument("--user-id", type=int)
    p.add_argument("--action")
    p.add_argument("--resource-type")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--offset", type=int, default=0)
    p.set_defaults(func=audit_list)

    # --- tokens ---
    pt = sub.add_parser("tokens", help="Refresh tokens")
    st = pt.add_subparsers(dest="action", required=True)
    p = st.add_parser("list"); p.add_argument("--user"); p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=tokens_list)
    p = st.add_parser("revoke"); p.add_argument("--user", required=True); p.set_defaults(func=tokens_revoke)

    # --- locks ---
    pl = sub.add_parser("locks", help="Project/dataset locks")
    sl = pl.add_subparsers(dest="action", required=True)
    p = sl.add_parser("list"); p.add_argument("--kind", default="all", choices=("project", "dataset", "all"))
    p.set_defaults(func=locks_list)
    p = sl.add_parser("clear"); p.add_argument("--kind", default="all", choices=("project", "dataset", "all"))
    p.set_defaults(func=locks_clear)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
