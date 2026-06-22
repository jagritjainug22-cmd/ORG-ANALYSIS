"""
OrgSight Chat Agent — Orchestrated multi-tool chatbot.

Architecture:
  1. build_system_prompt()  — injects schema + dataset metadata + benchmarks
  2. classify_intent()      — LLM call #1: classify intent, pick route + tool
  3. execute_tool()         — runs the chosen tool (SQL template, custom SQL, or insight service)
  4. format_response()      — LLM call #2: narrate results in business language
  5. run_agent_turn()       — orchestrates the full turn and returns structured response

Tools available:
  - org_summary             — top-level KPIs
  - l2_breakdown            — per L2-leader table
  - span_distribution       — spans bucketed + cost
  - layer_analysis          — cost/headcount per hierarchy level
  - manager_efficiency      — managers below span benchmark
  - cost_by_dimension       — cost/FTE by any column
  - insight_service         — calls spans_layers_service.get_insights() (pre-computed)
  - sql_agent               — generate + execute custom SQL for Tier 2/3 questions
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from services import duckdb_manager
from services.llm_service import call_llm, call_llm_json

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Industry benchmark constants (A&M defaults — override per project if needed)
# ---------------------------------------------------------------------------

BENCHMARKS = """## INDUSTRY BENCHMARKS
Use these for any question comparing the organisation against standards.

SPAN OF CONTROL:
  - Front-line managers (Level 4+):    ideal 6–10 direct reports
  - Mid-level managers (Level 3):      ideal 5–7 direct reports
  - Senior leaders (Level 2):          ideal 4–6 direct reports
  - Default target span (mixed):       6
  - Narrow/problematic span:           < 4 direct reports
  - Wide span (review needed):         > 12 direct reports

ORGANISATIONAL LAYERS:
  - Small org (< 500 employees):       max 5 layers
  - Mid-market (500–2 000 employees):  max 7 layers
  - Enterprise (2 000–10 000):         max 7–8 layers
  - Global MNC (> 10 000):             max 9 layers
  - Default threshold:                 7 layers

MANAGEMENT RATIOS:
  - Target manager-to-IC ratio:        1 manager per 6 ICs
  - Management cost as % of total:     target below 25%
  - % managers with < 4 reports:       should be below 20%

LOCATION COST TIERS:
  High cost  (> USD 80 k avg):   USA, UK, Germany, Switzerland, Australia, Singapore, Nordics
  Mid cost   (USD 30–80 k avg):  France, Spain, Italy, Poland, Czech Republic, Romania, Portugal
  Low cost   (< USD 30 k avg):   India, Philippines, Malaysia, Vietnam, Sri Lanka, Egypt, Mexico, Morocco

OFFSHORE / SHARED-SERVICE CENTRES (typical):
  India, Philippines, Poland, Romania, Malaysia, Mexico, Egypt

FUNCTION CLASSIFICATION:
  Customer-facing:  Sales, Account Management, Customer Success, Field Operations,
                    Client Delivery, Business Development, Revenue, Consulting
  Support/overhead: HR, Human Resources, People & Culture, Finance, Accounting,
                    Legal, Compliance, Risk, IT, Technology, Facilities,
                    Procurement, Strategy, Corporate Development
"""

# ---------------------------------------------------------------------------
# Function classification helpers
# ---------------------------------------------------------------------------

CUSTOMER_FACING_KEYWORDS = {
    "sales", "account", "customer", "client", "revenue", "field", "delivery",
    "business development", "consulting",
}
SUPPORT_KEYWORDS = {
    "hr", "human resources", "people", "finance", "accounting", "legal",
    "compliance", "risk", "it", "technology", "facilities", "procurement",
    "strategy", "corporate",
}

# ---------------------------------------------------------------------------
# Named SQL tool templates
# ---------------------------------------------------------------------------
# Placeholders: {flc_col}, {fte_col}, {emp_col}, {mgr_col}, {job_title_col},
#               {dimension_col}, {benchmark_span}, {max_layer}

_TOOLS: Dict[str, Dict[str, Any]] = {
    "org_summary": {
        "description": "Top-level KPIs: headcount, FTE, total cost, avg cost, avg span, max depth, manager count, IC count.",
        "use_when": "Overview questions, 'how big is the org', 'workforce size', 'total headcount'.",
        "sql": """
