# Start org-chart-app (Vite) on port 5174
$AppDir = Join-Path $PSScriptRoot "..\org-chart-app"
Set-Location $AppDir
Write-Host "Starting org-chart-app at http://localhost:5174 ..."
npm run dev -- --port 5174
