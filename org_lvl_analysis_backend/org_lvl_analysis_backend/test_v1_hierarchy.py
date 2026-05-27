"""
Verification 1: Hierarchy 500 — is it test-data-sized or a real regression?

Creates a realistic 50-employee org tree and runs the full lifecycle:
  upload → cleanup → validate → filter → hierarchy

If hierarchy works on realistic data, the Phase 4 test failure was
just the tiny 2-record post-cleanup dataset.
"""

import requests, json, sys, os, io
import openpyxl

BASE = "http://127.0.0.1:8001"
S = requests.Session()

def die(msg):
    print(f"  FATAL  {msg}")
    sys.exit(1)

# ---------- Admin login ----------
for pw in ["AM@dmin2026!", "NewPass123!"]:
    r = S.post(f"{BASE}/auth/login", json={"username": "am.admin", "password": pw})
    if r.status_code == 200:
        data = r.json()
        if data.get("user", {}).get("must_change_password"):
            S.headers["Authorization"] = f"Bearer {data['access_token']}"
            S.post(f"{BASE}/auth/change-password",
                   json={"old_password": pw, "new_password": "NewPass123!"})
            r2 = S.post(f"{BASE}/auth/login",
                        json={"username": "am.admin", "password": "NewPass123!"})
            if r2.status_code == 200:
                data = r2.json()
        S.headers["Authorization"] = f"Bearer {data['access_token']}"
        break
else:
    die("Admin login failed")

print("  OK  Admin logged in\n")

# ---------- Build realistic Excel ----------
wb = openpyxl.Workbook()
ws = wb.active
headers = ["Employee_ID", "Manager_ID", "Employee_Name", "FTE", "FLC",
           "Country", "Level", "Job_Title", "Department"]
ws.append(headers)

# CEO (root)
ws.append(["E001", "", "Alice CEO", 1.0, 250000, "US", 1, "Chief Executive Officer", "Executive"])

# C-suite (3 direct reports to CEO)
c_suite = [
    ("E002", "E001", "Bob CFO",      1.0, 200000, "US", 2, "Chief Financial Officer", "Finance"),
    ("E003", "E001", "Carol CTO",    1.0, 200000, "US", 2, "Chief Technology Officer", "Technology"),
    ("E004", "E001", "Dave COO",     1.0, 200000, "UK", 2, "Chief Operating Officer", "Operations"),
]
for row in c_suite:
    ws.append(row)

# VP layer (2 per C-suite = 6)
vps = [
    ("E005", "E002", "Eve VP Fin",   1.0, 150000, "US", 3, "VP Finance", "Finance"),
    ("E006", "E002", "Frank VP Acc", 1.0, 150000, "US", 3, "VP Accounting", "Finance"),
    ("E007", "E003", "Grace VP Eng", 1.0, 150000, "US", 3, "VP Engineering", "Technology"),
    ("E008", "E003", "Hank VP Data", 1.0, 150000, "UK", 3, "VP Data", "Technology"),
    ("E009", "E004", "Ivy VP Ops",   1.0, 150000, "US", 3, "VP Operations", "Operations"),
    ("E010", "E004", "Jack VP Log",  1.0, 150000, "IN", 3, "VP Logistics", "Operations"),
]
for row in vps:
    ws.append(row)

# Director layer (2 per VP = 12)
dirs = []
emp_id = 11
for vp_id in range(5, 11):
    for i in range(2):
        dirs.append((
            f"E{emp_id:03d}", f"E{vp_id:03d}",
            f"Dir_{emp_id}", 1.0, 120000,
            ["US", "UK", "IN", "DE"][emp_id % 4], 4,
            f"Director {emp_id}", "Various"
        ))
        emp_id += 1

for row in dirs:
    ws.append(row)

# Manager layer (2 per Director = 24)
mgrs = []
for d in dirs:
    d_num = int(d[0][1:])
    for i in range(2):
        mgrs.append((
            f"E{emp_id:03d}", d[0],
            f"Mgr_{emp_id}", 1.0, 90000,
            d[5], 5, f"Manager {emp_id}", d[8]
        ))
        emp_id += 1

for row in mgrs:
    ws.append(row)

total_rows = 1 + 3 + 6 + 12 + 24  # = 46 employees (realistic small org)
print(f"  Built test Excel: {total_rows} employees, {len(headers)} columns\n")

buf = io.BytesIO()
wb.save(buf)
buf.seek(0)

