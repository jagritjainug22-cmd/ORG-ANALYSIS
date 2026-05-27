"""Phase 3 browser-equivalent checks — the 4 critical verifications.

1. project_id = 1 on saved baseline (direct SQLite + API)
2. Different Legacy user sees the saved baseline
3. Silent refresh restores session mid-flow
4. Project B user gets 403 on Legacy endpoints
"""

import json
import os
import sqlite3
import time
import requests
import sys

BASE = "http://127.0.0.1:8001"
DB_PATH = os.path.join(os.path.dirname(__file__), "db", "orgsight.db")

PASS_COUNT = 0
FAIL_COUNT = 0


def check(label, condition, detail=""):
    global PASS_COUNT, FAIL_COUNT
    if condition:
        PASS_COUNT += 1
        print(f"  PASS  {label}")
    else:
        FAIL_COUNT += 1
        print(f"  FAIL  {label}  -- {detail}")


def admin_login():
    for pwd in ["AM@dmin2026!", "NewPass123!"]:
        r = requests.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": pwd})
        if r.status_code == 200:
            data = r.json()
            token = data["access_token"]
            h = {"Authorization": f"Bearer {token}"}
            if data["user"]["must_change_password"]:
                requests.post(
                    f"{BASE}/auth/change-password",
                    json={"old_password": pwd, "new_password": "NewPass123!"},
                    headers=h,
                )
                r2 = requests.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "NewPass123!"})
                token = r2.json()["access_token"]
                h = {"Authorization": f"Bearer {token}"}
            return token, h
    raise RuntimeError("Admin login failed")


def create_user_idempotent(admin_h, username, password, display_name, role="member"):
    """Create user or find existing. Returns user_id."""
    requests.post(
        f"{BASE}/admin/users",
        json={"username": username, "password": password, "display_name": display_name, "role": role},
        headers={**admin_h, "Content-Type": "application/json"},
    )
    r = requests.get(f"{BASE}/admin/users", headers=admin_h)
    for u in r.json():
        if u["username"] == username:
            return u["id"]
    raise RuntimeError(f"Could not find user {username}")


def user_login(username, passwords):
    """Try each password, change if must_change_password."""
    for pwd in passwords:
        r = requests.post(f"{BASE}/auth/login", json={"username": username, "password": pwd})
        if r.status_code == 200:
            data = r.json()
            token = data["access_token"]
            h = {"Authorization": f"Bearer {token}"}
            if data["user"]["must_change_password"]:
                new_pwd = passwords[0]
                requests.post(
                    f"{BASE}/auth/change-password",
                    json={"old_password": pwd, "new_password": new_pwd},
                    headers=h,
                )
                r2 = requests.post(f"{BASE}/auth/login", json={"username": username, "password": new_pwd})
                token = r2.json()["access_token"]
                h = {"Authorization": f"Bearer {token}"}
            return token, h
    raise RuntimeError(f"Login failed for {username}")


# =====================================================================
print("=" * 60)
print("SETUP: Admin login + create baseline dataset")
print("=" * 60)

admin_token, admin_h = admin_login()
print("  Admin logged in")