SELECT
    COUNT(*) AS total_headcount,
    ROUND(SUM("{fte_col}"), 2) AS total_fte,
    ROUND(SUM("{flc_col}"), 0) AS total_cost,
    ROUND(AVG("{flc_col}"), 0) AS avg_cost_per_head,
    ROUND(AVG(CASE WHEN Span > 0 THEN Span ELSE NULL END), 2) AS avg_mgr_span,
    MAX(Level) AS max_depth,
    COUNT(*) FILTER (WHERE Span > 0) AS manager_count,
    COUNT(*) FILTER (WHERE Span = 0) AS ic_count,
    ROUND(COUNT(*) FILTER (WHERE Span > 0) * 100.0 / COUNT(*), 1) AS mgr_pct_of_total,
    ROUND(SUM("{flc_col}") FILTER (WHERE Span > 0) * 100.0 / NULLIF(SUM("{flc_col}"), 0), 1) AS mgr_cost_pct
FROM employees
""",
    },

    "l2_breakdown": {
        "description": "Per L2 leader: headcount, total cost, avg cost, avg span, org depth, IC/manager split.",
        "use_when": "Questions about 'by leader', 'by division', 'which unit has highest X', 'L2 comparison'.",
        "sql": """
SELECT
    L2 AS l2_leader,
    COUNT(*) AS headcount,
    ROUND(SUM("{fte_col}"), 2) AS total_fte,
    ROUND(SUM("{flc_col}"), 0) AS total_cost,
    ROUND(AVG("{flc_col}"), 0) AS avg_cost_per_head,
    ROUND(SUM("{flc_col}") / NULLIF(SUM("{fte_col}"), 0), 0) AS cost_per_fte,
    ROUND(AVG(CASE WHEN Span > 0 THEN Span ELSE NULL END), 1) AS avg_span,
    MAX(Level) AS max_depth,
    COUNT(*) FILTER (WHERE Span = 0) AS ic_count,
    COUNT(*) FILTER (WHERE Span > 0) AS manager_count,
    ROUND(COUNT(*) FILTER (WHERE Span > 0) * 100.0 / COUNT(*), 1) AS mgr_pct
FROM employees
WHERE L2 IS NOT NULL
GROUP BY L2
ORDER BY total_cost DESC
""",
    },

    "span_distribution": {
        "description": "Span buckets for all managers: count, total cost, avg cost per bucket.",
        "use_when": "Span of control analysis, management density, benchmark comparison, narrow/wide spans.",
        "sql": """
SELECT
    CASE
        WHEN Span = 1 THEN '1 (solo manager)'
        WHEN Span BETWEEN 2 AND 3 THEN '2-3 (narrow)'
        WHEN Span BETWEEN 4 AND 5 THEN '4-5 (below target)'
        WHEN Span BETWEEN 6 AND 8 THEN '6-8 (ideal)'
        WHEN Span BETWEEN 9 AND 12 THEN '9-12 (wide)'
        WHEN Span > 12 THEN '13+ (very wide)'
    END AS span_bucket,
    COUNT(*) AS manager_count,
    ROUND(SUM("{flc_col}"), 0) AS total_mgr_cost,
    ROUND(AVG("{flc_col}"), 0) AS avg_mgr_cost
FROM employees
WHERE Span > 0
GROUP BY 1
ORDER BY MIN(Span)
""",
    },

    "layer_analysis": {
        "description": "Headcount, FTE, cost and cost-% at each hierarchy Level. Includes manager vs IC split.",
        "use_when": "Layer/depth questions, delayering, % below layer N, org structure depth.",
        "sql": """
