# OrgSight — Cloning & Local Setup Guide

OrgSight (Org Level Analysis) is a full-stack app for org census analysis, rationalisation, org-chart modelling, and scenario planning.

| Layer | Stack | Default URL |
|-------|-------|-------------|
| Backend | FastAPI + PostgreSQL + DuckDB | http://127.0.0.1:8601 |
| Frontend | React + Vite | http://localhost:8501 |
| Org chart app (optional) | React + Vite | http://localhost:5174 |

---

## 1. Prerequisites

Install these before cloning:

| Tool | Version | Notes |
|------|---------|-------|
| **Git** | any recent | clone the repo |
| **Python** | 3.11+ (3.12 tested) | backend |
| **Node.js** | 18+ LTS | frontend (`npm`) |
| **PostgreSQL** | 13+ | Azure Database for PostgreSQL or local instance |
| **Azure OpenAI** | optional | required for LLM features (mapping, rationalisation, chat) |
| **Inkscape** | optional | Windows-only PPT export with embedded org-chart EMF |

---

## 2. Clone the repository

```powershell
git clone https://github.com/jagritjainug22-cmd/ORG-ANALYSIS.git
cd ORG-ANALYSIS
```

---

## 3. PostgreSQL database

The backend connects **only** to a database named `OrgSight_db`. The name is enforced in code and cannot be changed without modifying `pg_adapter.py`.

### Create the database

On your PostgreSQL server, create the database (if it does not exist):

```sql
CREATE DATABASE "OrgSight_db";
```

Tables are created automatically on first backend startup via `db_service.init_db()`.

### Configure connection

```powershell
copy POSTGRES\.env.example POSTGRES\.env
```

Edit `POSTGRES/.env`:

```env
PGHOST=your-postgres-host.example.com
PGPORT=5432
PGDATABASE=OrgSight_db
PGUSER=your_db_user
PGPASSWORD=your_db_password
PGSSLMODE=require
```

---

## 4. Backend environment

```powershell
copy org_lvl_analysis_backend\.env.example org_lvl_analysis_backend\.env
```

Edit the backend `.env`. At minimum, set:

- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` — used to create the **first admin user** when the database has no admin yet
- `JWT_SECRET` — a long random string; keep it stable across restarts so login tokens remain valid

For LLM-powered features, also set the `AZURE_OPENAI_*` variables.

---

## 5. Python virtual environment & dependencies

From the **repo root**:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

Or install directly from the backend folder:

```powershell
pip install -r org_lvl_analysis_backend\requirements.txt
```

---

## 6. Frontend dependencies

```powershell
cd org_lvl_analysis_frontend
npm install
cd ..
```

Optional standalone org-chart app:

```powershell
cd org-chart-app
npm install
cd ..
```

---

## 7. Run the application

Open **two terminals** from the repo root.

### Terminal 1 — Backend (port 8601)

The frontend is configured to call the API on port **8601** (`src/api/backend.js`).

```powershell
.\scripts\start-backend.ps1
```

Or manually:

```powershell
cd org_lvl_analysis_backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8601
```

Verify: http://127.0.0.1:8601/docs

> **Note:** Use `127.0.0.1` or `0.0.0.0` as the host — not `127.0.0.0` (invalid on Windows).

### Terminal 2 — Frontend (port 8501)

```powershell
.\scripts\start-frontend.ps1
```

Or manually:

```powershell
cd org_lvl_analysis_frontend
npm run dev
```

Open: http://localhost:8501

Log in with the credentials from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.

---

## 8. Project layout

```
ORG-ANALYSIS/
├── requirements.txt                          # Root pointer to backend deps
├── CLONING_GUIDE.md                          # This file
├── scripts/
│   ├── start-backend.ps1
│   ├── start-frontend.ps1
│   └── start-org-chart.ps1
├── POSTGRES/
│   └── .env                                  # DB credentials (gitignored)
├── org_lvl_analysis_backend/
│   ├── main.py                               # FastAPI entry point
│   ├── requirements.txt
│   ├── .env                                  # Secrets (gitignored)
│   ├── routers/                              # API routes
│   └── services/                             # Business logic
└── org_lvl_analysis_frontend/
    ├── package.json
    └── src/                                  # React UI
```

---

## 9. Optional features

### Org chart standalone app

```powershell
.\scripts\start-org-chart.ps1
```

### PPT export with embedded org chart (Windows)

Install [Inkscape](https://inkscape.org/) at:

```
C:\Program Files\Inkscape\bin\inkscape.exe
```

Without Inkscape, other export paths (PDF, Excel) still work via ReportLab/svglib.

### SMTP email notifications

Set `SMTP_*` variables in the backend `.env` to enable project-assignment emails.

---

## 10. Running tests

Backend unit tests (from the backend directory, with venv active):

```powershell
cd org_lvl_analysis_backend
python -m pytest tests/ -v
```

Integration scripts (require a running backend):

```powershell
python test_auth.py
python test_chat_history.py --help
```

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `[WinError 10049]` on backend start | Invalid host, e.g. `127.0.0.0` | Use `--host 127.0.0.1` |
| Backend exits immediately on startup | Missing admin seed env vars | Set `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` |
| `PGDATABASE must be 'OrgSight_db'` | Wrong database name in `.env` | Set `PGDATABASE=OrgSight_db` |
| Frontend cannot reach API | Backend not running or wrong port | Start backend on **8601** |
| Login works once, fails after restart | `JWT_SECRET` changed | Set a fixed `JWT_SECRET` in `.env` |
| LLM / chat / rationalisation errors | Azure OpenAI not configured | Fill in `AZURE_OPENAI_*` variables |
| CORS errors | Frontend not on port 8501 | Use default Vite port 8501 |

---

## 12. Quick start checklist

- [ ] Clone repo
- [ ] Create PostgreSQL database `OrgSight_db`
- [ ] Copy and fill `POSTGRES/.env`
- [ ] Copy and fill backend `.env` (admin seed + JWT secret)
- [ ] `python -m venv .venv` → activate → `pip install -r requirements.txt`
- [ ] `npm install` in frontend folder
- [ ] Start backend on port **8601**
- [ ] Start frontend on port **8501**
- [ ] Log in at http://localhost:8501
