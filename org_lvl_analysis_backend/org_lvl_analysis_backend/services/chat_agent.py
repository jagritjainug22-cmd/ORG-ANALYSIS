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

import asyncio
import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional

from services import duckdb_manager
from services.llm_service import call_llm, call_llm_json

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Industry benchmark constants (A&M defaults — override per project if needed)
# ---------------------------------------------------------------------------

BENCHMARKS = """## BENCHMARKING

You have access to A&M industry benchmarks via the get_benchmarks tool.

WHEN TO CALL get_benchmarks:
- User asks to "compare against benchmark" or "how do we compare"
- User asks "is this good/bad/normal" about a metric
- User asks about "industry standard" or "best practice"
- User asks about "optimization opportunities" or "efficiency"
- User asks "which functions are over-managed / under-managed"
- User asks about "delayering savings" or "managers to remove"
- User mentions "benchmark" explicitly
- You are analyzing spans, layers, or management ratios and need a reference point

HOW TO USE:
1. First run the data query (run_sql or named tool) to get the computed metric
2. Then call get_benchmarks with the relevant categories
3. Compare the computed value against the benchmark in your response
4. Always state BOTH numbers: "Average span is 3.2, below the industry benchmark of 6"

Available benchmark categories: span, layers, management, delayering, location, functions
Pick only the categories relevant to the question — don't request "all" unless doing a full org review.
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

def _build_column_synonym_hints(dataset_meta: Dict[str, Any], available_cols: set) -> str:
    """
    Generate dynamic column synonym hints from dataset_meta.

    Maps user VOCABULARY → CATEGORY → dataset_meta key → actual column name.
    Only includes hints for columns that are actually present in the dataset.
    """
    CATEGORY_HINTS = {
        "flc_col": ("salary", "pay", "compensation", "cost", "ctc", "wage", "package"),
        "fte_col": ("fte", "headcount"),
        "func_col": ("department", "function", "team", "business unit"),
        "grade_col": ("grade", "band", "seniority", "level"),
        "job_title_col": ("role", "title", "designation", "position", "job"),
        "country_col": ("country", "location", "region", "geography", "office"),
        "division_col": ("division", "entity", "business unit", "unit"),
        "contract_type_col": ("contract type", "employment type", "worker type"),
        "start_date_col": ("start date", "tenure", "hire date", "joining date"),
    }

    lines = []
    for meta_key, user_terms in CATEGORY_HINTS.items():
        actual_col = dataset_meta.get(meta_key)
        terms_str = "/".join(f'"{t}"' for t in user_terms[:4])
        if actual_col and actual_col in available_cols:
            lines.append(f'- When user says {terms_str} → use column: "{actual_col}"')
        else:
            lines.append(f"- When user says {terms_str} → NOT AVAILABLE in this dataset, inform user")

    return "\n".join(lines)


def build_system_prompt(schema: Dict[str, Any], dataset_meta: Dict[str, Any]) -> str:
    """
    Construct the full system prompt injected into every LLM call.

    Design principles:
      - Entirely dynamic: built from live schema + dataset_meta
      - Safe metadata boundary: clearly separates "columns usable in SQL" from
        "availability status for reasoning only"
      - No hardcoded column names — adapts to any dataset shape
    """
    col_lines = []
    available_col_names = set()
    for col in schema.get("columns", []):
        samples = ", ".join(str(v) for v in col.get("sample_values", [])[:4])
        unique = col.get("unique_count", "?")
        col_lines.append(
            f'  "{col["name"]}"  {col["type"]}  ({unique} distinct)  samples: {samples}'
        )
        available_col_names.add(col["name"])

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

    # Build column mapping — only show columns that actually exist
    mapping_lines = []
    mapping_lines.append(f'Employee ID column:    "{emp_col}"')
    mapping_lines.append(f'Manager ID column:     "{mgr_col}"')
    if fte_col:
        mapping_lines.append(f'FTE column:            "{fte_col}"')
    if flc_col:
        mapping_lines.append(f'Fully Loaded Cost col: "{flc_col}"')
    if job_title_col:
        mapping_lines.append(f'Job Title column:      "{job_title_col}"')
    if country_col:
        mapping_lines.append(f'Country column:        "{country_col}"')
    if func_col:
        mapping_lines.append(f'Function column:       "{func_col}"')
    if grade_col:
        mapping_lines.append(f'Grade column:          "{grade_col}"')
    if contract_type_col:
        mapping_lines.append(f'Contract Type column:  "{contract_type_col}"')
    if start_date_col:
        mapping_lines.append(f'Start Date column:     "{start_date_col}"')

    # Build unavailable dimensions (for reasoning ONLY — never use in SQL)
    unavailable = []
    if not func_col:
        unavailable.append("Function/Department — not uploaded in this dataset")
    if not grade_col:
        unavailable.append("Grade/Band — not uploaded in this dataset")
    if not contract_type_col:
        unavailable.append("Contract Type — not uploaded in this dataset")
    if not start_date_col:
        unavailable.append("Start Date / Tenure — not uploaded in this dataset")

    unavailable_block = ""
    if unavailable:
        unavailable_block = (
            "\n## UNAVAILABLE DIMENSIONS (for reasoning ONLY — NEVER reference these in SQL)\n"
            "When a user asks about these, explain politely that the column was not included at upload.\n"
            + "\n".join(f"  - {u}" for u in unavailable)
        )

    # Dynamic column synonym hints
    synonym_hints = _build_column_synonym_hints(dataset_meta, available_col_names)

    # Self-join example — only if we have cost column
    join_example = ""
    if flc_col:
        join_example = f"""6. Self-join pattern to compare manager vs subordinate:
   SELECT e.*, m."{flc_col}" AS mgr_cost
   FROM employees e JOIN employees m ON e."{mgr_col}" = m."{emp_col}" """

    return f"""You are OrgSight AI, an expert organisational analyst embedded in the OrgSight platform.