SELECT
    Level,
    COUNT(*) AS headcount,
    ROUND(SUM("{fte_col}"), 2) AS total_fte,
    ROUND(SUM("{flc_col}"), 0) AS total_cost,
    ROUND(
        SUM("{flc_col}") * 100.0 / NULLIF(SUM(SUM("{flc_col}")) OVER (), 0),
        1
    ) AS pct_of_total_cost,
    COUNT(*) FILTER (WHERE Span > 0) AS managers,
    COUNT(*) FILTER (WHERE Span = 0) AS ics
FROM employees
GROUP BY Level
ORDER BY Level
""",
    },

    "manager_efficiency": {
        "description": "Managers below a span threshold — the primary delayering opportunity list.",
        "use_when": "Delayering savings, managers to remove, span below benchmark, narrow span cost.",
        "sql": """
SELECT
    "{emp_col}" AS emp_id,
    "{job_title_col}" AS job_title,
    Level,
    Span AS direct_reports,
    {benchmark_span} AS benchmark_span,
    ({benchmark_span} - Span) AS span_gap,
    ROUND("{flc_col}", 0) AS individual_cost
FROM employees
WHERE Span > 0 AND Span < {benchmark_span}
ORDER BY "{flc_col}" DESC
""",
    },

    "cost_by_dimension": {
        "description": "Cost, FTE, headcount broken down by any dataset column (Country, Function, Grade, etc.).",
        "use_when": "Any 'by X' cost or headcount question where X maps to a column name.",
        "sql": """
SELECT
    "{dimension_col}" AS dimension_value,
    COUNT(*) AS headcount,
    ROUND(SUM("{fte_col}"), 2) AS total_fte,
    ROUND(SUM("{flc_col}"), 0) AS total_cost,
    ROUND(AVG("{flc_col}"), 0) AS avg_cost_per_head,
    ROUND(SUM("{flc_col}") / NULLIF(SUM("{fte_col}"), 0), 0) AS cost_per_fte,
    COUNT(*) FILTER (WHERE Span > 0) AS managers,
    ROUND(COUNT(*) FILTER (WHERE Span > 0) * 100.0 / COUNT(*), 1) AS mgr_pct
FROM employees
WHERE "{dimension_col}" IS NOT NULL
GROUP BY 1
ORDER BY total_cost DESC
""",
    },
}


# ---------------------------------------------------------------------------
# System prompt builder
# ---------------------------------------------------------------------------

def build_system_prompt(schema: Dict[str, Any], dataset_meta: Dict[str, Any]) -> str:
    """Construct the full system prompt injected into every LLM call."""
    col_lines = []
    for col in schema.get("columns", []):
        samples = ", ".join(str(v) for v in col.get("sample_values", [])[:4])
        unique = col.get("unique_count", "?")
        col_lines.append(
            f'  "{col["name"]}"  {col["type"]}  ({unique} distinct)  samples: {samples}'
        )

    # Identify which standard columns were mapped
    emp_col = dataset_meta.get("emp_col") or "emp_id"
    mgr_col = dataset_meta.get("mgr_col") or "mgr_id"
    fte_col = dataset_meta.get("fte_col")
    flc_col = dataset_meta.get("flc_col")
    job_title_col = dataset_meta.get("job_title_col")
    country_col = dataset_meta.get("country_col")
    func_col = dataset_meta.get("func_col")
    grade_col = dataset_meta.get("grade_col")
    contract_type_col = dataset_meta.get("contract_type_col")
    start_date_col = dataset_meta.get("start_date_col")

    # Build missing column warning
    missing = []
    if not func_col:
        missing.append("Function/Business Unit (func_col not mapped)")
    if not grade_col:
        missing.append("Grade/Band (grade_col not mapped)")
    if not contract_type_col:
        missing.append("Contract Type (contract_type_col not mapped)")
    if not start_date_col:
        missing.append("Start Date / Tenure (start_date_col not mapped)")

    missing_block = ""
    if missing:
        missing_block = (
            "\n⚠️ MISSING COLUMNS (not uploaded in this dataset — tell the user politely if asked):\n"
            + "\n".join(f"  - {m}" for m in missing)
        )

    return f"""You are OrgSight AI, an expert organisational analyst embedded in the OrgSight platform.
