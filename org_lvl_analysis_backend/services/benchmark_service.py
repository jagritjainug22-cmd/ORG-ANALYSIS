"""
Deterministic benchmarking engine.

Every number that reaches the client — variances, FTE gaps, cost gaps, savings
ranges — is computed here in plain Python and SQL. The LLM narration layer
(benchmark_analysis.py) only ever interprets values produced by this module, so
nothing quantitative can be hallucinated.

Pipeline:
    resolve_columns()        which census columns back which concept
    compute_client_metrics() one SQL battery -> aggregates -> registry metrics
    compare()                client metrics vs pack metrics -> variance rows
    quantify()               variance -> FTE / cost / savings range
    rank_opportunities()     ordered, de-duplicated opportunity list
    build_comparison()       one call that runs all of the above
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from services import benchmark_registry as reg
from services import db_service, duckdb_manager

log = logging.getLogger(__name__)

# Locations treated as low-cost delivery centres. Mirrors the tiers already used
# by the chat benchmark constants so both features tell the same story.
try:
    from services.benchmark_constants import BENCHMARKS as _CHAT_BENCHMARKS
    LOW_COST_LOCATIONS = [c.lower() for c in _CHAT_BENCHMARKS["location"]["low_cost_tier"]]
    HIGH_COST_LOCATIONS = [c.lower() for c in _CHAT_BENCHMARKS["location"]["high_cost_tier"]]
except Exception:  # pragma: no cover — defensive, constants file is checked in
    LOW_COST_LOCATIONS = ["india", "philippines", "malaysia", "vietnam", "egypt",
                          "poland", "romania", "mexico", "colombia", "south africa"]
    HIGH_COST_LOCATIONS = ["usa", "uk", "germany", "switzerland", "australia",
                           "singapore", "japan", "canada", "netherlands", "france"]

COVERAGE_WARNING_THRESHOLD = 60.0  # percent of FTE that must map to a benchmarked function

# Opportunity buckets. Functional right-sizing and structural de-layering
# measure overlapping cost, so they are reported side by side and never summed.
BUCKET_FUNCTIONAL = "functional"
BUCKET_STRUCTURAL = "structural"

# Preference order when picking the single metric that sizes a function's
# opportunity — prevents the same excess headcount being counted three times.
_PRIMARY_SIZING_ORDER = [
    "func_cost_pct_of_total_cost",
    "func_fte_pct_of_total_fte",
    "func_fte_per_1000_employees",
]
_PRIMARY_SUBFUNC_SIZING_ORDER = [
    "subfunc_cost_pct_of_function_cost",
    "subfunc_fte_pct_of_function_fte",
]


# ---------------------------------------------------------------------------
# Column resolution
# ---------------------------------------------------------------------------

def resolve_columns(dataset_meta: Dict[str, Any], schema: Dict[str, Any]) -> Dict[str, Any]:
    """Decide which physical census columns back each analytical concept.

    Rationalised Function / Subfunction win when present: they are already
    normalised onto the A&M master taxonomy, which is the same vocabulary the
    benchmark packs are authored in, so the join works without a mapping step.
    """
    available = {c["name"] for c in (schema or {}).get("columns", [])}

    def _pick(*candidates: Optional[str]) -> Optional[str]:
        for c in candidates:
            if c and c in available:
                return c
        return None

    func_col = _pick("Rationalised Function", dataset_meta.get("func_col"))
    subfunc_col = _pick("Rationalised Subfunction", dataset_meta.get("subfunc_col"))

    return {
        "emp_col": _pick(dataset_meta.get("emp_col")),
        "func_col": func_col,
        "func_col_is_rationalised": func_col == "Rationalised Function",
        "subfunc_col": subfunc_col,
        "subfunc_col_is_rationalised": subfunc_col == "Rationalised Subfunction",
        "fte_col": _pick(dataset_meta.get("fte_col")),
        "flc_col": _pick(dataset_meta.get("flc_col")),
        "country_col": _pick(dataset_meta.get("country_col"), "Country"),
        "job_title_col": _pick(dataset_meta.get("job_title_col"), "Job Title"),
        "has_level": "Level" in available,
        "has_span": "Span" in available,
    }


def _fte_expr(cols: Dict[str, Any]) -> str:
    """FTE expression, falling back to one-per-head when no FTE column exists."""
    return f'COALESCE(TRY_CAST("{cols["fte_col"]}" AS DOUBLE), 0)' if cols.get("fte_col") else "1.0"


def _cost_expr(cols: Dict[str, Any]) -> str:
    return f'COALESCE(TRY_CAST("{cols["flc_col"]}" AS DOUBLE), 0)' if cols.get("flc_col") else "0.0"


def _low_cost_expr(cols: Dict[str, Any]) -> str:
    if not cols.get("country_col"):
        return "FALSE"
    values = ", ".join(f"'{c}'" for c in LOW_COST_LOCATIONS)
    return f'LOWER(TRIM(CAST("{cols["country_col"]}" AS VARCHAR))) IN ({values})'


def _aggregate_select(cols: Dict[str, Any], target_span: float) -> str:
    fte = _fte_expr(cols)
    cost = _cost_expr(cols)
    span = "COALESCE(TRY_CAST(Span AS DOUBLE), 0)" if cols.get("has_span") else "0"
    level = "COALESCE(TRY_CAST(Level AS INTEGER), 0)" if cols.get("has_level") else "0"
    return f"""
    COUNT(*) AS headcount,
    ROUND(SUM({fte}), 2) AS total_fte,
    ROUND(SUM({cost}), 2) AS total_cost,
    COUNT(*) FILTER (WHERE {span} > 0) AS managers,
    COUNT(*) FILTER (WHERE {span} <= 0) AS ics,
    COALESCE(SUM({span}) FILTER (WHERE {span} > 0), 0) AS subordinates,
    ROUND(COALESCE(SUM({cost}) FILTER (WHERE {span} > 0), 0), 2) AS mgr_cost,
    COUNT(*) FILTER (WHERE {span} = 1) AS single_report_mgrs,
    COUNT(*) FILTER (WHERE {span} > 0 AND {span} < {target_span}) AS mgrs_below_target,
    MAX({level}) AS max_level,
    COUNT(DISTINCT {level}) AS level_depth,
    COUNT(*) FILTER (WHERE {level} >= 5) AS hc_below_l5,
    ROUND(COALESCE(SUM({fte}) FILTER (WHERE {_low_cost_expr(cols)}), 0), 2) AS low_cost_fte
    """


# ---------------------------------------------------------------------------
# Client metric computation
# ---------------------------------------------------------------------------

def compute_client_metrics(
    user_id: int,
    dataset_meta: Dict[str, Any],
    schema: Dict[str, Any],
    config: Dict[str, Any],
    pack_functions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Run the aggregate battery and derive every registry metric from it."""
    cols = resolve_columns(dataset_meta, schema)
    target_span = float(config.get("target_span") or reg.DEFAULT_TARGET_SPAN)
    ctx = dict(config.get("context") or {})
    agg_select = _aggregate_select(cols, target_span)

    org_rows = duckdb_manager.query(user_id, f"SELECT {agg_select} FROM employees")["data"]
    org_agg = dict(org_rows[0]) if org_rows else {}

    function_aggs: List[Dict[str, Any]] = []
    if cols.get("func_col"):
        fq = (
            f'SELECT "{cols["func_col"]}" AS group_value, {agg_select} '
            f'FROM employees WHERE "{cols["func_col"]}" IS NOT NULL '
            f'AND TRIM(CAST("{cols["func_col"]}" AS VARCHAR)) <> \'\' '
            f'GROUP BY 1 ORDER BY total_fte DESC'
        )
        function_aggs = [dict(r) for r in duckdb_manager.query(user_id, fq)["data"]]

    subfunction_aggs: List[Dict[str, Any]] = []
    if cols.get("func_col") and cols.get("subfunc_col"):
        sq = (
            f'SELECT "{cols["func_col"]}" AS group_value, '
            f'"{cols["subfunc_col"]}" AS sub_value, {agg_select} '
            f'FROM employees WHERE "{cols["func_col"]}" IS NOT NULL '
            f'AND "{cols["subfunc_col"]}" IS NOT NULL '
            f'AND TRIM(CAST("{cols["subfunc_col"]}" AS VARCHAR)) <> \'\' '
            f'GROUP BY 1, 2 ORDER BY total_fte DESC'
        )
        subfunction_aggs = [dict(r) for r in duckdb_manager.query(user_id, sq)["data"]]

    # --- map raw client function values onto benchmark function names --------
    mapping = _build_function_mapping(
        [a["group_value"] for a in function_aggs],
        pack_functions or [],
        dict(config.get("function_map") or {}),
    )

    mapped_functions = _remap_aggregates(function_aggs, mapping, key="group_value")
    mapped_subfunctions = _remap_aggregates(subfunction_aggs, mapping, key="group_value")

    parent_lookup = {a["group_value"]: a for a in mapped_functions}
    for sub in mapped_subfunctions:
        parent = parent_lookup.get(sub["group_value"], {})
        sub["parent_fte"] = parent.get("total_fte")
        sub["parent_cost"] = parent.get("total_cost")

    metrics: List[Dict[str, Any]] = []
    for key in reg.metrics_for_scope(reg.SCOPE_ORG):
        value = _derive(key, org_agg, org_agg, ctx)
        if value is not None:
            metrics.append({"scope": "org", "function": None, "subfunction": None,
                            "metric_key": key, "value": value})

    for agg in mapped_functions:
        for key in reg.metrics_for_scope(reg.SCOPE_FUNCTION):
            value = _derive(key, agg, org_agg, ctx)
            if value is not None:
                metrics.append({"scope": "function", "function": agg["group_value"],
                                "subfunction": None, "metric_key": key, "value": value})

    for agg in mapped_subfunctions:
        for key in reg.metrics_for_scope(reg.SCOPE_SUBFUNCTION):
            value = _derive(key, agg, org_agg, ctx)
            if value is not None:
                metrics.append({"scope": "subfunction", "function": agg["group_value"],
                                "subfunction": agg["sub_value"], "metric_key": key,
                                "value": value})

    return {
        "columns": cols,
        "org": org_agg,
        "functions": mapped_functions,
        "subfunctions": mapped_subfunctions,
        "metrics": metrics,
        "function_mapping": mapping,
        "target_span": target_span,
    }


