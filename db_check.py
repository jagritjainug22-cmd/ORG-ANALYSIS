import sqlite3
import json
from pathlib import Path

DB = Path(__file__).parent / "org_lvl_analysis_backend" / "org_lvl_analysis_backend" / "db" / "orgsight.db"

if not DB.exists():
    print(f"Database not found at: {DB}")
    print("It will be created once you upload your first dataset.")
    exit()

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

print("=" * 60)
print("  OrgSight Database Inspector")
print("=" * 60)

print("\n--- TABLES ---")
tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
for t in tables:
    count = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"  {t}: {count} rows")

print("\n--- DATASETS ---")
datasets = conn.execute("SELECT id, name, username, row_count, upload_time FROM datasets").fetchall()
if not datasets:
    print("  (none)")
else:
    for r in datasets:
        print(f"  [{r['id']}] \"{r['name']}\" by {r['username']} ({r['row_count']} rows, uploaded {r['upload_time']})")

print("\n--- SCENARIOS ---")
scenarios = conn.execute("SELECT id, dataset_id, name, is_promoted, updated_at FROM scenarios").fetchall()
if not scenarios:
    print("  (none)")
else:
    for r in scenarios:
        promoted = " [PROMOTED]" if r["is_promoted"] else ""
        print(f"  [{r['id']}] dataset={r['dataset_id']} \"{r['name']}\"{promoted} (updated {r['updated_at']})")

print("\n--- RECENT CHANGES (last 10) ---")
changes = conn.execute(
    "SELECT action, emp_id, old_mgr_id, new_mgr_id, field, old_value, new_value, timestamp, username "
    "FROM change_log ORDER BY id DESC LIMIT 10"
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
sample = conn.execute("SELECT emp_id, mgr_id, level, fte, flc FROM baseline_records LIMIT 5").fetchall()
if not sample:
    print("  (none)")
else:
    print(f"  {'emp_id':<15} {'mgr_id':<15} {'level':<6} {'fte':<8} {'flc':<10}")
    print(f"  {'-'*15} {'-'*15} {'-'*6} {'-'*8} {'-'*10}")
    for r in sample:
        print(f"  {str(r['emp_id'] or ''):<15} {str(r['mgr_id'] or ''):<15} {str(r['level'] or ''):<6} {str(r['fte'] or ''):<8} {str(r['flc'] or ''):<10}")

conn.close()
print("\n" + "=" * 60)
print("  Done. Run any SQL manually with:")
print("  python -i -c \"import sqlite3; conn = sqlite3.connect(r'" + str(DB) + "'); conn.row_factory = sqlite3.Row\"")
print("=" * 60)
