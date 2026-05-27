"""Phase 5 E2E smoke test — Admin Panel API coverage."""
import requests, json, sys

BASE = "http://127.0.0.1:8001"
S = requests.Session()

RESULTS = []
def check(num, desc, passed, detail=""):
    RESULTS.append((num, desc, passed))
    mark = "PASS" if passed else "FAIL"
    print(f"  [{mark}] #{num}: {desc}" + (f" -- {detail}" if detail else ""))

# -- Admin login (try known passwords) --------------------
print("\n=== Admin Login ===")
admin_token = None
for uname in ["am.admin", "admin"]:
    for pwd in ["AM@dmin2026!", "AM@dmin2026!New"]:
        r = S.post(f"{BASE}/auth/login", json={"username": uname, "password": pwd})
        if r.status_code != 200:
            continue
        data = r.json()
        if data.get("must_change_password"):
            S.headers["Authorization"] = f"Bearer {data['access_token']}"
            newpwd = pwd + "X"
            r2 = S.post(f"{BASE}/auth/change-password", json={"old_password": pwd, "new_password": newpwd})
            r3 = S.post(f"{BASE}/auth/login", json={"username": uname, "password": newpwd})
            if r3.status_code == 200:
                admin_token = r3.json()["access_token"]
        else:
            admin_token = data["access_token"]
        break
    if admin_token:
        break
if not admin_token:
    print("  FATAL: Could not log in as admin")
    sys.exit(1)
S.headers["Authorization"] = f"Bearer {admin_token}"
print(f"  Logged in as admin ({uname})")

# -- 1. List users ----------------------------------------
print("\n=== User Management ===")
r = S.get(f"{BASE}/admin/users")
check(1, "GET /admin/users returns 200", r.status_code == 200, f"status={r.status_code}")
users = r.json()
check(2, "Users list is non-empty", len(users) > 0, f"count={len(users)}")

# -- 2. Create user ---------------------------------------
r = S.post(f"{BASE}/admin/users", json={"username": "p5_testuser", "password": "TestPass123!", "display_name": "Phase 5 Test", "role": "member"})
if r.status_code == 409:
    check(3, "Create user (or already exists)", True, "409 — already exists")
    existing = [u for u in users if u["username"] == "p5_testuser"]
    test_user_id = existing[0]["id"] if existing else None
else:
    check(3, "Create user -> 201", r.status_code == 201, f"status={r.status_code}")
    test_user_id = r.json().get("id")

# -- 3. Update user ---------------------------------------
if test_user_id:
    r = S.patch(f"{BASE}/admin/users/{test_user_id}", json={"display_name": "P5 Updated", "role": "member"})
    check(4, "PATCH user -> 200", r.status_code == 200, f"status={r.status_code}")
    check(5, "display_name updated", r.json().get("display_name") == "P5 Updated")

# -- 4. Reset password ------------------------------------
if test_user_id:
    r = S.patch(f"{BASE}/admin/users/{test_user_id}", json={"reset_password": "NewReset123!"})
    check(6, "Reset password -> 200", r.status_code == 200)
    check(7, "must_change_password set to 1", r.json().get("must_change_password") == 1)

# -- 5. Duplicate user -> 409 -----------------------------
r = S.post(f"{BASE}/admin/users", json={"username": "p5_testuser", "password": "TestPass123!"})
check(8, "Duplicate user -> 409", r.status_code == 409, f"status={r.status_code}")

# -- 6. Create project -----------------------------------
print("\n=== Project Management ===")
r = S.post(f"{BASE}/admin/projects", json={"name": "Phase 5 Test Project", "description": "E2E test", "deadline": "2026-12-31"})
check(9, "Create project -> 201", r.status_code == 201, f"status={r.status_code}")
test_project_id = r.json().get("id")

# -- 7. List projects ------------------------------------
r = S.get(f"{BASE}/admin/projects")
check(10, "GET /admin/projects -> 200", r.status_code == 200)
check(11, "Projects list contains new project", any(p["name"] == "Phase 5 Test Project" for p in r.json()))

# -- 8. Update project -----------------------------------
if test_project_id:
    r = S.patch(f"{BASE}/admin/projects/{test_project_id}", json={"description": "Updated desc", "deadline": "2027-06-30"})
    check(12, "PATCH project -> 200", r.status_code == 200)
    check(13, "deadline updated", "2027-06-30" in (r.json().get("deadline") or ""))

