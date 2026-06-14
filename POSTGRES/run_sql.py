import sys
from pathlib import Path
from db import connect

def get_sql() -> str:
    """Get SQL from: file arg, --sql arg, or interactive paste."""
    if len(sys.argv) >= 2 and sys.argv[1].endswith(".sql"):
        return Path(sys.argv[1]).read_text()
    if len(sys.argv) >= 3 and sys.argv[1] == "--sql":
        return sys.argv[2]
    print("Paste SQL, end with a line containing only ';;' then Enter:")
    lines = []
    for line in sys.stdin:
        if line.strip() == ";;":
            break
        lines.append(line)
    return "".join(lines)

def print_table(headers, rows, max_col_width: int = 60):
    """Minimal pretty printer — no external deps."""
    str_rows = [[("" if v is None else str(v))[:max_col_width] for v in r] for r in rows]
    widths = [max(len(h), *(len(r[i]) for r in str_rows)) for i, h in enumerate(headers)] \
             if str_rows else [len(h) for h in headers]
    fmt = " | ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print("-+-".join("-" * w for w in widths))
    for r in str_rows:
        print(fmt.format(*r))

sql_text = get_sql().strip()
if not sql_text:
    print("No SQL provided.")
    sys.exit(0)

with connect() as conn, conn.cursor() as cur:
    try:
        cur.execute(sql_text)
    except Exception as e:
        conn.rollback()
        print(f"✗ Error: {e}")
        sys.exit(1)

    if cur.description:                                  # query returned rows
        headers = [d.name for d in cur.description]
        rows = cur.fetchall()
        print_table(headers, rows)
        print(f"\n({len(rows)} row{'s' if len(rows) != 1 else ''})")
    else:                                                # DDL / DML — nothing to fetch
        conn.commit()
        rc = cur.rowcount
        print(f"✓ OK. {rc if rc >= 0 else 0} row(s) affected.")