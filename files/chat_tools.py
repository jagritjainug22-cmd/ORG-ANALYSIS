"""
Tool definitions, executors, and SQL validation for Ask OrgSight.

10 tools:
  1. run_sql           — LLM-generated SQL (Tier 1-2 escape hatch)
  2. org_summary       — pre-built: top-level KPIs
  3. l2_breakdown      — pre-built: per L2 leader table
  4. span_distribution — pre-built: span bucket analysis
  5. layer_analysis    — pre-built: cost/HC at each level
  6. manager_efficiency— pre-built: delayering opportunity
  7. cost_by_dimension — pre-built: cost/HC by any column
  8. get_insights      — calls spans_layers_service (pre-computed analytics)
  9. show_chart        — (REMOVED — display handled in response format)
  10. navigate         — switch workspace tab

Each tool has:
  - DEFINITION: JSON schema sent to Azure OpenAI
  - EXECUTOR: Python function that runs when called
"""

import json
import re
import logging

logger = logging.getLogger(__name__)

MAX_SQL_ROWS = 500


# =============================================================================
# SQL VALIDATION
# =============================================================================

def validate_sql(sql: str, known_columns: set[str]) -> str | None:
    """
    Pre-execution SQL validation. Returns error message if invalid, None if OK.
    
    Catches:
    - Write operations (INSERT, DROP, etc.)
    - Multiple statements (SQL injection)
    - Hallucinated column names (most common LLM failure)
    """
    sql_stripped = sql.strip()
    sql_upper = sql_stripped.upper()

    # Block writes
    write_keywords = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "COPY"]
    for kw in write_keywords:
        if sql_upper.startswith(kw):
            return f"Write operations are not allowed. Blocked keyword: {kw}"

    # Block multiple statements
    # Remove semicolons at the very end, then check for remaining ones
    cleaned = sql_stripped.rstrip(";")
    if ";" in cleaned:
        return "Multiple SQL statements are not allowed. Send one query at a time."

    # Validate quoted column names against known schema
    # DuckDB uses double quotes for identifiers: "Job Title", "Fully loaded cost"
    quoted_refs = re.findall(r'"([^"]+)"', sql)

    # Filter out string literals (inside single quotes) to avoid false positives
    # Simple heuristic: if the quoted text also appears inside single quotes, skip it
    invalid_cols = []
    for ref in quoted_refs:
        # Skip if it looks like a table name or alias (lowercase, no spaces)
        if ref == "employees":
            continue
        # Check against known columns
        if ref not in known_columns:
            # Check case-insensitive match and suggest correction
            match = next((c for c in known_columns if c.lower() == ref.lower()), None)
            if match:
                invalid_cols.append(f'"{ref}" → did you mean "{match}"?')
            else:
                invalid_cols.append(f'"{ref}"')

    if invalid_cols:
        available = ", ".join(f'"{c}"' for c in sorted(known_columns))
        return (
            f"Unknown column(s): {', '.join(invalid_cols)}\n"
            f"Available columns: {available}"
        )

    return None  # Valid


def _enrich_error(error_msg: str, known_columns: set[str]) -> str:
    """Add helpful hints to DuckDB error messages for better LLM self-correction."""
    msg = str(error_msg)
    hint = ""

    if "not found" in msg.lower() and "column" in msg.lower():
        available = ", ".join(f'"{c}"' for c in sorted(known_columns))
        hint = f"\nAvailable columns: {available}"
        hint += '\nRemember: column names with spaces or capitals must be double-quoted.'

    elif "syntax error" in msg.lower():
        hint = (
            "\nDuckDB uses PostgreSQL-like syntax. Common gotchas:"
            "\n  - FILTER clause: COUNT(*) FILTER (WHERE condition)"
            "\n  - String matching: ILIKE '%value%'"
            "\n  - GROUP BY must include all non-aggregated columns"
        )

    elif "conversion" in msg.lower() or "cast" in msg.lower() or "type" in msg.lower():
        hint = "\nCheck column types — you may need CAST() or TRY_CAST(), or handle NULLs with COALESCE()."

    elif "division by zero" in msg.lower():
        hint = "\nUse NULLIF(denominator, 0) to avoid division by zero."

    return f"SQL ERROR: {msg}{hint}\nFix the query and try again."