You answer questions about the organisation's workforce data with precision, insight, and commercial awareness.

## ACTIVE DATASET
Table name: employees
Total rows: {schema.get("row_count", "unknown")}
Dataset: {dataset_meta.get("name", "unknown")}

## COLUMN MAPPING (actual column names in this dataset)
Employee ID column:    "{emp_col}"
Manager ID column:     "{mgr_col}"
FTE column:            "{fte_col or 'NOT MAPPED'}"
Fully Loaded Cost col: "{flc_col or 'NOT MAPPED'}"
Job Title column:      "{job_title_col or 'NOT MAPPED'}"
Country column:        "{country_col or 'NOT MAPPED'}"
Function column:       "{func_col or 'NOT MAPPED'}"
Grade column:          "{grade_col or 'NOT MAPPED'}"
Contract Type column:  "{contract_type_col or 'NOT MAPPED'}"
Start Date column:     "{start_date_col or 'NOT MAPPED'}"

## ALL COLUMNS IN employees TABLE
{chr(10).join(col_lines)}

## COMPUTED HIERARCHY COLUMNS (always present, do NOT put in quotes when they are single-word)
  Level          INTEGER  — hierarchy depth (1 = CEO/top, higher = deeper)
  Span           INTEGER  — number of direct reports (0 = individual contributor, >0 = manager)
  Total_Reports  INTEGER  — total people in subtree beneath this person (including self)
  Avg_FLC        FLOAT    — average cost of this person's direct reports
  L1             TEXT     — ancestor name at Level 1 (CEO/top)
  L2             TEXT     — ancestor name at Level 2
  L3, L4...      TEXT     — ancestor at each deeper level (up to max depth)
  Chain          TEXT     — full ancestor path as array
  Chain_reversed TEXT     — same path, reversed

## QUERY RULES (CRITICAL — MUST FOLLOW)
1. Always double-quote column names that contain spaces or special chars: "Fully loaded cost", "Line Manager ID", "Job Title"
2. Single-word computed columns do NOT need quoting: Level, Span, Total_Reports, L1, L2
3. Managers  = WHERE Span > 0
4. Individual contributors (ICs) = WHERE Span = 0
5. Top of org / CEO = WHERE Level = 1
6. Self-join pattern to compare manager vs subordinate:
   SELECT e.*, m."{flc_col}" AS mgr_cost
   FROM employees e JOIN employees m ON e."{mgr_col}" = m."{emp_col}"
7. For L2 subtree analysis: GROUP BY L2
8. Never expose internal IDs or raw JSON in responses
{missing_block}

{BENCHMARKS}

## RESPONSE STYLE
- Be concise but insightful — always add a business interpretation, not just numbers
- When data shows an outlier, flag it and explain the implication
- Always show units (£, $, %, headcount)
- If a question cannot be answered due to missing columns, say which column is needed and that it wasn't mapped at upload
- Suggest a follow-up question when relevant
"""


# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------

_INTENT_SYSTEM = """You are an intent classifier for an org analytics chatbot.
Classify the user's message and output ONLY valid JSON matching this schema exactly.

