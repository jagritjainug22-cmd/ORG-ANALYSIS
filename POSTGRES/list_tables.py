from db import connect

QUERY = """
SELECT
    n.nspname                                       AS schema,
    c.relname                                       AS table_name,
    c.reltuples::bigint                             AS approx_rows,
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = n.nspname
         AND table_name   = c.relname)              AS columns
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'                               -- ordinary tables
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname;
"""

with connect() as conn, conn.cursor() as cur:
    cur.execute(QUERY)
    rows = cur.fetchall()

if not rows:
    print("(no user tables in this database)")
else:
    print(f"{'schema':<15} {'table':<35} {'approx_rows':>12} {'columns':>8}")
    print("-" * 75)
    for schema, table, n_rows, n_cols in rows:
        print(f"{schema:<15} {table:<35} {n_rows:>12} {n_cols:>8}")
    print(f"\nTotal tables: {len(rows)}")
    