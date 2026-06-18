import numpy as np
import pandas as pd
from collections import defaultdict


def spans_and_layers(df):
    """
    Compute IC, Manager counts and avg span by level.
    """
    if "Span" not in df.columns:
        raise ValueError("Span column missing")

    df = df.copy()
    df["Span"] = pd.to_numeric(df["Span"], errors="coerce").fillna(0)
    if "Level" in df.columns:
        df["Level"] = pd.to_numeric(df["Level"], errors="coerce")
    df["Is_Manager"] = df["Span"].apply(lambda x: 1 if x > 0 else 0)
    df["Is_IC"] = 1 - df["Is_Manager"]

    summary = df.groupby("Level").agg(
        IC_Count=("Is_IC", "sum"),
        Manager_Count=("Is_Manager", "sum"),
        Avg_Span=("Span", "mean")
    ).reset_index()

    summary["Total_Employees"] = summary["IC_Count"] + summary["Manager_Count"]
    summary["Avg_Span"] = summary["Avg_Span"].round(2)

    return summary


def span_threshold(df, threshold, fte_col=None, flc_col=None):
    """
    Classification High / Low span.
    """
    df = df.copy()
    df["Span"] = pd.to_numeric(df["Span"], errors="coerce").fillna(0)

    if "Is_Manager" not in df.columns:
        df["Is_Manager"] = df["Span"].apply(lambda x: 1 if x > 0 else 0)
    if "Is_IC" not in df.columns:
        df["Is_IC"] = df["Is_Manager"].apply(lambda x: 0 if x == 1 else 1)

    df["Span_Threshold"] = np.where(
        (df["Is_Manager"] == 1) & (df["Span"] >= threshold),
        "High",
        np.where(df["Is_Manager"] == 1, "Low", "")
    )

    high = ((df["Is_Manager"] == 1) & (df["Span"] >= threshold)).sum()
    low = ((df["Is_Manager"] == 1) & (df["Span"] < threshold)).sum()

    return df, high, low