{
  "intent": one of: headcount | cost | span_control | org_structure | geography |
            benchmarking | individual_lookup | simulation | insight_summary | comparison,
  "route": one of: named_tool | sql_agent | insight_service | llm_reasoning | simulation | cannot_answer,
  "tool_name": one of: org_summary | l2_breakdown | span_distribution | layer_analysis |
                manager_efficiency | cost_by_dimension | insight_service | sql_agent | none,
  "dimension_col": string or null,
  "benchmark_span": integer or null,
  "max_layer": integer or null,
  "filter_hint": string or null,
  "complexity": one of: tier1 | tier2 | tier3,
  "missing_columns_needed": list of strings or [],
  "cannot_answer_reason": string or null
}

Route guide:
- named_tool   → one of the 6 pre-built SQL templates covers this question exactly
- sql_agent    → needs custom SQL (LLM generates it); use for Tier 2-3 questions
- insight_service → question about 1:1 managers, thin layers, FTE opportunity, below-target spans
- llm_reasoning → needs multi-SQL synthesis or interpretation (e.g. "top risks", "compare A vs B")
- simulation   → what-if org redesign ("if we target span 8...") — cannot be answered with SQL
- cannot_answer → data genuinely unavailable (vacancies, bonus, peer comparison)
"""


def classify_intent(message: str, schema: Dict[str, Any], dataset_meta: Dict[str, Any]) -> Dict[str, Any]:
    """LLM call #1 — classify intent and pick the right route + tool."""
    col_names = [c["name"] for c in schema.get("columns", [])]
    col_summary = ", ".join(f'"{n}"' for n in col_names[:30])

    prompt = f"""User question: "{message}"

Available columns in employees table: {col_summary}
Dataset emp_col="{dataset_meta.get('emp_col')}", mgr_col="{dataset_meta.get('mgr_col')}", fte_col="{dataset_meta.get('fte_col')}", flc_col="{dataset_meta.get('flc_col')}"
func_col: {dataset_meta.get('func_col') or 'NOT MAPPED'}
grade_col: {dataset_meta.get('grade_col') or 'NOT MAPPED'}
contract_type_col: {dataset_meta.get('contract_type_col') or 'NOT MAPPED'}

Named tools available:
- org_summary: top-level KPIs
- l2_breakdown: per L2 leader breakdown
- span_distribution: span buckets for managers
- layer_analysis: headcount/cost per hierarchy level
- manager_efficiency: managers below span threshold
- cost_by_dimension: cost/FTE by any column
- insight_service: 1:1 managers, thin layers, FTE opportunity

Classify this question and respond with ONLY the JSON object."""

    try:
        result = call_llm_json(
            prompt,
            system_message=_INTENT_SYSTEM,
            max_tokens=400,
            call_type="intent_classification",
        )
        return result if isinstance(result, dict) else {}
    except Exception as e:
        log.warning("Intent classification failed: %s", e)
        return {"route": "sql_agent", "tool_name": "sql_agent", "complexity": "tier2"}


# ---------------------------------------------------------------------------
# SQL generation for sql_agent route
# ---------------------------------------------------------------------------

def _generate_sql(message: str, system_prompt: str) -> str:
    """Ask LLM to generate a DuckDB SQL query for the user's question."""
    prompt = f"""Write a DuckDB SQL query to answer this question about the employees table.

Question: {message}

Rules:
- Output ONLY the raw SQL — no markdown, no explanation, no backticks
- The table name is: employees
- Use the exact column names from the system prompt (double-quote columns with spaces)
- Use Level, Span, Total_Reports, L1, L2 for hierarchy (no quotes needed on these)
- For manager comparisons use a self-join on the manager ID column
- Always include ORDER BY when returning ranked results
- Use LIMIT 50 for detail rows; no LIMIT for summary aggregations"""

    content, _, _ = call_llm(
        prompt,
        system_message=system_prompt,
        max_tokens=800,
        temperature=0.0,
    )
    # Strip any accidental markdown fences
    sql = content.strip()
    if sql.startswith("```"):
        lines = sql.split("\n")
        sql = "\n".join(
            line for line in lines
            if not line.strip().startswith("```")
        ).strip()
    return sql


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

