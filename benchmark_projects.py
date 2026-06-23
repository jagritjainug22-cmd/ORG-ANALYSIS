import os
import sys
import time
import psycopg
from dotenv import load_dotenv

# Load Postgres environment variables
dotenv_path = r"c:\Users\jagritjain\OneDrive - Alvarez and Marsal\Documents\APPS\ORG_ANALYSIS\POSTGRES\.env"
load_dotenv(dotenv_path)

conn_str = f"host={os.getenv('PGHOST')} port={os.getenv('PGPORT')} user={os.getenv('PGUSER')} password={os.getenv('PGPASSWORD')} dbname={os.getenv('PGDATABASE')} sslmode=require"

def run_current_queries(cur, user_id, is_admin):
    # 1. Fetch projects
    if is_admin:
        cur.execute("SELECT * FROM projects ORDER BY created_at DESC")
    else:
        cur.execute("""
            SELECT p.*, pa.role AS assignment_role, pa.assigned_at
            FROM projects p
            JOIN project_assignments pa ON p.id = pa.project_id
            WHERE pa.user_id = %s AND p.status = 'active'
            ORDER BY p.updated_at DESC
        """, (user_id,))
    projects = cur.fetchall()
    
    if not projects:
        return []

    project_ids = [p["id"] for p in projects]
    placeholders = ", ".join(map(str, project_ids))

    # 2. Get locks (simulating lock_service.get_all_locks)
    # We include the cleanup DELETE query since it runs on every get_all_locks call
    cutoff = "2026-06-23T12:00:00"  # Dummy cutoff
    cur.execute("DELETE FROM project_locks WHERE last_heartbeat < %s", (cutoff,))
    cur.execute("SELECT * FROM project_locks")
    locks = {r["project_id"]: r for r in cur.fetchall()}

    # 3. Get overview (simulating get_projects_overview)
    # Query 3.1: Get assignments
    cur.execute(f"""
        SELECT pa.project_id, pa.role, pa.assigned_at,
               u.id AS user_id, u.username, u.display_name, u.is_active
        FROM project_assignments pa
        JOIN users u ON pa.user_id = u.id
        WHERE pa.project_id IN ({placeholders})
        ORDER BY pa.project_id, pa.assigned_at
    """)
    members = cur.fetchall()

    # Query 3.2: Get dataset counts
    cur.execute(f"""
        SELECT project_id, COUNT(*) AS n
        FROM datasets
        WHERE project_id IN ({placeholders})
        GROUP BY project_id
    """)
    datasets = {r["project_id"]: r["n"] for r in cur.fetchall()}

    # Merge results
    result = []
    for p in projects:
        lock = locks.get(p["id"])
        ds_count = datasets.get(p["id"], 0)
        p_members = [m for m in members if m["project_id"] == p["id"]]
        entry = {
            **p,
            "locked_by": lock["username"] if lock else None,
            "locked_by_id": lock["user_id"] if lock else None,
            "member_count": len(p_members),
            "members_preview": p_members[:5],
            "dataset_count": ds_count
        }
        result.append(entry)
    return result


