"""
Benchmark deep-analysis pipeline.

Runs a multi-stage agentic narration over a deterministic comparison. Each
section gets its own LLM call with the computed numbers pinned into the prompt,
and the two analytical sections may additionally issue read-only SQL against the
client census to investigate anomalies they spot. This is what separates the
report from a single-shot chat answer: the model spends its budget interpreting
evidence rather than trying to compute and explain in one pass.

Numbers are never produced here. Every figure quoted originates from
benchmark_service and is restated by the model, so the narrative and the charts
can never disagree.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncGenerator, Dict, List, Optional

from services import benchmark_registry as reg
from services import benchmark_service, duckdb_manager
from services.llm_service import call_llm, call_llm_stream

log = logging.getLogger(__name__)

MAX_DRILLDOWN_CALLS = 4
MAX_DRILLDOWN_ROWS = 40
TOP_FUNCTIONS_IN_PROMPT = 12
TOP_VARIANCES_IN_PROMPT = 30


_SYSTEM = """You are the lead organisational analyst on an A&M engagement, writing a benchmarking report for a client executive team.

NON-NEGOTIABLE RULES
- Every number you state must come from the FACTS block or from a query result you were given. Never estimate, extrapolate or invent a figure.
- When you quote a client metric, state the benchmark alongside it. "Finance sits at 2.4% of FTE against a 1.4% median" — not "Finance is high".
- Savings are always a range with the realisation assumption named. Never present a single savings number.
- If the facts do not support a claim, say so plainly. "The data does not show why" is a valid and valuable sentence.
- Do not add caveats that are already covered elsewhere in the report; state each one once.

