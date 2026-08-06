"""
Generate a small census Excel that reproduces the invalid-manager filter bug.

Scenario (mirrors a real EU census extract):
  - Top leaders report to EXTERNAL parent-company IDs (not in the file).
  - Everyone else reports up through those leaders.
  - Old filter: collect_subtree(external_id) wiped the whole org → 0 rows.
  - New filter: remove only the flagged rows → rest of org remains + exportable.

Output:
  testdata/invalid_manager_filter_test.xlsx
"""

from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "testdata" / "invalid_manager_filter_test.xlsx"

# External IDs — intentionally NOT present as Person IDs
EXT_BOARD = "272373"
EXT_PARENT = "287534"
EXT_OTHER = "999999"

rows = [
    # --- Top of org: report to external IDs (FLAGGED as invalid manager) ---
    {"Person ID": "1001", "Manager ID": EXT_BOARD, "Name": "Alice CEO", "Job Title": "CEO", "Country": "DE", "Function": "Executive", "Note": "FLAGGED — reports to external board"},
    {"Person ID": "1002", "Manager ID": EXT_PARENT, "Name": "Bob Country Head", "Job Title": "Country Head", "Country": "DE", "Function": "Executive", "Note": "FLAGGED — reports to external parent co"},
    {"Person ID": "1003", "Manager ID": EXT_OTHER, "Name": "Cara Side Lead", "Job Title": "Director", "Country": "FR", "Function": "Operations", "Note": "FLAGGED — external mgr, has 2 reports"},

    # --- Main tree under Alice (must SURVIVE filter; old bug deleted these) ---
    {"Person ID": "1101", "Manager ID": "1001", "Name": "Dana VP Ops", "Job Title": "VP Operations", "Country": "DE", "Function": "Operations", "Note": "Keep — under Alice"},
    {"Person ID": "1102", "Manager ID": "1001", "Name": "Evan VP Fin", "Job Title": "VP Finance", "Country": "DE", "Function": "Finance", "Note": "Keep — under Alice"},
    {"Person ID": "1201", "Manager ID": "1101", "Name": "Fay Manager", "Job Title": "Manager", "Country": "DE", "Function": "Operations", "Note": "Keep"},
    {"Person ID": "1202", "Manager ID": "1101", "Name": "Gus Manager", "Job Title": "Manager", "Country": "DE", "Function": "Operations", "Note": "Keep"},
    {"Person ID": "1203", "Manager ID": "1102", "Name": "Hana Manager", "Job Title": "Manager", "Country": "DE", "Function": "Finance", "Note": "Keep"},
    {"Person ID": "1301", "Manager ID": "1201", "Name": "Ivy Analyst", "Job Title": "Analyst", "Country": "DE", "Function": "Operations", "Note": "Keep"},
    {"Person ID": "1302", "Manager ID": "1201", "Name": "Jon Analyst", "Job Title": "Analyst", "Country": "DE", "Function": "Operations", "Note": "Keep"},
    {"Person ID": "1303", "Manager ID": "1202", "Name": "Kim Analyst", "Job Title": "Analyst", "Country": "AT", "Function": "Operations", "Note": "Keep"},
    {"Person ID": "1304", "Manager ID": "1202", "Name": "Leo Analyst", "Job Title": "Analyst", "Country": "AT", "Function": "Operations", "Note": "Keep"},
    {"Person ID": "1305", "Manager ID": "1203", "Name": "Mia Analyst", "Job Title": "Analyst", "Country": "DE", "Function": "Finance", "Note": "Keep"},
    {"Person ID": "1306", "Manager ID": "1203", "Name": "Ned Analyst", "Job Title": "Analyst", "Country": "DE", "Function": "Finance", "Note": "Keep"},

    # --- Tree under Bob Country Head (must SURVIVE) ---
    {"Person ID": "2101", "Manager ID": "1002", "Name": "Olivia Dir", "Job Title": "Director", "Country": "DE", "Function": "HR", "Note": "Keep — under Bob"},
    {"Person ID": "2201", "Manager ID": "2101", "Name": "Paul HRBP", "Job Title": "HRBP", "Country": "DE", "Function": "HR", "Note": "Keep"},
    {"Person ID": "2202", "Manager ID": "2101", "Name": "Quinn HRBP", "Job Title": "HRBP", "Country": "DE", "Function": "HR", "Note": "Keep"},

    # --- Small tree under Cara (must SURVIVE even though Cara is flagged) ---
    {"Person ID": "3101", "Manager ID": "1003", "Name": "Rita IC", "Job Title": "Specialist", "Country": "FR", "Function": "Operations", "Note": "Keep — report of flagged Cara"},
    {"Person ID": "3102", "Manager ID": "1003", "Name": "Sam IC", "Job Title": "Specialist", "Country": "FR", "Function": "Operations", "Note": "Keep — report of flagged Cara"},

    # --- Extra flagged leaves (no reports) ---
    {"Person ID": "4001", "Manager ID": EXT_BOARD, "Name": "Tina Contractor", "Job Title": "Contractor", "Country": "NL", "Function": "Operations", "Note": "FLAGGED — leaf external"},
    {"Person ID": "4002", "Manager ID": EXT_PARENT, "Name": "Uma Contractor", "Job Title": "Contractor", "Country": "NL", "Function": "Finance", "Note": "FLAGGED — leaf external"},
]

df = pd.DataFrame(rows)

readme = pd.DataFrame([
    {"Step": "1", "Action": "Upload this file in Upload & Prepare", "Expected": "Map Person ID → Employee, Manager ID → Manager"},
    {"Step": "2", "Action": "Run prepare / validation", "Expected": "5 flagged rows: Invalid Manager References (1001,1002,1003,4001,4002). 3 unique external IDs."},
    {"Step": "3", "Action": "Check Remove on Invalid Manager References → Apply Filters", "Expected": "Filters applied — 16 rows remaining (21 - 5). NOT 0."},
    {"Step": "4", "Action": "Dataset preview", "Expected": "Shows remaining people (Dana, Evan, Fay, … Rita, Sam). Flagged tops removed."},
    {"Step": "5", "Action": "Export to Excel", "Expected": "Enabled; downloads ~16 rows (not 'No data to export')."},
    {"Step": "6", "Action": "Optional: note after re-validate", "Expected": "People who reported to removed tops (e.g. 1101→1001) may show NEW invalid-manager flags — that is expected after deleting their manager row."},
    {"Step": "—", "Action": "Old bug (before fix)", "Expected": "Removing invalid managers deleted entire subtrees under 272373/287534/999999 → 0 rows left."},
])

OUT.parent.mkdir(parents=True, exist_ok=True)
with pd.ExcelWriter(OUT, engine="openpyxl") as writer:
    df.to_excel(writer, sheet_name="Census", index=False)
    readme.to_excel(writer, sheet_name="How_to_test", index=False)

print(f"Wrote {OUT}")
print(f"Total rows: {len(df)}")
print(f"Expected flagged (invalid mgr): 5")
print(f"Expected remaining after Remove: {len(df) - 5}")
