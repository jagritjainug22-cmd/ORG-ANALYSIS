@echo off
:: Starts backend and frontend in the background (no visible windows).
:: Logs are written to deployment\logs\

echo Starting OrgSight services...

wscript //B "%~dp0start-backend.vbs"
wscript //B "%~dp0start-frontend.vbs"

echo Done. Allow 5-10 seconds for services to initialise.
echo Backend : http://172.29.42.122:8601
echo Frontend: http://172.29.42.122:8501
echo Logs    : %~dp0logs\
echo.
echo Run status.bat to confirm both are running.
pause
