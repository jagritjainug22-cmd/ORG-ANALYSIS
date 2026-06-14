# Start OrgSight React frontend (Vite) on port 5173
$FrontendDir = Join-Path $PSScriptRoot "..\org_lvl_analysis_frontend\org_lvl_analysis_frontend"
Set-Location $FrontendDir
Write-Host "Starting frontend at http://localhost:5173 ..."
npm run dev