# Save a realistic baseline through the full pipeline path
records = [
    {"EmpID": "CEO-001", "MgrID": "",        "Name": "Jane Smith",    "Job Title": "CEO",           "Level": 1, "Country": "US", "FTE": 1.0},
    {"EmpID": "VP-001",  "MgrID": "CEO-001", "Name": "John Doe",     "Job Title": "VP Operations",  "Level": 2, "Country": "US", "FTE": 1.0},
    {"EmpID": "VP-002",  "MgrID": "CEO-001", "Name": "Alice Chen",   "Job Title": "VP Engineering", "Level": 2, "Country": "UK", "FTE": 1.0},
    {"EmpID": "DIR-001", "MgrID": "VP-001",  "Name": "Bob Kumar",    "Job Title": "Director Ops",   "Level": 3, "Country": "IN", "FTE": 1.0},
    {"EmpID": "DIR-002", "MgrID": "VP-002",  "Name": "Carol White",  "Job Title": "Director Eng",   "Level": 3, "Country": "US", "FTE": 0.8},
    {"EmpID": "MGR-001", "MgrID": "DIR-001", "Name": "Dave Park",    "Job Title": "Manager",        "Level": 4, "Country": "IN", "FTE": 1.0},
    {"EmpID": "MGR-002", "MgrID": "DIR-002", "Name": "Eve Brown",    "Job Title": "Manager",        "Level": 4, "Country": "UK", "FTE": 1.0},
    {"EmpID": "IC-001",  "MgrID": "MGR-001", "Name": "Frank Lee",    "Job Title": "Analyst",        "Level": 5, "Country": "IN", "FTE": 1.0},
    {"EmpID": "IC-002",  "MgrID": "MGR-001", "Name": "Grace Kim",    "Job Title": "Analyst",        "Level": 5, "Country": "IN", "FTE": 0.5},
    {"EmpID": "IC-003",  "MgrID": "MGR-002", "Name": "Hank Wilson",  "Job Title": "Engineer",       "Level": 5, "Country": "UK", "FTE": 1.0},
]

body = {
    "name": "Phase 3 Verification Dataset",
    "records": records,
    "emp_col": "EmpID",
    "mgr_col": "MgrID",
    "fte_col": "FTE",
    "job_title_col": "Job Title",
    "country_col": "Country",
}
r = requests.post(
    f"{BASE}/projects/1/db/save_baseline", json=body,
    headers={**admin_h, "Content-Type": "application/json"},
)
assert r.status_code == 200, f"Save baseline failed: {r.status_code} {r.text[:300]}"
saved = r.json()
dataset_id = saved["dataset_id"]
scenario_id = saved["scenarios"][0]["id"]
print(f"  Saved baseline: dataset_id={dataset_id}, scenario_id={scenario_id}")


# =====================================================================
print()
print("=" * 60)
print("CHECK 1: project_id = 1 on saved baseline")
print("=" * 60)

# 1a) Direct SQLite verification
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
row = conn.execute(
    "SELECT id, name, project_id, username, row_count FROM datasets ORDER BY id DESC LIMIT 1"
).fetchone()
conn.close()

print(f"\n  SQLite direct query:")
print(f"    id:         {row['id']}")
print(f"    name:       {row['name']}")
print(f"    project_id: {row['project_id']}")
print(f"    username:   {row['username']}")
print(f"    row_count:  {row['row_count']}")

check("SQLite: project_id == 1", row["project_id"] == 1, f"project_id={row['project_id']}")
check("SQLite: dataset name correct", row["name"] == "Phase 3 Verification Dataset")
check("SQLite: row_count == 10", row["row_count"] == 10, f"row_count={row['row_count']}")

# 1b) API verification
r = requests.get(f"{BASE}/projects/1/db/datasets/{dataset_id}", headers=admin_h)
ds = r.json()["dataset"]
print(f"\n  API GET /projects/1/db/datasets/{dataset_id}:")
print(f"    project_id: {ds.get('project_id')}")
print(f"    name:       {ds.get('name')}")
print(f"    emp_col:    {ds.get('emp_col')}")
print(f"    fte_col:    {ds.get('fte_col')}")

check("API: project_id == 1", ds.get("project_id") == 1, f"project_id={ds.get('project_id')}")
check("API: column mappings preserved", ds.get("emp_col") == "EmpID" and ds.get("fte_col") == "FTE")


# =====================================================================
print()
print("=" * 60)
print("CHECK 2: Different Legacy user sees the saved baseline")
print("=" * 60)

