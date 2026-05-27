"""Phase 2 end-to-end smoke tests.

Tests: migrations ran, admin CRUD for projects + assignments,
audit log records, require_project_access dependency, user-facing project list.
"""

import requests
import json
import sys

BASE = "http://127.0.0.1:8001"
failures = []
state = {}


def test(name, fn):
    print(f"\n{'='*60}")
    print(f"TEST: {name}")
    print(f"{'='*60}")
    try:
        fn()
    except AssertionError as e:
        failures.append(name)
        print(f"  FAIL: {e}")
    except Exception as e:
        failures.append(name)
        print(f"  ERROR: {type(e).__name__}: {e}")


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


# --- Setup: login as admin, change password first ---

def test_admin_login_and_change_pw():
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "AM@dmin2026!"})
    assert r.status_code == 200, f"Login failed: {r.json()}"
    data = r.json()
    state["admin_token"] = data["access_token"]
    state["admin_session"] = s
    state["admin_id"] = data["user"]["id"]

    if data["user"]["must_change_password"]:
        r2 = s.post(
            f"{BASE}/auth/change-password",
            json={"old_password": "AM@dmin2026!", "new_password": "AM@dmin2026!Changed"},
            headers=auth_header(state["admin_token"]),
        )
        assert r2.status_code == 200, f"Change password failed: {r2.json()}"
        # Re-login to get fresh token
        r3 = s.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "AM@dmin2026!Changed"})
        assert r3.status_code == 200
        state["admin_token"] = r3.json()["access_token"]
    print(f"  Admin logged in, id={state['admin_id']}")


# --- Migration verification ---

def test_schema_version():
    """Verify migrations ran by checking schema_version."""
    import sqlite3
    db_path = r"c:\Users\jagritjain\OneDrive - Alvarez and Marsal\Documents\APPS\ORG_ANALYSIS\org_lvl_analysis_backend\org_lvl_analysis_backend\db\orgsight.db"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ver = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
    print(f"  schema_version: {ver}")
    assert ver == 2, f"Expected version 2, got {ver}"

    # Check projects table exists
    tables = [r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"  Tables: {tables}")
    assert "projects" in tables
    assert "project_assignments" in tables
    assert "audit_log" in tables

    # Check datasets has project_id column
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(datasets)").fetchall()]
    print(f"  datasets columns: {cols}")
    assert "project_id" in cols
    conn.close()


# --- Admin: Create project ---

