# OrgSight — Deployment Guide

Internal application. Default local URLs:

- **Frontend:** http://localhost:8501
- **Backend:**  http://127.0.0.1:8601

---

## How it works

Both services run as hidden background processes managed by Windows Task Scheduler.  
No Cursor, no visible terminal windows. Logs are written to `deployment\logs\`.

| Service  | Process         | Port |
|----------|-----------------|------|
| Backend  | Python / uvicorn | 8601 |
| Frontend | Node / Vite      | 8501 |

---

## One-Time Setup

Run these steps once on the VM.

### 1. Verify prerequisites

```
node --version    # must be installed
npm --version
python --version  # from the repo .venv
```

### 2. Install frontend dependencies (if not already done)

```
cd org_lvl_analysis_frontend
npm install
```

### 3. Install backend dependencies (if not already done)

```
.venv\Scripts\pip install -r requirements.txt
```

### 4. Register the startup task

Open a **Command Prompt as Administrator** and run:

```
deployment\setup-task-scheduler.bat
```

Enter your Windows password when prompted.  
This creates a Task Scheduler task called **OrgSight Startup** that fires 60 seconds after every boot.

### 5. Start services now (without rebooting)

```
deployment\start-all.bat
```

### 6. Verify

```
deployment\status.bat
```

Both services should show **RUNNING**.

---

## Daily Operations

### Start

```
deployment\start-all.bat
```

### Stop

```
deployment\stop-all.bat
```

### Restart (after code changes)

```
deployment\restart-all.bat
```

### Check status

```
deployment\status.bat
```

### View logs

```
deployment\logs.bat
```

Or open the logs folder directly:

```
explorer deployment\logs
```

---

## Updating the Application

```
# 1. Pull latest code
git pull

# 2. Only if backend dependencies changed:
.venv\Scripts\pip install -r requirements.txt

# 3. Only if frontend dependencies changed:
cd org_lvl_analysis_frontend
npm install
cd ..\..

# 4. Restart both services
deployment\restart-all.bat
```

---

## After a VM Reboot

The Task Scheduler task starts both services automatically ~60 seconds after boot.

To verify after reboot:

```
deployment\status.bat
```

If for any reason services did not start automatically:

```
deployment\start-all.bat
```

---

## Troubleshooting

### Services show NOT RUNNING after start-all.bat

Wait 10–15 seconds and run `status.bat` again. Uvicorn connects to Azure PostgreSQL on startup — this takes a few seconds.

If still not running, check the logs:

```
deployment\logs.bat
```

Common causes:
- Python venv path wrong (check `.venv\Scripts\python.exe` exists)
- `node_modules` missing — run `npm install` in the frontend folder
- Database unreachable — check VPN / Azure PostgreSQL availability
- Port already in use — check `netstat -ano | findstr :8601`

### Port already in use

```
netstat -ano | findstr :8601
netstat -ano | findstr :8501
```

Find the PID and kill it:

```
taskkill /PID <pid> /F
```

Then start again.

### Task Scheduler task not running at boot

1. Open `taskschd.msc`
2. Find **OrgSight Startup**
3. Check **Last Run Result** — should be `0x0` (success)
4. If it shows an error, right-click → Run to test manually
5. Make sure **Run whether user is logged on or not** is set if the VM runs headless

### Manually remove the scheduled task

```
schtasks /delete /tn "OrgSight Startup" /f
```

---

## Log Files

| File | Contents |
|------|----------|
| `deployment\logs\backend.log`  | Uvicorn stdout + stderr |
| `deployment\logs\frontend.log` | Vite stdout + stderr |

Logs are **appended** on each start. They are not automatically rotated.  
Clear them manually if they grow too large.

---

## File Reference

| File | Purpose |
|------|---------|
| `start-backend.vbs`      | Launches uvicorn hidden with log capture |
| `start-frontend.vbs`     | Launches Vite hidden with log capture |
| `start-all-hidden.vbs`   | Called by Task Scheduler — invokes both VBS silently |
| `start-all.bat`          | Manual start — launches both services |
| `stop-all.bat`           | Kills both services |
| `restart-all.bat`        | Stop + start (use after code updates) |
| `status.bat`             | Shows running state and port status |
| `logs.bat`               | Prints last 60 lines of each log |
| `setup-task-scheduler.bat` | One-time setup: registers boot task |
| `logs\`                  | Log output directory |
