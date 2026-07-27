@echo off
echo ============================================================
echo  OrgSight Service Status
echo ============================================================
echo.

echo [Backend - uvicorn on port 8601]
powershell -NoProfile -Command ^
  "$p = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn*' }; if ($p) { Write-Host '  RUNNING  (PID' $p.ProcessId ')' -ForegroundColor Green } else { Write-Host '  NOT RUNNING' -ForegroundColor Red }"

echo.
echo [Frontend - vite on port 8501]
powershell -NoProfile -Command ^
  "$p = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*vite*' }; if ($p) { Write-Host '  RUNNING  (PID' $p.ProcessId ')' -ForegroundColor Green } else { Write-Host '  NOT RUNNING' -ForegroundColor Red }"

echo.
echo [Port check]
powershell -NoProfile -Command ^
  "$b = netstat -ano | Select-String ':8601 '; $f = netstat -ano | Select-String ':8501 '; if ($b) { Write-Host '  :8601 LISTENING' -ForegroundColor Green } else { Write-Host '  :8601 not found' -ForegroundColor Yellow }; if ($f) { Write-Host '  :8501 LISTENING' -ForegroundColor Green } else { Write-Host '  :8501 not found' -ForegroundColor Yellow }"

echo.
pause
