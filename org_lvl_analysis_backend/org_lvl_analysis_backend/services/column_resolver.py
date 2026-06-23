"""
Semantic Column Resolution Layer for OrgSight Chat.

Bridges the gap between user vocabulary (natural language) and physical
column names in the dataset schema. Resolution is entirely dataset-agnostic:

  USER VOCABULARY → SEMANTIC CATEGORY → dataset_meta key → live column name

The only static part is the vocabulary-to-category mapping (human language terms
that are stable across datasets). Everything else resolves dynamically against
the live DuckDB schema and Postgres dataset_meta at runtime.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Static mapping: user vocabulary → semantic category
# This is about HUMAN LANGUAGE, not about specific datasets or schemas.
# ---------------------------------------------------------------------------

TERM_TO_CATEGORY: Dict[str, str] = {
    # Cost / compensation
    "salary": "cost", "pay": "cost", "compensation": "cost", "ctc": "cost",
    "wage": "cost", "wages": "cost", "package": "cost", "total cost": "cost",
    "cost": "cost", "flc": "cost", "fully loaded cost": "cost",
    # FTE / headcount
    "fte": "fte", "headcount": "fte", "head count": "fte",
    # Function / department
    "department": "function", "function": "function", "team": "function",
    "functional area": "function", "business function": "function",
    # Sub-function
    "subfunction": "subfunction", "sub function": "subfunction",
    "sub-function": "subfunction",
    # Division / entity
    "division": "division", "entity": "division", "legal entity": "division",
    "business unit": "division", "unit": "division", "company": "division",
    # Grade / band
    "grade": "grade", "band": "grade", "seniority": "grade",
    "employee band": "grade",
    # Job title / role
    "role": "job_title", "title": "job_title", "designation": "job_title",
    "position": "job_title", "job": "job_title", "job title": "job_title",
    # Country / geography
    "country": "country", "location": "country", "region": "country",
    "geography": "country", "office": "country", "city": "country",
    # Contract type
    "contract type": "contract_type", "employment type": "contract_type",
    "worker type": "contract_type", "contract": "contract_type",
    # Start date / tenure
    "start date": "start_date", "tenure": "start_date", "hire date": "start_date",
    "joining date": "start_date", "date of joining": "start_date",
    # Manager
    "manager": "manager", "line manager": "manager", "reporting to": "manager",
    # Employee identity
    "name": "employee_name", "employee name": "employee_name",
    "employee id": "employee_id", "emp id": "employee_id", "id": "employee_id",
}

# Maps semantic category → dataset_meta key that holds the actual column name
CATEGORY_TO_META_KEY: Dict[str, str] = {
    "cost": "flc_col",
    "fte": "fte_col",
    "function": "func_col",
    "subfunction": "subfunc_col",
    "division": "division_col",
    "grade": "grade_col",
    "job_title": "job_title_col",
    "country": "country_col",
    "contract_type": "contract_type_col",
    "start_date": "start_date_col",
    "manager": "mgr_col",
    "employee_name": "emp_col",
    "employee_id": "emp_col",
}


def resolve_column(
    user_term: str,
    known_columns: Set[str],
    dataset_meta: Dict[str, Any],
    schema_samples: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Any]:
    """
    Resolve a user's column reference to an actual schema column.

    Resolution pipeline (in order of precedence):
      1. Exact match (case-insensitive) against known_columns
      2. Metadata mapping: user_term → category → dataset_meta[key] → column
      3. Substring containment against known_columns
      4. Evaluate: 1 match = resolved, 2+ = ambiguous, 0 = not_found

    Args:
        user_term: What the user or LLM said (e.g., "department", "salary")
        known_columns: Set of actual column names from the live DuckDB schema
        dataset_meta: Postgres dataset row with flc_col, func_col, etc.
        schema_samples: Optional dict of column_name → sample_values for disambiguation

    Returns:
        {
            "status": "exact" | "resolved" | "ambiguous" | "missing" | "not_found",
            "column": str | None,
            "candidates": [{"column": str, "samples": list}],
            "suggestion": str | None,
        }
    """
    term_lower = user_term.lower().strip()
    schema_samples = schema_samples or {}

    # 1. Exact case-insensitive match against known columns
    for col in known_columns:
        if col.lower() == term_lower:
            return {"status": "exact", "column": col, "candidates": [], "suggestion": None}

    # 2. Category-based resolution via dataset_meta
    category = TERM_TO_CATEGORY.get(term_lower)
    if category:
        meta_key = CATEGORY_TO_META_KEY.get(category)
        if meta_key:
            actual_col = dataset_meta.get(meta_key)
            if actual_col and actual_col in known_columns:
                return {"status": "resolved", "column": actual_col, "candidates": [], "suggestion": None}
            elif actual_col is None or actual_col == "":
                # Category exists but is not mapped for this dataset
                available = _get_available_dimensions(known_columns)
                return {
                    "status": "missing",
                    "column": None,
                    "candidates": [],
                    "suggestion": (
                        f"This dataset doesn't have a {term_lower} column mapped. "
                        f"Available columns you can use: {', '.join(available)}"
                    ),
                }

    # 3. Substring containment match
    matched_columns = []
    for col in known_columns:
        col_lower = col.lower()
        if term_lower in col_lower or col_lower in term_lower:
            matched_columns.append(col)

    # 4. Evaluate results
    if len(matched_columns) == 1:
        return {"status": "resolved", "column": matched_columns[0], "candidates": [], "suggestion": None}

    elif len(matched_columns) > 1:
        candidates = [
            {"column": col, "samples": schema_samples.get(col, [])}
            for col in matched_columns
        ]
        return {
            "status": "ambiguous",
            "column": None,
            "candidates": candidates,
            "suggestion": (
                f"'{user_term}' could refer to multiple columns: "
                f"{', '.join(matched_columns)}. Which one did you mean?"
            ),
        }

    else:
        # No match — suggest what IS available
        available = _get_available_dimensions(known_columns)
        return {
            "status": "not_found",
            "column": None,
            "candidates": [],
            "suggestion": (
                f"I couldn't find a column matching '{user_term}' in this dataset. "
                f"Available columns: {', '.join(available)}"
            ),
        }


def validate_and_correct_columns(
    sql: str,
    known_columns: Set[str],
    dataset_meta: Dict[str, Any],
    schema_samples: Optional[Dict[str, List[str]]] = None,
) -> tuple[str, Optional[str]]:
    """
    Scan LLM-generated SQL for quoted column references and auto-correct
    single-match resolutions. Returns clarification error for ambiguous refs.

    Args:
        sql: The generated SQL string
        known_columns: Set of valid column names
        dataset_meta: Dataset metadata for category-based resolution
        schema_samples: Optional sample values for disambiguation

    Returns:
        (corrected_sql, error_or_none)
        If error is not None, SQL should not be executed — return clarification to user.
    """
    import re

    quoted_refs = re.findall(r'"([^"]+)"', sql)
    corrected_sql = sql
    errors = []

    skip_names = {"employees", "_q"}

    for ref in quoted_refs:
        if ref in skip_names or ref in known_columns:
            continue

        # Check if it's an alias defined in the query
        alias_pattern = re.compile(rf'\bAS\s+"{re.escape(ref)}"', re.IGNORECASE)
        if alias_pattern.search(sql):
            continue

        resolution = resolve_column(ref, known_columns, dataset_meta, schema_samples)

        if resolution["status"] in ("exact", "resolved"):
            corrected_sql = corrected_sql.replace(f'"{ref}"', f'"{resolution["column"]}"')
        elif resolution["status"] == "ambiguous":
            errors.append(resolution["suggestion"])
        elif resolution["status"] == "missing":
            errors.append(resolution["suggestion"])
        else:
            errors.append(resolution["suggestion"])

    if errors:
        return sql, "\n".join(errors)

    return corrected_sql, None


def _get_available_dimensions(known_columns: Set[str]) -> List[str]:
    """Return user-friendly list of available columns, excluding hierarchy internals."""
    skip_prefixes = ("L", "Chain")
    available = sorted(
        col for col in known_columns
        if not (
            (col.startswith("L") and len(col) <= 3 and col[1:].isdigit())
            or col in ("Chain", "Chain_reversed", "Total_Reports", "Avg_FLC")
        )
    )
    return available[:15]
