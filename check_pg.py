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

cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
print('Tables in', os.getenv('PGDATABASE'), ':')
for row in cur.fetchall():
    print(' ', row[0])

print()
try:
    cur.execute("SELECT version FROM schema_version")
    print('schema_version:', cur.fetchone())
except Exception as e:
    print('schema_version query failed:', e)

conn.close()