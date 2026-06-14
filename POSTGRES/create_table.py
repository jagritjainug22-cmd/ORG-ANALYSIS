from db import connect

DDL = """
CREATE TABLE IF NOT EXISTS sites (
    id           SERIAL PRIMARY KEY,
    url          TEXT NOT NULL UNIQUE,
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_is_active ON sites(is_active);
"""

with connect() as conn, conn.cursor() as cur:
    cur.execute(DDL)
    conn.commit()
    print("✓ Table(s) created (or already existed).")