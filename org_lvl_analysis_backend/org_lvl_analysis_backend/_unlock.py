"""Check and clear any stale pg_advisory_locks from killed backends."""
import os
from pathlib import Path
from dotenv import load_dotenv

repo_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(repo_root / "POSTGRES" / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env")

import psycopg
from psycopg.rows import dict_row

conninfo = (
    f"host={os.environ['PGHOST']} port={os.environ['PGPORT']} "
    f"dbname={os.environ['PGDATABASE']} user={os.environ['PGUSER']} "
    f"password={os.environ['PGPASSWORD']} "
    f"sslmode={os.environ.get('PGSSLMODE', 'require')} connect_timeout=5"
)

with psycopg.connect(conninfo, row_factory=dict_row) as conn:
    # Check advisory locks
    locks = conn.execute("""
        SELECT l.pid, l.granted, l.classid, l.objid, a.state, left(a.query, 80) AS q
        FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory'
    """).fetchall()
    print(f"Advisory locks: {len(locks)}")
    for r in locks:
        print(f"  pid={r['pid']} granted={r['granted']} objid={r['objid']} state={r['state']}")
        print(f"    {r['q']}")

    # Terminate all backends except ours that are blocking with advisory locks
    if locks:
        print("\nTerminating backends holding advisory locks...")
        for r in locks:
            if r['pid'] != conn.info.backend_pid:
                result = conn.execute("SELECT pg_terminate_backend(%s)", (r['pid'],)).fetchone()
                print(f"  Terminated pid={r['pid']}: {result}")
        conn.commit()
    else:
        print("No advisory locks found.")

    # Also check all connections
    all_conns = conn.execute("""
        SELECT pid, state, wait_event_type, wait_event, left(query, 60) AS q
        FROM pg_stat_activity WHERE datname = 'OrgSight_db'
        ORDER BY state
    """).fetchall()
    print(f"\nAll connections to OrgSight_db ({len(all_conns)}):")
    for r in all_conns:
        print(f"  pid={r['pid']} state={r['state']} wait={r['wait_event_type']}/{r['wait_event']}: {r['q']}")