def _format_result_text(result: dict) -> str:
    """Format query result as readable text for the LLM to summarize."""
    columns = result.get("columns", [])
    rows = result.get("data", [])
    total = result.get("total_rows", len(rows))
    truncated = result.get("truncated", False)

    if not rows:
        return "Query returned 0 rows. Check your filters — the value may not exist in this dataset."

    lines = [" | ".join(str(c) for c in columns)]
    lines.append("-" * min(len(lines[0]), 120))

    for row in rows[:MAX_SQL_ROWS]:
        lines.append(" | ".join(str(v) if v is not None else "NULL" for v in row))

    summary = f"Query returned {total} rows"
    if truncated or total > MAX_SQL_ROWS:
        summary += f" (showing first {min(len(rows), MAX_SQL_ROWS)})"

    return summary + "\n\n" + "\n".join(lines)


# =============================================================================
# NAMED QUERY TEMPLATES
# =============================================================================

# These use {placeholders} filled at runtime from dataset metadata.
# The executor fills them before running against DuckDB.

NAMED_QUERIES = {
    "org_summary": """
        SELECT
            COUNT(*) AS total_headcount,
            ROUND(SUM("{fte_col}"), 2) AS total_fte,
            ROUND(SUM("{flc_col}"), 0) AS total_cost,
            ROUND(AVG("{flc_col}"), 0) AS avg_cost_per_head,
            ROUND(AVG(CASE WHEN "Span" > 0 THEN "Span" END), 2) AS avg_mgr_span,
            MAX("Level") AS max_depth,
            COUNT(*) FILTER (WHERE "Span" > 0) AS manager_count,
            COUNT(*) FILTER (WHERE "Span" = 0 OR "Span" IS NULL) AS ic_count,
            ROUND(COUNT(*) FILTER (WHERE "Span" > 0) * 100.0 / COUNT(*), 1) AS mgr_pct
        FROM employees
    """,

    "l2_breakdown": """
        SELECT
            "L2" AS l2_leader,
            COUNT(*) AS headcount,
            ROUND(SUM("{flc_col}"), 0) AS total_cost,
            ROUND(AVG("{flc_col}"), 0) AS avg_cost,
            ROUND(AVG(CASE WHEN "Span" > 0 THEN "Span" END), 1) AS avg_span,
            MAX("Level") AS max_depth,
            COUNT(*) FILTER (WHERE "Span" = 0 OR "Span" IS NULL) AS ic_count,
            COUNT(*) FILTER (WHERE "Span" > 0) AS mgr_count,
            ROUND(SUM("{fte_col}"), 2) AS total_fte
        FROM employees
        WHERE "L2" IS NOT NULL
        GROUP BY "L2"
        ORDER BY total_cost DESC
    """,

    "span_distribution": """
        SELECT
            CASE
                WHEN "Span" = 1 THEN '1 (solo manager)'
                WHEN "Span" BETWEEN 2 AND 3 THEN '2-3 (narrow)'
                WHEN "Span" BETWEEN 4 AND 5 THEN '4-5 (below target)'
                WHEN "Span" BETWEEN 6 AND 8 THEN '6-8 (ideal)'
                WHEN "Span" BETWEEN 9 AND 12 THEN '9-12 (wide)'
                WHEN "Span" > 12 THEN '13+ (very wide)'
            END AS span_bucket,
            COUNT(*) AS manager_count,
            ROUND(SUM("{flc_col}"), 0) AS total_mgr_cost,
            ROUND(AVG("{flc_col}"), 0) AS avg_mgr_cost,
            ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_managers
        FROM employees
        WHERE "Span" > 0
        GROUP BY 1
        ORDER BY MIN("Span")
    """,

    "layer_analysis": """
        SELECT
            "Level",
            COUNT(*) AS headcount,
            ROUND(SUM("{fte_col}"), 2) AS total_fte,
            ROUND(SUM("{flc_col}"), 0) AS total_cost,
            ROUND(SUM("{flc_col}") * 100.0 / SUM(SUM("{flc_col}")) OVER(), 1) AS pct_of_total_cost,
            COUNT(*) FILTER (WHERE "Span" > 0) AS managers,
            COUNT(*) FILTER (WHERE "Span" = 0 OR "Span" IS NULL) AS ics
        FROM employees
        GROUP BY "Level"
        ORDER BY "Level"
    """,

    "manager_efficiency": """
        SELECT
            emp_id,
            "{job_title_col}" AS job_title,
            "Level",
            "Span",
            ROUND("{flc_col}", 0) AS cost,
            ({benchmark_span} - "Span") AS span_gap
        FROM employees
        WHERE "Span" > 0 AND "Span" < {benchmark_span}
        ORDER BY "{flc_col}" DESC
        LIMIT 50
    """,

    "cost_by_dimension": """
        SELECT
            "{dimension_col}",
            COUNT(*) AS headcount,
            ROUND(SUM("{fte_col}"), 2) AS total_fte,
            ROUND(SUM("{flc_col}"), 0) AS total_cost,
            ROUND(AVG("{flc_col}"), 0) AS avg_cost_per_head,
            ROUND(SUM("{flc_col}") / NULLIF(SUM("{fte_col}"), 0), 0) AS cost_per_fte
        FROM employees
        WHERE "{dimension_col}" IS NOT NULL
        GROUP BY 1
        ORDER BY total_cost DESC
    """,
}


