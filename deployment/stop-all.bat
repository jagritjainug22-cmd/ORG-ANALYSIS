@echo off
:: Stops backend (uvicorn) and frontend (vite/npm) by matching their command lines.
:: Safe to run even if services are not currently running.

echo Stopping backend (uvicorn)...
powershell -NoProfile -Command ^
  "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo Stopping frontend (vite)...
powershell -NoProfile -Command ^
  "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*vite*' -or $_.CommandLine -like '*npm run dev*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo Done.
pause
