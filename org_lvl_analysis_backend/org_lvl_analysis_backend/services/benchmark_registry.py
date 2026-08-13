"""
Benchmark metric registry — the single place a benchmarkable KPI is defined.

Every metric carries the metadata needed by the whole stack:
  - how to label and format it (UI, Excel template, LLM prompts)
  - which direction is "good" (drives favourable/unfavourable verdicts)
  - what company context it needs (revenue-based metrics are suppressed without it)
  - how to derive the client-side value from a census aggregate row
  - how a variance converts into an FTE or cost opportunity

Adding a KPI means adding one entry here plus the aggregate it depends on in
benchmark_service._AGGREGATE_SQL.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

# ---------------------------------------------------------------------------
# Units / directions
# ---------------------------------------------------------------------------

UNIT_PCT = "pct"              # 0-100
UNIT_RATIO = "ratio"          # e.g. 6.2 direct reports
UNIT_COUNT = "count"          # e.g. 7 layers
UNIT_PER_1000 = "per_1000"    # FTE per 1,000 employees
UNIT_CURRENCY = "currency"    # cost per FTE

LOWER_BETTER = "lower_better"
HIGHER_BETTER = "higher_better"
BAND = "band"                 # in-range is good, either extreme is bad

SCOPE_ORG = "org"
SCOPE_FUNCTION = "function"
SCOPE_SUBFUNCTION = "subfunction"

# Opportunity basis — how a variance becomes a quantified number
BASIS_FTE = "fte"             # variance implies excess/deficit FTE
BASIS_COST = "cost"           # variance implies excess/deficit cost
BASIS_MANAGERS = "managers"   # variance implies excess managers
BASIS_NONE = None             # structural / qualitative only


def _safe_div(a: Any, b: Any) -> Optional[float]:
    try:
        a = float(a or 0)
        b = float(b or 0)
    except (TypeError, ValueError):
        return None
    if b == 0:
        return None
    return a / b


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------------------
# Metric definitions
# ---------------------------------------------------------------------------
# `derive(agg, totals, ctx)`:
#   agg     — the aggregate row for this scope (org totals, or one function /
#             sub-function group)
#   totals  — the org-wide aggregate row (denominator for share metrics)
#   ctx     — company context dict (revenue, currency, fx_rate, ...)
# Returns a float, or None when the metric is not computable for this row.

METRICS: Dict[str, Dict[str, Any]] = {
    # ---------------------------------------------------------------- org
    "avg_span_of_control": {
        "label": "Average span of control",
        "short": "Avg span",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_RATIO,
        "direction": BAND,
        "category": "structure",
        "decimals": 1,
        "description": "Average number of direct reports across all people managers.",
        "basis": BASIS_MANAGERS,
        "derive": lambda agg, totals, ctx: _safe_div(agg.get("subordinates"), agg.get("managers")),
    },
    "total_layers": {
        "label": "Organisational layers",
        "short": "Layers",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_COUNT,
        "direction": LOWER_BETTER,
        "category": "structure",
        "decimals": 0,
        "description": "Depth of the hierarchy from the top role to the deepest reporting line.",
        "basis": BASIS_NONE,
        "derive": lambda agg, totals, ctx: _num(agg.get("max_level")) or None,
    },
    "mgr_pct_of_headcount": {
        "label": "Managers as % of headcount",
        "short": "Manager %",
        "scopes": [SCOPE_ORG, SCOPE_FUNCTION],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "management",
        "decimals": 1,
        "description": "Share of the population that has at least one direct report.",
        "basis": BASIS_MANAGERS,
        "derive": lambda agg, totals, ctx: _pct(agg.get("managers"), agg.get("headcount")),
    },
    "mgr_cost_pct_of_total_cost": {
        "label": "Management cost as % of total cost",
        "short": "Mgmt cost %",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "management",
        "decimals": 1,
        "description": "Share of total workforce cost carried by people managers.",
        "basis": BASIS_COST,
        "derive": lambda agg, totals, ctx: _pct(agg.get("mgr_cost"), agg.get("total_cost")),
    },
    "ic_to_mgr_ratio": {
        "label": "Individual contributors per manager",
        "short": "IC : Mgr",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_RATIO,
        "direction": HIGHER_BETTER,
        "category": "management",
        "decimals": 1,
        "description": "Individual contributors divided by people managers.",
        "basis": BASIS_NONE,
        "derive": lambda agg, totals, ctx: _safe_div(agg.get("ics"), agg.get("managers")),
    },
    "pct_managers_below_target_span": {
        "label": "Managers below target span",
        "short": "Below-target mgrs",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "management",
        "decimals": 1,
        "description": "Share of managers with fewer direct reports than the target span.",
        "basis": BASIS_MANAGERS,
        "derive": lambda agg, totals, ctx: _pct(agg.get("mgrs_below_target"), agg.get("managers")),
    },
    "pct_single_report_managers": {
        "label": "Single-report managers",
        "short": "1:1 managers",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "management",
        "decimals": 1,
        "description": "Share of managers with exactly one direct report — the clearest delayering signal.",
        "basis": BASIS_MANAGERS,
        "derive": lambda agg, totals, ctx: _pct(agg.get("single_report_mgrs"), agg.get("managers")),
    },
    "pct_headcount_below_layer_5": {
        "label": "Headcount below layer 5",
        "short": "Below L5",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_PCT,
        "direction": HIGHER_BETTER,
        "category": "structure",
        "decimals": 1,
        "description": "Share of the workforce sitting at layer 5 or deeper — high values indicate a flat delivery base.",
        "basis": BASIS_NONE,
        "derive": lambda agg, totals, ctx: _pct(agg.get("hc_below_l5"), agg.get("headcount")),
    },
    "pct_fte_in_low_cost_locations": {
        "label": "FTE in low-cost locations",
        "short": "Low-cost FTE %",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_PCT,
        "direction": HIGHER_BETTER,
        "category": "location",
        "decimals": 1,
        "description": "Share of FTE based in low-cost delivery locations.",
        "basis": BASIS_NONE,
        "derive": lambda agg, totals, ctx: _pct(agg.get("low_cost_fte"), agg.get("total_fte")),
    },

    # ----------------------------------------------------------- function
    "func_fte_pct_of_total_fte": {
        "label": "Function FTE as % of total FTE",
        "short": "FTE share",
        "scopes": [SCOPE_FUNCTION],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "size",
        "decimals": 2,
        "description": "Function headcount weight relative to the whole organisation.",
        "basis": BASIS_FTE,
        "derive": lambda agg, totals, ctx: _pct(agg.get("total_fte"), totals.get("total_fte")),
    },
    "func_fte_per_1000_employees": {
        "label": "Function FTE per 1,000 employees",
        "short": "FTE / 1k",
        "scopes": [SCOPE_FUNCTION],
        "unit": UNIT_PER_1000,
        "direction": LOWER_BETTER,
        "category": "size",
        "decimals": 1,
        "description": "Function FTE normalised per 1,000 total employees — the standard support-function ratio.",
        "basis": BASIS_FTE,
        "derive": lambda agg, totals, ctx: _rate(agg.get("total_fte"), totals.get("headcount"), 1000),
    },
    "func_cost_pct_of_total_cost": {
        "label": "Function cost as % of total cost",
        "short": "Cost share",
        "scopes": [SCOPE_FUNCTION],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "cost",
        "decimals": 2,
        "description": "Function cost weight relative to total workforce cost. Currency-neutral.",
        "basis": BASIS_COST,
        "derive": lambda agg, totals, ctx: _pct(agg.get("total_cost"), totals.get("total_cost")),
    },
    "func_avg_span": {
        "label": "Function average span",
        "short": "Avg span",
        "scopes": [SCOPE_FUNCTION],
        "unit": UNIT_RATIO,
        "direction": BAND,
        "category": "structure",
        "decimals": 1,
        "description": "Average direct reports per manager within the function.",
        "basis": BASIS_MANAGERS,
        "derive": lambda agg, totals, ctx: _safe_div(agg.get("subordinates"), agg.get("managers")),
    },
    "func_layers": {
        "label": "Function layers",
        "short": "Layers",
        "scopes": [SCOPE_FUNCTION],
        "unit": UNIT_COUNT,
        "direction": LOWER_BETTER,
        "category": "structure",
        "decimals": 0,
        "description": "Distinct hierarchy levels present within the function.",
        "basis": BASIS_NONE,
        "derive": lambda agg, totals, ctx: _num(agg.get("level_depth")) or None,
    },

    # -------------------------------------------------------- subfunction
    "subfunc_fte_pct_of_function_fte": {
        "label": "Sub-function FTE as % of function FTE",
        "short": "FTE share of function",
        "scopes": [SCOPE_SUBFUNCTION],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "size",
        "decimals": 2,
        "description": "Sub-function weight inside its parent function — the meaningful denominator at this level.",
        "basis": BASIS_FTE,
        "derive": lambda agg, totals, ctx: _pct(agg.get("total_fte"), agg.get("parent_fte")),
    },
    "subfunc_cost_pct_of_function_cost": {
        "label": "Sub-function cost as % of function cost",
        "short": "Cost share of function",
        "scopes": [SCOPE_SUBFUNCTION],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "cost",
        "decimals": 2,
        "description": "Sub-function cost weight inside its parent function.",
        "basis": BASIS_COST,
        "derive": lambda agg, totals, ctx: _pct(agg.get("total_cost"), agg.get("parent_cost")),
    },
    "subfunc_avg_span": {
        "label": "Sub-function average span",
        "short": "Avg span",
        "scopes": [SCOPE_SUBFUNCTION],
        "unit": UNIT_RATIO,
        "direction": BAND,
        "category": "structure",
        "decimals": 1,
        "description": "Average direct reports per manager within the sub-function.",
        "basis": BASIS_MANAGERS,
        "derive": lambda agg, totals, ctx: _safe_div(agg.get("subordinates"), agg.get("managers")),
    },

    # ------------------------------------------------- context-dependent
    "func_cost_per_fte": {
        "label": "Function cost per FTE",
        "short": "Cost / FTE",
        "scopes": [SCOPE_FUNCTION],
        "unit": UNIT_CURRENCY,
        "direction": LOWER_BETTER,
        "category": "cost",
        "decimals": 0,
        "description": "Fully loaded cost per FTE. Absolute currency — needs a matching currency or FX rate.",
        "basis": BASIS_COST,
        "requires_context": ["currency"],
        "derive": lambda agg, totals, ctx: _fx(_safe_div(agg.get("total_cost"), agg.get("total_fte")), ctx),
    },
    "func_cost_pct_of_revenue": {
        "label": "Function cost as % of revenue",
        "short": "Cost / revenue",
        "scopes": [SCOPE_FUNCTION],
        "unit": UNIT_PCT,
        "direction": LOWER_BETTER,
        "category": "cost",
        "decimals": 3,
        "description": "Function workforce cost measured against company revenue.",
        "basis": BASIS_COST,
        "requires_context": ["revenue"],
        "derive": lambda agg, totals, ctx: _pct(_fx(agg.get("total_cost"), ctx), ctx.get("revenue")),
    },
    "revenue_per_fte": {
        "label": "Revenue per FTE",
        "short": "Revenue / FTE",
        "scopes": [SCOPE_ORG],
        "unit": UNIT_CURRENCY,
        "direction": HIGHER_BETTER,
        "category": "cost",
        "decimals": 0,
        "description": "Company revenue divided by total FTE — headline productivity measure.",
        "basis": BASIS_NONE,
        "requires_context": ["revenue"],
        "derive": lambda agg, totals, ctx: _safe_div(ctx.get("revenue"), agg.get("total_fte")),
    },
    "fte_per_1m_revenue": {
        "label": "FTE per $1M revenue",
        "short": "FTE / $1M",
        "scopes": [SCOPE_ORG, SCOPE_FUNCTION],
        "unit": UNIT_RATIO,
        "direction": LOWER_BETTER,
        "category": "size",
        "decimals": 2,
        "description": "FTE required per million of revenue.",
        "basis": BASIS_FTE,
        "requires_context": ["revenue"],
        "derive": lambda agg, totals, ctx: _rate(agg.get("total_fte"), ctx.get("revenue"), 1_000_000),
    },
}


def _pct(numerator: Any, denominator: Any) -> Optional[float]:
    ratio = _safe_div(numerator, denominator)
    return None if ratio is None else ratio * 100.0


def _rate(numerator: Any, denominator: Any, per: float) -> Optional[float]:
    ratio = _safe_div(numerator, denominator)
    return None if ratio is None else ratio * per


def _fx(value: Optional[float], ctx: Dict[str, Any]) -> Optional[float]:
    """Convert a client-currency figure into the benchmark pack currency."""
    if value is None:
        return None
    rate = ctx.get("fx_rate")
    try:
        rate = float(rate) if rate else 1.0
    except (TypeError, ValueError):
        rate = 1.0
    return value * rate


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------

def get_metric(metric_key: str) -> Optional[Dict[str, Any]]:
    return METRICS.get(metric_key)


def metrics_for_scope(scope: str) -> List[str]:
    return [k for k, m in METRICS.items() if scope in m["scopes"]]


def context_requirements(metric_key: str) -> List[str]:
    meta = METRICS.get(metric_key) or {}
    return list(meta.get("requires_context") or [])


def is_available(metric_key: str, ctx: Dict[str, Any]) -> bool:
    """A metric is available when every context key it needs has a usable value."""
    for key in context_requirements(metric_key):
        value = (ctx or {}).get(key)
        if value in (None, "", 0):
            return False
    return True


def unavailable_reason(metric_key: str, ctx: Dict[str, Any]) -> Optional[str]:
    missing = [k for k in context_requirements(metric_key) if not (ctx or {}).get(k)]
    if not missing:
        return None
    labels = {
        "revenue": "company revenue",
        "currency": "reporting currency",
        "fx_rate": "FX rate to the benchmark currency",
    }
    pretty = ", ".join(labels.get(m, m) for m in missing)
    return f"Requires {pretty} in the benchmark context."


def format_value(metric_key: str, value: Optional[float], currency: str = "USD") -> str:
    """Human-readable rendering used in prompts, exports and fallback UI."""
    if value is None:
        return "n/a"
    meta = METRICS.get(metric_key) or {}
    unit = meta.get("unit", UNIT_RATIO)
    decimals = int(meta.get("decimals", 1))
    if unit == UNIT_PCT:
        return f"{value:,.{decimals}f}%"
    if unit == UNIT_CURRENCY:
        return f"{currency} {value:,.0f}"
    if unit == UNIT_PER_1000:
        return f"{value:,.{decimals}f} per 1,000"
    if unit == UNIT_COUNT:
        return f"{value:,.0f}"
    return f"{value:,.{decimals}f}"


def metric_dictionary() -> List[Dict[str, Any]]:
    """Flat, serialisable catalogue — powers the Excel README and the UI legend."""
    out: List[Dict[str, Any]] = []
    for key, meta in METRICS.items():
        out.append({
            "metric_key": key,
            "label": meta["label"],
            "short": meta["short"],
            "scopes": meta["scopes"],
            "unit": meta["unit"],
            "direction": meta["direction"],
            "category": meta["category"],
            "decimals": meta["decimals"],
            "description": meta["description"],
            "requires_context": list(meta.get("requires_context") or []),
            "basis": meta.get("basis"),
        })
    return out


# ---------------------------------------------------------------------------
# Excel template column mapping (wide sheet -> long metric rows)
# ---------------------------------------------------------------------------
# Each entry: (spreadsheet column header, metric_key). The parser also accepts
# "<header> (P25)" and "<header> (P75)" variants for range values.

FUNCTIONAL_TEMPLATE_COLUMNS: List[tuple] = [
    ("FTE % of Total FTE", "func_fte_pct_of_total_fte"),
    ("FTE per 1000 Employees", "func_fte_per_1000_employees"),
    ("Cost % of Total Cost", "func_cost_pct_of_total_cost"),
    ("Cost per FTE", "func_cost_per_fte"),
    ("Cost % of Revenue", "func_cost_pct_of_revenue"),
    ("Avg Span", "func_avg_span"),
    ("Layers", "func_layers"),
    ("Manager %", "mgr_pct_of_headcount"),
]

SUBFUNCTIONAL_TEMPLATE_COLUMNS: List[tuple] = [
    ("FTE % of Function FTE", "subfunc_fte_pct_of_function_fte"),
    ("Cost % of Function Cost", "subfunc_cost_pct_of_function_cost"),
    ("Avg Span", "subfunc_avg_span"),
]

STRUCTURAL_TEMPLATE_METRICS: List[str] = [
    "avg_span_of_control",
    "total_layers",
    "mgr_pct_of_headcount",
    "mgr_cost_pct_of_total_cost",
    "ic_to_mgr_ratio",
    "pct_managers_below_target_span",
    "pct_single_report_managers",
    "pct_headcount_below_layer_5",
    "pct_fte_in_low_cost_locations",
    "revenue_per_fte",
    "fte_per_1m_revenue",
]

# Default target span used when classifying "below target" managers.
DEFAULT_TARGET_SPAN = 6
