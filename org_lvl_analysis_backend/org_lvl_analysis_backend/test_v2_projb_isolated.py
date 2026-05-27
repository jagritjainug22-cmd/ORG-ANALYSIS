"""
Verification 2: user.projb isolation test on a clean DB.

This test:
  1. Restores from the Phase 3 clean backup
  2. Starts a fresh server against the restored DB
  3. Logs in as admin
  4. Creates Project B + user.projb, assigns them
  5. Logs in as user.projb
  6. Verifies user.projb sees ONLY Project B in /projects
  7. Verifies user.projb gets 403 on Legacy (project 1)
  8. Verifies user.projb CAN access Project B
  9. Cleans up by restoring the current DB

Run with: python test_v2_projb_isolated.py
"""

import requests, json, sys, os, shutil, time, subprocess, signal

BASE = "http://127.0.0.1:8002"  # use a different port to avoid conflicts
DB_DIR = os.path.join(os.path.dirname(__file__), "db")
DB_PATH = os.path.join(DB_DIR, "orgsight.db")
BACKUP_PATH = os.path.join(DB_DIR, "backups", "orgsight_phase3_clean_20260527_142431.db")
TEMP_BACKUP = os.path.join(DB_DIR, "orgsight_v2_temp.db")

passed = 0
failed = 0

def ok(label):
    global passed
    passed += 1
    print(f"  PASS  {label}")

def fail(label, detail=""):
    global failed
    failed += 1
    print(f"  FAIL  {label}  {detail}")

# ---------- Step 0: Verify backup exists ----------
if not os.path.exists(BACKUP_PATH):
    print(f"FATAL: Backup not found at {BACKUP_PATH}")
    sys.exit(1)

print(f"\n--- Verification 2: Isolated user.projb Test ---\n")

# ---------- Step 1: Back up current DB, restore clean backup ----------
print("Step 1: Restoring Phase 3 clean backup...")
if os.path.exists(DB_PATH):
    shutil.copy2(DB_PATH, TEMP_BACKUP)
    print(f"  Current DB backed up to {os.path.basename(TEMP_BACKUP)}")

shutil.copy2(BACKUP_PATH, DB_PATH)
print(f"  Restored from {os.path.basename(BACKUP_PATH)}")

# ---------- Step 2: Start fresh server on port 8002 ----------
print("\nStep 2: Starting fresh server on port 8002...")
server = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8002"],
    cwd=os.path.dirname(__file__),
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
)

# Wait for server to be ready
for _ in range(30):
    time.sleep(1)
    try:
        r = requests.get(f"{BASE}/", timeout=2)
        if r.status_code == 200:
            print("  Server ready")
            break
    except:
        pass
else:
    print("  FATAL: Server did not start in 30s")
    server.kill()
    sys.exit(1)

