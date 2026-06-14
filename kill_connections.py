import psycopg
from dotenv import load_dotenv
import os

load_dotenv('POSTGRES/.env')

conn = psycopg.connect(
    host=os.getenv('PGHOST'),
    port=os.getenv('PGPORT'),
    user=os.getenv('PGUSER'),
    password=os.getenv('PGPASSWORD'),
    dbname=os.getenv('PGDATABASE'),
    sslmode='require'
)
conn.autocommit = True
cur = conn.cursor()

print("Terminating stale connections to OrgSight_db...")
cur.execute("""
    SELECT pg_terminate_backend(pid), pid, state, LEFT(query, 60) as query
    FROM pg_stat_activity 
    WHERE datname = %s AND pid <> pg_backend_pid()
""", (os.getenv('PGDATABASE'),))
for row in cur.fetchall():
    print(' ', row)

conn.close()
print("\nDone. Now check again:")