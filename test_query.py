import os
import sys
import time
import psycopg
from dotenv import load_dotenv

# Load Postgres environment variables
dotenv_path = r"c:\Users\jagritjain\OneDrive - Alvarez and Marsal\Documents\APPS\ORG_ANALYSIS\POSTGRES\.env"
load_dotenv(dotenv_path)

conn_str = f"host={os.getenv('PGHOST')} port={os.getenv('PGPORT')} user={os.getenv('PGUSER')} password={os.getenv('PGPASSWORD')} dbname={os.getenv('PGDATABASE')} sslmode=require"

try:
    conn = psycopg.connect(conn_str)
    conn.row_factory = psycopg.rows.dict_row
    cur = conn.cursor()
    
    # 1. Get the 3 most recent dataset IDs
    cur.execute("SELECT id, name FROM datasets ORDER BY upload_time DESC LIMIT 3")
    datasets = cur.fetchall()
    if not datasets:
        print("No datasets found in database.")
        sys.exit(0)
    
    dataset_ids = [d["id"] for d in datasets]
    dataset_names = {d["id"]: d["name"] for d in datasets}
    print(f"Testing query on datasets: {dataset_names}\n")
    
    # 2. Construct the query
    ids_str = ", ".join(map(str, dataset_ids))
    query = f"""
    WITH RankedRecords AS (
      SELECT 
        dataset_id, 
        level, 
        emp_id, 
        data_json,
        ROW_NUMBER() OVER(PARTITION BY dataset_id, level ORDER BY id) as rn
      FROM baseline_records
      WHERE dataset_id IN ({ids_str}) 
        AND level IN (1, 2)
    ),
    Level2Counts AS (
      SELECT 
        dataset_id, 
        COUNT(*) as total_children
      FROM baseline_records
      WHERE dataset_id IN ({ids_str}) AND level = 2
      GROUP BY dataset_id
    )
    SELECT 
      r.dataset_id,
      r.level,
      r.emp_id,
      substring(r.data_json from 1 for 60) as data_json_prefix,
      COALESCE(c.total_children, 0) as total_children
    FROM RankedRecords r
    LEFT JOIN Level2Counts c ON r.dataset_id = c.dataset_id
    WHERE (r.level = 1 AND r.rn = 1)
       OR (r.level = 2 AND r.rn <= 4)
    ORDER BY r.dataset_id, r.level, r.rn;
    """
    
    # Measure execution time
    start_time = time.perf_counter()
    cur.execute(query)
    rows = cur.fetchall()
    end_time = time.perf_counter()
    
    print(f"Query returned {len(rows)} rows in {(end_time - start_time) * 1000:.2f} ms:")
    print("-" * 80)
    for r in rows:
        print(f"Dataset: {r['dataset_id']} ({dataset_names[r['dataset_id']]}) | Level: {r['level']} | Emp ID: {r['emp_id']} | L2 Total Count: {r['total_children']} | Data JSON Preview: {r['data_json_prefix']}...")
    print("-" * 80)
    
    conn.close()

except Exception as e:
    print("Error executing query:", e)