You answer questions about the organisation's workforce data with precision, insight, and commercial awareness.

## ACTIVE DATASET
Table name: employees
Total rows: {schema.get("row_count", "unknown")}
Dataset: {dataset_meta.get("name", "unknown")}

## COLUMNS YOU CAN USE IN SQL (ONLY these exist — never reference anything else)
{chr(10).join(mapping_lines)}

## ALL COLUMNS IN employees TABLE (with types and sample values)
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

## COLUMN SYNONYM AWARENESS
Users may refer to columns using common business terms. Use these mappings:
{synonym_hints}
{unavailable_block}

## QUERY RULES (CRITICAL — MUST FOLLOW)
1. Always double-quote column names that contain spaces or special chars: "Fully loaded cost", "Line Manager ID"
2. Single-word computed columns do NOT need quoting: Level, Span, Total_Reports, L1, L2
3. NEVER reference a column that does not appear in the table above — if it's listed as UNAVAILABLE, explain to user
4. Managers  = WHERE Span > 0
5. Individual contributors (ICs) = WHERE Span = 0
{join_example}7. For L2 subtree analysis: GROUP BY L2
8. Never expose internal IDs or raw JSON in responses
9. Do NOT end SQL with a semicolon

{BENCHMARKS}

## RESPONSE STYLE
- Be concise but insightful — always add a business interpretation, not just numbers
- When data shows an outlier, flag it and explain the implication
- Always show units (£, $, %, headcount)
- If a question cannot be answered due to missing columns, say which column is needed and that it wasn't mapped at upload
- Suggest a follow-up question when relevant
"""


# ---------------------------------------------------------------------------
# Conversation history helpers
# ---------------------------------------------------------------------------

MAX_HISTORY_TURNS = 5  # last 5 user/assistant exchange pairs

def _build_history_block(history: List[Dict[str, Any]]) -> str:
    """Build a compact text block from the last N conversation turns.

    Each history entry should have:
      role: "user" | "assistant"
      content: the message text
      sql (optional): the SQL that was generated (assistant only)
      data_summary (optional): compact result shape (assistant only)
    """
    if not history:
        return ""

    recent = history[-(MAX_HISTORY_TURNS * 2):]
    lines = []
    for entry in recent:
        role = entry.get("role", "user").upper()
        content = entry.get("content", "")
        sql = entry.get("sql")
        data_summary = entry.get("data_summary")

        lines.append(f"{role}: {content}")
        if sql:
            lines.append(f"  [SQL executed: {sql}]")
        if data_summary:
            lines.append(f"  [Result: {data_summary}]")

    return "\n".join(lines)


def _build_history_messages(history: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Convert history entries into OpenAI-style message dicts for the messages array.

    Returns a list of {role, content} dicts ready to insert between system
    and the current user message.
    """
    if not history:
        return []

    recent = history[-(MAX_HISTORY_TURNS * 2):]
    msgs = []
    for entry in recent:
        role = entry.get("role", "user")
        content = entry.get("content", "")
        sql = entry.get("sql")
        data_summary = entry.get("data_summary")

        if role == "assistant":
            parts = [content]
            if sql:
                parts.append(f"\n[SQL: {sql}]")
            if data_summary:
                parts.append(f"\n[Result: {data_summary}]")
            msgs.append({"role": "assistant", "content": "".join(parts)})
        else:
            msgs.append({"role": "user", "content": content})

    return msgs