def _fill_template(template_name: str, params: dict, dataset_meta: dict) -> str:
    """
    Fill a named query template with runtime column names and parameters.

    dataset_meta provides the actual column name mappings:
      {"emp_col": "ID", "mgr_col": "Line Manager ID", "fte_col": "FTE", "flc_col": "Fully loaded cost", ...}
    """
    sql = NAMED_QUERIES[template_name]

    # Standard column mappings from dataset metadata
    col_defaults = {
        "fte_col": dataset_meta.get("fte_col") or "fte",
        "flc_col": dataset_meta.get("flc_col") or "flc",
        "emp_col": dataset_meta.get("emp_col") or "emp_id",
        "mgr_col": dataset_meta.get("mgr_col") or "mgr_id",
        "job_title_col": dataset_meta.get("job_title_col") or "Job Title",
    }

    # Merge with user-provided params (e.g. benchmark_span, dimension_col)
    all_params = {**col_defaults, **params}

    # Fill placeholders
    for key, value in all_params.items():
        sql = sql.replace(f"{{{key}}}", str(value))

    return sql.strip()


# =============================================================================
# TOOL DEFINITIONS (sent to Azure OpenAI)
# =============================================================================

RUN_SQL_TOOL = {
    "type": "function",
    "function": {
        "name": "run_sql",
        "description": (
            "Execute a custom read-only SQL query against the DuckDB employees table. "
            "Use this for ad-hoc queries when no named tool fits. "
            "Always use proper DuckDB/PostgreSQL syntax. Double-quote column names with spaces. "
            "Use LIMIT unless user asks for all rows."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of why this query answers the user's question",
                },
                "sql": {
                    "type": "string",
                    "description": "The SELECT query to execute",
                },
            },
            "required": ["reasoning", "sql"],
        },
    },
}