STYLE
- Write for a CFO or CHRO: direct, specific, commercially literate. No filler, no restating the question.
- Lead with the conclusion, then the evidence.
- Use markdown: short paragraphs, ## for sub-headings within your section, bullet lists for three or more items, **bold** for the numbers that matter.
- Never use emojis. Never mention SQL, columns, tables, prompts or that you are an AI.
- Do not write a preamble like "In this section we will". Start with substance.
"""

_DRILLDOWN_TOOL = {
    "type": "function",
    "function": {
        "name": "run_sql",
        "description": (
            "Run a read-only DuckDB SELECT against the client's employee census to investigate "
            "something the benchmark comparison surfaced. Use it to find WHERE a variance comes "
            "from: which sub-units, grades, locations or managers drive it. The table is "
            "'employees', one row per employee, with computed Level and Span columns. "
            "Call this at most a few times, only when a specific question would change your analysis."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "purpose": {
                    "type": "string",
                    "description": "One short sentence on what you are trying to find out.",
                },
                "sql": {
                    "type": "string",
                    "description": "A single SELECT statement. No semicolons, no DDL or DML. Always aggregate and always LIMIT to 40 rows or fewer.",
                },
            },
            "required": ["purpose", "sql"],
        },
    },
}


# ---------------------------------------------------------------------------
# Section definitions
# ---------------------------------------------------------------------------

SECTIONS: List[Dict[str, Any]] = [
    {
        "id": "executive_summary",
        "title": "Executive summary",
        "eyebrow": "The headline",
        "icon": "sparkles",
        "drilldown": False,
        "max_tokens": 1100,
        "visuals": ["health_gauge", "kpi_cards"],
        "brief": (
            "Open with a single sentence verdict on how this organisation compares to the benchmark. "
            "Then give the three findings that matter most, each with the client value and the benchmark "
            "side by side. Close with the total opportunity as a range, stating the realisation assumption, "
            "and note explicitly that functional and structural opportunity overlap and must not be added. "
            "Keep it under 300 words. This is the only part of the report some readers will see."
        ),
    },
    {
        "id": "function_deep_dive",
        "title": "Function-by-function variance",
        "eyebrow": "Where the gaps are",
        "icon": "layers",
        "drilldown": True,
        "max_tokens": 2000,
        "visuals": ["variance_diverging", "function_table"],
        "brief": (
            "Work through the functions with the largest unfavourable variances, most significant first. "
            "For each one: state the variance against the benchmark, translate it into FTE and cost, and "
            "say what inside the function drives it based on the evidence available. Where a function is "
            "at or better than benchmark, say so briefly rather than skipping it — leanness is a finding too. "
            "Group any small functions together instead of listing them individually."
        ),
    },
    {
        "id": "structural_analysis",
        "title": "Structure, spans and layers",
        "eyebrow": "How the org is built",
        "icon": "hierarchy",
        "drilldown": True,
        "max_tokens": 1800,
        "visuals": ["span_distribution", "layer_pyramid"],
        "brief": (
            "Analyse the shape of the organisation against the benchmark: span of control, layer count, "
            "management density and single-report managers. Explain how these interact — a low average span "
            "combined with deep layering is a different problem from wide spans in a flat structure. "
            "Identify which parts of the org drive the structural variance rather than treating it as uniform. "
            "Be explicit where a structural variance is a legitimate feature of this operating model rather "
            "than an inefficiency."
        ),
    },
    {
        "id": "root_causes",
        "title": "Root causes and cross-cutting patterns",
        "eyebrow": "Why it looks like this",
        "icon": "search",
        "drilldown": True,
        "max_tokens": 1800,
        "visuals": ["cost_vs_span_scatter"],
        "brief": (
            "Step back from individual functions and identify the two to four patterns that explain multiple "
            "variances at once — for example duplicated capability across business units, a location footprint "
            "that concentrates work in high-cost geographies, or a grade structure that has drifted senior. "
            "Label each as a hypothesis and state what evidence supports it and what would confirm or "
            "disprove it. Distinguish clearly between what the data shows and what it merely suggests."
        ),
    },
    {
        "id": "opportunities",
        "title": "Quantified opportunity",
        "eyebrow": "What it is worth",
        "icon": "target",
        "drilldown": False,
        "max_tokens": 1800,
        "visuals": ["savings_waterfall", "opportunity_table"],
        "brief": (
            "Walk through the ranked opportunities. For each material one: the size as a range, the confidence "
            "level and why, the practical route to capture it, and the risk of pursuing it. Be candid about "
            "which opportunities are clean and which depend on assumptions that have not been tested. "
            "Restate once that functional and structural sizing overlap. Do not produce a grand total that "
            "adds the two buckets together."
        ),
    },
    {
        "id": "roadmap",
        "title": "Recommended actions",
        "eyebrow": "What to do next",
        "icon": "route",
        "drilldown": False,
        "max_tokens": 1500,
        "visuals": ["roadmap_timeline"],
        "brief": (
            "Give a sequenced plan across three horizons: first 30 days (validate and mobilise), 60 days "
            "(design), 90 days and beyond (execute). Each action needs an owner archetype, the specific "
            "question or decision it resolves, and the opportunity it unlocks. Be concrete — 'run a span "
            "review across the twelve Finance managers below four reports' rather than 'review spans'. "
            "End with the data gaps that would materially sharpen this analysis if closed."
        ),
    },
]


# ---------------------------------------------------------------------------
# Fact block construction
# ---------------------------------------------------------------------------

def _fmt(metric_key: str, value: Optional[float], currency: str) -> str:
    return reg.format_value(metric_key, value, currency)


def _money(value: Optional[float], currency: str) -> str:
    if value is None:
        return "n/a"
    magnitude = abs(value)
    if magnitude >= 1_000_000_000:
        return f"{currency} {value / 1_000_000_000:,.2f}bn"
    if magnitude >= 1_000_000:
        return f"{currency} {value / 1_000_000:,.2f}m"
    if magnitude >= 1_000:
        return f"{currency} {value / 1_000:,.0f}k"
    return f"{currency} {value:,.0f}"


def build_facts_block(comparison: Dict[str, Any]) -> str:
    """Compact, unambiguous rendering of the deterministic results for the LLM."""
    summary = comparison["summary"]
    coverage = comparison["coverage"]
    pack = comparison["pack"]
    currency = summary.get("currency") or "USD"
    lines: List[str] = []

    lines.append("=== BENCHMARK CONTEXT ===")
    lines.append(f"Pack: {pack.get('name')} | Industry: {pack.get('industry')} | "
                 f"Region: {pack.get('region')} | Year: {pack.get('effective_year')}")
    if pack.get("notes"):
        lines.append(f"Pack notes: {pack['notes']}")
    lines.append(f"Benchmark provenance: {_pack_source(comparison)}")

    lines.append("\n=== CLIENT ORGANISATION ===")
    lines.append(f"Headcount: {summary.get('headcount'):,}" if summary.get("headcount") else "Headcount: n/a")
    lines.append(f"Total FTE: {summary.get('total_fte'):,.1f}" if summary.get("total_fte") else "Total FTE: n/a")
    lines.append(f"Total workforce cost: {_money(summary.get('total_cost'), currency)}")
    lines.append(f"Benchmark coverage: {coverage.get('coverage_pct')}% of FTE maps to a benchmarked function")
    if coverage.get("unmapped_functions"):
        lines.append(f"Unmapped client functions: {', '.join(coverage['unmapped_functions'][:15])}")
    if coverage.get("benchmark_functions_absent_from_client"):
        lines.append("Benchmark functions with no client match: "
                     f"{', '.join(coverage['benchmark_functions_absent_from_client'][:15])}")

    lines.append("\n=== SCORECARD ===")
    lines.append(f"Comparisons made: {summary.get('metrics_compared')} | "
                 f"Unfavourable: {summary.get('unfavourable_count')} | "
                 f"In line: {summary.get('in_line_count')} | "
                 f"Favourable: {summary.get('favourable_count')}")
    lines.append(f"Health score: {summary.get('health_score')}/100 ({summary.get('health_band')})")

    functional = summary.get("functional") or {}
    structural = summary.get("structural") or {}
    realization = (f"{int((summary.get('realization_low') or 0.6) * 100)}-"
                   f"{int((summary.get('realization_high') or 0.7) * 100)}% realisation")
    lines.append("\n=== QUANTIFIED OPPORTUNITY (two overlapping lenses — DO NOT ADD) ===")
    lines.append(
        f"Functional right-sizing: {functional.get('opportunity_count', 0)} opportunities | "
        f"excess FTE {functional.get('fte_gap', 0):,.1f} | gross cost gap "
        f"{_money(functional.get('cost_gap'), currency)} | realisable "
        f"{_money(functional.get('savings_low'), currency)}-{_money(functional.get('savings_high'), currency)} "
        f"at {realization}"
    )
    lines.append(
        f"Structural / management: {structural.get('opportunity_count', 0)} opportunities | "
        f"excess managers {structural.get('fte_gap', 0):,.1f} | gross cost gap "
        f"{_money(structural.get('cost_gap'), currency)} | realisable "
        f"{_money(structural.get('savings_low'), currency)}-{_money(structural.get('savings_high'), currency)} "
        f"at {realization}"
    )

    lines.append("\n=== ORGANISATION-LEVEL VARIANCE ===")
    for row in _sorted_variance(comparison, scope="org"):
        lines.append(_variance_line(row, currency))

    lines.append("\n=== FUNCTION-LEVEL VARIANCE (largest gaps first) ===")
    for row in _sorted_variance(comparison, scope="function")[:TOP_VARIANCES_IN_PROMPT]:
        lines.append(_variance_line(row, currency))

    subfunc = _sorted_variance(comparison, scope="subfunction")[:15]
    if subfunc:
        lines.append("\n=== SUB-FUNCTION VARIANCE (largest gaps first) ===")
        for row in subfunc:
            lines.append(_variance_line(row, currency))

    lines.append("\n=== FUNCTION PROFILE (client actuals) ===")
    for agg in (comparison.get("function_aggregates") or [])[:TOP_FUNCTIONS_IN_PROMPT]:
        span = (agg.get("subordinates") / agg["managers"]) if agg.get("managers") else 0
        lines.append(
            f"- {agg.get('group_value')}: {agg.get('headcount'):,} people, "
            f"{(agg.get('total_fte') or 0):,.1f} FTE, cost {_money(agg.get('total_cost'), currency)}, "
            f"{agg.get('managers')} managers (avg span {span:.1f}), "
            f"{agg.get('single_report_mgrs')} with a single report, "
            f"deepest level {agg.get('max_level')}"
        )

    lines.append("\n=== RANKED OPPORTUNITIES ===")
    for opp in (comparison.get("opportunities") or [])[:15]:
        lines.append(
            f"{opp['rank']}. [{opp['bucket']}] {opp['label']} — {opp['primary_metric_label']}: "
            f"{_fmt(opp['primary_metric'], opp.get('client_value'), currency)} vs benchmark median "
            f"{_fmt(opp['primary_metric'], opp.get('median'), currency)} "
            f"({opp.get('delta_pct'):+.1f}% off)" if opp.get("delta_pct") is not None else
            f"{opp['rank']}. [{opp['bucket']}] {opp['label']}"
        )
        detail = []
        if opp.get("fte_gap"):
            detail.append(f"excess {opp['fte_gap']:,.1f} FTE")
        if opp.get("savings_low") and opp.get("savings_high"):
            detail.append(f"realisable {_money(opp['savings_low'], currency)}-"
                          f"{_money(opp['savings_high'], currency)}")
        detail.append(f"confidence {opp.get('confidence')}")
        lines.append(f"   {' | '.join(detail)}")

    warnings = list(coverage.get("warnings") or [])
    if comparison.get("currency", {}).get("message"):
        warnings.append(comparison["currency"]["message"])
    for s in comparison.get("suppressed_metrics") or []:
        if s.get("reason"):
            warnings.append(f"{s['label']} unavailable: {s['reason']}")
    if warnings:
        lines.append("\n=== LIMITATIONS THE READER MUST KNOW ===")
        for w in warnings:
            lines.append(f"- {w}")

    return "\n".join(lines)


def _pack_source(comparison: Dict[str, Any]) -> str:
    sources = {r.get("source") for r in comparison.get("variance") or [] if r.get("source")}
    return "; ".join(sorted(s for s in sources if s)) or "Unspecified"


def _sorted_variance(comparison: Dict[str, Any], scope: str) -> List[Dict[str, Any]]:
    rows = [r for r in comparison.get("variance") or []
            if r["scope"] == scope and r.get("client_value") is not None]
    return sorted(rows, key=lambda r: -(abs(r.get("delta_pct") or 0)))


def _variance_line(row: Dict[str, Any], currency: str) -> str:
    key = row["metric_key"]
    label = row.get("subfunction") or row.get("function") or "Organisation"
    band = ""
    if row.get("p25") is not None and row.get("p75") is not None:
        band = f" [P25 {_fmt(key, row['p25'], currency)} - P75 {_fmt(key, row['p75'], currency)}]"
    delta = f"{row['delta_pct']:+.1f}%" if row.get("delta_pct") is not None else "n/a"
    extra = ""
    if row.get("fte_gap"):
        extra += f", implies {row['fte_gap']:+,.1f} FTE"
    if row.get("cost_gap"):
        extra += f", implies {_money(row['cost_gap'], currency)} cost gap"
    return (f"- {label} | {row['metric_label']}: client {_fmt(key, row['client_value'], currency)} "
            f"vs median {_fmt(key, row['median'], currency)}{band} -> {delta} ({row['verdict']}){extra}")


# ---------------------------------------------------------------------------
# Drilldown tool execution
# ---------------------------------------------------------------------------

def _execute_drilldown(user_id: int, args: Dict[str, Any]) -> Dict[str, Any]:
    sql = (args.get("sql") or "").strip()
    purpose = args.get("purpose") or "investigation"
    if not sql:
        return {"purpose": purpose, "sql": "", "error": "No SQL supplied."}
    try:
        result = duckdb_manager.query(user_id, sql, max_rows=MAX_DRILLDOWN_ROWS)
        return {
            "purpose": purpose,
            "sql": sql,
            "columns": result.get("columns", []),
            "rows": result.get("data", [])[:MAX_DRILLDOWN_ROWS],
            "row_count": result.get("row_count", 0),
        }
    except Exception as e:
        log.info("Benchmark drilldown query rejected: %s", e)
        return {"purpose": purpose, "sql": sql, "error": str(e)}


def _render_evidence(evidence: List[Dict[str, Any]]) -> str:
    if not evidence:
        return ""
    parts = ["\n=== YOUR INVESTIGATION RESULTS ==="]
    for item in evidence:
        parts.append(f"\nQuestion: {item.get('purpose')}")
        if item.get("error"):
            parts.append(f"  Query could not run: {item['error']}")
            continue
        rows = item.get("rows") or []
        if not rows:
            parts.append("  No rows returned.")
            continue
        parts.append(f"  {item.get('row_count', len(rows))} rows:")
        parts.append("  " + json.dumps(rows, default=str)[:4000])
    return "\n".join(parts)


async def _gather_evidence(
    user_id: int, section: Dict[str, Any], facts: str, schema_hint: str,
) -> List[Dict[str, Any]]:
    """Let the model interrogate the census before it writes the section."""
    messages = [
        {"role": "system", "content": _SYSTEM},
        {
            "role": "user",
            "content": (
                f"{facts}\n\n{schema_hint}\n\n"
                f"You are about to write the '{section['title']}' section of this report.\n"
                f"Section brief: {section['brief']}\n\n"
                "Before writing, you may run up to three read-only queries against the census to "
                "find out where the variances actually come from. Only query things that would "
                "change what you write. If the facts above are already sufficient, reply with the "
                "single word SUFFICIENT and run nothing."
            ),
        },
    ]

    evidence: List[Dict[str, Any]] = []
    for _ in range(MAX_DRILLDOWN_CALLS):
        try:
            response, _usage, _latency = await asyncio.to_thread(
                call_llm,
                messages=messages,
                tools=[_DRILLDOWN_TOOL],
                tool_choice="auto",
                max_tokens=700,
                temperature=0.1,
            )
        except Exception as e:
            log.warning("Benchmark drilldown call failed: %s", e)
            break

        if isinstance(response, str):
            break
        tool_calls = getattr(response, "tool_calls", None)
        if not tool_calls:
            break

        messages.append(response)
        for call in tool_calls:
            if call.function.name != "run_sql":
                continue
            try:
                args = json.loads(call.function.arguments)
            except Exception:
                args = {}
            result = await asyncio.to_thread(_execute_drilldown, user_id, args)
            evidence.append(result)
            payload = (
                f"Error: {result['error']}" if result.get("error")
                else json.dumps({"columns": result.get("columns"),
                                 "rows": result.get("rows")}, default=str)[:6000]
            )
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "name": "run_sql",
                "content": payload,
            })
        if len(evidence) >= 3:
            break

    return evidence


def _schema_hint(comparison: Dict[str, Any], schema: Dict[str, Any]) -> str:
    cols = comparison.get("columns") or {}
    names = [c["name"] for c in (schema or {}).get("columns", [])]
    return (
        "=== CENSUS TABLE FOR DRILLDOWN QUERIES ===\n"
        "Table: employees (one row per active employee)\n"
        f"Function column: \"{cols.get('func_col')}\" | "
        f"Sub-function column: \"{cols.get('subfunc_col')}\" | "
        f"FTE: \"{cols.get('fte_col')}\" | Cost: \"{cols.get('flc_col')}\" | "
        f"Country: \"{cols.get('country_col')}\" | Job title: \"{cols.get('job_title_col')}\"\n"
        "Computed columns (no quotes needed): Level (1 = top of house), Span (direct reports), "
        "Total_Reports, L1..Ln (reporting chain).\n"
        f"All available columns: {', '.join(names[:60])}"
    )


# ---------------------------------------------------------------------------
# Streaming pipeline
# ---------------------------------------------------------------------------

async def run_benchmark_analysis_stream(
    user_id: int,
    project_id: int,
    dataset_id: int,
    dataset_meta: Dict[str, Any],
    schema: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
    section_ids: Optional[List[str]] = None,
    focus: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Stream a full benchmark report: deterministic first, then narration."""
    started = time.monotonic()

    yield _status("resolve", "Resolving benchmark pack and mapping functions", 4)
    try:
        comparison = await asyncio.to_thread(
            benchmark_service.build_comparison,
            user_id, dataset_id, dataset_meta, schema, config,
        )
    except Exception as e:
        log.error("Benchmark comparison failed: %s", e, exc_info=True)
        yield {"type": "error", "data": {"message": str(e)}}
        return

    coverage = comparison["coverage"]
    yield _status(
        "compute",
        f"Computed {comparison['summary']['metrics_compared']} comparisons "
        f"across {coverage['coverage_pct']}% of FTE",
        18,
    )

    # The charts can render from here; narration fills in behind them.
    yield {"type": "deterministic", "data": comparison}

    if not comparison["variance"]:
        yield {"type": "error", "data": {
            "message": "No overlapping metrics between this dataset and the selected benchmark pack. "
                       "Check the function mapping in the benchmark configuration."
        }}
        return

    facts = build_facts_block(comparison)
    hint = _schema_hint(comparison, schema)
    if focus:
        facts += f"\n\n=== USER'S SPECIFIC FOCUS FOR THIS REPORT ===\n{focus}\n"

    selected = [s for s in SECTIONS if not section_ids or s["id"] in section_ids]
    sections_out: List[Dict[str, Any]] = []
    progress = 20
    step = int(70 / max(len(selected), 1))
    prior_summaries: List[str] = []

    for section in selected:
        yield {"type": "section_start", "data": {
            "id": section["id"],
            "title": section["title"],
            "eyebrow": section["eyebrow"],
            "icon": section["icon"],
            "visuals": section["visuals"],
        }}

        evidence: List[Dict[str, Any]] = []
        if section["drilldown"]:
            yield _status(section["id"], f"Investigating the drivers behind {section['title'].lower()}", progress)
            evidence = await _gather_evidence(user_id, section, facts, hint)
            if evidence:
                yield {"type": "evidence", "data": {
                    "section": section["id"],
                    "queries": [
                        {"purpose": e.get("purpose"), "sql": e.get("sql"),
                         "row_count": e.get("row_count"), "error": e.get("error")}
                        for e in evidence
                    ],
                }}

        progress = min(progress + step, 92)
        yield _status(section["id"], f"Writing {section['title'].lower()}", progress)

        prompt = _section_prompt(section, facts, evidence, prior_summaries)
        text = ""
        try:
            async for token in call_llm_stream(
                messages=[{"role": "system", "content": _SYSTEM},
                          {"role": "user", "content": prompt}],
                max_tokens=section["max_tokens"],
                temperature=0.35,
            ):
                text += token
                yield {"type": "token", "data": {"section": section["id"], "text": token}}
        except Exception as e:
            log.error("Benchmark narration failed for %s: %s", section["id"], e)
            text = text or (
                f"This section could not be generated ({e}). The underlying numbers are "
                f"still shown in the charts and tables above."
            )
            yield {"type": "token", "data": {"section": section["id"], "text": text}}

        section_payload = {
            "id": section["id"],
            "title": section["title"],
            "eyebrow": section["eyebrow"],
            "icon": section["icon"],
            "visuals": section["visuals"],
            "markdown": text.strip(),
            "evidence": [
                {"purpose": e.get("purpose"), "sql": e.get("sql"),
                 "columns": e.get("columns"), "rows": e.get("rows"),
                 "row_count": e.get("row_count"), "error": e.get("error")}
                for e in evidence
            ],
        }
        sections_out.append(section_payload)
        prior_summaries.append(f"{section['title']}: {_first_lines(text, 2)}")
        yield {"type": "section_end", "data": section_payload}

    elapsed_ms = int((time.monotonic() - started) * 1000)
    report = {
        "generated_at_ms": elapsed_ms,
        "dataset_id": dataset_id,
        "project_id": project_id,
        "pack": comparison["pack"],
        "summary": comparison["summary"],
        "coverage": comparison["coverage"],
        "currency": comparison["currency"],
        "columns": comparison["columns"],
        "org_aggregate": comparison["org_aggregate"],
        "function_aggregates": comparison["function_aggregates"],
        "subfunction_aggregates": comparison["subfunction_aggregates"],
        "function_mapping": comparison["function_mapping"],
        "variance": comparison["variance"],
        "opportunities": comparison["opportunities"],
        "suppressed_metrics": comparison["suppressed_metrics"],
        "sections": sections_out,
    }

    yield _status("done", f"Report complete in {elapsed_ms / 1000:.1f}s", 100)
    yield {"type": "done", "data": report}


