import sqlite3
import psycopg
from dotenv import load_dotenv
import os

SQLITE_PATH = r"org_lvl_analysis_backend\org_lvl_analysis_backend\db\orgsight.db"

tables = [
    "users",
    "refresh_tokens",
    "projects",
    "project_assignments",
    "datasets",
    "baseline_records",
    "scenarios",
    "scenario_records",
    "change_log",
    "audit_log",
    "dataset_user_views",
    "project_locks",
    "dataset_locks",
    "schema_version",
]

# SQLite counts
sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_cur = sqlite_conn.cursor()
sqlite_counts = {}
for table in tables:
    try:
        sqlite_cur.execute(f"SELECT COUNT(*) FROM {table}")
        sqlite_counts[table] = sqlite_cur.fetchone()[0]
    except sqlite3.OperationalError:
        sqlite_counts[table] = None
sqlite_conn.close()

# Postgres counts
load_dotenv('POSTGRES/.env')
pg_conn = psycopg.connect(
    host=os.getenv('PGHOST'),
    port=os.getenv('PGPORT'),
    user=os.getenv('PGUSER'),
    password=os.getenv('PGPASSWORD'),
    dbname=os.getenv('PGDATABASE'),
    sslmode='require'
)
pg_cur = pg_conn.cursor()
pg_counts = {}
for table in tables:
    try:
        pg_cur.execute(f"SELECT COUNT(*) FROM {table}")
        pg_counts[table] = pg_cur.fetchone()[0]
    except Exception:
        pg_counts[table] = None
pg_conn.close()

# Print comparison
print(f"{'Table':<25} {'SQLite':>10} {'Postgres':>10} {'Remaining':>12}")
print("-" * 60)
for table in tables:
    s = sqlite_counts.get(table)
    p = pg_counts.get(table)
    if s is None or p is None:
        print(f"{table:<25} {'?':>10} {'?':>10} {'?':>12}")
    else:
        remaining = s - p
        marker = "  ✓" if remaining == 0 else f"  {remaining:,}"
        print(f"{table:<25} {s:>10,} {p:>10,} {marker:>12}")

# SQLite file size
size_mb = os.path.getsize(SQLITE_PATH) / (1024 * 1024)
print(f"\nSQLite file size: {size_mb:.1f} MB")