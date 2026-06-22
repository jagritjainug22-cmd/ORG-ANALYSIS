"""
Build a ~100-row OrgSight test census from Census data.xlsx.

- Valid hierarchy: CEO has blank manager; all other managers are employees in the set.
- All 15 column-mapping fields present for upload / rationalise / hierarchy testing.
"""
from __future__ import annotations

import random
from collections import defaultdict, deque
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CENSUS_PATH = ROOT / "CENSUS_RATIONALISATION" / "app_2" / "app_2" / "excel data" / "Census data.xlsx"
OUTPUT_PATH = ROOT / "sample_data" / "OrgSight_Rationalisation_Test_100rows.xlsx"

TARGET_ROWS = 100
CEO_ID = "12207"
RANDOM_SEED = 42


def _clean_id(series: pd.Series) -> pd.Series:
    return (
        series.astype(str)
        .str.strip()
        .str.replace(r"\.0$", "", regex=True)
        .replace({"nan": "", "None": ""})
    )


def _load_census() -> pd.DataFrame:
    df = pd.read_excel(CENSUS_PATH, sheet_name="Census", header=1)
    df["Employee ID"] = _clean_id(df["Employee ID"])
    df["Manager ID"] = _clean_id(df["Manager ID"])
    df = df[df["Employee ID"].notna() & (df["Employee ID"] != "")]
    return df.reset_index(drop=True)


def _build_children(mgr_of: dict[str, str]) -> dict[str, list[str]]:
    children: dict[str, list[str]] = defaultdict(list)
    for emp, mgr in mgr_of.items():
        children[mgr].append(emp)
    return children


def _bfs_subtree(
    root: str,
    children: dict[str, list[str]],
    row_by_emp: dict[str, pd.Series],
    target: int,
) -> list[str]:
    """Breadth-first sample with shuffled siblings for function diversity."""
    rng = random.Random(RANDOM_SEED)
    picked: list[str] = []
    seen: set[str] = {root}
    queue: deque[str] = deque([root])

    while queue and len(picked) < target:
        node = queue.popleft()
        picked.append(node)
        kids = list(children.get(node, []))
        # Prefer children from under-represented functions when possible
        func_counts: dict[str, int] = defaultdict(int)
        for e in picked:
            func_counts[str(row_by_emp[e].get("Function", ""))] += 1

        def sort_key(emp_id: str) -> tuple[int, str]:
            func = str(row_by_emp[emp_id].get("Function", ""))
            return (func_counts.get(func, 0), emp_id)

        kids.sort(key=sort_key)
        rng.shuffle(kids)
        kids.sort(key=sort_key)
        for child in kids:
            if child not in seen:
                seen.add(child)
                queue.append(child)

    return picked[:target]


def _synthetic_pay(grade_val, fte_val) -> tuple[float, float]:
    try:
        grade = int(float(grade_val))
    except (TypeError, ValueError):
        grade = 5
    try:
        fte = float(fte_val)
    except (TypeError, ValueError):
        fte = 1.0
    base = 35000 + grade * 12000
    basic = round(base * fte, 2)
    flc = round(basic * 1.35 + grade * 2500, 2)
    return basic, flc


def _fix_start_date(val) -> str:
    s = str(val).strip()
    if not s or s.lower() == "nan" or "1899" in s:
        return "15 March 2019"
    return s


def build() -> pd.DataFrame:
    source = _load_census()
    emp_set = set(source["Employee ID"])
    mgr_of = dict(zip(source["Employee ID"], source["Manager ID"]))
    children = _build_children(mgr_of)
    row_by_emp = {r["Employee ID"]: r for _, r in source.iterrows()}

    if CEO_ID not in emp_set:
        raise ValueError(f"CEO id {CEO_ID} not found in census")

    picked_ids = _bfs_subtree(CEO_ID, children, row_by_emp, TARGET_ROWS)
    subset = source[source["Employee ID"].isin(picked_ids)].copy()

    # Corrected manager logic: CEO reports to nobody; drop any stray external managers
    subset.loc[subset["Employee ID"] == CEO_ID, "Manager ID"] = ""
    internal = set(subset["Employee ID"])
    bad_mgr = ~subset["Manager ID"].isin(internal) & (subset["Manager ID"] != "")
    if bad_mgr.any():
        subset.loc[bad_mgr, "Manager ID"] = CEO_ID

    rows = []
    for _, r in subset.iterrows():
        grade = r.get("Employee Grade", 5)
        fte = r.get("FTE", 1)
        basic, flc = _synthetic_pay(grade, fte)
        region = str(r.get("Region", "England")).strip() or "England"
        rows.append(
            {
                "ID": r["Employee ID"],
                "Line Manager ID": r["Manager ID"],
                "Job Title": str(r.get("Position Title", "")).strip(),
                "FTE": float(fte) if pd.notna(fte) else 1.0,
                "Fully loaded cost": flc,
                "Country": region,
                "Function": str(r.get("Function", "")).strip(),
                "Sub-Function": str(r.get("Sub Function", "")).strip(),
                "Grade": str(grade).strip() if pd.notna(grade) else "",
                "Division": str(r.get("Division", "")).strip(),
                "Entity": str(r.get("Employee Class", "FlexiPac")).strip() or "FlexiPac",
                "Start Date": _fix_start_date(r.get("Start Date")),
                "Basic Pay": basic,
                "Contract": str(r.get("Employee Type", "Perm")).strip() or "Perm",
                "Status": "Active",
            }
        )

    out = pd.DataFrame(rows)
    # Stable order: CEO first, then BFS order
    order = {eid: i for i, eid in enumerate(picked_ids)}
    out["_ord"] = out["ID"].map(order)
    out = out.sort_values("_ord").drop(columns="_ord").reset_index(drop=True)
    # Keep IDs as strings in Excel (avoids int/float mismatch on load)
    out["ID"] = out["ID"].astype(str)
    out["Line Manager ID"] = out["Line Manager ID"].fillna("").astype(str)
    return out


def validate(df: pd.DataFrame) -> None:
    emp = set(df["ID"].astype(str).str.strip())
    mgrs = df["Line Manager ID"].fillna("").astype(str).str.strip()
    missing = df[mgrs.ne("") & ~mgrs.isin(emp)]
    assert len(df) == TARGET_ROWS, f"Expected {TARGET_ROWS} rows, got {len(df)}"
    assert df["ID"].is_unique, "Duplicate employee IDs"
    assert missing.empty, f"Invalid managers:\n{missing}"
    assert (df.loc[df["ID"] == CEO_ID, "Line Manager ID"].iloc[0] == ""), "CEO must have blank manager"
    required = [
        "ID", "Line Manager ID", "Job Title", "FTE", "Fully loaded cost", "Country",
        "Function", "Sub-Function", "Grade", "Division", "Entity", "Start Date",
        "Basic Pay", "Contract", "Status",
    ]
    assert list(df.columns) == required, df.columns.tolist()
    print(f"OK: {len(df)} rows, {df['Function'].nunique()} functions, "
          f"{df['Job Title'].nunique()} titles, max depth-ready hierarchy")


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df = build()
    validate(df)
    df.to_excel(OUTPUT_PATH, index=False, sheet_name="Census")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
