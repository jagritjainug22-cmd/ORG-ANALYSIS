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


def _safe_num(val, default=0.0):
    """Coerce a cell to float; non-numeric / missing values become default."""
    if val is None:
        return default
    try:
        if pd.isna(val):
            return default
    except (TypeError, ValueError):
        pass
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _native(val):
    """Convert numpy/pandas scalars to JSON-safe Python types."""
    if val is None:
        return None
    try:
        if pd.isna(val):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(val, "item"):
        try:
            return val.item()
        except (ValueError, AttributeError):
            pass
    return val


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


def _span_distribution(managers: pd.DataFrame) -> list:
    """Bucket manager counts by span of control for a histogram."""
    if managers.empty:
        return []
    buckets = [
        ("1", lambda s: s == 1),
        ("2-3", lambda s: (s >= 2) & (s <= 3)),
        ("4-5", lambda s: (s >= 4) & (s <= 5)),
        ("6-8", lambda s: (s >= 6) & (s <= 8)),
        ("9+", lambda s: s >= 9),
    ]
    spans = managers["Span"]
    out = []
    for label, pred in buckets:
        out.append({"bucket": label, "count": int(pred(spans).sum())})
    return out


def _function_benchmarks(df, managers, func_col, threshold=0, fte_col=None, flc_col=None) -> list:
    """Per-function span stats for internal benchmarking."""
    if not func_col or func_col not in df.columns or managers.empty:
        return []

    mgr = managers.copy()
    mgr["_func"] = mgr[func_col].fillna("(Blank)").astype(str)
    hc_by_func = df[func_col].fillna("(Blank)").astype(str).value_counts().to_dict()

    # Convert FTE/FLC columns to numeric safely (coerce non-numeric to NaN, then fill with defaults)
    if fte_col and fte_col in df.columns:
        df[fte_col] = pd.to_numeric(df[fte_col], errors="coerce").fillna(1.0)
        mgr[fte_col] = pd.to_numeric(mgr[fte_col], errors="coerce").fillna(1.0)
    if flc_col and flc_col in df.columns:
        df[flc_col] = pd.to_numeric(df[flc_col], errors="coerce").fillna(0.0)
        mgr[flc_col] = pd.to_numeric(mgr[flc_col], errors="coerce").fillna(0.0)

    rows = []
    for func_val, grp in mgr.groupby("_func"):
        mgr_count = len(grp)
        avg = round(float(grp["Span"].mean()), 2) if mgr_count else 0.0
        median = round(float(grp["Span"].median()), 2) if mgr_count else 0.0
        min_span = int(grp["Span"].min()) if mgr_count else 0
        max_span = int(grp["Span"].max()) if mgr_count else 0
        one_to_one = int((grp["Span"] == 1).sum())
        headcount = int(hc_by_func.get(func_val, 0))

        fte_opp = 0.0
        cost_opp = 0.0
        below_count = 0
        if threshold > 0:
            below = grp[grp["Span"] < threshold]
            below_count = len(below)
            for _, row in below.iterrows():
                fte_val = _safe_num(row.get(fte_col), 1.0) if fte_col and fte_col in df.columns else 1.0
                flc_val = _safe_num(row.get(flc_col), 0.0) if flc_col and flc_col in df.columns else 0.0
                fte_opp += fte_val
                cost_opp += flc_val

        rows.append({
            "function": str(func_val),
            "headcount": headcount,
            "manager_count": mgr_count,
            "avg_span": avg,
            "median_span": median,
            "min_span": min_span,
            "max_span": max_span,
            "one_to_one_count": one_to_one,
            "below_target_count": below_count,
            "fte_opportunity": round(fte_opp, 2),
            "cost_opportunity": round(cost_opp, 1),
        })

    # Rank: narrowest avg span first (biggest redesign opportunity typically)
    rows.sort(key=lambda r: (r["avg_span"], -r["manager_count"]))
    return rows


