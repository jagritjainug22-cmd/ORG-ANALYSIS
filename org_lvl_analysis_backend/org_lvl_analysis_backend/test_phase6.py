"""Phase 6 E2E smoke test -- Soft Locks + Deadline Enforcement."""
import requests, json, sys, time

BASE = "http://127.0.0.1:8001"
RESULTS = []

def check(num, desc, passed, detail=""):
    RESULTS.append((num, desc, passed))
    mark = "PASS" if passed else "FAIL"
    print(f"  [{mark}] #{num}: {desc}" + (f" -- {detail}" if detail else ""))

# --- Admin login ---
print("\n=== Setup ===")
S_ADMIN = requests.Session()
for pwd in ["AM@dmin2026!", "AM@dmin2026!New"]:
    r = S_ADMIN.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": pwd})
    if r.status_code == 200 and not r.json().get("must_change_password"):
        S_ADMIN.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        break
print("  Admin logged in")

# Create test project with 72h deadline (triggers warning)
from datetime import datetime, timedelta
near_deadline = (datetime.utcnow() + timedelta(hours=48)).strftime("%Y-%m-%d")
r = S_ADMIN.post(f"{BASE}/admin/projects", json={"name": "LockTest", "deadline": near_deadline})
project_id = r.json()["id"]
print(f"  Created project id={project_id} with deadline {near_deadline}")

# Create two test users and ensure they can login with known passwords
USER_PWD = "Lock1234!"
USER_FINAL_PWD = "Lock5678!Z"
user_ids = {}

for uname in ["lock.user1", "lock.user2"]:
    r = S_ADMIN.post(f"{BASE}/admin/users", json={"username": uname, "password": USER_PWD, "role": "member"})
    if r.status_code == 409:
        users = S_ADMIN.get(f"{BASE}/admin/users").json()
        uid = next(u["id"] for u in users if u["username"] == uname)
    else:
        uid = r.json()["id"]
    # Ensure active + reset password to known value
    S_ADMIN.patch(f"{BASE}/admin/users/{uid}", json={"is_active": True, "reset_password": USER_PWD})
    user_ids[uname] = uid
    # Assign to project (ignore 409)
    S_ADMIN.post(f"{BASE}/admin/projects/{project_id}/assignments", json={"user_id": uid})

def login_user(uname):
    """Login, complete must_change_password if needed, return session."""
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

S1 = login_user("lock.user1")
S2 = login_user("lock.user2")
print("  Users logged in")

# === Lock Tests ===
print("\n=== Lock Acquire ===")
r = S1.post(f"{BASE}/projects/{project_id}/lock", json={})
check(1, "User1 acquires lock", r.status_code == 200 and r.json()["acquired"] == True)

r = S2.post(f"{BASE}/projects/{project_id}/lock", json={})
check(2, "User2 blocked by lock", r.status_code == 200 and r.json()["acquired"] == False, f"holder={r.json().get('holder')}")

print("\n=== Lock Status ===")
r = S2.get(f"{BASE}/projects/{project_id}/lock")
check(3, "Lock status shows holder", r.json().get("locked") == True and r.json().get("holder") == "lock.user1")
check(4, "is_mine=False for user2", r.json().get("is_mine") == False)

r = S1.get(f"{BASE}/projects/{project_id}/lock")
check(5, "is_mine=True for user1", r.json().get("is_mine") == True)

print("\n=== Heartbeat ===")
r = S1.post(f"{BASE}/projects/{project_id}/lock/heartbeat", json={})
check(6, "User1 heartbeat OK", r.status_code == 200)

r = S2.post(f"{BASE}/projects/{project_id}/lock/heartbeat", json={})
check(7, "User2 heartbeat -> lost (lock held by user1)", r.status_code == 200 and r.json().get("status") == "lost")

print("\n=== Lock Release ===")
r = S1.delete(f"{BASE}/projects/{project_id}/lock")
check(8, "User1 releases lock", r.status_code == 200 and r.json().get("status") == "released")

r = S2.post(f"{BASE}/projects/{project_id}/lock", json={})
check(9, "User2 acquires after release", r.json().get("acquired") == True)

# Admin force release
r = S_ADMIN.delete(f"{BASE}/projects/{project_id}/lock")
check(10, "Admin force-releases lock", r.status_code == 200 and r.json().get("status") == "released")

r = S1.get(f"{BASE}/projects/{project_id}/lock")
check(11, "Lock is now free", r.json().get("locked") == False)

print("\n=== Lock on Logout ===")
S1_fresh = login_user("lock.user1")
r = S1_fresh.post(f"{BASE}/projects/{project_id}/lock", json={})
check(12, "User1 re-acquires lock", r.json().get("acquired") == True)

r = S1_fresh.post(f"{BASE}/auth/logout")
check(13, "User1 logout OK", r.status_code == 200)

# Check lock released
S1_check = login_user("lock.user1")
r = S1_check.get(f"{BASE}/projects/{project_id}/lock")
check(14, "Lock released after logout", r.json().get("locked") == False)

print("\n=== Deadline Warning ===")
r = S1_check.get(f"{BASE}/projects/{project_id}")
check(15, "Project detail has deadline_warning field", "deadline_warning" in r.json())
check(16, "deadline_warning is True (within 72h)", r.json().get("deadline_warning") == True, f"hours_left={r.json().get('hours_until_deadline')}")

print("\n=== Project List Lock Status ===")
S1_check.post(f"{BASE}/projects/{project_id}/lock", json={})
r = S1_check.get(f"{BASE}/projects")
proj = next((p for p in r.json() if p["id"] == project_id), None)
check(17, "Project list includes locked_by", proj and proj.get("locked_by") == "lock.user1")
check(18, "Project list includes deadline_warning", proj and proj.get("deadline_warning") == True)

# Release and cleanup
S1_check.delete(f"{BASE}/projects/{project_id}/lock")

print("\n=== Expired Deadline Block ===")
# Set project deadline to yesterday
yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
S_ADMIN.patch(f"{BASE}/admin/projects/{project_id}", json={"deadline": yesterday})

r = S1_check.get(f"{BASE}/projects/{project_id}")
check(19, "Expired project returns 403", r.status_code == 403, f"status={r.status_code}")
if r.status_code == 403:
    check(20, "error_code is project_deadline_expired", r.json().get("detail", {}).get("error_code") == "project_deadline_expired")
else:
    check(20, "error_code check (skipped)", False)

# Admin can still access expired project
r = S_ADMIN.get(f"{BASE}/projects/{project_id}")
check(21, "Admin can access expired project", r.status_code == 200)

print("\n=== Audit Log ===")
r = S_ADMIN.get(f"{BASE}/admin/audit-log", params={"action": "project.lock_acquired"})
check(22, "Lock acquire in audit log", r.status_code == 200 and len(r.json()) > 0)
r = S_ADMIN.get(f"{BASE}/admin/audit-log", params={"action": "project.lock_released"})
check(23, "Lock release in audit log", r.status_code == 200 and len(r.json()) > 0)

# Cleanup: hard delete test project
S_ADMIN.post(f"{BASE}/admin/projects/{project_id}/delete", json={})

# === Summary ===
print("\n" + "=" * 60)
passed = sum(1 for _, _, p in RESULTS if p)
total = len(RESULTS)
print(f"  Phase 6 E2E: {passed}/{total} checks passed")
if passed < total:
    print("  FAILURES:")
    for n, d, p in RESULTS:
        if not p: print(f"    #{n}: {d}")
print("=" * 60)
sys.exit(0 if passed == total else 1)
