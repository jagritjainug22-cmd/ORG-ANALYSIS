# Start OrgSight React frontend (Vite) on port 8501
$FrontendDir = Join-Path $PSScriptRoot "..\org_lvl_analysis_frontend"
Set-Location $FrontendDir
Write-Host "Starting frontend at http://localhost:8501 ..."
npm run dev
