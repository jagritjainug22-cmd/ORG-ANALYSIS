"""Phase 6b E2E smoke test -- Dataset-Level Lock Enforcement."""
import requests, json, sys, time

BASE = "http://127.0.0.1:8001"
RESULTS = []


def check(num, desc, passed, detail=""):
    RESULTS.append((num, desc, passed))
    mark = "PASS" if passed else "FAIL"
    print(f"  [{mark}] #{num}: {desc}" + (f" -- {detail}" if detail else ""))


# =====================================================================
# Setup: admin login, project, users, baseline dataset
# =====================================================================

print("\n=== Setup ===")
S_ADMIN = requests.Session()
for pwd in ["AM@dmin2026!", "AM@dmin2026!New"]:
    r = S_ADMIN.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": pwd})
    if r.status_code == 200 and not r.json().get("user", {}).get("must_change_password", False):
        S_ADMIN.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        break
print("  Admin logged in")

# Create test project
r = S_ADMIN.post(f"{BASE}/admin/projects", json={"name": "DSLockTest"})
project_id = r.json()["id"]
print(f"  Created project id={project_id}")

# Create two test users
USER_PWD = "DSLock1234!"
USER_FINAL_PWD = "DSLock5678!Z"
user_ids = {}

for uname in ["dslock.user1", "dslock.user2"]:
    r = S_ADMIN.post(f"{BASE}/admin/users", json={"username": uname, "password": USER_PWD, "role": "member"})
    if r.status_code == 409:
        users = S_ADMIN.get(f"{BASE}/admin/users").json()
        uid = next(u["id"] for u in users if u["username"] == uname)
    else:
        uid = r.json()["id"]
    S_ADMIN.patch(f"{BASE}/admin/users/{uid}", json={"is_active": True, "reset_password": USER_PWD})
    user_ids[uname] = uid
    S_ADMIN.post(f"{BASE}/admin/projects/{project_id}/assignments", json={"user_id": uid})

print(f"  Users: {user_ids}")


def login_user(uname):
    s = requests.Session()
    for pwd in [USER_FINAL_PWD, USER_PWD]:
        r = s.post(f"{BASE}/auth/login", json={"username": uname, "password": pwd})
        if r.status_code != 200:
            continue
        data = r.json()
        must_change = data.get("user", {}).get("must_change_password", False)
        if must_change:
            s.headers["Authorization"] = f"Bearer {data['access_token']}"
            s.post(f"{BASE}/auth/change-password", json={"old_password": pwd, "new_password": USER_FINAL_PWD})
            r3 = s.post(f"{BASE}/auth/login", json={"username": uname, "password": USER_FINAL_PWD})
            if r3.status_code == 200:
                s.headers["Authorization"] = f"Bearer {r3.json()['access_token']}"
                return s
        else:
            s.headers["Authorization"] = f"Bearer {data['access_token']}"
            return s
    raise Exception(f"Could not login as {uname}")


S1 = login_user("dslock.user1")
S2 = login_user("dslock.user2")
print("  Users logged in")

# User1 saves a baseline to create a dataset
baseline_records = [
    {"Employee_ID": "E001", "Manager_ID": None, "Name": "CEO", "FTE": 1.0, "FLC": 100000},
    {"Employee_ID": "E002", "Manager_ID": "E001", "Name": "VP-A", "FTE": 1.0, "FLC": 80000},
    {"Employee_ID": "E003", "Manager_ID": "E001", "Name": "VP-B", "FTE": 1.0, "FLC": 80000},
    {"Employee_ID": "E004", "Manager_ID": "E002", "Name": "Mgr-A1", "FTE": 1.0, "FLC": 60000},
]
r = S1.post(
    f"{BASE}/projects/{project_id}/db/save_baseline",
    json={
        "name": "DSLockBaseline",
        "records": baseline_records,
        "emp_col": "Employee_ID",
        "mgr_col": "Manager_ID",
        "fte_col": "FTE",
        "flc_col": "FLC",
    },
)
assert r.status_code == 200, f"save_baseline failed: {r.status_code} {r.text}"
dataset_id = r.json()["dataset_id"]
scenario_id = r.json()["scenarios"][0]["id"]
print(f"  Baseline saved: dataset_id={dataset_id}, scenario_id={scenario_id}")


