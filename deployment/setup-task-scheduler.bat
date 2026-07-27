@echo off
:: Creates a Windows Task Scheduler task that starts both OrgSight services
:: automatically at system boot — completely hidden, no windows.
::
:: Run this script ONCE as Administrator.
:: You will be prompted for your Windows login password.

set TASK_NAME=OrgSight Startup
set VBS_PATH=%~dp0start-all-hidden.vbs

echo ============================================================
echo  OrgSight - Task Scheduler Setup
echo ============================================================
echo.
echo This will create a scheduled task named: %TASK_NAME%
echo It will run at system startup (with a 60-second delay)
echo using the script: %VBS_PATH%
echo.
echo You will be prompted for your Windows password.
echo.

schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "wscript //B \"%VBS_PATH%\"" ^
  /sc onstart ^
  /delay 0001:00 ^
  /ru "%USERDOMAIN%\%USERNAME%" ^
  /rp ^
  /rl highest ^
  /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Task "%TASK_NAME%" created successfully.
    echo Services will start automatically after every reboot.
    echo.
    echo To verify: open Task Scheduler (taskschd.msc) and find "%TASK_NAME%"
) else (
    echo.
    echo ERROR: Task creation failed. Make sure you are running as Administrator.
)

echo.
pause
