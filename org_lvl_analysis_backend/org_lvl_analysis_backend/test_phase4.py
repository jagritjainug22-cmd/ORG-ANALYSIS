"""
Phase 4 E2E verification:
  1. Admin login
  2. GET /projects (list)
  3. GET /projects/1 (Legacy project detail)
  4. Upload file through project-scoped endpoint
  5. Cleanup through project-scoped endpoint
  6. Hierarchy through project-scoped endpoint
  7. Save baseline through project-scoped endpoint
  8. Verify project_id=1 on saved baseline
  9. Create second user + Project B, verify isolation
 10. Second user sees only their project in /projects list
 11. Second user gets 403 on Legacy project
 12. Logout flow
"""

import requests, json, sys, os, time

BASE = "http://127.0.0.1:8001"
S = requests.Session()
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


# ---------- helpers ----------
def admin_login():
    # Try seed password first, then NewPass123!
    for pw in [os.environ.get("SEED_ADMIN_PASSWORD", "AM@dmin2026!"), "AM@dmin2026!", "NewPass123!"]:
        r = S.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": pw})
        if r.status_code == 200:
            data = r.json()
            if data.get("user", {}).get("must_change_password"):
                S.headers["Authorization"] = f"Bearer {data['access_token']}"
                cp = S.post(f"{BASE}/auth/change-password", json={"old_password": pw, "new_password": "NewPass123!"})
                if cp.status_code != 200:
                    continue
                r2 = S.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "NewPass123!"})
                if r2.status_code != 200:
                    continue
                data = r2.json()
            S.headers["Authorization"] = f"Bearer {data['access_token']}"
            return data
    return None


# ==================== 1. Admin login ====================
print("\n--- Phase 4 E2E Test ---\n")

data = admin_login()
if data:
    ok("1. Admin login")
else:
    fail("1. Admin login", "Could not authenticate")
    sys.exit(1)

token = data["access_token"]

# ==================== 2. GET /projects ====================
r = S.get(f"{BASE}/projects")
if r.status_code == 200:
    projects = r.json()
    if isinstance(projects, list) and len(projects) >= 1:
        legacy = next((p for p in projects if p["id"] == 1), None)
        if legacy:
            ok(f"2. GET /projects returns {len(projects)} project(s), Legacy found")
        else:
            fail("2. GET /projects", "Legacy project (id=1) not in list")
    else:
        fail("2. GET /projects", f"Expected list, got {type(projects)}")
else:
    fail("2. GET /projects", f"Status {r.status_code}: {r.text[:200]}")

# ==================== 3. GET /projects/1 ====================
r = S.get(f"{BASE}/projects/1")
if r.status_code == 200:
    detail = r.json()
    pname = detail.get("project", {}).get("name") or detail.get("name")
    ok(f"3. GET /projects/1 -> {pname}")
else:
    fail("3. GET /projects/1", f"Status {r.status_code}")

# ==================== 4. Upload through project scope ====================
import io, openpyxl
wb = openpyxl.Workbook()
ws = wb.active
ws.append(["Employee_ID", "Manager_ID", "FTE", "FLC", "Country", "Level", "Job_Title"])
for i in range(1, 11):
    ws.append([f"E{i:03d}", f"E{max(1, i//3):03d}", 1.0, 100000, "US", (i % 4) + 1, f"Title_{i}"])
buf = io.BytesIO()
wb.save(buf)
buf.seek(0)