def run_optimised_queries(cur, user_id, is_admin):
    # Query 1: Consolidated metadata, locks, dataset count and member count in ONE query
    if is_admin:
        project_query = """
            SELECT 
              p.*,
              pl.username as locked_by,
              pl.user_id as locked_by_id,
              COALESCE(ds.dataset_count, 0) as dataset_count,
              COALESCE(mem.member_count, 0) as member_count
            FROM projects p
            LEFT JOIN project_locks pl ON p.id = pl.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as dataset_count FROM datasets GROUP BY project_id
            ) ds ON p.id = ds.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as member_count FROM project_assignments GROUP BY project_id
            ) mem ON p.id = mem.project_id
            ORDER BY p.created_at DESC
        """
        cur.execute(project_query)
    else:
        project_query = """
            SELECT 
              p.*,
              pa.role AS assignment_role, pa.assigned_at as assigned_at_time,
              pl.username as locked_by,
              pl.user_id as locked_by_id,
              COALESCE(ds.dataset_count, 0) as dataset_count,
              COALESCE(mem.member_count, 0) as member_count
            FROM projects p
            JOIN project_assignments pa ON p.id = pa.project_id
            LEFT JOIN project_locks pl ON p.id = pl.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as dataset_count FROM datasets GROUP BY project_id
            ) ds ON p.id = ds.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as member_count FROM project_assignments GROUP BY project_id
            ) mem ON p.id = mem.project_id
            WHERE pa.user_id = %s AND p.status = 'active'
            ORDER BY p.updated_at DESC
        """
        cur.execute(project_query, (user_id,))
        
    projects = cur.fetchall()
    if not projects:
        return []

    # Query 2: Fetch only the first 5 active members for previews in a single batch using ROW_NUMBER()
    project_ids = [p["id"] for p in projects]
    placeholders = ", ".join(map(str, project_ids))
    
    preview_query = f"""
        WITH RankedMembers AS (
            SELECT 
              pa.project_id, pa.role, pa.assigned_at,
              u.id AS user_id, u.username, u.display_name, u.is_active,
              ROW_NUMBER() OVER(PARTITION BY pa.project_id ORDER BY pa.assigned_at) as rn
            FROM project_assignments pa
            JOIN users u ON pa.user_id = u.id
            WHERE pa.project_id IN ({placeholders}) AND u.is_active = 1
        )
        SELECT * FROM RankedMembers WHERE rn <= 5;
    """
    cur.execute(preview_query)
    previews = cur.fetchall()

    # Merge results
    result = []
    for p in projects:
        p_previews = [m for m in previews if m["project_id"] == p["id"]]
        entry = {
            **p,
            "members_preview": p_previews
        }
        result.append(entry)
    return result


try:
    conn = psycopg.connect(conn_str)
    # Use autocommit for clean read execution
    conn.autocommit = True
    conn.row_factory = psycopg.rows.dict_row
    cur = conn.cursor()

    # Find a test user (prefer admin for full projects list)
    cur.execute("SELECT id, username, role FROM users WHERE role = 'admin' LIMIT 1")
    user = cur.fetchone()
    if not user:
        cur.execute("SELECT id, username, role FROM users LIMIT 1")
        user = cur.fetchone()
    
    if not user:
        print("No users found.")
        sys.exit(0)

    user_id = user["id"]
    is_admin = user["role"] == "admin"
    print(f"Benchmarking project loading for user '{user['username']}' (admin={is_admin}):")

    # Warmup runs
    run_current_queries(cur, user_id, is_admin)
    run_optimised_queries(cur, user_id, is_admin)

    # 1. Benchmark Current Approach (average of 10 runs)
    current_times = []
    for _ in range(10):
        t0 = time.perf_counter()
        run_current_queries(cur, user_id, is_admin)
        current_times.append(time.perf_counter() - t0)
    avg_current = sum(current_times) / len(current_times) * 1000

    # 2. Benchmark Optimised Approach (average of 10 runs)
    opt_times = []
    for _ in range(10):
        t0 = time.perf_counter()
        run_optimised_queries(cur, user_id, is_admin)
        opt_times.append(time.perf_counter() - t0)
    avg_opt = sum(opt_times) / len(opt_times) * 1000

    print("\nBenchmark Results (Average of 10 runs):")
    print("-" * 50)
    print(f"Current Queries Latency   : {avg_current:.2f} ms  (5 DB calls, incl. write transaction)")
    print(f"Optimised Queries Latency : {avg_opt:.2f} ms  (2 DB calls, read-only)")
    print(f"Latency Improvement       : {avg_current - avg_opt:.2f} ms  ({((avg_current - avg_opt) / avg_current) * 100:.1f}% faster)")
    print("-" * 50)

    conn.close()

except Exception as e:
    print("Error executing benchmark:", e)
