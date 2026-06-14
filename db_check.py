import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "org_lvl_analysis_backend" / "org_lvl_analysis_backend"

load_dotenv(REPO_ROOT / "POSTGRES" / ".env")
load_dotenv(BACKEND_DIR / ".env")

sys.path.insert(0, str(BACKEND_DIR))

from services import db_service  # noqa: E402
from services.pg_adapter import REQUIRED_DATABASE  # noqa: E402

try:
    with db_service._connect() as conn:
        conn.execute("SELECT 1").fetchone()
except Exception as exc:
    print(f"Cannot connect to PostgreSQL database '{REQUIRED_DATABASE}': {exc}")
    print("Check POSTGRES/.env and network/SSL settings.")
    sys.exit(1)

with db_service._connect() as conn:
    print("=" * 60)
    print("  OrgSight Database Inspector (PostgreSQL)")
    print("=" * 60)

    print(f"\nDatabase: {REQUIRED_DATABASE}")

    print("\n--- TABLES ---")
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
    for t in tables:
        count = conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"]
        print(f"  {t}: {count} rows")

    print("\n--- DATASETS ---")
    datasets = conn.execute(
        "SELECT id, name, username, row_count, upload_time FROM datasets"
    ).fetchall()
    if not datasets:
        print("  (none)")
    else:
        for r in datasets:
            print(
                f"  [{r['id']}] \"{r['name']}\" by {r['username']} "
                f"({r['row_count']} rows, uploaded {r['upload_time']})"
            )

    print("\n--- SCENARIOS ---")
    scenarios = conn.execute(
        "SELECT id, dataset_id, name, is_promoted, updated_at FROM scenarios"
    ).fetchall()
    if not scenarios:
        print("  (none)")
    else:
        for r in scenarios:
            promoted = " [PROMOTED]" if r["is_promoted"] else ""
            print(
                f"  [{r['id']}] dataset={r['dataset_id']} \"{r['name']}\"{promoted} "
                f"(updated {r['updated_at']})"
            )

    print("\n--- RECENT CHANGES (last 10) ---")
    changes = conn.execute(
        """
        SELECT action, emp_id, old_mgr_id, new_mgr_id, field, old_value, new_value,
               timestamp, username
        FROM change_log ORDER BY id DESC LIMIT 10
        """
    ).fetchall()
    if not changes:
        print("  (none)")
    else:
        for r in changes:
            parts = [f"{r['action']}"]
            if r["emp_id"]:
                parts.append(f"emp={r['emp_id']}")
            if r["action"] == "move":
                parts.append(f"{r['old_mgr_id']} -> {r['new_mgr_id']}")
            elif r["action"] == "edit":
                parts.append(f"{r['field']}: {r['old_value']} -> {r['new_value']}")
            if r["username"]:
                parts.append(f"by {r['username']}")
            parts.append(f"@ {r['timestamp']}")
            print(f"  {' | '.join(parts)}")

    print("\n--- BASELINE SAMPLE (first 5 records) ---")
    sample = conn.execute(
        "SELECT emp_id, mgr_id, level, fte, flc FROM baseline_records LIMIT 5"
    ).fetchall()
    if not sample:
        print("  (none)")
    else:
        print(f"  {'emp_id':<15} {'mgr_id':<15} {'level':<6} {'fte':<8} {'flc':<10}")
        print(f"  {'-'*15} {'-'*15} {'-'*6} {'-'*8} {'-'*10}")
        for r in sample:
            print(
                f"  {str(r['emp_id'] or ''):<15} {str(r['mgr_id'] or ''):<15} "
                f"{str(r['level'] or ''):<6} {str(r['fte'] or ''):<8} {str(r['flc'] or ''):<10}"
            )

print("\n" + "=" * 60)
print("  Done.")
print("=" * 60)
