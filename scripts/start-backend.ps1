# Start OrgSight FastAPI backend on port 8601 (required by frontend)
$RepoRoot = Join-Path $PSScriptRoot ".."
$BackendDir = Join-Path $RepoRoot "org_lvl_analysis_backend\org_lvl_analysis_backend"
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }
Set-Location $BackendDir
Write-Host "Starting backend at http://127.0.0.1:8601 (using $Python) ..."
& $Python -m uvicorn main:app --reload --host 127.0.0.1 --port 8601