ORG_SUMMARY_TOOL = {
    "type": "function",
    "function": {
        "name": "org_summary",
        "description": (
            "Get top-level org KPIs: total headcount, FTE, total cost, average cost, "
            "average span, max depth, manager count, IC count, management percentage. "
            "Use for: overview questions, 'how big is the org', 'give me a summary'."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
}

L2_BREAKDOWN_TOOL = {
    "type": "function",
    "function": {
        "name": "l2_breakdown",
        "description": (
            "Per L2 leader breakdown: headcount, total cost, avg cost, avg span, "
            "max depth, IC/manager split, total FTE for each L2 leader's org. "
            "Use for: 'by leader', 'by division', 'which unit has highest X', 'L2 summary'."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
}

SPAN_DISTRIBUTION_TOOL = {
    "type": "function",
    "function": {
        "name": "span_distribution",
        "description": (
            "Span of control bucket analysis: groups managers into span ranges "
            "(1, 2-3, 4-5, 6-8, 9-12, 13+) with count, cost, and percentage. "
            "Use for: span analysis, management density, narrow/wide spans, span benchmarking."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
}

LAYER_ANALYSIS_TOOL = {
    "type": "function",
    "function": {
        "name": "layer_analysis",
        "description": (
            "Headcount, FTE, cost, and manager/IC split at each hierarchy Level. "
            "Shows cost distribution across org layers. "
            "Use for: org depth, layering, delayering analysis, '% below layer N'."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
}

MANAGER_EFFICIENCY_TOOL = {
    "type": "function",
    "function": {
        "name": "manager_efficiency",
        "description": (
            "Lists managers with span below a benchmark threshold — the delayering opportunity. "
            "Shows each manager's role, level, span, cost, and gap-to-benchmark. "
            "Use for: managers to remove, delayering savings, span below benchmark, small teams."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "benchmark_span": {
                    "type": "integer",
                    "description": "Minimum acceptable span. Default 4. Managers with span below this are flagged.",
                    "default": 4,
                },
            },
        },
    },
}

COST_BY_DIMENSION_TOOL = {
    "type": "function",
    "function": {
        "name": "cost_by_dimension",
        "description": (
            "Headcount, FTE, total cost, avg cost, and cost-per-FTE grouped by any column. "
            "Use for: 'cost by country', 'headcount by function', 'by grade', any 'by X' analysis. "
            "The dimension_col must be an actual column name from the schema."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "dimension_col": {
                    "type": "string",
                    "description": "Column name to group by (must match schema exactly, e.g. 'Country', 'Function', 'Grade')",
                },
            },
            "required": ["dimension_col"],
        },
    },
}

GET_INSIGHTS_TOOL = {
    "type": "function",
    "function": {
        "name": "get_insights",
        "description": (
            "Get pre-computed organizational insights: 1:1 manager chains, thin layers, "
            "below-benchmark spans, FTE optimization opportunities. "
            "Use for: 'what are the risks', 'structural issues', 'optimization opportunities', "
            "'what should we fix', 'org health check'."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
}

NAVIGATE_TOOL = {
    "type": "function",
    "function": {
        "name": "navigate",
        "description": (
            "Navigate the user to a specific tab in the OrgSight workspace. "
            "Use when user asks to 'go to', 'open', 'show me' a specific view."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "enum": ["hierarchy", "spans_layers", "crosstab", "org_chart", "scenarios", "activity", "upload"],
                    "description": "Which workspace tab to navigate to",
                },
                "reason": {
                    "type": "string",
                    "description": "Why this navigation was triggered",
                },
            },
            "required": ["target", "reason"],
        },
    },
}


# All tools sent to Azure OpenAI
ALL_TOOLS = [
    RUN_SQL_TOOL,
    ORG_SUMMARY_TOOL,
    L2_BREAKDOWN_TOOL,
    SPAN_DISTRIBUTION_TOOL,
    LAYER_ANALYSIS_TOOL,
    MANAGER_EFFICIENCY_TOOL,
    COST_BY_DIMENSION_TOOL,
    GET_INSIGHTS_TOOL,
    NAVIGATE_TOOL,
]


# =============================================================================
# TOOL EXECUTORS
# =============================================================================

def execute_run_sql(args: dict, ctx: dict) -> tuple[str, list | None]:
    """
    Execute LLM-generated SQL with validation.
    Returns (text_for_llm, raw_data_or_none).
    """
    sql = args["sql"]
    duckdb_mgr = ctx["duckdb_manager"]
    user_id = ctx["user_id"]
    known_columns = ctx["known_columns"]

    # Pre-validate
    error = validate_sql(sql, known_columns)
    if error:
        return f"VALIDATION ERROR: {error}\nFix the query and try again.", None

    # Execute
    try:
        result = duckdb_mgr.query(user_id, sql, max_rows=MAX_SQL_ROWS)
        text = _format_result_text(result)
        data = result.get("data", [])
        columns = result.get("columns", [])
        # Return structured data for chart pairing
        raw = [dict(zip(columns, row)) for row in data] if data else None
        return text, raw
    except Exception as e:
        return _enrich_error(str(e), known_columns), None


def execute_named_query(template_name: str, args: dict, ctx: dict) -> tuple[str, list | None]:
    """
    Execute a named query template with runtime column mappings.
    Returns (text_for_llm, raw_data_or_none).
    """
    duckdb_mgr = ctx["duckdb_manager"]
    user_id = ctx["user_id"]
    dataset_meta = ctx["dataset_meta"]
    known_columns = ctx["known_columns"]

    # For cost_by_dimension, validate the dimension column exists
    if template_name == "cost_by_dimension":
        dim_col = args.get("dimension_col", "")
        if dim_col not in known_columns:
            available = ", ".join(f'"{c}"' for c in sorted(known_columns))
            return f"Column \"{dim_col}\" not found in this dataset.\nAvailable columns: {available}", None

    # Fill template
    params = {**args}
    if "benchmark_span" not in params:
        params["benchmark_span"] = 4  # default

    try:
        sql = _fill_template(template_name, params, dataset_meta)
    except KeyError as e:
        return f"Template error: missing parameter {e}. Check dataset column mappings.", None

    # Execute
    try:
        result = duckdb_mgr.query(user_id, sql, max_rows=MAX_SQL_ROWS)
        text = _format_result_text(result)
        data = result.get("data", [])
        columns = result.get("columns", [])
        raw = [dict(zip(columns, row)) for row in data] if data else None
        return text, raw
    except Exception as e:
        return _enrich_error(str(e), known_columns), None


def execute_get_insights(args: dict, ctx: dict) -> tuple[str, None]:
    """
    Call the existing spans_layers_service.get_insights().
    Returns pre-computed org analytics as text for the LLM to narrativize.
    """
    # Import here to avoid circular deps — adjust path to your project structure
    try:
        from services.spans_layers_service import get_insights
        user_id = ctx["user_id"]

        insights = get_insights(user_id)

        # Format as readable text for the LLM
        parts = ["PRE-COMPUTED ORG INSIGHTS:\n"]

        if "one_to_one_managers" in insights:
            mgrs = insights["one_to_one_managers"]
            parts.append(f"1:1 MANAGERS (span of exactly 1): {len(mgrs)} found")
            if mgrs:
                total_cost = sum(m.get("flc", 0) or 0 for m in mgrs)
                parts.append(f"  Total cost of 1:1 managers: {total_cost:,.0f}")

        if "thin_layers" in insights:
            chains = insights["thin_layers"]
            parts.append(f"\nTHIN LAYER CHAINS (consecutive 1:1 reporting): {len(chains)} chains found")

        if "below_benchmark_spans" in insights:
            below = insights["below_benchmark_spans"]
            parts.append(f"\nBELOW-BENCHMARK SPANS (< 4 direct reports): {len(below)} managers")
            if below:
                total_cost = sum(m.get("flc", 0) or 0 for m in below)
                parts.append(f"  Total cost: {total_cost:,.0f}")

        if "fte_opportunity" in insights:
            opp = insights["fte_opportunity"]
            parts.append(f"\nFTE OPTIMIZATION OPPORTUNITY: {opp}")

        return "\n".join(parts), None

    except ImportError:
        return "ERROR: spans_layers_service not available. Use SQL tools instead.", None
    except Exception as e:
        return f"ERROR getting insights: {str(e)}", None


def execute_navigate(args: dict, ctx: dict) -> tuple[str, None]:
    """Navigation commands passed through to frontend."""
    return json.dumps({
        "status": "navigation_triggered",
        "target": args["target"],
    }), None


# =============================================================================
# EXECUTOR REGISTRY
# =============================================================================

def execute_tool(tool_name: str, args: dict, ctx: dict) -> tuple[str, list | None]:
    """
    Route a tool call to its executor.

    Args:
        tool_name: name of the tool called by the LLM
        args: parsed arguments from the LLM
        ctx: runtime context dict with:
            - duckdb_manager: DuckDB manager instance
            - user_id: current user ID
            - dataset_meta: dataset column mappings from PostgreSQL
            - known_columns: set of actual column names in DuckDB

    Returns:
        (text_result_for_llm, raw_data_rows_or_none)
    """
    named_query_tools = {
        "org_summary", "l2_breakdown", "span_distribution",
        "layer_analysis", "manager_efficiency", "cost_by_dimension",
    }

    if tool_name == "run_sql":
        return execute_run_sql(args, ctx)
    elif tool_name in named_query_tools:
        return execute_named_query(tool_name, args, ctx)
    elif tool_name == "get_insights":
        return execute_get_insights(args, ctx)
    elif tool_name == "navigate":
        return execute_navigate(args, ctx)
    else:
        return f"ERROR: Unknown tool '{tool_name}'", None
