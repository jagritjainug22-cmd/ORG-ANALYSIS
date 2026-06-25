"""
Smart column auto-mapping service.

Given uploaded column headers and a sample of data rows, maps them to the
standard OrgSight target columns using:
1. Deterministic exact/fuzzy name matching (zero cost, instant)
2. A single LLM call for remaining unresolved columns (one call total)
"""

import logging
import re
from typing import Any

import pandas as pd

from services.llm_service import call_llm_json

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Target column definitions
# ---------------------------------------------------------------------------

TARGET_COLUMNS: dict[str, dict[str, Any]] = {
    "employee_id": {
        "label": "Employee ID",
        "description": "Unique identifier for each employee (numeric or alphanumeric code)",
        "aliases": [
            "employee id", "emp id", "empid", "emp_id", "employee_id",
            "employee no", "employee number", "emp no", "staff id",
            "worker id", "personnel number", "person id", "id",
        ],
        "core": True,
    },
    "manager_id": {
        "label": "Manager ID",
        "description": "Employee ID of this person's direct line manager / supervisor",
        "aliases": [
            "manager id", "mgr id", "mgr_id", "manager_id", "line manager id",
            "line manager", "line mgr id", "reports to", "reports to id",
            "supervisor id", "sup id", "manager employee id", "reporting to",
        ],
        "core": True,
    },
    "fte": {
        "label": "FTE",
        "description": "Full-Time Equivalent (1.0 = full-time, 0.5 = part-time, decimal number)",
        "aliases": [
            "fte", "full time equivalent", "full-time equivalent",
            "fte value", "fte%",
        ],
        "core": True,
    },
    "flc": {
        "label": "Fully Loaded Cost",
        "description": "Total employment cost including salary, benefits, taxes, and overheads (currency amount)",
        "aliases": [
            "flc", "fully loaded cost", "total cost", "total compensation",
            "employment cost", "loaded cost", "total cost to company",
            "ctc", "cost to company",
        ],
        "core": True,
    },
    "country": {
        "label": "Country",
        "description": "Country where the employee is based or employed",
        "aliases": [
            "country", "country name", "location country", "work country",
            "country code", "nation",
        ],
        "core": True,
    },
    "job_title": {
        "label": "Job Title",
        "description": "Employee's position or role title (e.g. Senior Analyst, VP Finance)",
        "aliases": [
            "job title", "title", "position title", "role", "role title",
            "position", "designation", "job name", "position name",
        ],
        "core": True,
    },
    "function": {
        "label": "Function",
        "description": "Business function or department (e.g. Finance, HR, IT, Sales & Marketing)",
        "aliases": [
            "function", "department", "dept", "functional area",
            "business function", "division function", "org function",
        ],
        "core": False,
    },
    "subfunction": {
        "label": "Subfunction",
        "description": "Sub-department or sub-area within the function (e.g. Accounts Payable, Recruitment)",
        "aliases": [
            "sub function", "subfunction", "sub-function", "sub dept",
            "sub department", "sub-department", "team", "section",
        ],
        "core": False,
    },
    "grade": {
        "label": "Grade",
        "description": "Employee grade, level, or band (e.g. Grade 7, Band C, Level 3)",
        "aliases": [
            "grade", "employee grade", "grade band", "band", "level",
            "job grade", "pay grade", "job level",
        ],
        "core": False,
    },
    "entity": {
        "label": "Entity",
        "description": "Legal or employing entity / company name",
        "aliases": [
            "entity", "employing entity", "legal entity", "company",
            "company name", "employer", "organization", "org",
        ],
        "core": False,
    },
    "division": {
        "label": "Division",
        "description": "Business division or reporting unit",
        "aliases": [
            "division", "business unit", "bu", "reporting line",
            "business division", "segment",
        ],
        "core": False,
    },
    "start_date": {
        "label": "Start Date",
        "description": "Hire date / employment start date",
        "aliases": [
            "start date", "hire date", "date of joining", "doj",
            "join date", "employment date", "start", "date hired",
        ],
        "core": False,
    },
    "basic_pay": {
        "label": "Basic Pay",
        "description": "Base salary amount (before bonuses and add-ons)",
        "aliases": [
            "basic pay", "base pay", "base salary", "basic salary",
            "annual salary", "salary",
        ],
        "core": False,
    },
    "contract_type": {
        "label": "Contract Type",
        "description": "Type of employment contract (Permanent, Contractor, Temp, Fixed-term, etc.)",
        "aliases": [
            "contract type", "employment type", "employee type",
            "worker type", "engagement type", "contract",
        ],
        "core": False,
    },
    "status": {
        "label": "Status",
        "description": "Employment status (Active, On Leave, Terminated, etc.)",
        "aliases": [
            "status", "employee status", "employment status",
            "worker status", "active status",
        ],
        "core": False,
    },
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def auto_map_columns(
    columns: list[str],
    sample_rows: list[dict],
) -> dict[str, dict[str, Any]]:
    """Map uploaded columns to OrgSight target columns (backwards compatibility)."""
    mappings, _, _, _ = auto_map_columns_with_feedback(columns, sample_rows)
    return mappings


def auto_map_columns_with_feedback(
    columns: list[str],
    sample_rows: list[dict],
) -> tuple[dict[str, dict[str, Any]], str, bool, dict[str, Any]]:
    """Map uploaded columns to OrgSight target columns.

    Returns a tuple of (mappings, warning_message, requires_attention, mapping_summary).
    mapping_summary contains structured data for the UI:
      - unmapped_core: list of {target_id, label} for unmapped core columns
      - ai_mapped: list of {target_id, label, source_column, confidence} for LLM-mapped columns
      - ai_explanation: the LLM's explanation text (or None)
    """
    result: dict[str, dict[str, Any]] = {}
    matched_sources: set[str] = set()

    # ── Pass 1: Deterministic alias matching ─────────────────────────────
    for target_id, target_def in TARGET_COLUMNS.items():
        best_match = _match_by_alias(columns, target_def["aliases"], matched_sources)
        if best_match:
            result[target_id] = {
                "label": target_def["label"],
                "source_column": best_match,
                "confidence": "high",
                "method": "alias_match",
            }
            matched_sources.add(best_match)

    # ── Pass 2: LLM for unresolved targets ───────────────────────────────
    unresolved_targets = {
        tid: tdef for tid, tdef in TARGET_COLUMNS.items() if tid not in result
    }
    unmatched_columns = [c for c in columns if c not in matched_sources]

    ai_explanation = None
    if unresolved_targets and unmatched_columns:
        llm_mappings, ai_explanation = _llm_map_columns(
            unmatched_columns, sample_rows, unresolved_targets,
        )
        for target_id, mapping_result in llm_mappings.items():
            if not isinstance(mapping_result, dict):
                continue
            source_col = mapping_result.get("column")
            confidence = mapping_result.get("confidence", "medium")
            if confidence not in ("high", "medium", "low"):
                confidence = "medium"
            if source_col and source_col in columns and source_col not in matched_sources:
                result[target_id] = {
                    "label": TARGET_COLUMNS[target_id]["label"],
                    "source_column": source_col,
                    "confidence": confidence,
                    "method": "llm",
                }
                matched_sources.add(source_col)

    # ── Fill unmatched targets with "none" ───────────────────────────────
    for target_id, target_def in TARGET_COLUMNS.items():
        if target_id not in result:
            result[target_id] = {
                "label": target_def["label"],
                "source_column": None,
                "confidence": "none",
                "method": "none",
            }

    # ── Compile warnings, feedback, and structured summary ───────────────
    warnings = []
    requires_attention = False
    unmapped_core: list[dict] = []
    ai_mapped: list[dict] = []

    for target_id, target_def in TARGET_COLUMNS.items():
        m = result.get(target_id)
        if target_def.get("core"):
            if not m or not m.get("source_column"):
                warnings.append(f"Required column '{target_def['label']}' was not mapped automatically.")
                requires_attention = True
                unmapped_core.append({"target_id": target_id, "label": target_def["label"]})
            elif m.get("confidence") in ("low",):
                warnings.append(f"Required column '{target_def['label']}' was mapped to '{m['source_column']}' with low confidence.")
                requires_attention = True
        if m and m.get("method") == "llm" and m.get("source_column"):
            ai_mapped.append({
                "target_id": target_id,
                "label": target_def["label"],
                "source_column": m["source_column"],
                "confidence": m["confidence"],
            })

    if ai_explanation:
        feedback_message = ai_explanation.strip()
        if warnings:
            feedback_message = "Mapping Issues:\n" + "\n".join(f"- {w}" for w in warnings) + f"\n\nDetails: {feedback_message}"
    else:
        if warnings:
            feedback_message = "Mapping Issues:\n" + "\n".join(f"- {w}" for w in warnings)
        else:
            feedback_message = "All necessary columns mapped successfully."

    mapping_summary: dict[str, Any] = {
        "unmapped_core": unmapped_core,
        "ai_mapped": ai_mapped,
        "ai_explanation": ai_explanation,
    }

    return result, feedback_message, requires_attention, mapping_summary


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalize(s: str) -> str:
    """Lowercase, strip, collapse whitespace, remove punctuation for matching."""
    s = str(s).strip().lower()
    s = re.sub(r"[_\-/().]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _match_by_alias(
    columns: list[str],
    aliases: list[str],
    already_matched: set[str],
) -> str | None:
    """Return the first uploaded column whose normalized name matches an alias."""
    alias_set = {_normalize(a) for a in aliases}
    for col in columns:
        if col in already_matched:
            continue
        if _normalize(col) in alias_set:
            return col
    return None


# ---------------------------------------------------------------------------
# LLM column mapping prompt
# ---------------------------------------------------------------------------

_COLUMN_MAP_SYSTEM = (
    "You are a data classification expert specializing in HR census and "
    "organizational data. You map messy column names from uploaded Excel files "
    "to standard organizational analysis fields."
)


def _llm_map_columns(
    unmatched_columns: list[str],
    sample_rows: list[dict],
    unresolved_targets: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], str | None]:
    """Use a single LLM call to map remaining columns.

    Returns (mappings, explanation) where mappings is a dict of
    target_id -> {"column": str|None, "confidence": "high"|"medium"|"low"}.
    """
    # Build sample data preview (first 5 rows, only unmatched columns)
    sample_df = pd.DataFrame(sample_rows[:5])
    preview_cols = [c for c in unmatched_columns if c in sample_df.columns]
    if preview_cols:
        preview = sample_df[preview_cols].to_string(index=False, max_colwidth=30)
    else:
        preview = "(no sample data available)"

    # Build target descriptions
    target_list = "\n".join(
        f'  - "{tid}": {tdef["label"]} — {tdef["description"]}'
        for tid, tdef in unresolved_targets.items()
    )

    # Build column list with sample values
    col_previews = []
    for col in unmatched_columns:
        if col in sample_df.columns:
            sample_vals = sample_df[col].dropna().head(3).tolist()
            vals_str = ", ".join(str(v) for v in sample_vals)
            col_previews.append(f'  - "{col}" (sample values: {vals_str})')
        else:
            col_previews.append(f'  - "{col}"')
    col_list = "\n".join(col_previews)

    prompt = f"""I have uploaded an Excel file with organizational/HR census data.
Some columns could not be automatically mapped. Please map them to the correct
target fields based on the column names and sample data.

UPLOADED COLUMNS (not yet mapped):
{col_list}

SAMPLE DATA:
{preview}

TARGET FIELDS TO MAP TO:
{target_list}

INSTRUCTIONS:
1. For each TARGET field, identify which uploaded column best matches it.
2. Match based on column name meaning AND sample data patterns.
3. If no uploaded column is a reasonable match for a target, set "column" to null.
4. Each uploaded column can only be mapped to ONE target (no duplicates).
5. Assign a confidence level for each mapping:
   - "high": the column name or data clearly and unambiguously matches the target
   - "medium": the column plausibly matches but has some uncertainty
   - "low": weak or speculative match — human review strongly recommended
6. Return a JSON object with two fields:
   - "mappings": keys are target field IDs, values are objects with "column" (exact uploaded column name or null) and "confidence" ("high"/"medium"/"low").
   - "explanation": one concise sentence summarising the overall mapping result — mention any fields that could not be mapped or were matched with low confidence.

RESPONSE FORMAT:
Return ONLY a JSON object like:
{{
  "mappings": {{
    "target_id": {{"column": "Uploaded Column Name", "confidence": "high"}},
    "another_target": {{"column": null, "confidence": "low"}}
  }},
  "explanation": "Brief summary of mapping results and any fields needing human review."
}}

No explanation, no markdown, just the JSON object."""

    log.info("Column mapping LLM prompt:\n%s", prompt)

    try:
        result = call_llm_json(
            prompt,
            system_message=_COLUMN_MAP_SYSTEM,
            max_tokens=1200,
        )
        if not isinstance(result, dict):
            log.warning("LLM returned non-dict for column mapping: %s", type(result))
            return {}, None
        mappings = result.get("mappings", {})
        explanation = result.get("explanation", None)
        if not isinstance(mappings, dict):
            return {}, None
        return mappings, explanation
    except Exception as e:
        log.error("Column mapping LLM call failed: %s", e)
        return {}, None
