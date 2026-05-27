"""Phase 3 supplemental: verify 403/not_assigned fires for non-admin users.

Setup:
  - Admin creates a second project ("Project B")
  - Admin creates a member user, assigns them ONLY to Legacy (project 1)
  - Member logs in, hits Project B endpoints -> expects 403 not_assigned
  - Member hits Legacy endpoints -> expects 200 (assigned)
"""

import requests
import sys

BASE = "http://127.0.0.1:8001"
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


# --- Admin setup ---
print("\n=== Admin setup ===")

for pwd in ["NewPass123!", "AM@dmin2026!"]:
    r = requests.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": pwd})
    if r.status_code == 200:
        break
assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text[:200]}"
data = r.json()
admin_token = data["access_token"]
admin_h = {"Authorization": f"Bearer {admin_token}"}
used_password = pwd

if data["user"]["must_change_password"]:
    requests.post(
        f"{BASE}/auth/change-password",
        json={"old_password": used_password, "new_password": "NewPass123!"},
        headers=admin_h,
    )
    r = requests.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "NewPass123!"})
    admin_token = r.json()["access_token"]
    admin_h = {"Authorization": f"Bearer {admin_token}"}

print("  Admin logged in")

# Create Project B (admin POST returns 201, body is the project object directly)
r = requests.post(
    f"{BASE}/admin/projects",
    json={"name": "Project B", "description": "Isolated test project"},
    headers={**admin_h, "Content-Type": "application/json"},
)
check("create Project B", r.status_code == 201, f"status={r.status_code} {r.text[:200]}")
project_b = r.json()
project_b_id = project_b.get("id")
print(f"  Project B id: {project_b_id}")

# Create a member user (idempotent: 201 = new, 409 = already exists)
MEMBER_USERNAME = "test.member.403"
MEMBER_PASSWORD = "Member403!"
r = requests.post(
    f"{BASE}/admin/users",
    json={"username": MEMBER_USERNAME, "password": MEMBER_PASSWORD, "display_name": "Test Member 403", "role": "member"},
    headers={**admin_h, "Content-Type": "application/json"},
)
check("create/find member user", r.status_code in (201, 409), f"status={r.status_code} {r.text[:200]}")

# Look up the user id from the users list
r_users = requests.get(f"{BASE}/admin/users", headers=admin_h)
member_id = None
for u in r_users.json():
    if u["username"] == MEMBER_USERNAME:
        member_id = u["id"]
        break
assert member_id, f"Could not find member user {MEMBER_USERNAME}"
print(f"  Member user id: {member_id}")

# Assign member ONLY to Legacy project (id=1) -- NOT to Project B
# POST /admin/projects/{id}/assignments returns 201, or 409 if duplicate
r = requests.post(
    f"{BASE}/admin/projects/1/assignments",
    json={"user_id": member_id},
    headers={**admin_h, "Content-Type": "application/json"},
)
check("assign member to Legacy", r.status_code in (201, 409), f"status={r.status_code} {r.text[:200]}")

# --- Member login (try both original and changed password) ---
print("\n=== Member login ===")
MEMBER_NEW_PASSWORD = "MemberNew403!"
for mpwd in [MEMBER_NEW_PASSWORD, MEMBER_PASSWORD]:
    r = requests.post(f"{BASE}/auth/login", json={"username": MEMBER_USERNAME, "password": mpwd})
    if r.status_code == 200:
        break
check("member login", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")
member_token = r.json()["access_token"]
member_h = {"Authorization": f"Bearer {member_token}"}

if r.json()["user"]["must_change_password"]:
    r = requests.post(
        f"{BASE}/auth/change-password",
        json={"old_password": mpwd, "new_password": MEMBER_NEW_PASSWORD},
        headers=member_h,
    )
    check("member change password", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    r = requests.post(f"{BASE}/auth/login", json={"username": MEMBER_USERNAME, "password": MEMBER_NEW_PASSWORD})
    member_token = r.json()["access_token"]
    member_h = {"Authorization": f"Bearer {member_token}"}

# --- Test 403 path: member hits Project B (not assigned) ---
print("\n=== 403 not_assigned tests ===")

PJ_B = f"{BASE}/projects/{project_b_id}"

r = requests.get(f"{PJ_B}/db/datasets", headers=member_h)
check("member -> Project B datasets: 403", r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")
if r.status_code == 403:
    body = r.json()
    error_code = body.get("detail", {}).get("error_code", "")
    check("error_code is not_assigned", error_code == "not_assigned", f"error_code={error_code}")

r = requests.post(
    f"{PJ_B}/cleanup",
    json=[{"Name": "Alice"}],
    headers={**member_h, "Content-Type": "application/json"},
    params={"remove_exclusion": False},
)
check("member -> Project B cleanup: 403", r.status_code == 403, f"status={r.status_code}")

r = requests.post(f"{PJ_B}/upload", headers=member_h)
check("member -> Project B upload: 403 (not 422)", r.status_code == 403, f"status={r.status_code}")

r = requests.post(
    f"{PJ_B}/db/save_baseline",
    json={"name": "Test", "records": [{"a": "1"}], "emp_col": "a", "mgr_col": "b"},
    headers={**member_h, "Content-Type": "application/json"},
)
check("member -> Project B save_baseline: 403", r.status_code == 403, f"status={r.status_code}")

# --- Test 200 path: member hits Legacy (assigned) ---
print("\n=== 200 assigned tests ===")

PJ_LEGACY = f"{BASE}/projects/1"

r = requests.get(f"{PJ_LEGACY}/db/datasets", headers=member_h)
check("member -> Legacy datasets: 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

r = requests.post(
    f"{PJ_LEGACY}/cleanup",
    json=[{"Name": "Alice"}],
    headers={**member_h, "Content-Type": "application/json"},
    params={"remove_exclusion": False},
)
check("member -> Legacy cleanup: 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

# --- Test admin can still access Project B (admin bypass) ---
print("\n=== Admin bypass ===")
r = requests.get(f"{PJ_B}/db/datasets", headers=admin_h)
check("admin -> Project B datasets: 200", r.status_code == 200, f"status={r.status_code}")

# --- Test that /projects list shows only assigned projects for member ---
print("\n=== Project visibility ===")
r = requests.get(f"{BASE}/projects", headers=member_h)
check("member GET /projects: 200", r.status_code == 200)
member_projects = r.json()
member_project_ids = [p["id"] for p in member_projects] if isinstance(member_projects, list) else []
check("member sees Legacy (id=1)", 1 in member_project_ids, f"ids={member_project_ids}")
check("member does NOT see Project B", project_b_id not in member_project_ids, f"ids={member_project_ids}")

# Summary
print(f"\n{'='*50}")
print(f"403 test results: {PASS_COUNT} passed, {FAIL_COUNT} failed")
if FAIL_COUNT > 0:
    sys.exit(1)
else:
    print("ALL 403 PATH CHECKS PASSED")
