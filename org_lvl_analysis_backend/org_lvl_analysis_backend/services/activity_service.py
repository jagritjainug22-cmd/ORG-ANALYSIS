"""Activity Analysis service for OrgSight.

Workflow:
  Step 1 – Pick a role grouping column → discover distinct role values from census
  Step 2 – Define activities (name + process) + set % time per role
  Step 3 – Apply savings levers (automation / AI / stop_work / BPO) per activity with date
  Step 4 – Compute time-phased FTE/cost impact and savings breakdowns
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd


# ---------------------------------------------------------------------------
# Step 1 helpers
# ---------------------------------------------------------------------------

def get_role_values(
    dataset_id: int,
    role_grouping_col: str,
) -> List[Dict[str, Any]]:
    """Return distinct role values and their census counts for a given column."""
    from services.db_service import get_baseline_records, get_dataset

    records = get_baseline_records(dataset_id)
    
    # Resolve column names from dataset configuration
    dataset = get_dataset(dataset_id)
    fte_col = dataset.get("fte_col") if dataset else None
    flc_col = dataset.get("flc_col") if dataset else None
    
    counts: Dict[str, int] = defaultdict(int)
    fte_sums: Dict[str, float] = defaultdict(float)
    cost_sums: Dict[str, float] = defaultdict(float)

    for r in records:
        val = str(r.get(role_grouping_col) or "").strip()
        if not val:
            val = "(Blank)"
        counts[val] += 1
        
        # Try configured column first, then fall back to standard names
        fte_value = r.get(fte_col) if fte_col else None
        if fte_value is None:
            fte_value = r.get("__fte") or r.get("FTE") or r.get("fte") or 0
        fte_sums[val] += float(fte_value or 0)
        
        flc_value = r.get(flc_col) if flc_col else None
        if flc_value is None:
            flc_value = r.get("__flc") or r.get("FLC") or r.get("Fully loaded cost") or 0
        cost_sums[val] += float(flc_value or 0)

    return sorted(
        [
            {
                "role_value": rv,
                "headcount": counts[rv],
                "total_fte": round(fte_sums[rv], 2),
                "total_cost": round(cost_sums[rv], 2),
            }
            for rv in counts
        ],
        key=lambda x: (-x["headcount"], x["role_value"].lower()),
    )


# ---------------------------------------------------------------------------
# Step 2 helpers
# ---------------------------------------------------------------------------

def get_allocation_completeness(config_id: int) -> List[Dict[str, Any]]:
    """Per role: how much % is allocated, which activities are assigned."""
    from services.db_service import get_role_allocation_matrix

    matrix_data = get_role_allocation_matrix(config_id)
    result = []
    for row in matrix_data["matrix"]:
        total = row["total_pct"]
        if total >= 0.98:
            status = "complete"
        elif total >= 0.50:
            status = "partial"
        elif total > 0:
            status = "low"
        else:
            status = "empty"
        result.append({
            "role_value": row["role_value"],
            "total_pct": round(total, 4),
            "total_pct_display": f"{round(total * 100, 1)}%",
            "status": status,
            "activity_count": len([v for v in row["allocations"].values() if v > 0]),
        })
    return result


def parse_allocation_upload(df: pd.DataFrame, activities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Parse an Excel allocation matrix upload.

    Expected format: rows = roles, columns = activity names, cells = % (0-100 or 0.0-1.0).
    First column is the role name.
    """
    act_by_name = {a["name"].strip().lower(): a["id"] for a in activities}
    cols = list(df.columns)
    role_col = cols[0]
    activity_cols = cols[1:]

    allocations = []
    for _, row in df.iterrows():
        role_val = str(row[role_col]).strip()
        if not role_val or role_val.lower() in ("nan", "role", "roles"):
            continue
        for act_col in activity_cols:
            act_name = str(act_col).strip().lower()
            act_id = act_by_name.get(act_name)
            if act_id is None:
                continue
            raw = pd.to_numeric(row[act_col], errors="coerce")
            if pd.isna(raw):
                continue
            pct = float(raw)
            if pct > 1.5:  # assume 0-100 scale
                pct = pct / 100.0
            allocations.append({"role_value": role_val, "activity_id": act_id, "time_pct": pct})
    return allocations


# ---------------------------------------------------------------------------
# Step 3 helpers
# ---------------------------------------------------------------------------