def _safe_str(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return ""
    return str(val)


def _pick_name_col(df, emp_col):
    for c in ["Name", "Employee Name", "Full Name", "Job Title", "Position Title"]:
        if c in df.columns:
            return c
    return None


def _row_label(row, emp_col, name_col):
    name = _safe_str(row.get(name_col)) if name_col else ""
    emp = _safe_str(row.get(emp_col))
    return name or emp


def _build_children_map(df, emp_col, mgr_col):
    children = defaultdict(list)
    for _, row in df.iterrows():
        emp = _safe_str(row.get(emp_col))
        mgr = _safe_str(row.get(mgr_col))
        if emp and mgr and mgr not in ("nan", "None"):
            children[mgr].append(emp)
    return children


def detect_thin_layers(df, emp_col, mgr_col):
    """
    Managers with exactly 1 direct report, where that report is also a
    manager with exactly 1 direct report (consecutive thin branch).
    """
    if not emp_col or emp_col not in df.columns:
        return []

    children = _build_children_map(df, emp_col, mgr_col)
    span_map = { _safe_str(r[emp_col]): int(r.get("Span", 0) or 0) for _, r in df.iterrows() }
    level_map = { _safe_str(r[emp_col]): r.get("Level") for _, r in df.iterrows() }
    by_id = { _safe_str(r[emp_col]): r for _, r in df.iterrows() }
    name_col = _pick_name_col(df, emp_col)

    thin = []
    seen = set()
    for _, row in df.iterrows():
        emp = _safe_str(row.get(emp_col))
        if span_map.get(emp, 0) != 1:
            continue
        reports = children.get(emp, [])
        if len(reports) != 1:
            continue
        report = reports[0]
        if span_map.get(report, 0) != 1:
            continue
        key = tuple(sorted([emp, report]))
        if key in seen:
            continue
        seen.add(key)
        report_row = by_id.get(report)
        thin.append({
            "emp_id": emp,
            "name": _row_label(row, emp_col, name_col),
            "level": level_map.get(emp),
            "report_id": report,
            "report_name": _row_label(report_row, emp_col, name_col) if report_row is not None else report,
        })
    return thin


def get_insights(df, threshold=0, emp_col=None, mgr_col=None, fte_col=None):
    """
    Structural insights: 1:1 managers, below-target span, thin layers, FTE opportunity.
    """
    if "Span" not in df.columns:
        raise ValueError("Span column missing")

    df = df.copy()
    df["Span"] = pd.to_numeric(df["Span"], errors="coerce").fillna(0)
    if "Level" in df.columns:
        df["Level"] = pd.to_numeric(df["Level"], errors="coerce")
    emp_col = emp_col or next((c for c in df.columns if "emp" in c.lower() and "id" in c.lower()), df.columns[0])
    name_col = _pick_name_col(df, emp_col)
    managers = df[df["Span"] > 0]

    one_to_one = managers[managers["Span"] == 1]
    one_to_one_list = []
    for _, row in one_to_one.iterrows():
        one_to_one_list.append({
            "emp_id": _safe_str(row.get(emp_col)),
            "name": _row_label(row, emp_col, name_col),
            "level": row.get("Level"),
            "span": int(row.get("Span", 0)),
        })

    below_target = []
    fte_opportunity = 0.0
    if threshold > 0:
        below = managers[(managers["Span"] > 0) & (managers["Span"] < threshold)]
        for _, row in below.iterrows():
            gap = round(threshold - float(row["Span"]), 1)
            fte_val = float(row[fte_col]) if fte_col and fte_col in df.columns and pd.notna(row.get(fte_col)) else 1.0
            below_target.append({
                "emp_id": _safe_str(row.get(emp_col)),
                "name": _row_label(row, emp_col, name_col),
                "level": row.get("Level"),
                "current_span": int(row.get("Span", 0)),
                "target_span": threshold,
                "gap": gap,
                "fte": round(fte_val, 2),
            })
            fte_opportunity += fte_val

    thin_layers = detect_thin_layers(df, emp_col, mgr_col) if mgr_col and mgr_col in df.columns else []

    avg_span = round(float(managers["Span"].mean()), 2) if len(managers) > 0 else 0.0

    return {
        "one_to_one_count": len(one_to_one_list),
        "one_to_one_managers": one_to_one_list,
        "below_target_count": len(below_target),
        "below_target": below_target,
        "thin_layer_count": len(thin_layers),
        "thin_layers": thin_layers,
        "fte_opportunity": round(fte_opportunity, 2),
        "avg_span": avg_span,
    }


def get_layer_employees(df, level, emp_col=None, name_col=None):
    """Return all employees at a given hierarchy level."""
    if "Level" not in df.columns:
        raise ValueError("Level column missing")

    emp_col = emp_col or next((c for c in df.columns if "emp" in c.lower() and "id" in c.lower()), df.columns[0])
    name_col = name_col or _pick_name_col(df, emp_col)

    level_num = float(level)
    subset = df[df["Level"].astype(float) == level_num]

    rows = []
    for _, row in subset.iterrows():
        rows.append({
            "emp_id": _safe_str(row.get(emp_col)),
            "name": _row_label(row, emp_col, name_col),
            "level": row.get("Level"),
            "span": int(row.get("Span", 0) or 0),
            "is_manager": int(row.get("Span", 0) or 0) > 0,
        })
    return rows


def get_manager_detail(df, emp_id, threshold=0, emp_col=None, mgr_col=None, fte_col=None):
    """Detailed view of a single manager and their direct reports."""
    emp_col = emp_col or next((c for c in df.columns if "emp" in c.lower() and "id" in c.lower()), df.columns[0])
    mgr_col = mgr_col or next((c for c in df.columns if "mgr" in c.lower() or "manager" in c.lower()), None)
    name_col = _pick_name_col(df, emp_col)

    emp_id = _safe_str(emp_id)
    mgr_rows = df[df[emp_col].astype(str) == emp_id]
    if mgr_rows.empty:
        return None

    mgr = mgr_rows.iloc[0]
    span = int(mgr.get("Span", 0) or 0)

    direct_reports = []
    if mgr_col and mgr_col in df.columns:
        reports = df[df[mgr_col].astype(str) == emp_id]
        for _, row in reports.iterrows():
            direct_reports.append({
                "emp_id": _safe_str(row.get(emp_col)),
                "name": _row_label(row, emp_col, name_col),
                "level": row.get("Level"),
                "span": int(row.get("Span", 0) or 0),
            })

    fte_val = float(mgr[fte_col]) if fte_col and fte_col in df.columns and pd.notna(mgr.get(fte_col)) else None

    return {
        "emp_id": emp_id,
        "name": _row_label(mgr, emp_col, name_col),
        "level": mgr.get("Level"),
        "current_span": span,
        "target_span": threshold if threshold > 0 else None,
        "gap": round(threshold - span, 1) if threshold > 0 and span < threshold else 0,
        "fte": round(fte_val, 2) if fte_val is not None else None,
        "direct_reports": direct_reports,
    }