# ---------------------------------------------------------------------------
# Pre-classifier intent registry (pattern-based, no LLM call needed)
# ---------------------------------------------------------------------------

_NAVIGATION_PATTERNS = ["take me to", "go to", "open", "navigate to", "switch to",
                        "show me the view", "show me the page", "bring up", "jump to", "head to"]

_NAVIGATION_TARGETS = {
    "hierarchy": ["hierarchy", "hierarchy table", "org table", "levels table"],
    "spans_layers": ["spans", "layers", "spans and layers", "span analysis", "spans & layers",
                     "span & layer", "spans layers"],
    "crosstab": ["crosstab", "pivot", "cross tab", "pivot table"],
    "org_chart": ["org chart", "org tree", "organization chart", "tree view", "chart view"],
    "scenarios": ["scenarios", "scenario list", "compare scenarios"],
    "activity": ["activity", "activity analysis", "fte analysis"],
    "upload": ["upload", "upload data", "prepare", "data prep"],
}

_GREETING_PATTERNS = ["hello", "hi", "hey", "good morning", "good afternoon", "good evening",
                      "howdy", "hola", "namaste"]

_CAPABILITIES_PATTERNS = ["what can you do", "what do you do", "help", "what can i ask",
                          "what kind of questions", "how can you help", "capabilities",
                          "what are you", "who are you", "what questions can i ask"]


def _build_capabilities_response(dataset_meta: Dict[str, Any]) -> str:
    """Generate capabilities text based on what's actually available in this dataset."""
    available = [
        "**Org overview** — headcount, cost, FTE, management ratios",
        "**Span analysis** — span of control distribution, benchmarking against industry standards",
        "**Layer analysis** — cost and headcount at each hierarchy level",
        "**Manager efficiency** — identify managers with narrow spans, delayering opportunities",
        "**Employee lookups** — find specific people, filter by any criteria",
        "**Structural risks** — 1:1 chains, thin layers, below-benchmark spans",
        "**Benchmarking** — compare your org metrics against A&M industry benchmarks",
        "**Navigation** — 'take me to org chart', 'open spans & layers'",
    ]
    if dataset_meta.get("country_col"):
        available.append(f"**Geographic breakdown** — cost/headcount by {dataset_meta['country_col']}")
    if dataset_meta.get("func_col"):
        available.append(f"**Functional breakdown** — analysis by {dataset_meta['func_col']}")
    if dataset_meta.get("grade_col"):
        available.append(f"**Grade/Band analysis** — distribution by {dataset_meta['grade_col']}")

    items = "\n".join(f"- {a}" for a in available)
    return (
        f"I can help you explore your org data. Here's what I can do:\n\n"
        f"{items}\n\n"
        f"Try asking: 'Give me an org summary' or 'Which managers have fewer than 4 reports?'"
    )


