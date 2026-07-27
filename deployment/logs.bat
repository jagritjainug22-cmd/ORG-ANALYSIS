@echo off
echo ============================================================
echo  OrgSight Logs  (last 60 lines of each)
echo ============================================================
echo.

echo --- Backend log (%~dp0logs\backend.log) ---
powershell -NoProfile -Command ^
  "if (Test-Path '%~dp0logs\backend.log') { Get-Content '%~dp0logs\backend.log' -Tail 60 } else { Write-Host 'No backend log yet.' -ForegroundColor Yellow }"

echo.
echo --- Frontend log (%~dp0logs\frontend.log) ---
powershell -NoProfile -Command ^
  "if (Test-Path '%~dp0logs\frontend.log') { Get-Content '%~dp0logs\frontend.log' -Tail 60 } else { Write-Host 'No frontend log yet.' -ForegroundColor Yellow }"

echo.
echo Tip: to open the logs folder in Explorer, run:  explorer "%~dp0logs"
pause