def get_insights(df, threshold=0, emp_col=None, mgr_col=None, fte_col=None, flc_col=None, func_col=None):
    """
    Structural insights: 1:1 managers, below-target span, thin layers,
    FTE/cost opportunity, span distribution, and function-level benchmarks.
    """
    if "Span" not in df.columns:
        raise ValueError("Span column missing")

    df = df.copy()
    df["Span"] = pd.to_numeric(df["Span"], errors="coerce").fillna(0)
    if "Level" in df.columns:
        df["Level"] = pd.to_numeric(df["Level"], errors="coerce")
    # Convert FTE/FLC BEFORE slicing managers — otherwise the below-target loop
    # still sees original strings and crashes (insights comes back null).
    if fte_col and fte_col in df.columns:
        df[fte_col] = pd.to_numeric(df[fte_col], errors="coerce").fillna(1.0)
    if flc_col and flc_col in df.columns:
        df[flc_col] = pd.to_numeric(df[flc_col], errors="coerce").fillna(0.0)
    emp_col = emp_col or next((c for c in df.columns if "emp" in c.lower() and "id" in c.lower()), df.columns[0])
    name_col = _pick_name_col(df, emp_col)
    managers = df[df["Span"] > 0].copy()

    one_to_one = managers[managers["Span"] == 1]
    one_to_one_list = []
    for _, row in one_to_one.iterrows():
        one_to_one_list.append({
            "emp_id": _safe_str(row.get(emp_col)),
            "name": _row_label(row, emp_col, name_col),
            "level": _native(row.get("Level")),
            "span": int(_safe_num(row.get("Span"), 0)),
        })

    below_target = []
    fte_opportunity = 0.0
    cost_opportunity = 0.0
    if threshold > 0:
        below = managers[(managers["Span"] > 0) & (managers["Span"] < threshold)]
        for _, row in below.iterrows():
            span_val = _safe_num(row.get("Span"), 0)
            gap = round(threshold - span_val, 1)
            fte_val = _safe_num(row.get(fte_col), 1.0) if fte_col and fte_col in df.columns else 1.0
            flc_val = _safe_num(row.get(flc_col), 0.0) if flc_col and flc_col in df.columns else 0.0
            below_target.append({
                "emp_id": _safe_str(row.get(emp_col)),
                "name": _row_label(row, emp_col, name_col),
                "level": _native(row.get("Level")),
                "current_span": int(span_val),
                "target_span": threshold,
                "gap": gap,
                "fte": round(fte_val, 2),
                "cost": round(flc_val, 1),
            })
            fte_opportunity += fte_val
            cost_opportunity += flc_val

    thin_layers = detect_thin_layers(df, emp_col, mgr_col) if mgr_col and mgr_col in df.columns else []

    avg_span = round(float(managers["Span"].mean()), 2) if len(managers) > 0 else 0.0
    management_depth = int(df["Level"].max()) if "Level" in df.columns and len(df) and pd.notna(df["Level"].max()) else 0
    total_managers = int(len(managers))
    total_ics = int((df["Span"] == 0).sum())

    by_function = _function_benchmarks(
        df, managers, func_col, threshold=threshold, fte_col=fte_col, flc_col=flc_col
    )
    narrowest = by_function[0] if by_function else None
    widest = max(by_function, key=lambda r: r["avg_span"]) if by_function else None

    # Most efficiently structured = highest avg span (best leverage of managers).
    # Prefer functions with >= 2 managers; fall back to any function.
    efficient_pool = [r for r in by_function if r["manager_count"] >= 2] or list(by_function)
    most_efficient = max(efficient_pool, key=lambda r: (r["avg_span"], r["manager_count"])) if efficient_pool else None
    # Avoid trivial duplicate messaging when every function has the same avg span
    if (
        most_efficient
        and narrowest
        and widest
        and narrowest["function"] == widest["function"] == most_efficient["function"]
        and len(by_function) == 1
    ):
        pass  # single-function org — keep the highlight

    # Redesign priority: functions with largest combined opportunity when threshold set
    redesign_priority = []
    if threshold > 0 and by_function:
        ranked = sorted(
            by_function,
            key=lambda r: (r["fte_opportunity"], r["cost_opportunity"], -r["avg_span"]),
            reverse=True,
        )
        redesign_priority = [
            {
                "function": r["function"],
                "fte_opportunity": r["fte_opportunity"],
                "cost_opportunity": r["cost_opportunity"],
                "below_target_count": r["below_target_count"],
                "avg_span": r["avg_span"],
                "rank": i + 1,
            }
            for i, r in enumerate(ranked)
            if r["below_target_count"] > 0 or r["fte_opportunity"] > 0
        ]

    return {
        "one_to_one_count": len(one_to_one_list),
        "one_to_one_managers": one_to_one_list,
        "below_target_count": len(below_target),
        "below_target": below_target,
        "thin_layer_count": len(thin_layers),
        "thin_layers": thin_layers,
        "fte_opportunity": round(fte_opportunity, 2),
        "cost_opportunity": round(cost_opportunity, 1),
        "avg_span": avg_span,
        "total_managers": total_managers,
        "total_ics": total_ics,
        "management_depth": management_depth,
        "span_distribution": _span_distribution(managers),
        "by_function": by_function,
        "function_highlights": {
            "narrowest": narrowest,
            "widest": widest,
            "most_efficient": most_efficient,
        },
        "redesign_priority": redesign_priority,
        "has_cost_data": bool(flc_col and flc_col in df.columns),
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