def _fill_template(sql: str, dataset_meta: Dict[str, Any], extra: Dict[str, Any] | None = None) -> str:
    """Fill column name placeholders in a SQL template."""
    replacements = {
        "emp_col": dataset_meta.get("emp_col") or "emp_id",
        "mgr_col": dataset_meta.get("mgr_col") or "mgr_id",
        "fte_col": dataset_meta.get("fte_col") or "FTE",
        "flc_col": dataset_meta.get("flc_col") or "FLC",
        "job_title_col": dataset_meta.get("job_title_col") or "Job Title",
        "country_col": dataset_meta.get("country_col") or "Country",
        "benchmark_span": 6,
        "max_layer": 7,
        "dimension_col": "Country",
    }
    if extra:
        replacements.update(extra)
    for key, val in replacements.items():
        sql = sql.replace("{" + key + "}", str(val))
    return sql


def execute_tool(
    intent: Dict[str, Any],
    user_id: int,
    dataset_meta: Dict[str, Any],
    message: str,
    system_prompt: str,
) -> Dict[str, Any]:
    """Route to the correct tool and return raw results."""
    route = intent.get("route", "sql_agent")
    tool_name = intent.get("tool_name", "sql_agent")

    # ── Named SQL tool ──────────────────────────────────────────────────────
    if route == "named_tool" and tool_name in _TOOLS:
        extra = {}
        if intent.get("benchmark_span"):
            extra["benchmark_span"] = intent["benchmark_span"]
        if intent.get("dimension_col"):
            extra["dimension_col"] = intent["dimension_col"]
        if intent.get("max_layer"):
            extra["max_layer"] = intent["max_layer"]

        sql = _fill_template(_TOOLS[tool_name]["sql"], dataset_meta, extra)
        try:
            result = duckdb_manager.query(user_id, sql)
            return {"source": "named_tool", "tool": tool_name, "sql": sql, **result}
        except Exception as e:
            log.warning("Named tool %s failed, falling back to sql_agent: %s", tool_name, e)
            route = "sql_agent"  # fallback

    # ── Insight service ──────────────────────────────────────────────────────
    if route == "insight_service":
        try:
            # Pull sample data from DuckDB to run the service
            sample = duckdb_manager.query(
                user_id,
                f"SELECT * FROM employees LIMIT 10000",
                max_rows=10000,
            )
            import pandas as pd
            from services.spans_layers_service import get_insights
            df = pd.DataFrame(sample["data"])
            emp_col = dataset_meta.get("emp_col") or "emp_id"
            mgr_col = dataset_meta.get("mgr_col") or "mgr_id"
            fte_col = dataset_meta.get("fte_col")
            insights = get_insights(
                df,
                threshold=intent.get("benchmark_span") or 6,
                emp_col=emp_col,
                mgr_col=mgr_col,
                fte_col=fte_col,
            )
            return {"source": "insight_service", "insights": insights}
        except Exception as e:
            log.warning("Insight service failed, falling back to sql_agent: %s", e)
            route = "sql_agent"

    # ── Simulation (not yet implemented) ────────────────────────────────────
    if route == "simulation":
        return {
            "source": "simulation",
            "data": [],
            "columns": [],
            "row_count": 0,
            "simulation_note": (
                "Full what-if simulation is not yet implemented. "
                "I can tell you the current state and estimate the opportunity."
            ),
        }

    # ── Cannot answer ────────────────────────────────────────────────────────
    if route == "cannot_answer":
        return {
            "source": "cannot_answer",
            "data": [],
            "columns": [],
            "row_count": 0,
            "reason": intent.get("cannot_answer_reason", "This data is not available in the current dataset."),
        }

    # ── SQL agent (custom SQL generation + execute) ─────────────────────────
    try:
        sql = _generate_sql(message, system_prompt)
        result = duckdb_manager.query(user_id, sql)
        return {"source": "sql_agent", "sql": sql, **result}
    except Exception as e:
        log.error("sql_agent failed: %s", e)
        return {
            "source": "sql_agent",
            "data": [],
            "columns": [],
            "row_count": 0,
            "sql_error": str(e),
        }