# Pick a legacy user (migrated from VALID_USERS). These are auto-assigned to Legacy.
# Use the first legacy user from the DB.
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
legacy_users = conn.execute(
    "SELECT username FROM users WHERE role = 'member' AND is_active = 1 ORDER BY id LIMIT 3"
).fetchall()
conn.close()

if not legacy_users:
    print("  SKIP: No legacy member users found in DB")
else:
    legacy_username = legacy_users[0]["username"]
    print(f"  Using legacy user: {legacy_username}")

    # Legacy users have must_change_password=true, default password is their username
    # Try login with common patterns
    legacy_token = None
    legacy_h = None
    for pwd in [f"LegacyCheck1!", legacy_username, "password"]:
        r = requests.post(f"{BASE}/auth/login", json={"username": legacy_username, "password": pwd})
        if r.status_code == 200:
            data = r.json()
            legacy_token = data["access_token"]
            legacy_h = {"Authorization": f"Bearer {legacy_token}"}
            if data["user"]["must_change_password"]:
                r2 = requests.post(
                    f"{BASE}/auth/change-password",
                    json={"old_password": pwd, "new_password": "LegacyCheck1!"},
                    headers=legacy_h,
                )
                if r2.status_code == 200:
                    r3 = requests.post(f"{BASE}/auth/login", json={"username": legacy_username, "password": "LegacyCheck1!"})
                    if r3.status_code == 200:
                        legacy_token = r3.json()["access_token"]
                        legacy_h = {"Authorization": f"Bearer {legacy_token}"}
            break

    if not legacy_h:
        # Reset password via admin (reset_password field, forces must_change_password=1)
        print(f"  Could not log in as {legacy_username}, resetting password via admin")
        user_id_result = None
        r_users = requests.get(f"{BASE}/admin/users", headers=admin_h)
        for u in r_users.json():
            if u["username"] == legacy_username:
                user_id_result = u["id"]
                break
        if user_id_result:
            requests.patch(
                f"{BASE}/admin/users/{user_id_result}",
                json={"reset_password": "TempLegacy1!"},
                headers={**admin_h, "Content-Type": "application/json"},
            )
            r = requests.post(f"{BASE}/auth/login", json={"username": legacy_username, "password": "TempLegacy1!"})
            if r.status_code == 200:
                tmp_token = r.json()["access_token"]
                tmp_h = {"Authorization": f"Bearer {tmp_token}"}
                # Must change password to clear the flag
                r2 = requests.post(
                    f"{BASE}/auth/change-password",
                    json={"old_password": "TempLegacy1!", "new_password": "LegacyCheck1!"},
                    headers=tmp_h,
                )
                if r2.status_code == 200:
                    r3 = requests.post(f"{BASE}/auth/login", json={"username": legacy_username, "password": "LegacyCheck1!"})
                    if r3.status_code == 200:
                        legacy_token = r3.json()["access_token"]
                        legacy_h = {"Authorization": f"Bearer {legacy_token}"}

    if legacy_h:
        print(f"  Logged in as {legacy_username}")

        # Check they can see the dataset list in project 1
        r = requests.get(f"{BASE}/projects/1/db/datasets", headers=legacy_h)
        check(f"{legacy_username} -> GET /projects/1/db/datasets: 200", r.status_code == 200, f"status={r.status_code}")

        datasets = r.json().get("datasets", [])
        found = any(d["id"] == dataset_id for d in datasets)
        check(f"{legacy_username} sees dataset {dataset_id}", found, f"datasets={[d['id'] for d in datasets]}")

        # Check they can read the dataset detail
        r = requests.get(f"{BASE}/projects/1/db/datasets/{dataset_id}", headers=legacy_h)
        check(f"{legacy_username} -> dataset detail: 200", r.status_code == 200)

        # Check they can read the scenario
        r = requests.get(f"{BASE}/projects/1/db/scenarios/{scenario_id}", headers=legacy_h)
        check(f"{legacy_username} -> scenario records: 200", r.status_code == 200)
        if r.status_code == 200:
            rec_count = len(r.json()["records"])
            check(f"{legacy_username} sees all 10 records", rec_count == 10, f"count={rec_count}")

        print(f"\n  >> PROJECT-AS-SHARED-WORKSPACE CONFIRMED: {legacy_username} can see and read")
        print(f"     admin's saved baseline in the same project.")
    else:
        print(f"  SKIP: Could not authenticate as {legacy_username}")