# ---------- Step 1: Upload ----------
print("--- Step 1: Upload ---")
r = S.post(f"{BASE}/projects/1/upload",
           files={"file": ("realistic_org.xlsx", buf,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
if r.status_code != 200:
    die(f"Upload failed: {r.status_code} {r.text[:300]}")
records = r.json()["records"]
print(f"  OK  Uploaded {len(records)} records\n")

# ---------- Step 2: Cleanup ----------
print("--- Step 2: Cleanup ---")
r = S.post(f"{BASE}/projects/1/cleanup", json=records,
           params={"remove_exclusion": True, "country_col": "Country"})
if r.status_code != 200:
    die(f"Cleanup failed: {r.status_code} {r.text[:300]}")
cleanup_resp = r.json()
cleaned = cleanup_resp.get("df", cleanup_resp) if isinstance(cleanup_resp, dict) else cleanup_resp
print(f"  OK  Cleanup returned {len(cleaned)} records (removed {cleanup_resp.get('removed', '?')})\n")

# ---------- Step 3: Validate ----------
print("--- Step 3: Validate ---")
r = S.post(f"{BASE}/projects/1/validate", json=cleaned,
           params={"emp_col": "Employee_ID", "mgr_col": "Manager_ID"})
if r.status_code != 200:
    die(f"Validate failed: {r.status_code} {r.text[:300]}")
validated = r.json()
print(f"  OK  Validate returned (keys: {list(validated.keys()) if isinstance(validated, dict) else 'list'})\n")

# Use validated records if available
if isinstance(validated, dict) and "records" in validated:
    df = validated["records"]
elif isinstance(validated, list):
    df = validated
else:
    df = cleaned

# ---------- Step 4: Filter Errors ----------
print("--- Step 4: Filter Errors ---")
r = S.post(f"{BASE}/projects/1/filter_errors", json=df,
           params={"emp_col": "Employee_ID", "mgr_col": "Manager_ID"})
if r.status_code != 200:
    print(f"  WARN  Filter errors: {r.status_code} {r.text[:200]}")
    filtered = df
else:
    filter_resp = r.json()
    if isinstance(filter_resp, dict) and "df" in filter_resp:
        filtered = filter_resp["df"]
    elif isinstance(filter_resp, dict) and "records" in filter_resp:
        filtered = filter_resp["records"]
    elif isinstance(filter_resp, list):
        filtered = filter_resp
    else:
        filtered = df
    print(f"  OK  Filter returned {len(filtered)} records")
    if filtered and isinstance(filtered[0], dict):
        print(f"       Columns: {list(filtered[0].keys())[:8]}...\n")

# Hierarchy uses the cleaned data (same as browser flow: user sends
# their working df, which may or may not have gone through filter).
# Use cleaned records with original columns for the definitive test.
hierarchy_input = cleaned

# ---------- Step 5: Hierarchy (THE KEY TEST) ----------
print("--- Step 5: HIERARCHY (on cleaned data, 46 records) ---")
r = S.post(f"{BASE}/projects/1/hierarchy", json=hierarchy_input,
           params={"emp_col": "Employee_ID", "mgr_col": "Manager_ID",
                    "fte_col": "FTE", "flc_col": "FLC",
                    "job_title_col": "Job_Title"})

if r.status_code == 200:
    hier = r.json()
    print(f"  PASS  Hierarchy succeeded!")
    if isinstance(hier, dict):
        print(f"         Keys: {list(hier.keys())}")
        if "records" in hier:
            print(f"         Records: {len(hier['records'])}")
    elif isinstance(hier, list):
        print(f"         Records: {len(hier)}")
elif r.status_code == 500:
    print(f"  FAIL  Hierarchy 500 on realistic data — THIS IS A REAL REGRESSION")
    print(f"         Response: {r.text[:500]}")
else:
    print(f"  FAIL  Hierarchy unexpected status: {r.status_code}")
    print(f"         Response: {r.text[:500]}")

# ---------- Step 6: Save baseline (if hierarchy worked) ----------
if r.status_code == 200:
    print("\n--- Step 6: Save Baseline ---")
    body = {
        "name": "V1_Hierarchy_Test",
        "records": filtered,
        "emp_col": "Employee_ID", "mgr_col": "Manager_ID",
        "fte_col": "FTE", "flc_col": "FLC",
        "job_title_col": "Job_Title", "country_col": "Country"
    }
    r2 = S.post(f"{BASE}/projects/1/db/save_baseline", json=body)
    if r2.status_code == 200:
        print(f"  OK  Baseline saved: dataset_id={r2.json().get('dataset_id')}")
    else:
        print(f"  WARN  Baseline save: {r2.status_code} {r2.text[:200]}")

print("\n--- Verification 1 Complete ---")
