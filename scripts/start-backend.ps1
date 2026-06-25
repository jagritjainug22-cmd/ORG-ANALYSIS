# Start OrgSight FastAPI backend on port 8001 (required by frontend)
$BackendDir = Join-Path $PSScriptRoot "..\org_lvl_analysis_backend\org_lvl_analysis_backend"
Set-Location $BackendDir
Write-Host "Starting backend at http://127.0.0.1:8601 ..."
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8601
