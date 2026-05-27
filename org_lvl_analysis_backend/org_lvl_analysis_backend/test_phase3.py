"""Phase 3 end-to-end smoke test: project-scoped lifecycle endpoints."""

import json
import requests
import sys

BASE = "http://127.0.0.1:8001"
PJ = f"{BASE}/projects/1"
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


# 1) Login + change password
print("\n=== 1. Login + change password ===")
r = requests.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "AM@dmin2026!"})
check("admin login", r.status_code == 200, f"status={r.status_code}")
data = r.json()
token = data["access_token"]
headers = {"Authorization": f"Bearer {token}"}

r = requests.post(
    f"{BASE}/auth/change-password",
    json={"old_password": "AM@dmin2026!", "new_password": "NewPass123!"},
    headers=headers,
)
check("change password", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")

r = requests.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": "NewPass123!"})
check("re-login after password change", r.status_code == 200)
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# 2) Check Legacy project exists
print("\n=== 2. Projects list ===")
r = requests.get(f"{BASE}/projects", headers=headers)
check("GET /projects", r.status_code == 200)
projects = r.json()
has_legacy = any(p.get("name") == "Legacy" for p in projects) if isinstance(projects, list) else False
check("Legacy project exists", has_legacy, f"projects={json.dumps(projects)[:300]}")

# 3) Unauthenticated request -> 401
print("\n=== 3. Auth enforcement ===")
r = requests.get(f"{PJ}/db/datasets")
check("no auth -> 401", r.status_code == 401, f"status={r.status_code}")

# 4) Stateless pipeline: upload routing works (422 = correct route, missing file body)
print("\n=== 4. Pipeline routing ===")
r = requests.post(f"{PJ}/upload", headers=headers)
check("upload route exists (422 = no file)", r.status_code == 422, f"status={r.status_code}")

# 5) Cleanup endpoint
print("\n=== 5. Cleanup ===")
sample = [{"Name": "Alice", "Country": "US"}, {"Name": "Bob", "Country": "UK"}]
r = requests.post(
    f"{PJ}/cleanup", json=sample, headers={**headers, "Content-Type": "application/json"},
    params={"remove_exclusion": False},
)
check("cleanup returns 200", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")

# 6) Empty dataset list
print("\n=== 6. Dataset list (empty) ===")
r = requests.get(f"{PJ}/db/datasets", headers=headers)
check("datasets list returns 200", r.status_code == 200)
check("datasets empty on fresh DB", len(r.json()["datasets"]) == 0, f"count={len(r.json()['datasets'])}")

# 7) Save baseline
print("\n=== 7. Save baseline ===")
records = [
    {"EmpID": "E1", "MgrID": "", "Name": "CEO", "Level": 1},
    {"EmpID": "E2", "MgrID": "E1", "Name": "VP1", "Level": 2},
    {"EmpID": "E3", "MgrID": "E1", "Name": "VP2", "Level": 2},
    {"EmpID": "E4", "MgrID": "E2", "Name": "Dir1", "Level": 3},
]
body = {"name": "Test Dataset", "records": records, "emp_col": "EmpID", "mgr_col": "MgrID"}
r = requests.post(
    f"{PJ}/db/save_baseline", json=body,
    headers={**headers, "Content-Type": "application/json"},
)
check("save baseline returns 200", r.status_code == 200, f"status={r.status_code} {r.text[:300]}")
ds_id = r.json().get("dataset_id") if r.status_code == 200 else None
check("dataset_id returned", ds_id is not None)

# 8) Verify project_id is set on dataset
if ds_id:
    print("\n=== 8. Dataset project_id verification ===")
    r = requests.get(f"{PJ}/db/datasets/{ds_id}", headers=headers)
    check("get dataset returns 200", r.status_code == 200)
    ds = r.json()["dataset"]
    check("project_id == 1", ds.get("project_id") == 1, f"project_id={ds.get('project_id')}")

    # 9) Wrong project -> 404
    print("\n=== 9. Cross-project access denied ===")
    r = requests.get(f"{BASE}/projects/999/db/datasets/{ds_id}", headers=headers)
    check("wrong project -> 404", r.status_code == 404, f"status={r.status_code}")

    # 10) Scenario access
    print("\n=== 10. Scenario endpoints ===")
    r = requests.get(f"{PJ}/db/datasets/{ds_id}", headers=headers)
    scenarios = r.json()["scenarios"]
    check("default scenario created", len(scenarios) >= 1)
    scenario_id = scenarios[0]["id"]

    r = requests.get(f"{PJ}/db/scenarios/{scenario_id}", headers=headers)
    check("get scenario returns 200", r.status_code == 200, f"status={r.status_code}")
    rec_count = len(r.json()["records"])
    check("scenario has 4 records", rec_count == 4, f"count={rec_count}")

    # Scenario via wrong project -> 404
    r = requests.get(f"{BASE}/projects/999/db/scenarios/{scenario_id}", headers=headers)
    check("scenario wrong project -> 404", r.status_code == 404, f"status={r.status_code}")

    # 11) Scenario mutations
    print("\n=== 11. Scenario mutations ===")
    r = requests.post(
        f"{PJ}/db/scenarios/{scenario_id}/move",
        json={"emp_id": "E3", "new_mgr_id": "E2"},
        headers={**headers, "Content-Type": "application/json"},
    )
    check("move employee", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")

    r = requests.get(f"{PJ}/db/scenarios/{scenario_id}/summary", headers=headers)
    check("summary after move", r.status_code == 200)

    r = requests.post(f"{PJ}/db/scenarios/{scenario_id}/undo", json={}, headers=headers)
    check("undo move", r.status_code == 200)

    r = requests.get(f"{PJ}/db/scenarios/{scenario_id}/change_log", headers=headers)
    check("change log", r.status_code == 200)

    # 12) Create second scenario
    print("\n=== 12. Create scenario ===")
    r = requests.post(
        f"{PJ}/db/datasets/{ds_id}/scenarios",
        json={"name": "What-if A", "description": "test"},
        headers={**headers, "Content-Type": "application/json"},
    )
    check("create scenario", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")

    # Compare scenarios
    r = requests.get(f"{PJ}/db/datasets/{ds_id}/compare", headers=headers)
    check("compare scenarios", r.status_code == 200)
    check("compare returns 2 scenarios", len(r.json()["scenarios"]) == 2)

# 13) Org chart endpoint
print("\n=== 13. Org chart (stateless) ===")
orgdata = [
    {"EmpID": "E1", "MgrID": "", "Name": "CEO", "Level": 1},
    {"EmpID": "E2", "MgrID": "E1", "Name": "VP1", "Level": 2},
    {"EmpID": "E3", "MgrID": "E1", "Name": "VP2", "Level": 2},
]
r = requests.post(
    f"{PJ}/orgchart", json=orgdata,
    params={"emp_col": "EmpID", "mgr_col": "MgrID"},
    headers={**headers, "Content-Type": "application/json"},
)
check("orgchart returns 200", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")

# 14) Delete dataset
if ds_id:
    print("\n=== 14. Delete dataset ===")
    r = requests.delete(f"{PJ}/db/datasets/{ds_id}", headers=headers)
    check("delete dataset", r.status_code == 200)
    r = requests.get(f"{PJ}/db/datasets", headers=headers)
    check("dataset list now empty", len(r.json()["datasets"]) == 0)

# Summary
print(f"\n{'='*50}")
print(f"Phase 3 results: {PASS_COUNT} passed, {FAIL_COUNT} failed")
if FAIL_COUNT > 0:
    sys.exit(1)
else:
    print("ALL PHASE 3 CHECKS PASSED")
