import os
import psycopg
from psycopg import sql
from dotenv import load_dotenv

load_dotenv()

NEW_DB_NAME = "OrgSight_db"  # <-- change to whatever you want

# Connect to the 'postgres' admin DB. You can't CREATE DATABASE
# while connected to the one being created, and 'postgres' exists on every server.
with psycopg.connect(
    host=os.environ["PGHOST"],
    port=os.environ["PGPORT"],
    dbname="postgres",
    user=os.environ["PGUSER"],
    password=os.environ["PGPASSWORD"],
    sslmode="require",
    autocommit=True,  # CREATE DATABASE cannot run inside a transaction block
) as conn, conn.cursor() as cur:

    # 1. Check if the database already exists
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (NEW_DB_NAME,))
    already_exists = cur.fetchone() is not None

    if already_exists:
        print(f"⚠  Database '{NEW_DB_NAME}' already exists — no action taken.")
    else:
        # 2. Safely quote the identifier (you can't parameterize DB names)
        try:
            cur.execute(
                sql.SQL(
                    "CREATE DATABASE {name} WITH ENCODING = 'UTF8' TEMPLATE = template0;"
                ).format(name=sql.Identifier(NEW_DB_NAME))
            )
            print(f"✓ Database '{NEW_DB_NAME}' created successfully.")
        except psycopg.errors.InsufficientPrivilege:
            print(f"✗ Your user lacks CREATEDB permission. Ask whoever issued"
                  f" the creds to grant it, or have them create the DB for you.")
        except psycopg.Error as e:
            print(f"✗ Failed to create database: {e}")