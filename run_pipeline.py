"""Run the full org chart pipeline via API and save a baseline."""
import requests
import json

BASE = "http://127.0.0.1:8001/projects/1"
fp = r"c:\Users\jagritjain\OneDrive - Alvarez and Marsal\Documents\APPS\ORG_ANALYSIS\Fw_ G&A Tools (Org and Census Data Rationalization) Enhancement\Census-Whitsbury.xlsx"

token = requests.post(
    "http://127.0.0.1:8001/auth/login",
    json={"username": "am.admin", "password": "AM@dmin2026!"},
).json()["access_token"]
h = {"Authorization": f"Bearer {token}"}

# Step 1: Upload
print("Step 1: Upload...")
with open(fp, "rb") as f:
    r = requests.post(
        f"{BASE}/upload",
        headers=h,
        files={"file": ("Census-Whitsbury.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
data = r.json()
records = data["records"]
columns = data["columns"]
print(f"  Got {len(records)} records. Columns: {columns[:5]}...")

# Step 2: Cleanup
print("Step 2: Cleanup...")
r2 = requests.post(f"{BASE}/cleanup", headers=h, json=records, params={"country_col": "Country"})
if r2.status_code != 200:
    print("  FAIL:", r2.text[:300])
    exit(1)
cleaned = r2.json()["df"]
print(f"  Cleaned: {len(cleaned)} records")

# Step 3: Validate
print("Step 3: Validate...")
r3 = requests.post(
    f"{BASE}/validate",
    headers=h,
    params={"emp_col": "ID", "mgr_col": "Line Manager ID"},
    json=cleaned,
)
if r3.status_code != 200:
    print("  FAIL:", r3.text[:300])
    exit(1)
v = r3.json()
print(f"  Validated. dups={len(v['duplicate_ids'])}, missing_mgr={len(v['missing_manager_ids'])}, invalid={len(v['invalid_manager_ids'])}")
validated = v["df_with_flags"]

# Step 4: Filter errors
print("Step 4: Filter Errors...")
r4 = requests.post(
    f"{BASE}/filter_errors",
    headers=h,
    params={"emp_col": "ID", "mgr_col": "Line Manager ID"},
    json=validated,
)
if r4.status_code != 200:
    print("  FAIL:", r4.text[:300])
    exit(1)
f4 = r4.json()
print("  Filter keys:", list(f4.keys())[:8])
filtered = f4.get("df") or f4.get("records") or validated
print(f"  Filtered: {len(filtered)} records")

# Step 5: Hierarchy
print("Step 5: Hierarchy...")
r5 = requests.post(
    f"{BASE}/hierarchy",
    headers=h,
    params={"emp_col": "ID", "mgr_col": "Line Manager ID", "fte_col": "FTE", "flc_col": "Fully loaded cost", "job_title_col": "Job Title"},
    json=filtered,
)
if r5.status_code != 200:
    print("  FAIL:", r5.text[:300])
    exit(1)
h5 = r5.json()
print("  Hierarchy keys:", list(h5.keys())[:8])

# Step 6: Save baseline
print("Step 6: Save Baseline...")
save_payload = {
    "records": filtered,
    "name": "Census-Whitsbury",
    "emp_col": "ID",
    "mgr_col": "Line Manager ID",
    "fte_col": "FTE",
    "flc_col": "Fully loaded cost",
    "job_title_col": "Job Title",
    "country_col": "Country",
}
r6 = requests.post(f"{BASE}/db/save_baseline", headers=h, json=save_payload)
print("  Save baseline status:", r6.status_code)
print("  Response:", r6.text[:300])
