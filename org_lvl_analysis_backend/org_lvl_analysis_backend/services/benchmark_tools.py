"""
Benchmark access for the Ask OrgSight chat agent.

Two integration points:

  build_prompt_context()          a compact block injected into every system
                                  prompt so ordinary questions are benchmark
                                  aware without spending a tool call

  get_benchmark_comparison tool   an on-demand tool returning both narrative
                                  text and tabular rows, so unlike the older
                                  text-only get_benchmarks it can drive a chart

Both read from the same deterministic engine the full report uses, so a number
quoted in chat always matches the number in the report.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from services import benchmark_registry as reg
from services import benchmark_service, db_service

log = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 120
_cache: Dict[Tuple[int, int], Dict[str, Any]] = {}
_cache_lock = threading.Lock()


def invalidate(dataset_id: Optional[int] = None) -> None:
    """Drop cached comparisons — called whenever benchmark config changes."""
    with _cache_lock:
        if dataset_id is None:
            _cache.clear()
            return
        for key in [k for k in _cache if k[1] == dataset_id]:
            _cache.pop(key, None)


def get_comparison(
    user_id: int,
    dataset_id: int,
    dataset_meta: Dict[str, Any],
    schema: Dict[str, Any],
    force: bool = False,
) -> Optional[Dict[str, Any]]:
    """Cached deterministic comparison. Returns None when benchmarking is not set up."""
    key = (user_id, dataset_id)
    now = time.time()
    if not force:
        with _cache_lock:
            entry = _cache.get(key)
            if entry and now - entry["at"] < _CACHE_TTL_SECONDS:
                return entry["value"]

    try:
        comparison = benchmark_service.build_comparison(user_id, dataset_id, dataset_meta, schema)
    except Exception as e:
        log.info("Benchmark comparison unavailable for dataset %s: %s", dataset_id, e)
        return None

    with _cache_lock:
        _cache[key] = {"at": now, "value": comparison}
    return comparison


# ---------------------------------------------------------------------------
# System prompt context
# ---------------------------------------------------------------------------

def build_prompt_context(
    user_id: int,
    dataset_id: int,
    dataset_meta: Dict[str, Any],
    schema: Dict[str, Any],
) -> str:
    """Short benchmark-awareness block for the chat system prompt."""
    comparison = get_comparison(user_id, dataset_id, dataset_meta, schema)
    if not comparison:
        return ""

    summary = comparison["summary"]
    pack = comparison["pack"]
    currency = summary.get("currency") or "USD"

    top = [
        r for r in sorted(
            comparison["variance"],
            key=lambda r: -(abs(r.get("delta_pct") or 0)),
        )
        if r.get("client_value") is not None and r.get("verdict") == "unfavourable"
    ][:5]

    lines = [
        "## ACTIVE BENCHMARK PACK",
        f"Pack: {pack.get('name')} ({pack.get('industry')}, {pack.get('effective_year')}). "
        f"Benchmarks cover {summary.get('coverage_pct')}% of FTE.",
        f"Overall health score {summary.get('health_score')}/100 ({summary.get('health_band')}) — "
        f"{summary.get('unfavourable_count')} of {summary.get('metrics_compared')} comparisons are unfavourable.",
    ]
    if top:
        lines.append("Largest gaps against benchmark right now:")
        for r in top:
            label = r.get("subfunction") or r.get("function") or "Organisation"
            lines.append(
                f"- {label} {r['metric_label']}: "
                f"{reg.format_value(r['metric_key'], r['client_value'], currency)} vs median "
                f"{reg.format_value(r['metric_key'], r['median'], currency)} ({r['delta_pct']:+.1f}%)"
            )
    lines.append(
        "When a question touches how the org compares, is sized, or could be improved, use "
        "get_benchmark_comparison to pull exact figures rather than reasoning from this summary. "
        "For a full written analysis, tell the user to open the benchmark report."
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool definition + executor
# ---------------------------------------------------------------------------

BENCHMARK_COMPARISON_TOOL = {
    "type": "function",
    "function": {
        "name": "get_benchmark_comparison",
        "description": (
            "Compare this client's actual organisation against the active industry benchmark pack. "
            "Returns real computed variances — client value, benchmark P25/median/P75, the gap, and "
            "the implied FTE and cost opportunity — for the organisation as a whole, for named "
            "functions, or for sub-functions. Use this whenever the user asks how they compare, "
            "whether a number is good, what the benchmark is, where the savings are, or which areas "
            "are over- or under-invested. Prefer this over get_benchmarks, which only returns generic "
            "rules of thumb with no client data attached."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "scope": {
                    "type": "string",
                    "enum": ["org", "function", "subfunction", "opportunities", "all"],
                    "description": (
                        "'org' for structural metrics like span and layers, 'function' for per-function "
                        "variance, 'subfunction' for detail inside a function, 'opportunities' for the "
                        "ranked savings list, 'all' for a broad sweep."
                    ),
                },
                "functions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional function names to restrict to, e.g. ['Finance', 'IT'].",
                },
                "only_gaps": {
                    "type": "boolean",
                    "description": "When true, return only unfavourable variances. Defaults to false.",
                },
            },
            "required": ["scope"],
        },
    },
}


def execute_get_benchmark_comparison(
    args: Dict[str, Any], ctx: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """Return (text_for_llm, tabular_payload_for_chart)."""
    ctx = ctx or {}
    user_id = ctx.get("user_id")
    dataset_id = ctx.get("dataset_id")
    dataset_meta = ctx.get("dataset_meta") or {}
    schema = ctx.get("schema") or {}

    if not user_id or not dataset_id:
        return ("Benchmark comparison is not available in this context.", None)

    comparison = get_comparison(user_id, dataset_id, dataset_meta, schema)
    if not comparison:
        return (
            "No benchmark pack is configured for this dataset yet. Tell the user to open the "
            "Benchmarking tab, pick an industry pack or upload their own, and then re-ask.",
            None,
        )

    scope = (args.get("scope") or "all").lower()
    wanted = {f.strip().lower() for f in (args.get("functions") or []) if f}
    only_gaps = bool(args.get("only_gaps"))
    currency = comparison["summary"].get("currency") or "USD"

    if scope == "opportunities":
        return _render_opportunities(comparison, currency, wanted)

    scopes = ["org", "function", "subfunction"] if scope == "all" else [scope]
    rows = [
        r for r in comparison["variance"]
        if r["scope"] in scopes and r.get("client_value") is not None
    ]
    if wanted:
        rows = [r for r in rows if (r.get("function") or "").lower() in wanted]
    if only_gaps:
        rows = [r for r in rows if r["verdict"] == "unfavourable"]
    rows.sort(key=lambda r: -(abs(r.get("delta_pct") or 0)))
    rows = rows[:40]

    if not rows:
        return ("No benchmark comparisons matched that request.", None)

    summary = comparison["summary"]
    text_lines = [
        f"BENCHMARK COMPARISON — pack '{comparison['pack'].get('name')}' "
        f"({comparison['pack'].get('industry')}), covering {summary.get('coverage_pct')}% of FTE.",
        "",
    ]
    data_rows: List[Dict[str, Any]] = []

    for r in rows:
        label = r.get("subfunction") or r.get("function") or "Organisation"
        text_lines.append(
            f"- {label} | {r['metric_label']}: client "
            f"{reg.format_value(r['metric_key'], r['client_value'], currency)}, benchmark median "
            f"{reg.format_value(r['metric_key'], r['median'], currency)}"
            + (f" (P25 {reg.format_value(r['metric_key'], r['p25'], currency)}"
               f" - P75 {reg.format_value(r['metric_key'], r['p75'], currency)})"
               if r.get("p25") is not None and r.get("p75") is not None else "")
            + f" -> {r['delta_pct']:+.1f}% ({r['verdict']})"
            + (f", implies {r['fte_gap']:+,.1f} FTE" if r.get("fte_gap") else "")
            + (f", implies {r['cost_gap']:+,.0f} {currency} cost gap" if r.get("cost_gap") else "")
        )
        data_rows.append({
            "Area": label,
            "Metric": r["metric_short"],
            "Client": r["client_value"],
            "Benchmark median": r["median"],
            "Variance %": r["delta_pct"],
            "Verdict": r["verdict"],
        })

    text_lines.append("")
    text_lines.append(
        "Always state both the client figure and the benchmark. Savings must be quoted as a range "
        f"({int((summary.get('realization_low') or 0.6) * 100)}-"
        f"{int((summary.get('realization_high') or 0.7) * 100)}% realisation)."
    )
    if not comparison["coverage"].get("is_sufficient"):
        text_lines.append(
            f"CAVEAT: only {comparison['coverage'].get('coverage_pct')}% of FTE maps to a benchmarked "
            "function, so treat these as directional and say so."
        )

    payload = {
        "columns": ["Area", "Metric", "Client", "Benchmark median", "Variance %", "Verdict"],
        "data": data_rows,
        "chart_hint": "bar" if len(data_rows) <= 15 else "table",
    }
    return ("\n".join(text_lines), payload)


def _render_opportunities(
    comparison: Dict[str, Any], currency: str, wanted: set,
) -> Tuple[str, Optional[Dict[str, Any]]]:
    opportunities = comparison.get("opportunities") or []
    if wanted:
        opportunities = [o for o in opportunities if (o.get("function") or "").lower() in wanted]
    if not opportunities:
        return ("No quantified benchmark opportunities were identified for that request.", None)

    summary = comparison["summary"]
    realization = (f"{int((summary.get('realization_low') or 0.6) * 100)}-"
                   f"{int((summary.get('realization_high') or 0.7) * 100)}%")
    lines = [
        "RANKED BENCHMARK OPPORTUNITIES "
        f"(realisation assumption {realization}; functional and structural lenses overlap "
        "and must never be added together).",
        "",
    ]
    data_rows: List[Dict[str, Any]] = []

    for o in opportunities[:20]:
        lines.append(
            f"{o['rank']}. [{o['bucket']}] {o['label']} — {o['primary_metric_label']}: "
            f"{reg.format_value(o['primary_metric'], o.get('client_value'), currency)} vs median "
            f"{reg.format_value(o['primary_metric'], o.get('median'), currency)}"
            + (f", excess {o['fte_gap']:,.1f} FTE" if o.get("fte_gap") else "")
            + (f", realisable {o['savings_low']:,.0f}-{o['savings_high']:,.0f} {currency}"
               if o.get("savings_low") else "")
            + f", confidence {o.get('confidence')}"
        )
        data_rows.append({
            "Rank": o["rank"],
            "Area": o["label"],
            "Lens": o["bucket"],
            "Excess FTE": o.get("fte_gap"),
            "Savings low": o.get("savings_low"),
            "Savings high": o.get("savings_high"),
            "Confidence": o.get("confidence"),
        })

    functional = summary.get("functional") or {}
    structural = summary.get("structural") or {}
    lines.append("")
    lines.append(
        f"Functional lens total: {functional.get('savings_low', 0):,.0f}-"
        f"{functional.get('savings_high', 0):,.0f} {currency}. "
        f"Structural lens total: {structural.get('savings_low', 0):,.0f}-"
        f"{structural.get('savings_high', 0):,.0f} {currency}. Report these separately."
    )

    payload = {
        "columns": ["Rank", "Area", "Lens", "Excess FTE", "Savings low", "Savings high", "Confidence"],
        "data": data_rows,
        "chart_hint": "bar" if len(data_rows) <= 15 else "table",
    }
    return ("\n".join(lines), payload)
