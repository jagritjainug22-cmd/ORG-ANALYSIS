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
cur = conn.cursor()

print("Active connections to OrgSight_db:")
cur.execute("""
    SELECT pid, application_name, state, query_start, 
           LEFT(query, 80) as recent_query
    FROM pg_stat_activity 
    WHERE datname = %s AND pid <> pg_backend_pid()
""", (os.getenv('PGDATABASE'),))
for row in cur.fetchall():
    print(' ', row)

print()
print("Advisory locks held:")
cur.execute("""
    SELECT pid, locktype, mode, granted, objid
    FROM pg_locks 
    WHERE locktype = 'advisory'
""")
locks = cur.fetchall()
if locks:
    for row in locks:
        print(' ', row)
else:
    print('  None')

conn.close()