# ---------------------------------------------------------------------------
# Response formatter
# ---------------------------------------------------------------------------

_FORMAT_SYSTEM = """You are OrgSight AI. Format query results into a clear, insightful business answer.

Rules:
- Open with a direct answer to the question (1–2 sentences)
- Then provide key observations and numbers
- Always add a brief business interpretation ("This means...", "This suggests...")
- Use bullet points for lists of 3+ items
- If data is empty or query failed, explain clearly and suggest what column mapping is needed
- End with one relevant follow-up question the user might want to ask next
- Keep the total response under 300 words unless a detailed table is warranted
- DO NOT repeat the raw SQL or column names in your response"""


def format_response(
    message: str,
    tool_result: Dict[str, Any],
    intent: Dict[str, Any],
    system_prompt: str,
) -> str:
    """LLM call #2 — narrate the tool results in business language."""
    source = tool_result.get("source", "unknown")

    # Handle cannot_answer and simulation upfront
    if source == "cannot_answer":
        return (
            f"I'm unable to answer this question with the current dataset. "
            f"{tool_result.get('reason', '')} "
            f"To enable this analysis, please re-upload the data with the relevant column mapped."
        )
    if source == "simulation":
        note = tool_result.get("simulation_note", "")
        return (
            f"This question requires a full org redesign simulation which is not yet available. {note} "
            f"Would you like me to show you the current state instead — "
            f"for example, which managers have spans furthest from the target?"
        )

    # Build data summary for LLM
    data = tool_result.get("data", [])
    row_count = tool_result.get("row_count", 0)
    sql_error = tool_result.get("sql_error")

    if sql_error:
        return (
            f"I encountered an error retrieving that data: {sql_error}. "
            f"Could you rephrase the question or specify which column you're referring to?"
        )

    # Serialize data compactly (cap at 30 rows for prompt size)
    data_preview = json.dumps(data[:30], default=str, indent=None)
    total_note = f" ({tool_result.get('total_rows', row_count)} total rows, showing {min(row_count, 30)})" if row_count > 30 else ""

    # Insights from insight_service
    if source == "insight_service":
        insights_raw = tool_result.get("insights", {})
        data_preview = json.dumps(insights_raw, default=str, indent=None)

    prompt = f"""User asked: "{message}"

Query returned {row_count} rows{total_note}:
{data_preview}

Answer this question in clear business language based on the data above."""

    try:
        content, _, _ = call_llm(
            prompt,
            system_message=_FORMAT_SYSTEM,
            max_tokens=600,
            temperature=0.3,
        )
        return content
    except Exception as e:
        log.error("Response formatting failed: %s", e)
        # Fallback: return a plain summary
        if data:
            return f"Here are the results ({row_count} rows returned). The top entry: {json.dumps(data[0], default=str)}"
        return "I retrieved the data but encountered an error formatting the response."


# ---------------------------------------------------------------------------
# Suggested follow-up questions
# ---------------------------------------------------------------------------

