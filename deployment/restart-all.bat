@echo off
:: Stops both services, waits 3 seconds, then starts them again.
:: Use after pulling code changes.

echo Restarting OrgSight services...

call "%~dp0stop-all.bat" >nul 2>&1
timeout /t 3 /nobreak >nul

wscript //B "%~dp0start-backend.vbs"
wscript //B "%~dp0start-frontend.vbs"

echo Done. Allow 5-10 seconds for services to reinitialise.
echo Run status.bat to confirm both are running.
pause