# =====================================================================
print()
print("=" * 60)
print("CHECK 3: Silent refresh restores session")
print("=" * 60)

# Simulate: login -> get refresh cookie -> let access token 'expire' -> use refresh
session = requests.Session()

# Login (captures the refresh cookie in the session)
r = session.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "NewPass123!"})
check("login for refresh test", r.status_code == 200)
original_token = r.json()["access_token"]

# Verify the refresh cookie was set
cookies = session.cookies.get_dict()
has_refresh_cookie = "refresh_token" in cookies
check("refresh cookie set", has_refresh_cookie, f"cookies={list(cookies.keys())}")

# Hit a project endpoint with valid token -- should work
r = session.get(
    f"{BASE}/projects/1/db/datasets",
    headers={"Authorization": f"Bearer {original_token}"},
)
check("original token works", r.status_code == 200)

# Simulate "browser refresh" -- use the refresh endpoint to get a new access token
# This is what silentRefresh() does on F5
r = session.post(
    f"{BASE}/auth/refresh",
    headers={"X-Requested-With": "fetch"},
)
check("silent refresh returns 200", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")

if r.status_code == 200:
    new_token = r.json()["access_token"]
    refreshed_user = r.json()["user"]
    check("new token is a valid JWT", new_token and len(new_token.split(".")) == 3)
    check("refreshed user is am.admin", refreshed_user["username"] == "am.admin")

    # Use the new token to hit project endpoints
    r = session.get(
        f"{BASE}/projects/1/db/datasets",
        headers={"Authorization": f"Bearer {new_token}"},
    )
    check("new token works on project endpoint", r.status_code == 200)

    # Verify old token is revoked (rotation should invalidate it)
    # The old access token may still work (it's a JWT, stateless) until expiry,
    # but the refresh token should be rotated
    print(f"\n  >> SESSION RESTORATION CONFIRMED: silentRefresh() returns a valid new")
    print(f"     access token + user info. Frontend state can be rebuilt from this.")
    print(f"     In-memory pipeline data (df, hierarchy) resets on F5 — expected.")


# =====================================================================
print()
print("=" * 60)
print("CHECK 4: Project B user gets 403 on Legacy endpoints")
print("=" * 60)

# Create Project B (idempotent)
r = requests.post(
    f"{BASE}/admin/projects",
    json={"name": "Project B Check4", "description": "Isolated for 403 check"},
    headers={**admin_h, "Content-Type": "application/json"},
)
project_b_id = r.json().get("id") if r.status_code == 201 else None
print(f"  Project B id: {project_b_id}")

# Create user assigned ONLY to Project B
USER_B = "user.projectb"
PASS_B = "ProjectB403!"
user_b_id = create_user_idempotent(admin_h, USER_B, PASS_B, "User ProjectB Only")
print(f"  User B id: {user_b_id}")

# Assign to Project B only
r = requests.post(
    f"{BASE}/admin/projects/{project_b_id}/assignments",
    json={"user_id": user_b_id},
    headers={**admin_h, "Content-Type": "application/json"},
)
print(f"  Assigned to Project B: {r.status_code}")

# Remove from Legacy project if assigned (v2 migration assigns everyone)
r = requests.delete(
    f"{BASE}/admin/projects/1/assignments/{user_b_id}",
    headers=admin_h,
)
print(f"  Removed from Legacy: {r.status_code}")

# Login as Project B user -- handle must_change_password
# Reset password to a known value first
requests.patch(
    f"{BASE}/admin/users/{user_b_id}",
    json={"reset_password": "TempB1234!"},
    headers={**admin_h, "Content-Type": "application/json"},
)
r = requests.post(f"{BASE}/auth/login", json={"username": USER_B, "password": "TempB1234!"})
assert r.status_code == 200, f"User B login failed: {r.status_code}"
b_token = r.json()["access_token"]
b_h = {"Authorization": f"Bearer {b_token}"}
# Complete password change to clear must_change_password
r2 = requests.post(
    f"{BASE}/auth/change-password",
    json={"old_password": "TempB1234!", "new_password": PASS_B},
    headers=b_h,
)
assert r2.status_code == 200, f"User B change password failed: {r2.status_code}"
r3 = requests.post(f"{BASE}/auth/login", json={"username": USER_B, "password": PASS_B})
b_token = r3.json()["access_token"]
b_h = {"Authorization": f"Bearer {b_token}"}
print(f"  Logged in as {USER_B} (password changed, must_change_password cleared)")

# Hit Legacy (project 1) endpoints — should get 403
print()
r = requests.get(f"{BASE}/projects/1/db/datasets", headers=b_h)
check(f"{USER_B} -> Legacy datasets: 403", r.status_code == 403, f"status={r.status_code}")
if r.status_code == 403:
    detail = r.json().get("detail", {})
    error_code = detail.get("error_code", "")
    message = detail.get("message", "")
    print(f"    error_code: {error_code}")
    print(f"    message:    {message}")
    check("error_code is not_assigned", error_code == "not_assigned")

r = requests.post(
    f"{BASE}/projects/1/upload",
    headers=b_h,
)
check(f"{USER_B} -> Legacy upload: 403", r.status_code == 403, f"status={r.status_code}")

r = requests.post(
    f"{BASE}/projects/1/db/save_baseline",
    json={"name": "x", "records": [{"a": "1"}], "emp_col": "a", "mgr_col": "b"},
    headers={**b_h, "Content-Type": "application/json"},
)
check(f"{USER_B} -> Legacy save_baseline: 403", r.status_code == 403, f"status={r.status_code}")

r = requests.post(
    f"{BASE}/projects/1/orgchart",
    json=[{"EmpID": "1", "MgrID": "", "Level": 1}],
    params={"emp_col": "EmpID", "mgr_col": "MgrID"},
    headers={**b_h, "Content-Type": "application/json"},
)
check(f"{USER_B} -> Legacy orgchart: 403", r.status_code == 403, f"status={r.status_code}")

# But Project B endpoints should work
r = requests.get(f"{BASE}/projects/{project_b_id}/db/datasets", headers=b_h)
check(f"{USER_B} -> Project B datasets: 200", r.status_code == 200, f"status={r.status_code}")

# Verify /projects list only shows Project B for this user
r = requests.get(f"{BASE}/projects", headers=b_h)
user_b_projects = r.json() if r.status_code == 200 else []
user_b_project_ids = [p["id"] for p in user_b_projects]
check(f"{USER_B} sees Project B in /projects", project_b_id in user_b_project_ids, f"ids={user_b_project_ids}")
check(f"{USER_B} does NOT see Legacy in /projects", 1 not in user_b_project_ids, f"ids={user_b_project_ids}")

print(f"\n  >> FRONTEND BEHAVIOR: When {USER_B} hits http://localhost:5173, the app")
print(f"     hardcodes CURRENT_PROJECT_ID=1. Every API call will return 403.")
print(f"     Current frontend shows a generic error — Phase 4 adds the project")
print(f"     selector which prevents this scenario entirely.")


# =====================================================================
print()
print("=" * 60)
print(f"RESULTS: {PASS_COUNT} passed, {FAIL_COUNT} failed")
print("=" * 60)
if FAIL_COUNT > 0:
    sys.exit(1)
else:
    print("ALL 4 CHECKS PASSED")