_FOLLOWUP_INTENTS = {
    "headcount": [
        "What is the total FTE across the org?",
        "How does headcount break down by country?",
        "Which level has the most employees?",
    ],
    "cost": [
        "Which L2 leader has the highest total workforce cost?",
        "What percentage of total cost is in management roles?",
        "How does cost per FTE compare across countries?",
    ],
    "span_control": [
        "How much does it cost to maintain managers with fewer than 4 direct reports?",
        "Which level has the lowest average span of control?",
        "How does our average span compare to the industry benchmark of 6?",
    ],
    "org_structure": [
        "What percentage of employees sit below layer 5?",
        "Which L2 leader has the deepest org beneath them?",
        "How many employees are within 3 layers of the CEO?",
    ],
    "geography": [
        "Which country has the highest cost per FTE?",
        "How does management density vary by country?",
        "What percentage of our workforce is in low-cost locations?",
    ],
    "benchmarking": [
        "Which managers could be removed while maintaining a span of 6?",
        "What would be the estimated savings from removing all 1:1 managers?",
        "Which L2 subtrees have the most excessive layering?",
    ],
    "default": [
        "Show me the top-level org summary.",
        "Which L2 leader has the largest team?",
        "How many managers have fewer than 4 direct reports?",
    ],
}


def _get_followups(intent: Dict[str, Any]) -> List[str]:
    intent_cat = intent.get("intent", "default")
    return _FOLLOWUP_INTENTS.get(intent_cat, _FOLLOWUP_INTENTS["default"])


# ---------------------------------------------------------------------------
# Main agent turn entry point
# ---------------------------------------------------------------------------

def run_agent_turn(
    message: str,
    user_id: int,
    project_id: int,
    dataset_meta: Dict[str, Any],
    schema: Dict[str, Any],
    history: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    Execute a full chatbot turn:
      1. Build system prompt (schema + benchmarks + dataset metadata)
      2. Classify intent → pick route + tool
      3. Execute tool (named SQL / custom SQL / insight service)
      4. Format results into business narrative
      5. Return structured response

    Returns:
      {
        "response":    str — the natural language answer,
        "data":        list — raw query results (for table/chart rendering),
        "columns":     list — column names,
        "row_count":   int,
        "source":      str — which tool was used,
        "sql":         str | None — the SQL executed (for debugging),
        "chart_hint":  str | None — suggested chart type,
        "follow_ups":  list[str] — suggested next questions,
        "intent":      dict — full intent classification result,
      }
    """
    history = history or []

    # Step 1: build system prompt
    system_prompt = build_system_prompt(schema, dataset_meta)

    # Step 2: classify intent
    intent = classify_intent(message, schema, dataset_meta)
    log.info("Intent: %s", json.dumps(intent, default=str))

    # Step 3: execute tool
    tool_result = execute_tool(intent, user_id, dataset_meta, message, system_prompt)

    # Step 4: format response
    response_text = format_response(message, tool_result, intent, system_prompt)

    # Step 5: determine chart hint
    chart_hint = _suggest_chart(intent, tool_result)

    return {
        "response": response_text,
        "data": tool_result.get("data", []),
        "columns": tool_result.get("columns", []),
        "row_count": tool_result.get("row_count", 0),
        "total_rows": tool_result.get("total_rows", tool_result.get("row_count", 0)),
        "truncated": tool_result.get("truncated", False),
        "source": tool_result.get("source", "unknown"),
        "sql": tool_result.get("sql"),
        "chart_hint": chart_hint,
        "follow_ups": _get_followups(intent),
        "intent": intent,
    }


def _suggest_chart(intent: Dict[str, Any], tool_result: Dict[str, Any]) -> Optional[str]:
    """Suggest a chart type based on intent and result shape."""
    tool = intent.get("tool_name", "")
    rows = tool_result.get("row_count", 0)
    if rows == 0:
        return None
    if tool == "l2_breakdown":
        return "bar"
    if tool == "span_distribution":
        return "bar"
    if tool == "layer_analysis":
        return "bar"
    if tool == "cost_by_dimension":
        return "bar" if rows <= 20 else "table"
    if tool == "org_summary":
        return "kpi_cards"
    if tool == "manager_efficiency":
        return "table"
    intent_cat = intent.get("intent", "")
    if intent_cat == "geography":
        return "bar"
    if rows == 1:
        return "kpi_cards"
    if rows <= 15:
        return "bar"
    return "table"
