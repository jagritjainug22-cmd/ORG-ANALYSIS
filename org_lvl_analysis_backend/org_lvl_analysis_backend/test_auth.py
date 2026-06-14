"""Quick smoke test for Phase 1 auth endpoints. Run while server is up."""

import requests
import json
import sys

BASE = "http://127.0.0.1:8001"
failures = []


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


state = {}


def test_health():
    r = requests.get(f"{BASE}/")
    print(f"  Status: {r.status_code}")
    assert r.status_code == 200


def test_login_admin():
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"username": "admin", "password": "Admin@123"})
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  access_token present: {bool(data.get('access_token'))}")
    print(f"  user: {data.get('user')}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {data}"
    assert data.get("access_token"), "No access_token"
    assert data["user"]["must_change_password"] is True
    assert data["user"]["role"] == "admin"
    state["admin_session"] = s
    state["admin_token"] = data["access_token"]
    print(f"  Cookies: {list(s.cookies.keys())}")


def test_login_bad_password():
    r = requests.post(f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"})
    print(f"  Status: {r.status_code}")
    assert r.status_code == 401


def test_login_legacy_user():
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"username": "dmirakhur", "password": "dmrkhr"})
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  user: {data.get('user')}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {data}"
    assert data["user"]["must_change_password"] is True
    assert data["user"]["role"] == "member"
    state["legacy_token"] = data["access_token"]
    state["legacy_session"] = s


def test_refresh_with_csrf():
    s = state["admin_session"]
    r = s.post(f"{BASE}/auth/refresh", headers={"X-Requested-With": "fetch"})
    print(f"  Status: {r.status_code}")
    data = r.json()
    if r.status_code == 200:
        print(f"  New access_token present: {bool(data.get('access_token'))}")
        print(f"  user: {data.get('user')}")
        state["admin_token_refreshed"] = data["access_token"]
    else:
        print(f"  Body: {data}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {data}"


def test_refresh_without_csrf():
    s = state["admin_session"]
    r = s.post(f"{BASE}/auth/refresh")
    print(f"  Status: {r.status_code} (should be 403)")
    assert r.status_code == 403


def test_change_password():
    token = state.get("admin_token_refreshed", state.get("admin_token"))
    r = state["admin_session"].post(
        f"{BASE}/auth/change-password",
        json={"old_password": "Admin@123", "new_password": "NewAdmin@456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Body: {data}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {data}"


def test_login_new_password():
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"username": "admin", "password": "NewAdmin@456"})
    print(f"  Status: {r.status_code}")
    data = r.json()
    mcp = data.get("user", {}).get("must_change_password")
    print(f"  must_change_password: {mcp}")
    assert r.status_code == 200
    assert mcp is False, f"Expected must_change_password=False, got {mcp}"
    state["admin_new_session"] = s
    state["admin_new_token"] = data["access_token"]


def test_logout():
    token = state["admin_new_token"]
    s = state["admin_new_session"]
    r = s.post(
        f"{BASE}/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    print(f"  Status: {r.status_code}")
    data = r.json()
    print(f"  Body: {data}")
    assert r.status_code == 200


def test_refresh_after_logout():
    s = state["admin_new_session"]
    r = s.post(f"{BASE}/auth/refresh", headers={"X-Requested-With": "fetch"})
    print(f"  Status: {r.status_code} (should be 401)")
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.json()}"


# --- Run all tests ---
test("Health check", test_health)
test("Login admin (seeded)", test_login_admin)
test("Login bad password", test_login_bad_password)
test("Login legacy user (migrated)", test_login_legacy_user)
test("Refresh with CSRF header", test_refresh_with_csrf)
test("Refresh without CSRF header (should fail)", test_refresh_without_csrf)
test("Change password (first login)", test_change_password)
test("Login with new password", test_login_new_password)
test("Logout", test_logout)
test("Refresh after logout (should fail)", test_refresh_after_logout)

print(f"\n{'='*60}")
if failures:
    print(f"FAILURES ({len(failures)}):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
    sys.exit(0)
