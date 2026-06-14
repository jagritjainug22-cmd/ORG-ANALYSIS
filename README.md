# Org Level Analysis (OrgSight)

## Servers (standard ports)

| Service | URL | Start command |
|---------|-----|---------------|
| **Backend** (FastAPI) | http://127.0.0.1:8001 | `.\scripts\start-backend.ps1` |
| **Frontend** (Vite) | http://localhost:5173 | `.\scripts\start-frontend.ps1` |
| **Org chart app** (Vite) | http://localhost:5174 | `.\scripts\start-org-chart.ps1` |

The frontend calls the API at **port 8001** only (`org_lvl_analysis_frontend/.../src/api/backend.js`). Do not use port 8000 — it is redundant.

Manual backend start:

```powershell
cd org_lvl_analysis_backend\org_lvl_analysis_backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

## Database CLI

See [DB_COMMANDS.md](DB_COMMANDS.md) for user/project/dataset CRUD commands (`python manage_db.py ...`).
