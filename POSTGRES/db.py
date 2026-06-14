import os
import psycopg
from dotenv import load_dotenv

load_dotenv()

def connect(autocommit: bool = False) -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ["PGHOST"],
        port=os.environ["PGPORT"],
        dbname=os.environ["PGDATABASE"],
        user=os.environ["PGUSER"],
        password=os.environ["PGPASSWORD"],
        sslmode="require",
        autocommit=autocommit,
    )