# =====================================================================
# Dataset Lock Acquire / Release
# =====================================================================

print("\n=== Dataset Lock Acquire ===")
r = S1.post(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock", json={})
check(1, "User1 acquires dataset lock", r.status_code == 200 and r.json()["acquired"] == True)

r = S2.post(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock", json={})
d = r.json()
check(2, "User2 blocked by lock", r.status_code == 200 and d["acquired"] == False, f"holder={d.get('holder')}")

# =====================================================================
# Lock Status
# =====================================================================

print("\n=== Lock Status ===")
r = S2.get(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock")
d = r.json()
check(3, "Lock status shows holder", d["locked"] == True and d["holder"] == "dslock.user1")
check(4, "is_mine=False for user2", d["is_mine"] == False)
check(5, "last_heartbeat present", "last_heartbeat" in d and d["last_heartbeat"] is not None)

r = S1.get(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock")
check(6, "is_mine=True for user1", r.json()["is_mine"] == True)

# =====================================================================
# Heartbeat
# =====================================================================

print("\n=== Heartbeat ===")
r = S1.post(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock/heartbeat", json={})
check(7, "User1 heartbeat OK", r.status_code == 200 and r.json()["status"] == "ok")

r = S2.post(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock/heartbeat", json={})
d = r.json()
check(8, "User2 heartbeat -> lost", r.status_code == 200 and d["status"] == "lost", f"holder={d.get('holder')}")

# =====================================================================
# Mutation blocked for non-holder (423)
# =====================================================================

print("\n=== Mutation Blocked (423) ===")
r = S2.post(
    f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}/move",
    json={"emp_id": "E003", "new_mgr_id": "E002"},
)
d = r.json() if r.status_code == 423 else {}
check(9, "User2 move blocked with 423", r.status_code == 423, f"status={r.status_code}")
det = d.get("detail", d)
check(10, "error_code is dataset_locked", det.get("error_code") == "dataset_locked", f"code={det.get('error_code')}")
check(11, "423 includes holder info", det.get("holder") == "dslock.user1")

# Verify read-only access still works
r = S2.get(f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}")
check(12, "User2 can still GET scenario (read-only)", r.status_code == 200)

# =====================================================================
# Mutation allowed for holder
# =====================================================================

print("\n=== Mutation Allowed for Holder ===")
r = S1.post(
    f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}/move",
    json={"emp_id": "E003", "new_mgr_id": "E002"},
)
check(13, "User1 move succeeds", r.status_code == 200, f"status={r.status_code}")

# =====================================================================
# Lock Release + User2 Acquires
# =====================================================================

print("\n=== Lock Release ===")
r = S1.delete(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock")
check(14, "User1 releases lock", r.status_code == 200 and r.json()["status"] == "released")

r = S2.post(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock", json={})
check(15, "User2 acquires after release", r.json()["acquired"] == True)

# User2 can now mutate
r = S2.post(
    f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}/edit",
    json={"emp_id": "E004", "updates": {"Name": "Mgr-A1-Edited"}},
)
check(16, "User2 can mutate with lock", r.status_code == 200)

# User1 mutation now blocked
r = S1.post(
    f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}/flag",
    json={"emp_id": "E004", "flagged": True},
)
check(17, "User1 now blocked (423)", r.status_code == 423)

# =====================================================================
# Admin Force Release
# =====================================================================

print("\n=== Admin Override ===")
# Admin can mutate (bypasses lock)
r = S_ADMIN.post(
    f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}/flag",
    json={"emp_id": "E004", "flagged": True},
)
check(18, "Admin can mutate bypassing lock", r.status_code == 200)

# =====================================================================
# Lock on Logout
# =====================================================================

print("\n=== Lock on Logout ===")
# User2 still holds the lock, log them out
r = S2.post(f"{BASE}/auth/logout")
check(19, "User2 logout OK", r.status_code == 200)

# Lock should be released
r = S1.get(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock")
check(20, "Lock released after logout", r.json()["locked"] == False)

# =====================================================================
# Dataset list shows lock badges
# =====================================================================

print("\n=== Dataset List Lock Badges ===")
# Re-login user2, acquire lock
S2 = login_user("dslock.user2")
r = S2.post(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock", json={})
check(21, "User2 re-acquires lock", r.json()["acquired"] == True)

r = S1.get(f"{BASE}/projects/{project_id}/db/datasets")
datasets = r.json()["datasets"]
ds = next((d for d in datasets if d["id"] == dataset_id), None)
check(22, "Dataset list includes locked_by", ds is not None and ds["locked_by"] == "dslock.user2")

# Release for cleanup
S2.delete(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock")

# =====================================================================
# All scenario mutation endpoints gated
# =====================================================================

print("\n=== All Mutation Endpoints Gated ===")
# User1 acquires lock, user2 tries all mutation endpoints
S1.post(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock", json={})

endpoints = [
    ("POST", f"/db/scenarios/{scenario_id}/move", {"emp_id": "E002", "new_mgr_id": "E001"}),
    ("POST", f"/db/scenarios/{scenario_id}/edit", {"emp_id": "E002", "updates": {"Name": "X"}}),
    ("POST", f"/db/scenarios/{scenario_id}/add", {"record": {"Employee_ID": "E099", "Manager_ID": "E001", "Name": "New"}, "emp_id": "E099", "mgr_id": "E001", "level": 2, "fte": 1.0, "flc": 50000}),
    ("POST", f"/db/scenarios/{scenario_id}/flag", {"emp_id": "E002", "flagged": True}),
    ("POST", f"/db/scenarios/{scenario_id}/undo", {}),
    ("POST", f"/db/scenarios/{scenario_id}/promote", {}),
    ("POST", f"/db/scenarios/{scenario_id}/reset", {}),
    ("PATCH", f"/db/scenarios/{scenario_id}/rename", {"name": "Renamed", "description": ""}),
    ("POST", f"/db/datasets/{dataset_id}/scenarios", {"name": "NewScenario"}),
]

all_blocked = True
for method, path, body in endpoints:
    url = f"{BASE}/projects/{project_id}{path}"
    if method == "POST":
        resp = S2.post(url, json=body)
    elif method == "PATCH":
        resp = S2.patch(url, json=body)
    elif method == "DELETE":
        resp = S2.delete(url)
    else:
        continue
    if resp.status_code != 423:
        print(f"    WARNING: {method} {path} returned {resp.status_code} (expected 423)")
        all_blocked = False
check(23, "All 9 mutation endpoints return 423 for non-holder", all_blocked)

# DELETE scenario also gated
resp_del = S2.delete(f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}")
check(24, "DELETE scenario returns 423 for non-holder", resp_del.status_code == 423)

# GET endpoints still open
r = S2.get(f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}")
check(25, "GET scenario still open", r.status_code == 200)
r = S2.get(f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}/change_log")
check(26, "GET change_log still open", r.status_code == 200)
r = S2.get(f"{BASE}/projects/{project_id}/db/scenarios/{scenario_id}/summary")
check(27, "GET summary still open", r.status_code == 200)

# Cleanup lock
S1.delete(f"{BASE}/projects/{project_id}/db/datasets/{dataset_id}/lock")

# =====================================================================
# Audit Log
# =====================================================================

print("\n=== Audit Log ===")
r = S_ADMIN.get(f"{BASE}/admin/audit-log", params={"action": "dataset_lock_acquired"})
entries = r.json()
check(28, "dataset_lock_acquired in audit log", len(entries) > 0)

r = S_ADMIN.get(f"{BASE}/admin/audit-log", params={"action": "dataset_lock_released"})
entries = r.json()
check(29, "dataset_lock_released in audit log", len(entries) > 0)


# =====================================================================
# Summary
# =====================================================================

total = len(RESULTS)
passed = sum(1 for _, _, p in RESULTS if p)
failed = [(n, d) for n, d, p in RESULTS if not p]

print(f"\n{'=' * 60}")
print(f"  Phase 6b E2E: {passed}/{total} checks passed")
if failed:
    print("  FAILURES:")
    for n, d in failed:
        print(f"    #{n}: {d}")
print(f"{'=' * 60}")

sys.exit(0 if not failed else 1)