def _derive(metric_key: str, agg: Dict[str, Any], totals: Dict[str, Any],
            ctx: Dict[str, Any]) -> Optional[float]:
    if not reg.is_available(metric_key, ctx):
        return None
    meta = reg.get_metric(metric_key)
    if not meta:
        return None
    try:
        value = meta["derive"](agg, totals, ctx)
    except Exception as e:  # a malformed census row should not kill the report
        log.warning("Metric %s failed to derive: %s", metric_key, e)
        return None
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return None if value != value else round(value, 4)  # NaN guard


def _build_function_mapping(
    client_functions: List[str],
    pack_functions: List[str],
    overrides: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Match client function values to benchmark function names.

    Explicit user overrides win, then a case-insensitive exact match. Anything
    left over is reported as unmapped rather than guessed at, so the coverage
    figure stays honest.
    """
    lookup = {p.strip().lower(): p for p in pack_functions}
    out: List[Dict[str, Any]] = []
    for raw in client_functions:
        raw_str = str(raw).strip()
        if raw_str in overrides and overrides[raw_str]:
            out.append({"client_value": raw_str, "mapped_to": overrides[raw_str], "method": "manual"})
            continue
        exact = lookup.get(raw_str.lower())
        if exact:
            out.append({"client_value": raw_str, "mapped_to": exact, "method": "exact"})
            continue
        out.append({"client_value": raw_str, "mapped_to": None, "method": "unmapped"})
    return out


_SUMMABLE = ("headcount", "total_fte", "total_cost", "managers", "ics", "subordinates",
             "mgr_cost", "single_report_mgrs", "mgrs_below_target", "hc_below_l5",
             "low_cost_fte")


def _remap_aggregates(aggs: List[Dict[str, Any]], mapping: List[Dict[str, Any]],
                      key: str) -> List[Dict[str, Any]]:
    """Re-aggregate client groups under their mapped benchmark function name."""
    mapped_name = {m["client_value"]: m["mapped_to"] for m in mapping}
    merged: Dict[Tuple[Any, ...], Dict[str, Any]] = {}

    for agg in aggs:
        target = mapped_name.get(str(agg.get(key)).strip())
        if not target:
            continue
        identity = (target, agg.get("sub_value")) if "sub_value" in agg else (target,)
        bucket = merged.get(identity)
        if bucket is None:
            bucket = {k: v for k, v in agg.items()}
            bucket[key] = target
            bucket["source_values"] = [str(agg.get(key))]
            merged[identity] = bucket
            continue
        for field in _SUMMABLE:
            bucket[field] = (bucket.get(field) or 0) + (agg.get(field) or 0)
        bucket["max_level"] = max(bucket.get("max_level") or 0, agg.get("max_level") or 0)
        bucket["level_depth"] = max(bucket.get("level_depth") or 0, agg.get("level_depth") or 0)
        bucket["source_values"].append(str(agg.get(key)))

    return sorted(merged.values(), key=lambda a: -(a.get("total_fte") or 0))


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------

def compare(
    client: Dict[str, Any],
    pack_metrics: List[Dict[str, Any]],
    config: Dict[str, Any],
    currency_ok: bool = True,
) -> List[Dict[str, Any]]:
    """Join client metrics to pack metrics and classify each variance."""
    client_index = {
        (m["scope"], m.get("function"), m.get("subfunction"), m["metric_key"]): m["value"]
        for m in client["metrics"]
    }
    rows: List[Dict[str, Any]] = []

    for bm in pack_metrics:
        metric_key = bm["metric_key"]
        meta = reg.get_metric(metric_key)
        if not meta:
            continue
        if not currency_ok and meta["unit"] == reg.UNIT_CURRENCY:
            continue

        identity = (bm["scope"], bm.get("function"), bm.get("subfunction"), metric_key)
        client_value = client_index.get(identity)
        median = _f(bm.get("median"))
        p25 = _f(bm.get("p25"))
        p75 = _f(bm.get("p75"))

        if client_value is None:
            rows.append({
                **_identity_fields(bm, meta),
                "client_value": None,
                "p25": p25, "median": median, "p75": p75,
                "delta": None, "delta_pct": None,
                "position": "no_client_data",
                "verdict": "not_measured",
                "severity": 0.0,
            })
            continue

        delta = None if median is None else round(client_value - median, 4)
        delta_pct = None
        if median not in (None, 0):
            delta_pct = round((client_value - median) / abs(median) * 100.0, 2)

        position = _position(client_value, p25, median, p75)
        verdict = _verdict(position, meta["direction"])
        severity = abs(delta_pct or 0.0)

        rows.append({
            **_identity_fields(bm, meta),
            "client_value": client_value,
            "p25": p25, "median": median, "p75": p75,
            "delta": delta,
            "delta_pct": delta_pct,
            "position": position,
            "verdict": verdict,
            "severity": round(severity, 2),
        })

    return rows


def _identity_fields(bm: Dict[str, Any], meta: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "scope": bm["scope"],
        "function": bm.get("function"),
        "subfunction": bm.get("subfunction"),
        "metric_key": bm["metric_key"],
        "metric_label": meta["label"],
        "metric_short": meta["short"],
        "unit": meta["unit"],
        "direction": meta["direction"],
        "category": meta["category"],
        "decimals": meta["decimals"],
        "source": bm.get("source"),
    }


def _f(value: Any) -> Optional[float]:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _position(value: float, p25: Optional[float], median: Optional[float],
              p75: Optional[float]) -> str:
    if p25 is not None and value < p25:
        return "below_p25"
    if p75 is not None and value > p75:
        return "above_p75"
    if p25 is None and p75 is None and median is not None:
        # No range published — treat +/-10% around the median as in-band.
        if value < median * 0.9:
            return "below_p25"
        if value > median * 1.1:
            return "above_p75"
    return "in_band"


def _verdict(position: str, direction: str) -> str:
    if position == "in_band":
        return "in_line"
    if direction == reg.BAND:
        return "unfavourable"
    if direction == reg.LOWER_BETTER:
        return "unfavourable" if position == "above_p75" else "favourable"
    return "favourable" if position == "above_p75" else "unfavourable"


# ---------------------------------------------------------------------------
# Quantification
# ---------------------------------------------------------------------------

def quantify(
    variance_rows: List[Dict[str, Any]],
    client: Dict[str, Any],
    config: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Translate each unfavourable variance into FTE / cost exposure.

    Everything is expressed against the benchmark median. Only excess above the
    median is treated as opportunity; favourable variances are retained with
    negative values so the report can show where the org is already lean.
    """
    org = client.get("org") or {}
    functions = {f["group_value"]: f for f in client.get("functions") or []}
    subfunctions = {
        (s["group_value"], s.get("sub_value")): s for s in client.get("subfunctions") or []
    }
    low = float(config.get("realization_low") or 0.6)
    high = float(config.get("realization_high") or 0.7)

    total_fte = _f(org.get("total_fte")) or 0.0
    total_cost = _f(org.get("total_cost")) or 0.0
    total_headcount = _f(org.get("headcount")) or 0.0

    for row in variance_rows:
        row["fte_gap"] = None
        row["cost_gap"] = None
        row["savings_low"] = None
        row["savings_high"] = None

        delta = row.get("delta")
        if delta is None or row.get("client_value") is None:
            continue

        meta = reg.get_metric(row["metric_key"]) or {}
        basis = meta.get("basis")
        if not basis:
            continue

        group = org
        if row["scope"] == "function":
            group = functions.get(row["function"]) or {}
        elif row["scope"] == "subfunction":
            group = subfunctions.get((row["function"], row["subfunction"])) or {}
        if not group:
            continue

        fte_gap, cost_gap = _gap_for_metric(
            row["metric_key"], delta, group, org, total_fte, total_cost, total_headcount,
        )

        if fte_gap is not None:
            row["fte_gap"] = round(fte_gap, 2)
            if cost_gap is None:
                avg_cost = _avg_cost_per_fte(group)
                if avg_cost:
                    cost_gap = fte_gap * avg_cost
        if cost_gap is not None:
            row["cost_gap"] = round(cost_gap, 2)
            if cost_gap > 0:
                row["savings_low"] = round(cost_gap * low, 2)
                row["savings_high"] = round(cost_gap * high, 2)

    return variance_rows


def _gap_for_metric(
    metric_key: str,
    delta: float,
    group: Dict[str, Any],
    org: Dict[str, Any],
    total_fte: float,
    total_cost: float,
    total_headcount: float,
) -> Tuple[Optional[float], Optional[float]]:
    """Return (fte_gap, cost_gap) implied by a delta against the median."""
    group_fte = _f(group.get("total_fte")) or 0.0
    managers = _f(group.get("managers")) or 0.0
    headcount = _f(group.get("headcount")) or 0.0
    avg_mgr_cost = _avg_manager_cost(group)

    if metric_key == "func_fte_pct_of_total_fte":
        return (delta / 100.0) * total_fte, None
    if metric_key == "func_fte_per_1000_employees":
        return (delta / 1000.0) * total_headcount, None
    if metric_key == "subfunc_fte_pct_of_function_fte":
        return (delta / 100.0) * (_f(group.get("parent_fte")) or 0.0), None
    if metric_key == "fte_per_1m_revenue":
        return None, None  # revenue-normalised: informative, not directly sizable

    if metric_key == "func_cost_pct_of_total_cost":
        return None, (delta / 100.0) * total_cost
    if metric_key == "subfunc_cost_pct_of_function_cost":
        return None, (delta / 100.0) * (_f(group.get("parent_cost")) or 0.0)
    if metric_key == "mgr_cost_pct_of_total_cost":
        return None, (delta / 100.0) * (_f(org.get("total_cost")) or 0.0)
    if metric_key == "func_cost_per_fte":
        return None, delta * group_fte
    if metric_key == "func_cost_pct_of_revenue":
        return None, None  # sized via the cost-share metric instead

    if metric_key in ("avg_span_of_control", "func_avg_span", "subfunc_avg_span"):
        # A span below the median implies more managers than the benchmark
        # structure needs to supervise the same number of subordinates.
        subordinates = _f(group.get("subordinates")) or 0.0
        if delta >= 0 or not managers or not subordinates:
            return None, None
        benchmark_span = (subordinates / managers) - delta
        if benchmark_span <= 0:
            return None, None
        excess_managers = managers - (subordinates / benchmark_span)
        return excess_managers, (excess_managers * avg_mgr_cost if avg_mgr_cost else None)

    if metric_key == "mgr_pct_of_headcount":
        excess_managers = (delta / 100.0) * headcount
        return excess_managers, (excess_managers * avg_mgr_cost if avg_mgr_cost else None)

    if metric_key in ("pct_managers_below_target_span", "pct_single_report_managers"):
        excess_managers = (delta / 100.0) * managers
        return excess_managers, (excess_managers * avg_mgr_cost if avg_mgr_cost else None)

    return None, None


def _avg_manager_cost(group: Dict[str, Any]) -> Optional[float]:
    managers = _f(group.get("managers")) or 0.0
    mgr_cost = _f(group.get("mgr_cost")) or 0.0
    if managers and mgr_cost:
        return mgr_cost / managers
    return _avg_cost_per_fte(group)


def _avg_cost_per_fte(group: Dict[str, Any]) -> Optional[float]:
    fte = _f(group.get("total_fte")) or 0.0
    cost = _f(group.get("total_cost")) or 0.0
    return (cost / fte) if fte and cost else None


# ---------------------------------------------------------------------------
# Opportunity ranking
# ---------------------------------------------------------------------------

def rank_opportunities(
    variance_rows: List[Dict[str, Any]],
    client: Dict[str, Any],
    coverage: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """One opportunity per group, sized on a single primary metric.

    Functional right-sizing and structural de-layering both cost money to fix
    and both draw on the same population, so they are tagged into separate
    buckets and never added together.
    """
    by_group: Dict[Tuple[Any, ...], List[Dict[str, Any]]] = {}
    for row in variance_rows:
        if row.get("verdict") != "unfavourable":
            continue
        if (row.get("cost_gap") or 0) <= 0 and (row.get("fte_gap") or 0) <= 0:
            continue
        key = (row["scope"], row.get("function"), row.get("subfunction"))
        by_group.setdefault(key, []).append(row)

    opportunities: List[Dict[str, Any]] = []
    for (scope, function, subfunction), rows in by_group.items():
        order = (
            _PRIMARY_SIZING_ORDER if scope == "function"
            else _PRIMARY_SUBFUNC_SIZING_ORDER if scope == "subfunction"
            else []
        )
        primary = _pick_primary(rows, order)
        if not primary:
            continue

        bucket = BUCKET_STRUCTURAL if (
            scope == "org" or primary["category"] in ("structure", "management")
        ) else BUCKET_FUNCTIONAL

        supporting = [
            {
                "metric_key": r["metric_key"],
                "metric_label": r["metric_label"],
                "client_value": r["client_value"],
                "median": r["median"],
                "delta_pct": r["delta_pct"],
            }
            for r in rows if r["metric_key"] != primary["metric_key"]
        ]

        # A cost-sized opportunity still needs its headcount equivalent, and vice
        # versa, so the two lenses read consistently. Borrowed from a supporting
        # metric on the same group rather than recomputed.
        fte_gap = primary.get("fte_gap") or _borrow_gap(rows, "fte_gap")
        cost_gap = primary.get("cost_gap") or _borrow_gap(rows, "cost_gap")
        savings_low = primary.get("savings_low")
        savings_high = primary.get("savings_high")

        opportunities.append({
            "scope": scope,
            "function": function,
            "subfunction": subfunction,
            "label": subfunction or function or "Organisation-wide",
            "bucket": bucket,
            "primary_metric": primary["metric_key"],
            "primary_metric_label": primary["metric_label"],
            "client_value": primary["client_value"],
            "median": primary["median"],
            "p25": primary["p25"],
            "p75": primary["p75"],
            "delta_pct": primary["delta_pct"],
            "fte_gap": fte_gap,
            "cost_gap": cost_gap,
            "savings_low": savings_low,
            "savings_high": savings_high,
            "confidence": _confidence(primary, coverage),
            "supporting_metrics": supporting,
        })

    opportunities.sort(
        key=lambda o: (o.get("savings_high") or 0, o.get("fte_gap") or 0), reverse=True,
    )
    for rank, opp in enumerate(opportunities, start=1):
        opp["rank"] = rank
    return opportunities


def _borrow_gap(rows: List[Dict[str, Any]], field: str) -> Optional[float]:
    """Largest positive value of `field` across a group's other variance rows."""
    values = [r.get(field) for r in rows if (r.get(field) or 0) > 0]
    return max(values) if values else None


def _pick_primary(rows: List[Dict[str, Any]], order: List[str]) -> Optional[Dict[str, Any]]:
    for metric_key in order:
        for row in rows:
            if row["metric_key"] == metric_key and (
                (row.get("cost_gap") or 0) > 0 or (row.get("fte_gap") or 0) > 0
            ):
                return row
    scored = sorted(rows, key=lambda r: (r.get("cost_gap") or 0, r.get("fte_gap") or 0), reverse=True)
    return scored[0] if scored else None


def _confidence(row: Dict[str, Any], coverage: Dict[str, Any]) -> str:
    coverage_pct = coverage.get("coverage_pct") or 0
    if coverage_pct < COVERAGE_WARNING_THRESHOLD:
        return "low"
    if row.get("p25") is None or row.get("p75") is None:
        return "medium"
    if abs(row.get("delta_pct") or 0) < 15:
        return "medium"
    return "high"


# ---------------------------------------------------------------------------
# Coverage + guardrails
# ---------------------------------------------------------------------------

def compute_coverage(client: Dict[str, Any], pack: Dict[str, Any],
                     pack_functions: List[str]) -> Dict[str, Any]:
    org_fte = _f((client.get("org") or {}).get("total_fte")) or 0.0
    mapped_fte = sum(_f(f.get("total_fte")) or 0.0 for f in client.get("functions") or [])
    coverage_pct = round((mapped_fte / org_fte * 100.0), 1) if org_fte else 0.0

    unmapped = [m["client_value"] for m in client.get("function_mapping") or []
                if not m.get("mapped_to")]
    matched = sorted({m["mapped_to"] for m in client.get("function_mapping") or []
                      if m.get("mapped_to")})
    missing_from_client = [f for f in pack_functions if f not in matched]

    warnings: List[str] = []
    if coverage_pct < COVERAGE_WARNING_THRESHOLD:
        warnings.append(
            f"Only {coverage_pct}% of FTE maps to a benchmarked function. "
            f"Variances and savings below are directional at best until the "
            f"unmapped functions are mapped in the benchmark configuration."
        )
    if not client["columns"].get("flc_col"):
        warnings.append(
            "No cost column is mapped for this dataset, so every cost-based "
            "benchmark and all savings quantification is unavailable."
        )
    if not client["columns"].get("func_col"):
        warnings.append(
            "No function column is mapped, so only organisation-level structural "
            "benchmarks can be compared."
        )
    elif not client["columns"].get("func_col_is_rationalised"):
        warnings.append(
            "Functions have not been rationalised onto the master taxonomy. "
            "Matching relies on exact name matches, so coverage may understate reality — "
            "run Rationalise for a cleaner join."
        )
    if not client["columns"].get("subfunc_col"):
        warnings.append("No sub-function column is mapped, so sub-function variance is not reported.")

    return {
        "total_fte": round(org_fte, 2),
        "mapped_fte": round(mapped_fte, 2),
        "coverage_pct": coverage_pct,
        "is_sufficient": coverage_pct >= COVERAGE_WARNING_THRESHOLD,
        "unmapped_functions": unmapped,
        "matched_functions": matched,
        "benchmark_functions_absent_from_client": missing_from_client,
        "warnings": warnings,
    }


def check_currency(pack: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """Absolute-cost metrics are only trustworthy when currencies line up."""
    ctx = dict(config.get("context") or {})
    pack_currency = (pack.get("currency") or "USD").upper()
    client_currency = str(ctx.get("currency") or "").upper()
    fx_rate = ctx.get("fx_rate")

    if not client_currency:
        return {
            "ok": False,
            "pack_currency": pack_currency,
            "client_currency": None,
            "message": (
                f"No reporting currency is set for this dataset. Absolute cost-per-FTE "
                f"benchmarks (published in {pack_currency}) are suppressed. "
                f"Percentage-of-total comparisons are unaffected."
            ),
        }
    if client_currency == pack_currency:
        return {"ok": True, "pack_currency": pack_currency,
                "client_currency": client_currency, "message": None}
    if fx_rate:
        return {
            "ok": True,
            "pack_currency": pack_currency,
            "client_currency": client_currency,
            "message": (
                f"Client costs converted from {client_currency} to {pack_currency} "
                f"at {fx_rate} for absolute cost comparisons."
            ),
        }
    return {
        "ok": False,
        "pack_currency": pack_currency,
        "client_currency": client_currency,
        "message": (
            f"Dataset is in {client_currency} but the benchmark pack is published in "
            f"{pack_currency}, and no FX rate is set. Absolute cost-per-FTE benchmarks "
            f"are suppressed; percentage-of-total comparisons remain valid."
        ),
    }


# ---------------------------------------------------------------------------
# Top-level entry point
# ---------------------------------------------------------------------------

def build_comparison(
    user_id: int,
    dataset_id: int,
    dataset_meta: Dict[str, Any],
    schema: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Full deterministic benchmark comparison. No LLM involved."""
    config = config or db_service.get_dataset_benchmark_config(dataset_id)
    pack_id = config.get("pack_id")
    if not pack_id:
        default_pack = db_service.get_default_benchmark_pack()
        pack_id = default_pack["id"] if default_pack else None
    if not pack_id:
        raise ValueError("No benchmark pack is available. Upload one or reseed the built-in packs.")

    pack = db_service.get_benchmark_pack(pack_id)
    if not pack:
        raise ValueError(f"Benchmark pack {pack_id} not found")

    pack_metrics = db_service.get_benchmark_metrics(pack_id)
    pack_functions = sorted({m["function"] for m in pack_metrics if m.get("function")})

    client = compute_client_metrics(user_id, dataset_meta, schema, config, pack_functions)
    coverage = compute_coverage(client, pack, pack_functions)
    currency = check_currency(pack, config)

    variance_rows = compare(client, pack_metrics, config, currency_ok=currency["ok"])
    variance_rows = quantify(variance_rows, client, config)
    opportunities = rank_opportunities(variance_rows, client, coverage)

    summary = _summarise(variance_rows, opportunities, client, config, pack, coverage, currency)

    return {
        "pack": pack,
        "config": config,
        "columns": client["columns"],
        "coverage": coverage,
        "currency": currency,
        "org_aggregate": client["org"],
        "function_aggregates": client["functions"],
        "subfunction_aggregates": client["subfunctions"],
        "function_mapping": client["function_mapping"],
        "variance": variance_rows,
        "opportunities": opportunities,
        "summary": summary,
        "suppressed_metrics": _suppressed_metrics(config, currency),
    }


def _summarise(
    variance_rows: List[Dict[str, Any]],
    opportunities: List[Dict[str, Any]],
    client: Dict[str, Any],
    config: Dict[str, Any],
    pack: Dict[str, Any],
    coverage: Dict[str, Any],
    currency: Dict[str, Any],
) -> Dict[str, Any]:
    measured = [r for r in variance_rows if r.get("verdict") != "not_measured"]
    unfavourable = [r for r in measured if r["verdict"] == "unfavourable"]
    favourable = [r for r in measured if r["verdict"] == "favourable"]
    in_line = [r for r in measured if r["verdict"] == "in_line"]

    functional = [o for o in opportunities if o["bucket"] == BUCKET_FUNCTIONAL]
    structural = [o for o in opportunities if o["bucket"] == BUCKET_STRUCTURAL]

    def _sum(items: List[Dict[str, Any]], field: str) -> float:
        return round(sum(i.get(field) or 0 for i in items), 2)

    org = client.get("org") or {}
    health = _health_score(measured)

    return {
        "pack_name": pack.get("name"),
        "pack_industry": pack.get("industry"),
        "currency": pack.get("currency") or "USD",
        "headcount": org.get("headcount"),
        "total_fte": org.get("total_fte"),
        "total_cost": org.get("total_cost"),
        "metrics_compared": len(measured),
        "unfavourable_count": len(unfavourable),
        "favourable_count": len(favourable),
        "in_line_count": len(in_line),
        "health_score": health,
        "health_band": _health_band(health),
        "functional": {
            "opportunity_count": len(functional),
            "fte_gap": _sum(functional, "fte_gap"),
            "cost_gap": _sum(functional, "cost_gap"),
            "savings_low": _sum(functional, "savings_low"),
            "savings_high": _sum(functional, "savings_high"),
        },
        "structural": {
            "opportunity_count": len(structural),
            "fte_gap": _sum(structural, "fte_gap"),
            "cost_gap": _sum(structural, "cost_gap"),
            "savings_low": _sum(structural, "savings_low"),
            "savings_high": _sum(structural, "savings_high"),
        },
        "realization_low": config.get("realization_low"),
        "realization_high": config.get("realization_high"),
        "coverage_pct": coverage.get("coverage_pct"),
        "currency_ok": currency.get("ok"),
        "overlap_note": (
            "Functional right-sizing and structural de-layering draw on the same "
            "population and must not be added together. Treat functional sizing as "
            "the headline and structural as the delivery mechanism."
        ),
    }


def _health_score(measured: List[Dict[str, Any]]) -> int:
    """0-100 score: share of comparisons at or better than the benchmark band."""
    if not measured:
        return 0
    good = sum(1 for r in measured if r["verdict"] in ("in_line", "favourable"))
    return int(round(good / len(measured) * 100))


def _health_band(score: int) -> str:
    if score >= 75:
        return "strong"
    if score >= 55:
        return "mixed"
    if score >= 35:
        return "stretched"
    return "critical"


def _suppressed_metrics(config: Dict[str, Any], currency: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Metrics deliberately withheld, each with the reason shown to the user."""
    ctx = dict(config.get("context") or {})
    out: List[Dict[str, Any]] = []
    for key, meta in reg.METRICS.items():
        if not meta.get("requires_context"):
            continue
        if reg.is_available(key, ctx) and (
            meta["unit"] != reg.UNIT_CURRENCY or currency.get("ok")
        ):
            continue
        reason = reg.unavailable_reason(key, ctx)
        if not reason and meta["unit"] == reg.UNIT_CURRENCY:
            reason = currency.get("message")
        out.append({"metric_key": key, "label": meta["label"], "reason": reason})
    return out
