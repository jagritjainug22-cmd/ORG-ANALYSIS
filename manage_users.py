"""
OrgSight user credentials helper (dev/local use).

Passwords in orgsight.db are Argon2 hashes — they cannot be read back.
This script:
  - lists users from the database
  - resets or creates users
  - keeps a local plaintext registry (credentials.local.json) when you set passwords

Usage (from repo root):
  python manage_users.py list
  python manage_users.py show jagrit.m
  python manage_users.py set jagrit.m MyNewPass123!
  python manage_users.py create new.user TempPass123! --role member
  python manage_users.py registry              # show saved local credentials
  python manage_users.py sync                  # apply registry -> database
  python manage_users.py sync --dry-run        # preview sync only
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "org_lvl_analysis_backend" / "org_lvl_analysis_backend"
REGISTRY_PATH = BACKEND_DIR / "db" / "credentials.local.json"

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / "POSTGRES" / ".env")
load_dotenv(BACKEND_DIR / ".env")

sys.path.insert(0, str(BACKEND_DIR))

from services import db_service  # noqa: E402
from services.pg_adapter import REQUIRED_DATABASE  # noqa: E402
from services.user_service import hash_password  # noqa: E402


def _load_registry() -> dict:
    if not REGISTRY_PATH.exists():
        return {}
    with REGISTRY_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise SystemExit(f"Invalid registry format in {REGISTRY_PATH}")
    return data


def _save_registry(registry: dict) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_note": "Dev-only plaintext passwords. Do NOT commit. Argon2 hashes live in orgsight.db.",
        "_updated_at": datetime.now(timezone.utc).isoformat(),
        "users": registry,
    }
    with REGISTRY_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def _record_password(username: str, password: str) -> None:
    registry = _load_registry()
    if "_note" in registry or "_updated_at" in registry:
        users = registry.get("users", {})
    else:
        users = registry
    users[username] = password
    _save_registry(users)


def _ensure_db() -> None:
    try:
        with db_service._connect() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception as exc:
        raise SystemExit(
            f"Cannot connect to PostgreSQL database '{REQUIRED_DATABASE}': {exc}\n"
            "Check POSTGRES/.env and start the backend once to run init_db()."
        ) from exc


def cmd_list(_: argparse.Namespace) -> None:
    _ensure_db()
    with db_service._connect() as conn:
        rows = conn.execute(
            """
            SELECT id, username, display_name, role, is_active, must_change_password,
                   created_at, updated_at
            FROM users
            ORDER BY role DESC, username
            """
        ).fetchall()

    registry_users = {}
    if REGISTRY_PATH.exists():
        raw = _load_registry()
        registry_users = raw.get("users", raw) if isinstance(raw, dict) else {}

    print(f"\nDatabase: {REQUIRED_DATABASE}")
    print(f"Registry: {REGISTRY_PATH} ({'found' if REGISTRY_PATH.exists() else 'missing'})\n")
    print(f"{'ID':<4} {'Username':<22} {'Role':<8} {'Active':<7} {'ChgPwd':<7} {'Registry pwd':<14} Display")
    print("-" * 95)
    for r in rows:
        reg_pwd = "yes" if r["username"] in registry_users else "-"
        print(
            f"{r['id']:<4} {r['username']:<22} {r['role']:<8} "
            f"{'yes' if r['is_active'] else 'no':<7} "
            f"{'yes' if r['must_change_password'] else 'no':<7} "
            f"{reg_pwd:<14} {r['display_name'] or ''}"
        )
    print(f"\n{len(rows)} user(s). Hashes in DB cannot be reversed to plaintext.\n")


def cmd_show(args: argparse.Namespace) -> None:
    _ensure_db()
    user = db_service.get_user_by_username(args.username)
    if not user:
        raise SystemExit(f"User not found: {args.username}")

    registry = _load_registry()
    users = registry.get("users", registry) if isinstance(registry, dict) else registry
    saved = users.get(args.username)

    print(json.dumps(
        {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "is_active": bool(user["is_active"]),
            "must_change_password": bool(user["must_change_password"]),
            "created_at": user["created_at"],
            "updated_at": user["updated_at"],
            "registry_password": saved if saved else "(not in credentials.local.json)",
        },
        indent=2,
    ))


def cmd_set(args: argparse.Namespace) -> None:
    _ensure_db()
    if len(args.password) < 8:
        raise SystemExit("Password must be at least 8 characters.")

    user = db_service.get_user_by_username(args.username)
    if not user:
        raise SystemExit(f"User not found: {args.username}")

    db_service.update_user_password(user["id"], hash_password(args.password), clear_must_change=True)
    if not args.no_registry:
        _record_password(args.username, args.password)

    print(f"Password updated for {args.username}")
    if not args.no_registry:
        print(f"Saved to {REGISTRY_PATH}")


def cmd_create(args: argparse.Namespace) -> None:
    _ensure_db()
    if len(args.password) < 8:
        raise SystemExit("Password must be at least 8 characters.")
    if args.role not in ("admin", "member"):
        raise SystemExit("Role must be 'admin' or 'member'")

    existing = db_service.get_user_by_username(args.username)
    if existing:
        raise SystemExit(f"User already exists: {args.username} (use 'set' to change password)")

    db_service.create_user(
        username=args.username,
        password_hash=hash_password(args.password),
        display_name=args.display_name or args.username,
        role=args.role,
    )
    if not args.no_registry:
        _record_password(args.username, args.password)

    print(f"Created user {args.username} (role={args.role})")
    if not args.no_registry:
        print(f"Saved to {REGISTRY_PATH}")


def cmd_registry(_: argparse.Namespace) -> None:
    if not REGISTRY_PATH.exists():
        print(f"No registry file at {REGISTRY_PATH}")
        print("Run: python manage_users.py set <username> <password>")
        return

    with REGISTRY_PATH.open(encoding="utf-8") as f:
        print(f.read())


def cmd_sync(args: argparse.Namespace) -> None:
    _ensure_db()
    if not REGISTRY_PATH.exists():
        raise SystemExit(f"Registry not found: {REGISTRY_PATH}")

    raw = _load_registry()
    users = raw.get("users", raw) if isinstance(raw, dict) else raw
    if not users:
        print("Registry is empty.")
        return

    for username, password in users.items():
        if username.startswith("_"):
            continue
        if not isinstance(password, str) or len(password) < 8:
            print(f"  SKIP {username}: password must be a string with 8+ chars")
            continue

        user = db_service.get_user_by_username(username)
        if not user:
            print(f"  SKIP {username}: not in database")
            continue

        if args.dry_run:
            print(f"  WOULD update {username}")
            continue

        db_service.update_user_password(user["id"], hash_password(password), clear_must_change=True)
        print(f"  OK {username}")

    if args.dry_run:
        print("\nDry run only — no changes written.")
    else:
        print("\nSync complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="OrgSight user & credentials manager")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="List all users (DB + registry hint)")

    p_show = sub.add_parser("show", help="Show one user + registry password if saved")
    p_show.add_argument("username")

    p_set = sub.add_parser("set", help="Set password in DB and registry")
    p_set.add_argument("username")
    p_set.add_argument("password")
    p_set.add_argument("--no-registry", action="store_true", help="Do not write credentials.local.json")

    p_create = sub.add_parser("create", help="Create user in DB and registry")
    p_create.add_argument("username")
    p_create.add_argument("password")
    p_create.add_argument("--role", default="member", choices=("admin", "member"))
    p_create.add_argument("--display-name", default=None)
    p_create.add_argument("--no-registry", action="store_true")

    sub.add_parser("registry", help="Print credentials.local.json")

    p_sync = sub.add_parser("sync", help="Apply all registry passwords to database")
    p_sync.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()
    handlers = {
        "list": cmd_list,
        "show": cmd_show,
        "set": cmd_set,
        "create": cmd_create,
        "registry": cmd_registry,
        "sync": cmd_sync,
    }
    handlers[args.command](args)


if __name__ == "__main__":
    main()
