# Start OrgSight FastAPI backend on port 8601 (required by frontend)
$BackendDir = Join-Path $PSScriptRoot "..\org_lvl_analysis_backend\org_lvl_analysis_backend"
Set-Location $BackendDir
Write-Host "Starting backend at http://0.0.0.0:8601 ..."
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8601
