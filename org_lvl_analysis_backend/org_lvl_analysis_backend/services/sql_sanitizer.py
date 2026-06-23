"""
SQL Sanitization Layer for OrgSight Chat.

Validates and cleans LLM-generated SQL before execution against DuckDB.
This layer is dataset-agnostic — it only needs the set of known columns
from the live schema to validate column references.

Catches:
  - Trailing semicolons (break subquery wrapping)
  - Multiple statements (potential injection)
  - DDL/DML keywords (data modification attempts)
  - System table access (metadata snooping)
  - Invalid column references (hallucinated or leaked metadata)
  - Empty queries after cleaning
"""

from __future__ import annotations

import logging
import re
from typing import Set, Tuple, Optional

log = logging.getLogger(__name__)

_DANGEROUS_KEYWORDS = re.compile(
    r"\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ATTACH|COPY|EXPORT|IMPORT)\b",
    re.IGNORECASE,
)

_SYSTEM_TABLES = re.compile(
    r"\b(information_schema|pg_catalog|sqlite_master|duckdb_tables|duckdb_columns|duckdb_schemas)\b",
    re.IGNORECASE,
)

_MARKDOWN_FENCE = re.compile(r"^```(?:sql|duckdb)?\s*\n?", re.IGNORECASE)
_MARKDOWN_FENCE_END = re.compile(r"\n?```\s*$")


def sanitize_sql(
    sql: str,
    known_columns: Optional[Set[str]] = None,
) -> Tuple[str, Optional[str]]:
    """
    Validate and clean SQL for safe execution.

    Args:
        sql: Raw SQL string (potentially from LLM output).
        known_columns: Set of valid column names from the live DuckDB schema.
                      If provided, quoted column references are validated against it.

    Returns:
        Tuple of (cleaned_sql, error_message_or_none).
        If error is not None, the SQL should NOT be executed.
    """
    if not sql or not sql.strip():
        return "", "Empty query — nothing to execute."

    cleaned = sql.strip()

    # 1. Strip markdown fences (LLM sometimes wraps in ```sql ... ```)
    cleaned = _MARKDOWN_FENCE.sub("", cleaned)
    cleaned = _MARKDOWN_FENCE_END.sub("", cleaned)
    cleaned = cleaned.strip()

    # 2. Strip trailing semicolons (handles multiple: ";;;" or "; ;")
    cleaned = cleaned.rstrip().rstrip(";").strip()

    if not cleaned:
        return "", "Query is empty after cleaning."

    # 3. Reject multiple statements (semicolons remaining = multiple statements)
    if ";" in cleaned:
        return cleaned, "Multiple SQL statements detected — only single SELECT queries are allowed."

    # 4. Reject DDL/DML keywords
    match = _DANGEROUS_KEYWORDS.search(cleaned)
    if match:
        return cleaned, f"Unsafe SQL operation detected: {match.group(0).upper()}. Only SELECT queries are allowed."

    # 5. Reject system table access
    match = _SYSTEM_TABLES.search(cleaned)
    if match:
        return cleaned, f"Access to system tables ({match.group(0)}) is not permitted."

    # 6. Must start with SELECT (or WITH for CTEs)
    first_word = cleaned.split()[0].upper() if cleaned.split() else ""
    if first_word not in ("SELECT", "WITH"):
        return cleaned, f"Only SELECT queries are allowed. Got: {first_word}"

    # 7. Validate quoted column references against known schema
    if known_columns:
        error = _validate_column_references(cleaned, known_columns)
        if error:
            return cleaned, error

    return cleaned, None


def _validate_column_references(sql: str, known_columns: Set[str]) -> Optional[str]:
    """
    Check that double-quoted identifiers in the SQL exist in the schema.

    Skips the table name 'employees' and common SQL aliases.
    Returns an error message if invalid references are found, None otherwise.
    """
    quoted_refs = re.findall(r'"([^"]+)"', sql)

    skip_names = {"employees", "_q"}
    invalid_refs = []

    for ref in quoted_refs:
        if ref in skip_names:
            continue
        if ref in known_columns:
            continue
        # Allow aliases that are defined earlier in the same query (AS "...")
        # by checking if this ref appears after AS in the query
        alias_pattern = re.compile(rf'\bAS\s+"{re.escape(ref)}"', re.IGNORECASE)
        if alias_pattern.search(sql):
            continue
        invalid_refs.append(ref)

    if invalid_refs:
        available = sorted(known_columns)[:20]
        return (
            f"Column(s) not found in dataset: {', '.join(invalid_refs)}. "
            f"Available columns: {', '.join(available)}"
        )

    return None
