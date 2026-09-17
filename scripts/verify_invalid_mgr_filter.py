"""
Verify invalid-manager filter removes only flagged rows (not whole org).

Run from repo root:
  python scripts/verify_invalid_mgr_filter.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "org_lvl_analysis_backend"
sys.path.insert(0, str(BACKEND))

import pandas as pd  # noqa: E402
from services.filter_error_service import filter_errors  # noqa: E402
from services.validation_service import validate_org_data  # noqa: E402

XLSX = ROOT / "testdata" / "invalid_manager_filter_test.xlsx"
EMP, MGR = "Person ID", "Manager ID"


def main() -> int:
    if not XLSX.exists():
        print(f"Missing {XLSX} — run scripts/generate_invalid_mgr_filter_testdata.py first")
        return 1

    df = pd.read_excel(XLSX, sheet_name="Census", dtype=str)
    # Blank Manager ID cells come through as NaN / "nan" — normalize blanks for top cases if any
    df[MGR] = df[MGR].replace({"nan": pd.NA, "None": pd.NA})

    result = validate_org_data(df, EMP, MGR)
    flagged = result["df_with_flags"]
    n_flagged = int((flagged["FLAG_MANAGER_ID_NOT_EMPLOYEE"] == 1).sum())
    invalid_ids = result["invalid_manager_ids"]

    print(f"Input rows: {len(df)}")
    print(f"Invalid manager IDs: {invalid_ids}")
    print(f"Flagged rows (invalid mgr): {n_flagged}")

    if n_flagged != 5:
        print(f"FAIL: expected 5 flagged rows, got {n_flagged}")
        return 1

    filtered = filter_errors(
        flagged, EMP, MGR,
        remove_dup=False,
        remove_missing=False,
        remove_invalid=True,
        remove_circular=False,
    )
    remaining = len(filtered)
    expected = len(df) - n_flagged

    print(f"Remaining after filter: {remaining} (expected {expected})")

    removed_ids = set(df[EMP].astype(str)) - set(filtered[EMP].astype(str))
    print(f"Removed Person IDs: {sorted(removed_ids)}")

    # Must keep people who were under flagged tops (old bug deleted these)
    must_keep = {"1101", "1102", "1301", "2101", "3101", "3102"}
    missing_keep = must_keep - set(filtered[EMP].astype(str))
    if missing_keep:
        print(f"FAIL: subtree rows were deleted (old bug): {sorted(missing_keep)}")
        return 1

    if remaining == 0:
        print("FAIL: 0 rows remaining — subtree wipe still present")
        return 1

    if remaining != expected:
        print(f"FAIL: remaining {remaining} != expected {expected}")
        return 1

    # Exportability check: non-empty frame with no FLAG_ cols
    flag_cols = [c for c in filtered.columns if str(c).startswith("FLAG_")]
    if flag_cols:
        print(f"FAIL: FLAG columns still present: {flag_cols}")
        return 1

    print("PASS: flagged rows only removed; org remains exportable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