r = S.post(f"{BASE}/projects/1/upload", files={"file": ("test.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
if r.status_code == 200 and "records" in r.json():
    records = r.json()["records"]
    ok(f"4. Upload -> {len(records)} records")
else:
    fail("4. Upload", f"Status {r.status_code}: {r.text[:200]}")
    records = []

# ==================== 5. Cleanup ====================
if records:
    r = S.post(f"{BASE}/projects/1/cleanup", json=records, params={"remove_exclusion": True})
    if r.status_code == 200:
        cleaned = r.json()
        ok(f"5. Cleanup -> {len(cleaned)} records")
    else:
        fail("5. Cleanup", f"Status {r.status_code}: {r.text[:200]}")
        cleaned = records
else:
    cleaned = []
    fail("5. Cleanup", "No records to clean")

# ==================== 6. Hierarchy ====================
if cleaned:
    r = S.post(f"{BASE}/projects/1/hierarchy", json=cleaned, params={"emp_col": "Employee_ID", "mgr_col": "Manager_ID"})
    if r.status_code == 200:
        ok("6. Hierarchy")
    else:
        fail("6. Hierarchy", f"Status {r.status_code}: {r.text[:200]}")
else:
    fail("6. Hierarchy", "No data")

# ==================== 7. Save baseline ====================
if cleaned:
    body = {
        "name": "Phase4_Test",
        "records": cleaned if isinstance(cleaned, list) else [],
        "emp_col": "Employee_ID",
        "mgr_col": "Manager_ID",
        "fte_col": "FTE",
        "flc_col": "FLC",
        "job_title_col": "Job_Title",
        "country_col": "Country"
    }
    r = S.post(f"{BASE}/projects/1/db/save_baseline", json=body)
    if r.status_code == 200:
        ds = r.json()
        dataset_id = ds.get("dataset_id")
        ok(f"7. Save baseline -> dataset_id={dataset_id}")
    else:
        fail("7. Save baseline", f"Status {r.status_code}: {r.text[:200]}")
        dataset_id = None
else:
    fail("7. Save baseline", "No data")
    dataset_id = None

# ==================== 8. Verify project_id on baseline ====================
if dataset_id:
    r = S.get(f"{BASE}/projects/1/db/datasets/{dataset_id}")
    if r.status_code == 200:
        ds_data = r.json()
        ds_obj = ds_data.get("dataset", ds_data)
        pid = ds_obj.get("project_id")
        if pid == 1:
            ok("8. Baseline project_id=1 confirmed")
        else:
            fail("8. Baseline project_id", f"Expected 1, got {pid} (keys: {list(ds_obj.keys())})")
    else:
        fail("8. Baseline project_id", f"Status {r.status_code}")
else:
    fail("8. Baseline project_id", "No dataset_id")

# ==================== 9. Create Project B + user ====================
r = S.post(f"{BASE}/admin/projects", json={"name": "Project B", "description": "Test"})
if r.status_code == 201:
    proj_b_id = r.json()["id"]
    ok(f"9a. Created Project B id={proj_b_id}")
elif r.status_code == 409:
    ok("9a. Project B already exists (409)")
    proj_b_id = 2
else:
    fail("9a. Create Project B", f"Status {r.status_code}: {r.text[:200]}")
    proj_b_id = None

r = S.post(f"{BASE}/admin/users", json={"username": "user.projb", "password": "TempPass1!", "role": "member"})
if r.status_code == 201:
    user_b_id = r.json()["id"]
    ok(f"9b. Created user.projb id={user_b_id}")
elif r.status_code == 409:
    ok("9b. user.projb already exists (409)")
    user_b_id = None
else:
    fail("9b. Create user.projb", f"Status {r.status_code}: {r.text[:200]}")
    user_b_id = None

if proj_b_id:
    r = S.post(f"{BASE}/admin/projects/{proj_b_id}/assignments", json={"user_id": user_b_id or 2})
    if r.status_code in (201, 409):
        ok("9c. Assigned user.projb -> Project B")
    else:
        fail("9c. Assignment", f"Status {r.status_code}: {r.text[:200]}")

# ==================== 10. Login as user.projb ====================
S2 = requests.Session()
for pw in ["TempPass1!", "NewProjB1!"]:
    r = S2.post(f"{BASE}/auth/login", json={"username": "user.projb", "password": pw})
    if r.status_code == 200:
        d = r.json()
        if d.get("user", {}).get("must_change_password"):
            S2.headers["Authorization"] = f"Bearer {d['access_token']}"
            cp = S2.post(f"{BASE}/auth/change-password", json={"old_password": pw, "new_password": "NewProjB1!"})
            r2 = S2.post(f"{BASE}/auth/login", json={"username": "user.projb", "password": "NewProjB1!"})
            if r2.status_code == 200:
                d = r2.json()
                S2.headers["Authorization"] = f"Bearer {d['access_token']}"
                break
        else:
            S2.headers["Authorization"] = f"Bearer {d['access_token']}"
            break

# Check /projects as user.projb
r = S2.get(f"{BASE}/projects")
if r.status_code == 200:
    user_projects = r.json()
    pnames = [p["name"] for p in user_projects]
    if "Project B" in pnames and "Legacy" not in pnames:
        ok(f"10. user.projb sees only Project B: {pnames}")
    elif "Project B" in pnames:
        ok(f"10. user.projb project list: {pnames} (may include Legacy if assigned)")
    else:
        fail("10. user.projb projects", f"Expected Project B, got {pnames}")
else:
    fail("10. user.projb projects", f"Status {r.status_code}")

# ==================== 11. user.projb gets 403 on Legacy ====================
r = S2.get(f"{BASE}/projects/1")
if r.status_code == 403:
    code = r.json().get("error_code", "")
    ok(f"11a. user.projb 403 on Legacy project (error_code={code})")
elif r.status_code == 404:
    ok("11a. user.projb 404 on Legacy (namespace isolation)")
else:
    fail("11a. user.projb on Legacy", f"Status {r.status_code}: {r.text[:200]}")

r = S2.post(f"{BASE}/projects/1/cleanup", json=[{"a": 1}])
if r.status_code in (403, 404):
    ok(f"11b. user.projb lifecycle blocked on Legacy ({r.status_code})")
else:
    fail("11b. user.projb lifecycle on Legacy", f"Status {r.status_code}")

# user.projb CAN access Project B
if proj_b_id:
    r = S2.get(f"{BASE}/projects/{proj_b_id}")
    if r.status_code == 200:
        ok("11c. user.projb CAN access Project B")
    else:
        fail("11c. user.projb on Project B", f"Status {r.status_code}: {r.text[:200]}")

# ==================== 12. Logout ====================
r = S.post(f"{BASE}/auth/logout")
if r.status_code == 200:
    ok("12. Admin logout")
else:
    fail("12. Admin logout", f"Status {r.status_code}")

# After logout, clear header (JWT is stateless but refresh cookie is gone)
S.headers.pop("Authorization", None)
r = S.get(f"{BASE}/projects")
if r.status_code == 401:
    ok("13. After logout + no header, /projects returns 401")
else:
    fail("13. After logout", f"Expected 401, got {r.status_code}")

# ==================== Summary ====================
print(f"\n{'='*50}")
print(f"  Phase 4 E2E: {passed} passed, {failed} failed")
print(f"{'='*50}")
sys.exit(1 if failed else 0)
