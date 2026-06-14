# Postgres Rehearsal Checklist

Run after `python scripts/migrate_sqlite_to_postgres.py --fresh`.

## Migration order (confirmed)

1. Connect to Postgres only — **no `init_db()`**, no seeding
2. Verify schema exists and **schema_version = 5** (script exits if not)
3. `TRUNCATE` app tables reverse FK order + `CASCADE` (clears init_db seeds)
4. Copy SQLite in FK order, preserving IDs
5. `setval(seq, COALESCE(MAX(id),0)+1, false)` per serial table
6. Verify row counts match SQLite

`--fresh` is **required**; running without it exits immediately.

## Automated

```powershell
python scripts/rehearsal_verify.py
python scripts/rehearsal_verify.py --scenario-id <id> --manager-emp-id <emp_id>
```

Covers:
- `mark_dataset_seen()` upsert (one row, `last_seen` updates)
- `UNIQUE` constraint on `dataset_user_views`
- `flag_employee()` cascade (with scenario + manager args)
- CLI leak smoke (10x `db_check.py` + `pg_stat_activity`)

## Manual (required before cutover)

### flag_employee — 3+ level tree

Pick a real manager with deep reports. Count expected descendants (org chart or SQL). Flag in UI or API. Compare flagged row count to manual count. **Silent failure = fewer rows flagged than expected.**

### mark_dataset_seen — browser path

Open a dataset in the app (marks seen). Reload. Confirm one row in `dataset_user_views` for that user+dataset.

### Connection pool under load

~20 simultaneous API requests (e.g. parallel curl or browser tabs on `/projects`). Expect queueing/slight latency, **not** 500s or pool exhaustion errors.

### Advisory lock — two backends

```powershell
# Terminal 1
uvicorn main:app --port 8001

# Terminal 2 (same POSTGRES/.env)
uvicorn main:app --port 8002
```

Second instance should start cleanly; logs show schema at v5, migrations no-op (advisory lock serializes if both start together).

### Refresh token — real browser

1. Log in via frontend (not curl-only)
2. Wait for access token expiry or force refresh
3. Confirm silent refresh via cookie — no redirect to login
4. Requires unchanged `JWT_SECRET` and same API hostname/port as before

## Cutover gate

All automated + manual checks pass → maintenance window → final `--fresh` migrate → restart backend on same URL.