def parse_lever_upload(df: pd.DataFrame, activities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Parse an Excel lever upload.

    Expected columns: Activity, Process, Lever Type, Reduction %, Effective Date.
    """
    act_by_name = {a["name"].strip().lower(): a["id"] for a in activities}
    cols = {str(c).strip().lower(): c for c in df.columns}

    act_col = next((cols[k] for k in ("activity", "activity name") if k in cols), None)
    type_col = next((cols[k] for k in ("lever type", "lever", "type") if k in cols), None)
    pct_col = next((cols[k] for k in ("reduction %", "reduction_pct", "reduction", "%") if k in cols), None)
    date_col = next((cols[k] for k in ("effective date", "date", "effective_date") if k in cols), None)

    if not act_col or not type_col or not pct_col or not date_col:
        raise ValueError(
            "Upload must have columns: Activity, Lever Type, Reduction %, Effective Date"
        )

    valid_types = {"automation", "ai", "stop_work", "bpo"}
    levers = []
    for _, row in df.iterrows():
        act_name = str(row[act_col]).strip().lower()
        act_id = act_by_name.get(act_name)
        if act_id is None:
            continue
        lt = str(row[type_col]).strip().lower().replace(" ", "_")
        if lt not in valid_types:
            continue
        pct = pd.to_numeric(row[pct_col], errors="coerce")
        if pd.isna(pct):
            continue
        pct = float(pct)
        if pct > 1.5:
            pct = pct / 100.0
        raw_date = str(row[date_col]).strip()
        try:
            parsed = pd.to_datetime(raw_date)
            eff_date = parsed.strftime("%Y-%m-%d")
        except Exception:
            eff_date = raw_date
        levers.append({"activity_id": act_id, "lever_type": lt, "reduction_pct": pct, "effective_date": eff_date})
    return levers


# ---------------------------------------------------------------------------
# Step 4 — compute impact
# ---------------------------------------------------------------------------

LEVER_COLORS = {
    "automation": "#3b82f6",  # blue
    "ai": "#8b5cf6",          # violet
    "stop_work": "#ef4444",   # red
    "bpo": "#f59e0b",         # amber
}

LEVER_LABELS = {
    "automation": "Automation",
    "ai": "AI / Augmentation",
    "stop_work": "Stop Work",
    "bpo": "BPO / Outsource",
}


def _monthly_periods(start: date, end: date) -> List[str]:
    months = []
    cur = start.replace(day=1)
    while cur <= end:
        months.append(cur.strftime("%Y-%m"))
        if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1)
        else:
            cur = cur.replace(month=cur.month + 1)
    return months


def compute_impact(
    config_id: int,
    dataset_id: int,
    function_col: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute time-phased FTE/cost savings for all roles/people.

    Returns:
      {
        "months": [...],
        "fte_trend":  {month: total_fte_remaining},
        "cost_trend": {month: total_cost_remaining},
        "savings_by_lever": {lever_type: total_savings_cost},
        "savings_by_process": [{process, activity, savings_fte, savings_cost}],
        "savings_by_role":    [{role_value, baseline_fte, baseline_cost, savings_fte, savings_cost}],
        "individual_savings": [{emp_id, role_value, baseline_cost, savings_cost, pct_saved}],
        # optional (when function_col is set):
        "function_breakdown": [{function, baseline_fte, post_impact_fte, delta_fte,
                                 baseline_cost, post_impact_cost, delta_cost}],
        "fte_by_function_lever_month": {func: {lever|"Total": {month: value}}},
        "cost_by_function_lever_month": {func: {lever|"Total": {month: value}}},
      }
    """
    from services.db_service import (
        get_activity_config,
        get_activity_levers,
        get_baseline_records,
        get_dataset,
    )

    cfg = get_activity_config(config_id)
    if not cfg:
        raise ValueError(f"Activity config {config_id} not found")

    # Resolve column names from dataset configuration
    dataset = get_dataset(dataset_id)
    fte_col = dataset.get("fte_col") if dataset else None
    flc_col = dataset.get("flc_col") if dataset else None

    role_col = cfg["role_grouping_col"]
    activities = {a["id"]: a for a in cfg["activities"]}
    levers = get_activity_levers(config_id)
    records = get_baseline_records(dataset_id)

    # Build allocation map: role_value → {activity_id → time_pct}
    alloc_map: Dict[str, Dict[int, float]] = defaultdict(dict)
    for a in cfg["allocations"]:
        alloc_map[str(a["role_value"])][int(a["activity_id"])] = float(a["time_pct"] or 0)

    # Build lever map: activity_id → [{lever_type, reduction_pct, effective_date}]
    lever_map: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for lv in levers:
        lever_map[int(lv["activity_id"])].append({
            "lever_type": lv["lever_type"],
            "reduction_pct": float(lv["reduction_pct"] or 0),
            "effective_date": lv["effective_date"],
        })

    # Determine time range
    today = date.today()
    latest_str = max(
        (lv["effective_date"] for lv in levers if lv.get("effective_date")),
        default=today.strftime("%Y-%m-%d"),
    )
    try:
        latest_date = date.fromisoformat(latest_str)
    except ValueError:
        latest_date = today
    end_date = date(latest_date.year + 1, 1, 1)  # extend 1 year past last lever
    months = _monthly_periods(today, end_date)

    # -----------------------------------------------------------------------
    # Per-person savings accumulation
    # -----------------------------------------------------------------------
    baseline_fte_total = 0.0
    baseline_cost_total = 0.0
    monthly_savings_fte: Dict[str, float] = defaultdict(float)
    monthly_savings_cost: Dict[str, float] = defaultdict(float)
    savings_by_lever: Dict[str, float] = defaultdict(float)
    savings_by_act: Dict[int, Dict[str, float]] = defaultdict(lambda: {"savings_fte": 0.0, "savings_cost": 0.0})
    savings_by_role: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"baseline_fte": 0.0, "baseline_cost": 0.0, "savings_fte": 0.0, "savings_cost": 0.0}
    )
    individual_savings: List[Dict[str, Any]] = []

    # Function-level tracking (only when function_col is provided)
    func_fte_baseline: Dict[str, float] = defaultdict(float)
    func_cost_baseline: Dict[str, float] = defaultdict(float)
    # func_lever_monthly_savings_fte[func][lever_type][month] = cumulative savings
    func_lever_monthly_savings_fte: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )
    func_lever_monthly_savings_cost: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )
    # baseline FTE allocated to activities per (func, lever)
    func_lever_fte_baseline: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    func_lever_cost_baseline: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for rec in records:
        role_val = str(rec.get(role_col) or "").strip() or "(Blank)"
        
        # Try configured column first, then fall back to standard names
        raw_fte = rec.get(fte_col) if fte_col else None
        if raw_fte is None:
            raw_fte = rec.get("FTE") or rec.get("fte") or rec.get("__fte") or 1.0
        
        raw_cost = rec.get(flc_col) if flc_col else None
        if raw_cost is None:
            raw_cost = rec.get("Fully loaded cost") or rec.get("FLC") or rec.get("flc") or rec.get("__flc") or 0.0
        
        p_fte = float(raw_fte or 1.0)
        p_cost = float(raw_cost or 0.0)
        emp_id = str(rec.get("ID") or rec.get("__emp_id") or "")
        func_val = str(rec.get(function_col) or "").strip() or "(Blank)" if function_col else None

        baseline_fte_total += p_fte
        baseline_cost_total += p_cost
        savings_by_role[role_val]["baseline_fte"] += p_fte
        savings_by_role[role_val]["baseline_cost"] += p_cost
        if func_val is not None:
            func_fte_baseline[func_val] += p_fte
            func_cost_baseline[func_val] += p_cost

        person_allocs = alloc_map.get(role_val, {})
        if not person_allocs:
            individual_savings.append({
                "emp_id": emp_id, "role_value": role_val,
                "baseline_cost": round(p_cost, 2),
                "savings_cost": 0.0, "pct_saved": 0.0,
            })
            continue

        person_total_savings = 0.0
        person_savings_fte = 0.0

        for act_id, time_pct in person_allocs.items():
            if time_pct <= 0:
                continue
            act_levers = lever_map.get(act_id, [])
            for lv in act_levers:
                eff_date_str = lv["effective_date"]
                try:
                    eff_date = date.fromisoformat(eff_date_str)
                except ValueError:
                    continue
                eff_month = eff_date.strftime("%Y-%m")
                reduction = float(lv["reduction_pct"] or 0)
                lt = lv["lever_type"]
                if reduction <= 0:
                    continue

                savings_fte_contrib = p_fte * time_pct * reduction
                savings_cost_contrib = p_cost * time_pct * reduction

                for month in months:
                    if month >= eff_month:
                        monthly_savings_fte[month] += savings_fte_contrib
                        monthly_savings_cost[month] += savings_cost_contrib
                        if func_val is not None:
                            func_lever_monthly_savings_fte[func_val][lt][month] += savings_fte_contrib
                            func_lever_monthly_savings_cost[func_val][lt][month] += savings_cost_contrib

                savings_by_lever[lt] += savings_cost_contrib
                savings_by_act[act_id]["savings_fte"] += savings_fte_contrib
                savings_by_act[act_id]["savings_cost"] += savings_cost_contrib
                savings_by_role[role_val]["savings_fte"] += savings_fte_contrib
                savings_by_role[role_val]["savings_cost"] += savings_cost_contrib
                person_total_savings += savings_cost_contrib
                person_savings_fte += savings_fte_contrib

                # Track baseline by (func, lever) — how much FTE is allocated to this lever bucket
                if func_val is not None:
                    func_lever_fte_baseline[func_val][lt] += p_fte * time_pct
                    func_lever_cost_baseline[func_val][lt] += p_cost * time_pct

        individual_savings.append({
            "emp_id": emp_id, "role_value": role_val,
            "baseline_cost": round(p_cost, 2),
            "savings_cost": round(person_total_savings, 2),
            "pct_saved": round(person_total_savings / p_cost * 100, 1) if p_cost else 0.0,
        })

    # Build trend arrays
    fte_trend = {m: round(baseline_fte_total - monthly_savings_fte.get(m, 0.0), 3) for m in months}
    cost_trend = {m: round(baseline_cost_total - monthly_savings_cost.get(m, 0.0), 2) for m in months}

    # Savings by process/activity table
    savings_by_process = []
    for act_id, sav in savings_by_act.items():
        act = activities.get(act_id, {})
        savings_by_process.append({
            "activity_id": act_id,
            "activity": act.get("name", ""),
            "process": act.get("process_name", ""),
            "savings_fte": round(sav["savings_fte"], 3),
            "savings_cost": round(sav["savings_cost"], 2),
        })
    savings_by_process.sort(key=lambda x: -x["savings_cost"])

    savings_by_role_list = [
        {
            "role_value": rv,
            "baseline_fte": round(d["baseline_fte"], 2),
            "baseline_cost": round(d["baseline_cost"], 2),
            "savings_fte": round(d["savings_fte"], 3),
            "savings_cost": round(d["savings_cost"], 2),
            "pct_saved": round(d["savings_cost"] / d["baseline_cost"] * 100, 1) if d["baseline_cost"] else 0.0,
        }
        for rv, d in savings_by_role.items()
    ]
    savings_by_role_list.sort(key=lambda x: -x["savings_cost"])

    individual_savings.sort(key=lambda x: -x["savings_cost"])

    total_savings_cost = monthly_savings_cost.get(months[-1] if months else "", 0.0) if months else 0.0
    total_savings_fte = monthly_savings_fte.get(months[-1] if months else "", 0.0) if months else 0.0

    result: Dict[str, Any] = {
        "months": months,
        "baseline_fte": round(baseline_fte_total, 2),
        "baseline_cost": round(baseline_cost_total, 2),
        "total_savings_cost": round(total_savings_cost, 2),
        "total_savings_fte": round(total_savings_fte, 3),
        "fte_trend": fte_trend,
        "cost_trend": cost_trend,
        "savings_by_lever": {lt: round(v, 2) for lt, v in savings_by_lever.items()},
        "savings_by_process": savings_by_process,
        "savings_by_role": savings_by_role_list,
        "individual_savings": individual_savings[:500],
    }

    # -----------------------------------------------------------------------
    # Function-level breakdown (only when function_col provided)
    # -----------------------------------------------------------------------
    if function_col and func_fte_baseline:
        # Compute total monthly savings per function (sum across all levers)
        func_total_monthly_savings_fte: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        func_total_monthly_savings_cost: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for func, lever_data in func_lever_monthly_savings_fte.items():
            for lt, month_data in lever_data.items():
                for m, v in month_data.items():
                    func_total_monthly_savings_fte[func][m] += v
        for func, lever_data in func_lever_monthly_savings_cost.items():
            for lt, month_data in lever_data.items():
                for m, v in month_data.items():
                    func_total_monthly_savings_cost[func][m] += v

        last_month = months[-1] if months else ""
        function_breakdown = []
        for func in sorted(func_fte_baseline.keys(), key=lambda f: -func_fte_baseline[f]):
            bfte = func_fte_baseline[func]
            bcost = func_cost_baseline[func]
            sfte = func_total_monthly_savings_fte[func].get(last_month, 0.0)
            scost = func_total_monthly_savings_cost[func].get(last_month, 0.0)
            function_breakdown.append({
                "function": func,
                "baseline_fte": round(bfte, 2),
                "post_impact_fte": round(bfte - sfte, 2),
                "delta_fte": round(sfte, 2),
                "baseline_cost": round(bcost, 2),
                "post_impact_cost": round(bcost - scost, 2),
                "delta_cost": round(scost, 2),
            })

        # Build cross-tab: {func: {lever|"Total": {month: fte_remaining}}}
        fte_by_func: Dict[str, Dict[str, Dict[str, float]]] = {}
        cost_by_func: Dict[str, Dict[str, Dict[str, float]]] = {}

        for func in func_fte_baseline:
            fte_by_func[func] = {}
            cost_by_func[func] = {}

            # Total row = baseline FTE for function - all savings up to month
            fte_by_func[func]["Total"] = {
                m: round(func_fte_baseline[func] - func_total_monthly_savings_fte[func].get(m, 0.0), 2)
                for m in months
            }
            cost_by_func[func]["Total"] = {
                m: round(func_cost_baseline[func] - func_total_monthly_savings_cost[func].get(m, 0.0), 2)
                for m in months
            }

            # Per-lever rows = baseline lever FTE - lever savings up to month
            all_levers = set(func_lever_fte_baseline[func].keys()) | set(func_lever_monthly_savings_fte[func].keys())
            for lt in all_levers:
                baseline_lt_fte = func_lever_fte_baseline[func].get(lt, 0.0)
                baseline_lt_cost = func_lever_cost_baseline[func].get(lt, 0.0)
                fte_by_func[func][lt] = {
                    m: round(baseline_lt_fte - func_lever_monthly_savings_fte[func][lt].get(m, 0.0), 2)
                    for m in months
                }
                cost_by_func[func][lt] = {
                    m: round(baseline_lt_cost - func_lever_monthly_savings_cost[func][lt].get(m, 0.0), 2)
                    for m in months
                }

        result["function_breakdown"] = function_breakdown
        result["fte_by_function_lever_month"] = fte_by_func
        result["cost_by_function_lever_month"] = cost_by_func

    return result


