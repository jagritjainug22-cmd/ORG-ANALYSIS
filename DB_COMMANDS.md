# OrgSight database commands

Run all commands from the **repo root**:

```bash
cd "ORG_ANALYSIS"
python manage_db.py <entity> <action> ...
```

**Database file:** `org_lvl_analysis_backend/org_lvl_analysis_backend/db/orgsight.db`  
**Dev password registry (plaintext):** `.../db/credentials.local.json` (gitignored)

Passwords in the DB are **Argon2 hashes** — you cannot read them back. Use `users set-password` or `users registry` to track plaintext locally.

---

## Overview

| Command | Description |
|---------|-------------|
| `python manage_db.py tables` | Row count per table |
| `python manage_db.py sql "SELECT ..."` | Raw SQL |

---

## Users

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py users list` |
| **Read** | `python manage_db.py users show jagrit.m` |
| **Create** | `python manage_db.py users create new.user Pass123! --role member --display-name "Name"` |
| **Update** | `python manage_db.py users update jagrit.m --display-name "Jagrit" --role member --active yes` |
| **Set password** | `python manage_db.py users set-password jagrit.m Pass123!` |
| **Deactivate** | `python manage_db.py users deactivate jagrit.m` |
| **Activate** | `python manage_db.py users activate jagrit.m` |
| **Delete** (permanent) | `python manage_db.py users delete test.user --force` |
| **View registry** | `python manage_db.py users registry` |
| **Sync registry → DB** | `python manage_db.py users sync` |
| **Sync dry-run** | `python manage_db.py users sync --dry-run` |

Update flags (combine as needed):

- `--display-name "..."`
- `--role admin|member`
- `--active yes|no`
- `--password NewPass123!` (optional `--force-change` to require change on next login)
- `--no-registry` — do not write `credentials.local.json`

---

## Projects

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py projects list` |
| **Read** | `python manage_db.py projects show 1` or `show "Project Name"` |
| **Create** | `python manage_db.py projects create "Q1 Analysis" --description "..." --deadline 2026-12-31` |
| **Update** | `python manage_db.py projects update 1 --name "New Name" --status active --deadline 2027-01-01` |
| **Archive** (soft delete) | `python manage_db.py projects archive 1` |
| **Delete** (permanent + datasets) | `python manage_db.py projects delete 1 --force` |

Status values: `active`, `archived`, `closed`

---

## Project assignments

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py assignments list --project 1` |
| **Create** | `python manage_db.py assignments assign --project 1 --user jagrit.m --role member` |
| **Delete** | `python manage_db.py assignments unassign --project 1 --user jagrit.m` |

`--project` and `--user` accept **id** or **name/username**.

---

## Datasets (uploaded Excel / baseline data)

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py datasets list` |
| **List by project** | `python manage_db.py datasets list --project 1` |
| **List by uploader** | `python manage_db.py datasets list --username jagrit.m` |
| **Read** | `python manage_db.py datasets show 5` |
| **Delete** | `python manage_db.py datasets delete 5 --force` |

---

## Scenarios (org modelling branches)

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py scenarios list --dataset 5` |
| **Read** | `python manage_db.py scenarios show 12` |
| **Delete** | `python manage_db.py scenarios delete 12 --force` |

---

## Audit log (read only)

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py audit list` |
| **Filter** | `python manage_db.py audit list --user-id 1 --action user.create --limit 100` |

---

## Refresh tokens (sessions)

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py tokens list` |
| **List for user** | `python manage_db.py tokens list --user jagrit.m` |
| **Revoke all** | `python manage_db.py tokens revoke --user jagrit.m` |

---

## Locks (stuck edit locks)

| Action | Command |
|--------|---------|
| **List** | `python manage_db.py locks list` |
| **List project only** | `python manage_db.py locks list --kind project` |
| **Clear all** | `python manage_db.py locks clear --kind all` |

---

## Raw SQL

```bash
python manage_db.py sql "SELECT id, username, role FROM users WHERE is_active = 1"
python manage_db.py sql "UPDATE projects SET status = 'active' WHERE id = 2"
```

Use with care on mutating statements.

---

## Legacy script

`manage_users.py` is superseded by `manage_db.py users ...` (same operations).

---

## First admin (bootstrap)

If the DB has no admin, set in `.env` in the backend folder:

```
SEED_ADMIN_USERNAME=am.admin
SEED_ADMIN_PASSWORD=YourSecurePassword
```

Then start the backend once on port **8001**.

---

## Servers

| Service | URL |
|---------|-----|
| Backend | http://127.0.0.1:8001 |
| Frontend | http://localhost:5173 |
| Org chart app | http://localhost:5174 |