def test_create_project():
    r = requests.post(
        f"{BASE}/admin/projects",
        json={"name": "Test Engagement Alpha", "description": "A test project", "deadline": "2026-12-31T23:59:59"},
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Project: {data}")
    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {data}"
    assert data["name"] == "Test Engagement Alpha"
    state["project_id"] = data["id"]


# --- Admin: Create a member user ---

def test_create_member_user():
    r = requests.post(
        f"{BASE}/admin/users",
        json={"username": "test.member", "password": "TestMember@123", "display_name": "Test Member", "role": "member"},
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  User: id={data.get('id')}, username={data.get('username')}")
    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {data}"
    state["member_id"] = data["id"]


# --- Admin: Assign member to project ---

def test_assign_member():
    r = requests.post(
        f"{BASE}/admin/projects/{state['project_id']}/assignments",
        json={"user_id": state["member_id"], "role": "member"},
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Assignment: {data}")
    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {data}"


# --- Admin: List assignments ---

def test_list_assignments():
    r = requests.get(
        f"{BASE}/admin/projects/{state['project_id']}/assignments",
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Assignments count: {len(data)}")
    assert r.status_code == 200
    assert len(data) >= 1
    usernames = [a["username"] for a in data]
    assert "test.member" in usernames


# --- Admin: List users ---

def test_list_users():
    r = requests.get(
        f"{BASE}/admin/users",
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Users count: {len(data)}")
    assert r.status_code == 200
    assert len(data) >= 2  # admin + test.member at minimum


# --- Admin: Update project ---

def test_update_project():
    r = requests.patch(
        f"{BASE}/admin/projects/{state['project_id']}",
        json={"description": "Updated description", "deadline": "2027-06-30T23:59:59"},
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    assert r.status_code == 200
    assert data["description"] == "Updated description"
    assert "2027-06-30" in data["deadline"]


# --- Audit log: verify actions recorded ---

def test_audit_log():
    r = requests.get(
        f"{BASE}/admin/audit-log?limit=50",
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    actions = [e["action"] for e in data]
    print(f"  Actions recorded: {actions}")
    assert r.status_code == 200
    assert "project.create" in actions
    assert "user.create" in actions
    assert "project.assign" in actions
    assert "project.update" in actions


# --- Member: login and change password ---

def test_member_login():
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"username": "test.member", "password": "TestMember@123"})
    assert r.status_code == 200
    data = r.json()
    token = data["access_token"]

    # Must change password first
    r2 = s.post(
        f"{BASE}/auth/change-password",
        json={"old_password": "TestMember@123", "new_password": "TestMember@456"},
        headers=auth_header(token),
    )
    assert r2.status_code == 200

    r3 = s.post(f"{BASE}/auth/login", json={"username": "test.member", "password": "TestMember@456"})
    assert r3.status_code == 200
    state["member_token"] = r3.json()["access_token"]
    print(f"  Member logged in, must_change_password={r3.json()['user']['must_change_password']}")


# --- Member: list my projects ---

def test_member_list_projects():
    r = requests.get(
        f"{BASE}/projects",
        headers=auth_header(state["member_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Projects: {[p['name'] for p in data]}")
    assert r.status_code == 200
    names = [p["name"] for p in data]
    assert "Test Engagement Alpha" in names


# --- Member: get project detail ---

def test_member_project_detail():
    r = requests.get(
        f"{BASE}/projects/{state['project_id']}",
        headers=auth_header(state["member_token"]),
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Project name: {data.get('name')}, members: {len(data.get('members', []))}")
    assert r.status_code == 200
    assert data["name"] == "Test Engagement Alpha"
    assert len(data["members"]) >= 1


# --- Member: cannot access admin endpoints ---

def test_member_admin_blocked():
    r = requests.get(
        f"{BASE}/admin/users",
        headers=auth_header(state["member_token"]),
    )
    print(f"  Status: {r.status_code} (should be 403)")
    assert r.status_code == 403


# --- Member: cannot access unassigned project ---

def test_unassigned_project_blocked():
    # Create another project that member is NOT assigned to
    r = requests.post(
        f"{BASE}/admin/projects",
        json={"name": "Restricted Project"},
        headers=auth_header(state["admin_token"]),
    )
    assert r.status_code == 201
    restricted_id = r.json()["id"]

    r2 = requests.get(
        f"{BASE}/projects/{restricted_id}",
        headers=auth_header(state["member_token"]),
    )
    print(f"  Status: {r2.status_code} (should be 403)")
    assert r2.status_code == 403
    detail = r2.json().get("detail", {})
    print(f"  error_code: {detail.get('error_code')}")
    assert detail.get("error_code") == "not_assigned"


# --- Admin: archive project ---

def test_archive_project():
    r = requests.delete(
        f"{BASE}/admin/projects/{state['project_id']}",
        headers=auth_header(state["admin_token"]),
    )
    print(f"  Status: {r.status_code}")
    assert r.status_code == 200
    assert r.json()["status"] == "archived"


# --- Member: blocked from archived project ---

def test_archived_project_blocked():
    r = requests.get(
        f"{BASE}/projects/{state['project_id']}",
        headers=auth_header(state["member_token"]),
    )
    print(f"  Status: {r.status_code} (should be 403)")
    assert r.status_code == 403
    detail = r.json().get("detail", {})
    print(f"  error_code: {detail.get('error_code')}")
    assert detail.get("error_code") == "project_inactive"


# --- Run all ---
test("Admin login + change password", test_admin_login_and_change_pw)
test("Schema version = 2, tables exist", test_schema_version)
test("Create project", test_create_project)
test("Create member user", test_create_member_user)
test("Assign member to project", test_assign_member)
test("List assignments", test_list_assignments)
test("List users", test_list_users)
test("Update project", test_update_project)
test("Audit log has all actions", test_audit_log)
test("Member login + change password", test_member_login)
test("Member: list my projects", test_member_list_projects)
test("Member: project detail", test_member_project_detail)
test("Member: admin endpoints blocked", test_member_admin_blocked)
test("Member: unassigned project blocked", test_unassigned_project_blocked)
test("Admin: archive project", test_archive_project)
test("Member: archived project blocked", test_archived_project_blocked)

print(f"\n{'='*60}")
if failures:
    print(f"FAILURES ({len(failures)}):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
else:
    print(f"ALL {16} TESTS PASSED")
    sys.exit(0)