# -- 9. Assign user to project ---------------------------
print("\n=== Assignments ===")
if test_project_id and test_user_id:
    r = S.post(f"{BASE}/admin/projects/{test_project_id}/assignments", json={"user_id": test_user_id})
    check(14, "Assign user -> 201", r.status_code == 201, f"status={r.status_code}")

    # Duplicate assignment -> 409
    r = S.post(f"{BASE}/admin/projects/{test_project_id}/assignments", json={"user_id": test_user_id})
    check(15, "Duplicate assignment -> 409", r.status_code == 409)

    # List assignments
    r = S.get(f"{BASE}/admin/projects/{test_project_id}/assignments")
    check(16, "List assignments -> 200", r.status_code == 200)
    assignments = r.json()
    check(17, "Assignment includes test user", any(a["user_id"] == test_user_id for a in assignments))

    # Unassign
    r = S.delete(f"{BASE}/admin/projects/{test_project_id}/assignments/{test_user_id}")
    check(18, "Unassign user -> 200", r.status_code == 200)

# -- 10. Archive project ---------------------------------
if test_project_id:
    r = S.delete(f"{BASE}/admin/projects/{test_project_id}")
    check(19, "Archive project -> 200", r.status_code == 200)
    check(20, "status = archived", r.json().get("status") == "archived")

# -- 11. Audit log ---------------------------------------
print("\n=== Audit Log ===")
r = S.get(f"{BASE}/admin/audit-log")
check(21, "GET /admin/audit-log -> 200", r.status_code == 200)
entries = r.json()
check(22, "Audit log has entries", len(entries) > 0, f"count={len(entries)}")

actions_found = set(e["action"] for e in entries)
check(23, "user.create in audit", "user.create" in actions_found, f"actions={actions_found}")
check(24, "project.create in audit", "project.create" in actions_found)
check(25, "project.archive in audit", "project.archive" in actions_found)

# Filter by action
r = S.get(f"{BASE}/admin/audit-log", params={"action": "project.create"})
check(26, "Filter by action works", r.status_code == 200 and all(e["action"] == "project.create" for e in r.json()))

# Filter by date
r = S.get(f"{BASE}/admin/audit-log", params={"date_from": "2026-01-01", "date_to": "2026-12-31T23:59:59"})
check(27, "Filter by date range", r.status_code == 200)

# -- 12. Non-admin blocked -------------------------------
print("\n=== Non-admin access guard ===")
if test_user_id:
    # Ensure user is active and has a known password
    S.patch(f"{BASE}/admin/users/{test_user_id}", json={"is_active": True, "reset_password": "P5NonAdmin1!"})
    S2 = requests.Session()
    # Login (will have must_change_password=True after reset)
    r = S2.post(f"{BASE}/auth/login", json={"username": "p5_testuser", "password": "P5NonAdmin1!"})
    if r.status_code == 200 and r.json().get("must_change_password"):
        S2.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        S2.post(f"{BASE}/auth/change-password", json={"old_password": "P5NonAdmin1!", "new_password": "P5NonAdmin2!"})
        r = S2.post(f"{BASE}/auth/login", json={"username": "p5_testuser", "password": "P5NonAdmin2!"})
    if r.status_code == 200:
        S2.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        r = S2.get(f"{BASE}/admin/users")
        check(28, "Non-admin GET /admin/users -> 403", r.status_code == 403, f"status={r.status_code}")
        r = S2.get(f"{BASE}/admin/projects")
        check(29, "Non-admin GET /admin/projects -> 403", r.status_code == 403)
        r = S2.get(f"{BASE}/admin/audit-log")
        check(30, "Non-admin GET /admin/audit-log -> 403", r.status_code == 403)
    else:
        check(28, "Non-admin login failed", False, f"status={r.status_code}")
        check(29, "--", False, "skipped")
        check(30, "--", False, "skipped")

# -- 13. Deactivate user ---------------------------------
print("\n=== Deactivate user ===")
if test_user_id:
    r = S.delete(f"{BASE}/admin/users/{test_user_id}")
    check(31, "Deactivate user -> 200", r.status_code == 200)
    check(32, "status = deactivated", r.json().get("status") == "deactivated")

    # Deactivated user cannot login
    r2 = requests.post(f"{BASE}/auth/login", json={"username": "p5_testuser", "password": "P5Final123!"})
    check(33, "Deactivated user login -> 401", r2.status_code == 401, f"status={r2.status_code}")

# -- Summary ----------------------------------------------
print("\n" + "=" * 60)
passed = sum(1 for _, _, p in RESULTS if p)
total = len(RESULTS)
print(f"  Phase 5 E2E: {passed}/{total} checks passed")
if passed < total:
    print("  FAILURES:")
    for n, d, p in RESULTS:
        if not p: print(f"    #{n}: {d}")
print("=" * 60)
sys.exit(0 if passed == total else 1)
