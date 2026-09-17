# OrgSight — Clone & Start

Someone cloning this repo gets the **code**, not your data. Postgres is the source of truth. DuckDB is a temporary in-memory cache and does not need to be installed or configured.

| Service | Stack | URL |
|---------|-------|-----|
| Backend | FastAPI | http://127.0.0.1:8601 |
| Frontend | React + Vite | http://localhost:8501 |

---

## What gets created automatically?

**Yes, tables and the first admin are created on first backend start.**  
**No, the Postgres database itself is not created for you.**

| Layer | Created automatically? | What it is |
|-------|------------------------|------------|
| Postgres database `OrgSight_db` | **You create this** (or reuse an existing empty one) | Persistent store: users, projects, uploads, scenarios, audit |
| Tables / schema | **Yes** — `init_db()` on startup | Safe to run every time (`CREATE TABLE IF NOT EXISTS`) |
| First admin user | **Yes** — from `SEED_ADMIN_*` if no admin exists | Then log in and create other users in Admin → Users |
| Census / project data | **No** | Empty until someone uploads a file |
| DuckDB | **Yes, in RAM only** | Per-user cache for Ask OrgSight + benchmarking SQL. Gone on restart |

You do **not** need a local SQLite file, and you do **not** set up DuckDB.

### DuckDB — used, but not “too much”

Postgres holds everything durable. DuckDB is loaded only when a dataset/scenario is active, so chat and benchmark queries can run fast SQL in memory. It is not a second database you maintain.

---

## Prerequisites

- Git
- Python 3.11+ (3.12 tested)
- Node.js 18+ LTS
- PostgreSQL 13+ (local or Azure). Database **name must be** `OrgSight_db`
- Azure OpenAI — optional, but required for mapping, rationalisation, and Ask OrgSight

---

## 1. Clone

```powershell
git clone https://github.com/jagritjainug22-cmd/ORG-ANALYSIS.git
cd ORG-ANALYSIS
```

---

## 2. Create the Postgres database

On your Postgres server:

```sql
CREATE DATABASE "OrgSight_db";
```

Then:

```powershell
copy POSTGRES\.env.example POSTGRES\.env
```

Edit `POSTGRES/.env`:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=OrgSight_db
PGUSER=your_db_user
PGPASSWORD=your_db_password
PGSSLMODE=prefer
```

Use `PGSSLMODE=require` for Azure Postgres.

---

## 3. Backend secrets

```powershell
copy org_lvl_analysis_backend\.env.example org_lvl_analysis_backend\.env
```

Set at least:

```env
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=change-me-to-a-strong-password
JWT_SECRET=paste-a-long-random-string-and-keep-it-stable
```

Add `AZURE_OPENAI_*` if you want LLM features.

---

## 4. Install

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

cd org_lvl_analysis_frontend
npm install
cd ..
```

---

## 5. Start

Two terminals, from the repo root:

```powershell
.\scripts\start-backend.ps1
```

```powershell
.\scripts\start-frontend.ps1
```

- API docs: http://127.0.0.1:8601/docs  
- App: http://localhost:8501  

Log in with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`. Create a project, upload a census, then use the rest of the app.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Backend exits on startup | Fill `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` |
| `PGDATABASE must be 'OrgSight_db'` | Database name must be exactly that |
| Cannot connect to Postgres | Check `POSTGRES/.env` host, user, password, SSL |
| Frontend cannot reach API | Backend must be on **8601** |
| Logged out after restart | Keep `JWT_SECRET` unchanged |
| Chat / rationalisation fails | Fill `AZURE_OPENAI_*` |

Do not commit `.env` files. They are gitignored.