def _pre_classify(message: str, dataset_meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Fast pattern-based pre-classification that bypasses the LLM for known intents.

    Returns an intent dict if matched, or None to fall through to LLM classification.
    New intents can be added here as data entries without touching execution logic.
    """
    msg_lower = message.lower().strip()

    # Navigation — check if message contains a navigation pattern + target
    if any(pattern in msg_lower for pattern in _NAVIGATION_PATTERNS):
        for target_key, keywords in _NAVIGATION_TARGETS.items():
            if any(kw in msg_lower for kw in keywords):
                return {
                    "route": "navigate",
                    "tool_name": "none",
                    "intent": "navigation",
                    "complexity": "tier1",
                    "navigation_target": target_key,
                    "missing_columns_needed": [],
                    "cannot_answer_reason": None,
                }

    # Capabilities / meta questions
    if any(pattern in msg_lower for pattern in _CAPABILITIES_PATTERNS):
        return {
            "route": "capabilities",
            "tool_name": "none",
            "intent": "capabilities",
            "complexity": "tier1",
            "missing_columns_needed": [],
            "cannot_answer_reason": None,
            "_static_response": _build_capabilities_response(dataset_meta),
        }

    # Greetings
    # Only match if the ENTIRE message (stripped of punctuation) is a greeting
    msg_stripped = msg_lower.rstrip("!?.,'\"")
    if msg_stripped in _GREETING_PATTERNS or msg_stripped in [f"{g} there" for g in _GREETING_PATTERNS]:
        caps = _build_capabilities_response(dataset_meta)
        return {
            "route": "greeting",
            "tool_name": "none",
            "intent": "greeting",
            "complexity": "tier1",
            "missing_columns_needed": [],
            "cannot_answer_reason": None,
            "_static_response": (
                f"Hello! I'm OrgSight AI — your org analytics assistant.\n\n{caps}"
            ),
        }

    return None


# ---------------------------------------------------------------------------
# Intent classification (LLM-based — only reached if pre-classifier doesn't match)
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


def classify_intent(
    message: str,
    schema: Dict[str, Any],
    dataset_meta: Dict[str, Any],
    history: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """LLM call #1 — classify intent and pick the right route + tool.

    First attempts pattern-based pre-classification (no LLM call).
    Falls through to LLM only if pre-classifier doesn't match.
    Conversation history is included so the classifier can resolve
    pronouns and follow-up references (e.g. "break that down by grade").
    """
    # Pre-classifier: fast pattern match for navigation, capabilities, greetings
    pre_result = _pre_classify(message, dataset_meta)
    if pre_result is not None:
        return pre_result

    col_names = [c["name"] for c in schema.get("columns", [])]
    col_summary = ", ".join(f'"{n}"' for n in col_names[:30])

    history_block = _build_history_block(history or [])
    history_section = ""
    if history_block:
        history_section = f"""## CONVERSATION HISTORY (last {MAX_HISTORY_TURNS} turns)
{history_block}

"""

    prompt = f"""{history_section}Current user question: "{message}"

Available columns in employees table: {col_summary}
Dataset emp_col="{dataset_meta.get('emp_col')}", mgr_col="{dataset_meta.get('mgr_col')}", fte_col="{dataset_meta.get('fte_col')}", flc_col="{dataset_meta.get('flc_col')}"
func_col: {dataset_meta.get('func_col') or '[UNAVAILABLE in this dataset]'}
grade_col: {dataset_meta.get('grade_col') or '[UNAVAILABLE in this dataset]'}
contract_type_col: {dataset_meta.get('contract_type_col') or '[UNAVAILABLE in this dataset]'}

Named tools available:
- org_summary: top-level KPIs
- l2_breakdown: per L2 leader breakdown
- span_distribution: span buckets for managers
- layer_analysis: headcount/cost per hierarchy level
- manager_efficiency: managers below span threshold
- cost_by_dimension: cost/FTE by any column
- insight_service: 1:1 managers, thin layers, FTE opportunity

Classify this question and respond with ONLY the JSON object.
If this is a follow-up question referencing prior context, resolve the reference
and classify the RESOLVED intent (e.g. "break that down by grade" → cost_by_dimension with dimension_col="Grade")."""

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


def validate_intent(intent: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enforce inter-stage contracts on classifier output.

    Ensures consistency between fields — prevents contradictions like
    missing_columns_needed being populated while route is sql_agent.
    This is purely logic-based, dataset-agnostic, and never calls an LLM.
    """
    missing = intent.get("missing_columns_needed", [])
    route = intent.get("route", "sql_agent")

    # Rule 1: If essential columns are missing AND route would generate SQL, block it
    if missing and route in ("sql_agent", "llm_reasoning"):
        intent["route"] = "cannot_answer"
        intent["cannot_answer_reason"] = intent.get("cannot_answer_reason") or (
            f"This question requires data that isn't available in this dataset: "
            f"{', '.join(missing)}. "
            f"To enable this analysis, please re-upload the data with the relevant column mapped."
        )

    # Rule 2: If route is cannot_answer, ensure reason is populated
    if intent.get("route") == "cannot_answer" and not intent.get("cannot_answer_reason"):
        intent["cannot_answer_reason"] = "This question cannot be answered with the available data."

    # Rule 3: If tool_name references a tool that doesn't exist, fall back to sql_agent
    if intent.get("route") == "named_tool" and intent.get("tool_name") not in _TOOLS:
        intent["route"] = "sql_agent"
        intent["tool_name"] = "sql_agent"

    return intent


# ---------------------------------------------------------------------------
# SQL generation for sql_agent route
# ---------------------------------------------------------------------------

def _generate_sql(
    message: str,
    system_prompt: str,
    history: List[Dict[str, Any]] | None = None,
) -> str:
    """Ask LLM to generate a DuckDB SQL query for the user's question.

    Conversation history is included so the model can write follow-up SQL
    that references prior queries (e.g. "now filter that by Germany").
    """
    user_prompt = f"""Write a DuckDB SQL query to answer this question about the employees table.

Question: {message}

Rules:
- Output ONLY the raw SQL — no markdown, no explanation, no backticks
- The table name is: employees
- Use the exact column names from the system prompt (double-quote columns with spaces)
- Use Level, Span, Total_Reports, L1, L2 for hierarchy (no quotes needed on these)
- For manager comparisons use a self-join on the manager ID column
- Always include ORDER BY when returning ranked results
- Use LIMIT 50 for detail rows; no LIMIT for summary aggregations
- If this is a follow-up question, use the conversation history to understand what the user is referring to and build on the previous SQL logic"""

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(_build_history_messages(history or []))
    messages.append({"role": "user", "content": user_prompt})

    content, _, _ = call_llm(
        messages=messages,
        max_tokens=800,
        temperature=0.0,
    )
    sql = content.strip()
    if sql.startswith("```"):
        lines = sql.split("\n")
        sql = "\n".join(
            line for line in lines
            if not line.strip().startswith("```")
        ).strip()
    sql = sql.rstrip(";").strip()
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
    resolved_columns: Dict[str, str] | None = None,
    history: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """Route to the correct tool and return raw results."""
    route = intent.get("route", "sql_agent")
    tool_name = intent.get("tool_name", "sql_agent")
    resolved_columns = resolved_columns or {}

    # ── Pre-classified intents (no SQL needed) ───────────────────────────────
    if route in ("navigate", "capabilities", "greeting"):
        return {
            "source": route,
            "data": [],
            "columns": [],
            "row_count": 0,
            "navigation_target": intent.get("navigation_target"),
            "_static_response": intent.get("_static_response", ""),
        }

    # ── Benchmark Tool ───────────────────────────────────────────────────────
    if tool_name == "get_benchmarks":
        from services.benchmark_constants import execute_get_benchmarks
        categories = intent.get("categories") or ["all"]
        text_result, _ = execute_get_benchmarks({"categories": categories})
        return {
            "source": "get_benchmarks",
            "data": [],
            "columns": [],
            "row_count": 0,
            "_static_response": text_result,
        }

    # ── Named SQL tool ──────────────────────────────────────────────────────
    if route == "named_tool" and tool_name in _TOOLS:
        from services.column_resolver import resolve_column

        extra = {}
        if intent.get("benchmark_span"):
            extra["benchmark_span"] = intent["benchmark_span"]
        if intent.get("max_layer"):
            extra["max_layer"] = intent["max_layer"]

        # Resolve dimension_col through the semantic layer
        if intent.get("dimension_col"):
            dim_col = intent["dimension_col"]

            # If user already clarified this column, use their choice directly
            if dim_col.lower() in {k.lower() for k in resolved_columns}:
                matched_key = next(k for k in resolved_columns if k.lower() == dim_col.lower())
                extra["dimension_col"] = resolved_columns[matched_key]
            else:
                schema_info = duckdb_manager.get_schema(user_id)
                known_cols = {c["name"] for c in schema_info["columns"]} if schema_info else set()
                schema_samples = {
                    c["name"]: c.get("sample_values", [])
                    for c in (schema_info or {}).get("columns", [])
                }

                resolution = resolve_column(
                    dim_col, known_cols, dataset_meta, schema_samples
                )

                if resolution["status"] in ("exact", "resolved"):
                    extra["dimension_col"] = resolution["column"]
                elif resolution["status"] == "ambiguous":
                    return {
                        "source": "clarification_needed",
                        "clarification_type": "column_disambiguation",
                        "message": resolution["suggestion"],
                        "options": resolution["candidates"],
                        "original_query": message,
                        "data": [], "columns": [], "row_count": 0,
                    }
                else:
                    return {
                        "source": "cannot_answer",
                        "data": [], "columns": [], "row_count": 0,
                        "reason": resolution["suggestion"],
                    }

        sql = _fill_template(_TOOLS[tool_name]["sql"], dataset_meta, extra)
        try:
            result = duckdb_manager.query(user_id, sql)
            return {"source": "named_tool", "tool": tool_name, "sql": sql, **result}
        except Exception as e:
            log.warning(
                "Named tool %s failed (sql=%s...), falling back to sql_agent: %s",
                tool_name, sql[:200], e,
            )
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
        from services.column_resolver import validate_and_correct_columns

        sql = _generate_sql(message, system_prompt, history=history)

        # Validate and auto-correct column references in generated SQL
        schema_info = duckdb_manager.get_schema(user_id)
        known_cols = {c["name"] for c in schema_info["columns"]} if schema_info else set()
        schema_samples = {
            c["name"]: c.get("sample_values", [])
            for c in (schema_info or {}).get("columns", [])
        }

        corrected_sql, col_error = validate_and_correct_columns(
            sql, known_cols, dataset_meta, schema_samples
        )
        if col_error:
            return {
                "source": "cannot_answer",
                "data": [], "columns": [], "row_count": 0,
                "reason": col_error,
            }

        result = duckdb_manager.query(user_id, corrected_sql)
        return {"source": "sql_agent", "sql": corrected_sql, **result}
    except Exception as first_err:
        log.warning("sql_agent first attempt failed: %s", first_err)
        # One-shot retry: send the error back to the LLM so it can self-correct
        try:
            from services.column_resolver import validate_and_correct_columns as _vac
            retry_message = (
                f"{message}\n\n"
                f"[RETRY: The previous SQL failed with the error below. "
                f"Fix the query and try again. Do NOT repeat the same mistake.]\n"
                f"Error: {first_err}"
            )
            retry_sql = _generate_sql(retry_message, system_prompt, history=history)
            retry_schema_info = duckdb_manager.get_schema(user_id)
            retry_known_cols = {c["name"] for c in retry_schema_info["columns"]} if retry_schema_info else set()
            retry_samples = {
                c["name"]: c.get("sample_values", [])
                for c in (retry_schema_info or {}).get("columns", [])
            }
            corrected_retry, retry_col_error = _vac(retry_sql, retry_known_cols, dataset_meta, retry_samples)
            if not retry_col_error:
                retry_result = duckdb_manager.query(user_id, corrected_retry)
                log.info("sql_agent retry succeeded")
                return {"source": "sql_agent", "sql": corrected_retry, "retried": True, **retry_result}
        except Exception as retry_err:
            log.error("sql_agent retry also failed: %s", retry_err)

        return {
            "source": "sql_agent",
            "data": [],
            "columns": [],
            "row_count": 0,
            "sql_error": str(first_err),
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
    history: List[Dict[str, Any]] | None = None,
) -> str:
    """LLM call #2 — narrate the tool results in business language.

    Conversation history is included so the narrator can reference prior
    context and maintain a coherent conversational tone across turns.
    """
    source = tool_result.get("source", "unknown")

    # Handle pre-classified intents (no LLM needed)
    if source in ("navigate", "capabilities", "greeting"):
        return tool_result.get("_static_response", "")

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
        log.warning("SQL error (hidden from user): %s", sql_error)
        return (
            "I wasn't able to retrieve that data. This might be due to a column "
            "type mismatch or an unsupported query pattern. Could you try rephrasing "
            "your question, or ask it in a different way?"
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

Answer this question in clear business language based on the data above.
If this is a follow-up question, connect your answer to the prior conversation context."""

    messages = [
        {"role": "system", "content": _FORMAT_SYSTEM + "\n\n" + BENCHMARKS},
    ]
    messages.extend(_build_history_messages(history or []))
    messages.append({"role": "user", "content": prompt})

    from services.benchmark_constants import BENCHMARK_TOOL

    try:
        # Loop for tool call resolution (max 4 iterations)
        for iteration in range(4):
            response_msg, usage_dict, latency_ms = call_llm(
                messages=messages,
                tools=[BENCHMARK_TOOL],
                tool_choice="auto",
                max_tokens=600,
                temperature=0.3,
            )

            # If response_msg is a string (meaning no tool calls were generated)
            if isinstance(response_msg, str):
                return response_msg

            tool_calls = getattr(response_msg, "tool_calls", None)
            if not tool_calls:
                content = getattr(response_msg, "content", "")
                return content.strip() if content else ""

            # Append the assistant's message (with tool calls) to messages history
            messages.append(response_msg)

            # Execute the tool calls
            for tool_call in tool_calls:
                if tool_call.function.name == "get_benchmarks":
                    try:
                        args = json.loads(tool_call.function.arguments)
                    except Exception:
                        args = {}

                    from services.benchmark_constants import execute_get_benchmarks
                    text_result, _ = execute_get_benchmarks(args)

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_call.function.name,
                        "content": text_result,
                    })

        # Fallback if loop ends without returning
        return getattr(response_msg, "content", "") if not isinstance(response_msg, str) else response_msg

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
    resolved_columns: Dict[str, str] | None = None,
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
    import time as _time
    history = history or []
    _t0 = _time.monotonic()

    # Step 1: build system prompt
    system_prompt = build_system_prompt(schema, dataset_meta)

    # Step 2: classify intent + validate contracts
    intent = classify_intent(message, schema, dataset_meta, history=history)
    intent = validate_intent(intent)
    log.info("Intent: %s", json.dumps(intent, default=str))

    # Step 3: execute tool
    tool_result = execute_tool(
        intent, user_id, dataset_meta, message, system_prompt,
        resolved_columns, history=history,
    )

    # Step 4: format response
    response_text = format_response(
        message, tool_result, intent, system_prompt, history=history,
    )

    # Step 5: determine chart hint
    chart_hint = _suggest_chart(intent, tool_result)

    elapsed_ms = int((_time.monotonic() - _t0) * 1000)

    try:
        from services.logging_service import log_chat_query
        log_chat_query(
            user_id=user_id,
            project_id=project_id,
            message=message,
            intent=intent,
            tool_result=tool_result,
            response_text=response_text,
            elapsed_ms=elapsed_ms,
        )
    except Exception as log_err:
        log.error("Failed to log chat query details: %s", log_err, exc_info=True)

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
        "elapsed_ms": elapsed_ms,
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


# ---------------------------------------------------------------------------
# Streaming agent turn entry point
# ---------------------------------------------------------------------------

async def run_agent_turn_stream(
    message: str,
    user_id: int,
    project_id: int,
    dataset_meta: Dict[str, Any],
    schema: Dict[str, Any],
    history: List[Dict[str, Any]] | None = None,
    resolved_columns: Dict[str, str] | None = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Async generator version of run_agent_turn.

    Yields typed SSE event dicts:
      {"type": "status", "data": {"phase": str, "message": str}}
      {"type": "token",  "data": {"text": str}}
      {"type": "done",   "data": { ...full structured payload... }}
      {"type": "error",  "data": {"message": str}}

    The full agent pipeline runs in three phases:
      1. classify_intent()  — fast LLM call (offloaded to thread)
      2. execute_tool()     — SQL / insight execution (offloaded to thread)
      3. LLM narration      — streamed token-by-token via call_llm_stream()
    """
    from services.llm_service import call_llm_stream

    import time as _time
    history = history or []
    _t0 = _time.monotonic()

    try:
        # ── Phase 1: Intent classification ──────────────────────────────────
        yield {"type": "status", "data": {"phase": "intent", "message": "Classifying your question..."}}

        system_prompt = build_system_prompt(schema, dataset_meta)

        intent = await asyncio.to_thread(
            classify_intent, message, schema, dataset_meta, history
        )
        intent = validate_intent(intent)
        log.info("Stream intent: %s", json.dumps(intent, default=str))

        # ── Phase 2: Tool / SQL execution ────────────────────────────────────
        yield {"type": "status", "data": {"phase": "query", "message": "Running analysis query..."}}

        tool_result = await asyncio.to_thread(
            execute_tool, intent, user_id, dataset_meta, message, system_prompt,
            resolved_columns, history,
        )

        # ── Phase 3: Stream LLM narration ────────────────────────────────────
        yield {"type": "status", "data": {"phase": "formatting", "message": "Writing response..."}}

        source = tool_result.get("source", "unknown")
        sql_error = tool_result.get("sql_error")

        # Handle non-LLM paths inline
        response_text_for_log = ""

        if source in ("navigate", "capabilities", "greeting"):
            static_text = tool_result.get("_static_response", "")
            yield {"type": "token", "data": {"text": static_text}}
            response_text_for_log = static_text

        elif source == "cannot_answer":
            reason = tool_result.get("reason", "")
            static_text = (
                f"I'm unable to answer this question with the current dataset. "
                f"{reason} "
                f"To enable this analysis, please re-upload the data with the relevant column mapped."
            )
            yield {"type": "token", "data": {"text": static_text}}
            response_text_for_log = static_text

        elif source == "clarification_needed":
            clarification_msg = tool_result.get("message", "Could you clarify which column you mean?")
            yield {"type": "token", "data": {"text": clarification_msg}}
            response_text_for_log = clarification_msg

        elif source == "simulation":
            note = tool_result.get("simulation_note", "")
            static_text = (
                f"This question requires a full org redesign simulation which is not yet available. {note} "
                f"Would you like me to show you the current state instead — "
                f"for example, which managers have spans furthest from the target?"
            )
            yield {"type": "token", "data": {"text": static_text}}
            response_text_for_log = static_text

        elif sql_error:
            log.warning("SQL error in stream (hidden from user): %s", sql_error)
            static_text = (
                "I wasn't able to retrieve that data. This might be due to a column "
                "type mismatch or an unsupported query pattern. Could you try rephrasing "
                "your question, or ask it in a different way?"
            )
            yield {"type": "token", "data": {"text": static_text}}
            response_text_for_log = static_text

        else:
            # Build the LLM prompt (same logic as format_response())
            data = tool_result.get("data", [])
            row_count = tool_result.get("row_count", 0)
            data_preview = json.dumps(data[:30], default=str, indent=None)
            total_note = (
                f" ({tool_result.get('total_rows', row_count)} total rows, showing {min(row_count, 30)})"
                if row_count > 30 else ""
            )
            if source == "insight_service":
                data_preview = json.dumps(tool_result.get("insights", {}), default=str, indent=None)

            format_prompt = f"""User asked: "{message}"

Query returned {row_count} rows{total_note}:
{data_preview}

Answer this question in clear business language based on the data above.
If this is a follow-up question, connect your answer to the prior conversation context."""

            messages = [
                {"role": "system", "content": _FORMAT_SYSTEM + "\n\n" + BENCHMARKS},
            ]
            messages.extend(_build_history_messages(history))
            messages.append({"role": "user", "content": format_prompt})

            from services.benchmark_constants import BENCHMARK_TOOL

            has_tool_called = False
            for iteration in range(4):
                response_msg, usage_dict, latency_ms = await asyncio.to_thread(
                    call_llm,
                    messages=messages,
                    tools=[BENCHMARK_TOOL],
                    tool_choice="auto",
                    max_tokens=600,
                    temperature=0.3,
                )

                # Check if response_msg is a string (meaning no tool calls were generated)
                if isinstance(response_msg, str):
                    yield {"type": "token", "data": {"text": response_msg}}
                    response_text_for_log = response_msg
                    break

                tool_calls = getattr(response_msg, "tool_calls", None)
                if not tool_calls:
                    content = getattr(response_msg, "content", "")
                    yield {"type": "token", "data": {"text": content}}
                    response_text_for_log = content
                    break

                # If there are tool calls, append and execute them
                has_tool_called = True
                messages.append(response_msg)

                for tool_call in tool_calls:
                    if tool_call.function.name == "get_benchmarks":
                        try:
                            args = json.loads(tool_call.function.arguments)
                        except Exception:
                            args = {}

                        from services.benchmark_constants import execute_get_benchmarks
                        text_result, _ = execute_get_benchmarks(args)

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": tool_call.function.name,
                            "content": text_result,
                        })

                # Break after handling tool calls so we stream the subsequent final completion
                break

            if has_tool_called:
                # Stream the final turn chunk-by-chunk
                full_text = ""
                async for token in call_llm_stream(
                    messages=messages,
                    max_tokens=600,
                    temperature=0.3,
                ):
                    full_text += token
                    yield {"type": "token", "data": {"text": token}}
                response_text_for_log = full_text

        # ── Logging ──────────────────────────────────────────────────────────
        try:
            from services.logging_service import log_chat_query
            log_chat_query(
                user_id=user_id,
                project_id=project_id,
                message=message,
                intent=intent,
                tool_result=tool_result,
                response_text=response_text_for_log,
                elapsed_ms=int((_time.monotonic() - _t0) * 1000),
            )
        except Exception as log_err:
            log.error("Failed to log chat query (stream): %s", log_err)

        # ── Done event: structured metadata ──────────────────────────────────
        chart_hint = _suggest_chart(intent, tool_result)
        done_data = {
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
        # Include navigation target for frontend routing
        if source == "navigate":
            done_data["navigation_target"] = tool_result.get("navigation_target")
        # Include clarification options for frontend disambiguation UI
        if source == "clarification_needed":
            done_data["clarification_type"] = tool_result.get("clarification_type")
            done_data["options"] = tool_result.get("options", [])
            done_data["original_query"] = tool_result.get("original_query")

        yield {
            "type": "done",
            "data": done_data,
        }

    except Exception as exc:
        log.error("run_agent_turn_stream error: %s", exc, exc_info=True)
        yield {"type": "error", "data": {"message": str(exc)}}