def _status(phase: str, message: str, progress: int) -> Dict[str, Any]:
    return {"type": "status", "data": {"phase": phase, "message": message, "progress": progress}}


def _first_lines(text: str, count: int) -> str:
    lines = [l.strip() for l in (text or "").split("\n") if l.strip() and not l.strip().startswith("#")]
    return " ".join(lines[:count])[:400]


def _section_prompt(
    section: Dict[str, Any],
    facts: str,
    evidence: List[Dict[str, Any]],
    prior_summaries: List[str],
) -> str:
    parts = [facts, _render_evidence(evidence)]
    if prior_summaries:
        parts.append(
            "\n=== ALREADY COVERED EARLIER IN THIS REPORT (do not repeat) ===\n"
            + "\n".join(f"- {s}" for s in prior_summaries)
        )
    parts.append(
        f"\n=== YOUR TASK ===\n"
        f"Write the '{section['title']}' section of the report.\n"
        f"{section['brief']}\n\n"
        "Output only the section body in markdown. Do not repeat the section title as a heading — "
        "it is already rendered above your text. Do not sign off or add a conclusion that belongs "
        "to a later section."
    )
    return "\n".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Non-streaming convenience wrapper
# ---------------------------------------------------------------------------

async def run_benchmark_analysis(
    user_id: int, project_id: int, dataset_id: int,
    dataset_meta: Dict[str, Any], schema: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
    section_ids: Optional[List[str]] = None,
    focus: Optional[str] = None,
) -> Dict[str, Any]:
    report: Dict[str, Any] = {}
    async for event in run_benchmark_analysis_stream(
        user_id, project_id, dataset_id, dataset_meta, schema, config, section_ids, focus,
    ):
        if event["type"] == "done":
            report = event["data"]
        elif event["type"] == "error":
            raise RuntimeError(event["data"].get("message", "Benchmark analysis failed"))
    return report