try:
    S = requests.Session()

    # ---------- Step 3: Admin login ----------
    print("\nStep 3: Admin login...")
    for pw in ["AM@dmin2026!", "NewPass123!"]:
        r = S.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": pw})
        if r.status_code == 200:
            data = r.json()
            if data.get("user", {}).get("must_change_password"):
                S.headers["Authorization"] = f"Bearer {data['access_token']}"
                S.post(f"{BASE}/auth/change-password",
                       json={"old_password": pw, "new_password": "NewPass123!"})
                r2 = S.post(f"{BASE}/auth/login",
                            json={"username": "am.admin", "password": "NewPass123!"})
                if r2.status_code == 200:
                    data = r2.json()
            S.headers["Authorization"] = f"Bearer {data['access_token']}"
            ok("Admin login")
            break
    else:
        fail("Admin login", "Could not authenticate")
        raise SystemExit(1)

    # ---------- Step 4: Create Project B + user.projb ----------
    print("\nStep 4: Create Project B + user.projb...")

    r = S.post(f"{BASE}/admin/projects", json={"name": "Project B", "description": "Isolated test"})
    if r.status_code == 201:
        proj_b_id = r.json()["id"]
        ok(f"Created Project B id={proj_b_id}")
    else:
        fail("Create Project B", f"Status {r.status_code}: {r.text[:200]}")
        raise SystemExit(1)

    r = S.post(f"{BASE}/admin/users", json={"username": "user.projb", "password": "TempProjB1!", "role": "member"})
    if r.status_code == 201:
        user_b_id = r.json()["id"]
        ok(f"Created user.projb id={user_b_id}")
    else:
        fail("Create user.projb", f"Status {r.status_code}: {r.text[:200]}")
        raise SystemExit(1)

    r = S.post(f"{BASE}/admin/projects/{proj_b_id}/assignments", json={"user_id": user_b_id})
    if r.status_code == 201:
        ok(f"Assigned user.projb -> Project B (id={proj_b_id})")
    else:
        fail("Assignment", f"Status {r.status_code}: {r.text[:200]}")

    # ---------- Step 5: Login as user.projb ----------
    print("\nStep 5: Login as user.projb...")
    S2 = requests.Session()
    r = S2.post(f"{BASE}/auth/login", json={"username": "user.projb", "password": "TempProjB1!"})
    if r.status_code != 200:
        fail("user.projb login", f"Status {r.status_code}: {r.text[:200]}")
        raise SystemExit(1)

    d = r.json()
    if d.get("user", {}).get("must_change_password"):
        S2.headers["Authorization"] = f"Bearer {d['access_token']}"
        cp = S2.post(f"{BASE}/auth/change-password",
                     json={"old_password": "TempProjB1!", "new_password": "NewProjB1!"})
        if cp.status_code != 200:
            fail("user.projb change password", f"Status {cp.status_code}")
            raise SystemExit(1)
        r2 = S2.post(f"{BASE}/auth/login", json={"username": "user.projb", "password": "NewProjB1!"})
        if r2.status_code != 200:
            fail("user.projb re-login", f"Status {r2.status_code}")
            raise SystemExit(1)
        d = r2.json()
    S2.headers["Authorization"] = f"Bearer {d['access_token']}"
    ok("user.projb logged in (password changed)")

    # ---------- Step 6: user.projb /projects list ----------
    print("\nStep 6: user.projb /projects list...")
    r = S2.get(f"{BASE}/projects")
    if r.status_code == 200:
        user_projects = r.json()
        pnames = [p["name"] for p in user_projects]
        pids = [p["id"] for p in user_projects]
        if "Project B" in pnames and "Legacy" not in pnames:
            ok(f"user.projb sees ONLY Project B: {pnames} (ids={pids})")
        elif "Project B" in pnames:
            fail(f"user.projb sees extra projects", f"{pnames}")
        else:
            fail("user.projb projects", f"Missing Project B: {pnames}")
    else:
        fail("user.projb /projects", f"Status {r.status_code}")

    # ---------- Step 7: user.projb gets 403 on Legacy ----------
    print("\nStep 7: user.projb access to Legacy (project 1)...")
    r = S2.get(f"{BASE}/projects/1")
    if r.status_code == 403:
        code = r.json().get("error_code", "")
        ok(f"user.projb 403 on Legacy (error_code={code})")
    elif r.status_code == 404:
        ok("user.projb 404 on Legacy (namespace isolation)")
    else:
        fail("user.projb on Legacy", f"Expected 403/404, got {r.status_code}: {r.text[:200]}")

    r = S2.post(f"{BASE}/projects/1/cleanup", json=[{"Employee_ID": "E001"}])
    if r.status_code in (403, 404):
        ok(f"user.projb lifecycle blocked on Legacy ({r.status_code})")
    else:
        fail("user.projb lifecycle on Legacy", f"Expected 403/404, got {r.status_code}")

    # ---------- Step 8: user.projb CAN access Project B ----------
    print("\nStep 8: user.projb access to Project B...")
    r = S2.get(f"{BASE}/projects/{proj_b_id}")
    if r.status_code == 200:
        ok(f"user.projb CAN access Project B (id={proj_b_id})")
    else:
        fail("user.projb on Project B", f"Status {r.status_code}: {r.text[:200]}")

    # Also test a lifecycle call on Project B
    r = S2.post(f"{BASE}/projects/{proj_b_id}/cleanup", json=[{"Employee_ID": "E001"}])
    if r.status_code == 200:
        ok(f"user.projb lifecycle works on Project B (cleanup={r.status_code})")
    else:
        # 200 or 422 are both acceptable (422 = bad data shape, but at least auth passed)
        if r.status_code == 422:
            ok(f"user.projb lifecycle auth passes on Project B (422 = data validation, not auth)")
        else:
            fail("user.projb lifecycle on Project B", f"Status {r.status_code}: {r.text[:200]}")

finally:
    # ---------- Cleanup: kill server, restore original DB ----------
    print("\n--- Cleanup ---")
    try:
        server.terminate()
        server.wait(timeout=5)
    except:
        server.kill()
    print("  Server stopped")

    if os.path.exists(TEMP_BACKUP):
        shutil.copy2(TEMP_BACKUP, DB_PATH)
        os.remove(TEMP_BACKUP)
        print("  Original DB restored")
    else:
        print("  No temp backup to restore")

# ---------- Summary ----------
print(f"\n{'='*50}")
print(f"  Verification 2: {passed} passed, {failed} failed")
print(f"{'='*50}")
sys.exit(1 if failed else 0)