def impact_to_excel(impact: Dict[str, Any], config_name: str = "Activity Analysis") -> bytes:
    """Serialize compute_impact result to a multi-sheet Excel workbook."""
    from io import BytesIO
    import openpyxl  # noqa – just to validate install

    months = impact.get("months", [])
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        # Summary
        pd.DataFrame([
            {"Metric": "Baseline FTE", "Value": impact.get("baseline_fte")},
            {"Metric": "Baseline Cost", "Value": impact.get("baseline_cost")},
            {"Metric": "Total Savings (FTE)", "Value": impact.get("total_savings_fte")},
            {"Metric": "Total Savings (Cost)", "Value": impact.get("total_savings_cost")},
        ]).to_excel(writer, index=False, sheet_name="Summary")

        # FTE + Cost trend
        if months:
            pd.DataFrame([
                {
                    "Month": m,
                    "FTE Remaining": impact["fte_trend"].get(m),
                    "Cost Remaining": impact["cost_trend"].get(m),
                }
                for m in months
            ]).to_excel(writer, index=False, sheet_name="Trend")

        # Savings by lever
        if impact.get("savings_by_lever"):
            pd.DataFrame([
                {"Lever": LEVER_LABELS.get(lt, lt), "Savings Cost": v}
                for lt, v in impact["savings_by_lever"].items()
            ]).to_excel(writer, index=False, sheet_name="By Lever")

        # Savings by process/activity
        if impact.get("savings_by_process"):
            pd.DataFrame(impact["savings_by_process"]).to_excel(writer, index=False, sheet_name="By Activity")

        # Savings by role
        if impact.get("savings_by_role"):
            pd.DataFrame(impact["savings_by_role"]).to_excel(writer, index=False, sheet_name="By Role")

        # Individual
        if impact.get("individual_savings"):
            pd.DataFrame(impact["individual_savings"]).to_excel(writer, index=False, sheet_name="Individuals")

    buf.seek(0)
    return buf.read()
