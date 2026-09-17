# Org Level Analysis (OrgSight)

Full-stack org census analysis, rationalisation, org-chart modelling, and scenario planning.

**New to the project?** See **[CLONING_GUIDE.md](CLONING_GUIDE.md)** for clone, env setup, and first run.

## Servers (standard ports)

| Service | URL | Start command |
|---------|-----|---------------|
| **Backend** (FastAPI) | http://127.0.0.1:8601 | `.\scripts\start-backend.ps1` |
| **Frontend** (Vite) | http://localhost:8501 | `.\scripts\start-frontend.ps1` |
| **Org chart app** (Vite) | http://localhost:5174 | `.\scripts\start-org-chart.ps1` |

The frontend calls the API at **port 8601** (`org_lvl_analysis_frontend/.../src/api/backend.js`).

## Dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Manual backend start:

```powershell
cd org_lvl_analysis_backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8601
```
