"""
Smart Excel upload service.

Handles messy real-world census files:
- Auto-detect header row (headers not always on row 1)
- Skip blank leading rows
- Unmerge merged cells and forward-fill
- Pick the best sheet when multiple sheets exist
- Clean column names (trim, deduplicate)
- Fix numeric IDs stored as floats (1001.0 → "1001")
- Normalize date columns
- Drop completely empty columns
"""

import logging
import re
from io import BytesIO
from typing import Any

import numpy as np
import openpyxl
import pandas as pd

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def read_excel_file(file) -> pd.DataFrame:
    """Original simple reader — kept for backward compatibility."""
    df = pd.read_excel(file)
    return _finalize_df(df)


def smart_read_excel(file_bytes: bytes, filename: str = "") -> tuple[pd.DataFrame, dict[str, Any]]:
    """Read a messy Excel file and return (DataFrame, preprocessing_summary).

    This is the new entry point that handles real-world file quirks.
    """
    summary: dict[str, Any] = {
        "header_row_detected": 0,
        "blank_rows_skipped": 0,
        "merged_cells_resolved": 0,
        "sheet_used": "",
        "sheets_available": [],
        "duplicate_columns_renamed": [],
        "empty_columns_dropped": [],
        "float_id_columns_fixed": [],
        "total_rows": 0,
    }

    bio = BytesIO(file_bytes)

    # ── Step 1: Discover sheets ──────────────────────────────────────────
    wb = openpyxl.load_workbook(bio, data_only=True)
    sheet_names = wb.sheetnames
    summary["sheets_available"] = sheet_names

    best_sheet = _pick_best_sheet(wb, sheet_names)
    summary["sheet_used"] = best_sheet
    ws = wb[best_sheet]

    # ── Step 2: Unmerge merged cells ─────────────────────────────────────
    merged_count = _unmerge_cells(ws)
    summary["merged_cells_resolved"] = merged_count

    # ── Step 3: Read sheet data into list-of-lists ───────────────────────
    raw_rows = list(ws.iter_rows(values_only=True))
    if not raw_rows:
        wb.close()
        return pd.DataFrame(), summary

    # ── Step 4: Detect header row ────────────────────────────────────────
    header_idx = _detect_header_row(raw_rows)
    summary["header_row_detected"] = header_idx + 1  # 1-based for display
    summary["blank_rows_skipped"] = header_idx

    headers = [str(h).strip() if h is not None else f"Column_{i}"
               for i, h in enumerate(raw_rows[header_idx])]
    data_rows = raw_rows[header_idx + 1:]

    wb.close()

    # ── Step 5: Build DataFrame ──────────────────────────────────────────
    df = pd.DataFrame(data_rows, columns=headers)

    # Drop rows that are entirely empty
    df.dropna(how="all", inplace=True)
    df.reset_index(drop=True, inplace=True)

    # ── Step 6: Clean column names ───────────────────────────────────────
    df, dup_renames = _deduplicate_columns(df)
    summary["duplicate_columns_renamed"] = dup_renames

    # ── Step 7: Drop fully empty columns ─────────────────────────────────
    # Only drop columns that are 100% empty (no data at all). Non-empty
    # columns — including those not mapped to OrgSight standard fields —
    # are always preserved through processing, save, and export.
    empty_cols = [c for c in df.columns if df[c].isna().all()]
    if empty_cols:
        df.drop(columns=empty_cols, inplace=True)
        summary["empty_columns_dropped"] = empty_cols

    # ── Step 8: Fix float IDs ────────────────────────────────────────────
    fixed_id_cols = _fix_float_ids(df)
    summary["float_id_columns_fixed"] = fixed_id_cols

    # ── Step 9: Finalize (same cleanup as original reader) ───────────────
    df = _finalize_df(df)
    summary["total_rows"] = len(df)

    log.info(
        "Smart upload: sheet=%s, header_row=%d, merged=%d, rows=%d",
        best_sheet, header_idx + 1, merged_count, len(df),
    )
    return df, summary


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _finalize_df(df: pd.DataFrame) -> pd.DataFrame:
    """Standard cleanup applied to every DataFrame before returning."""
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    for col in df.select_dtypes(include=["datetime", "datetimetz"]):
        df[col] = df[col].astype(str)

    df = df.astype(object)
    df = df.where(pd.notna(df), None)
    df.columns = df.columns.map(lambda c: str(c).strip())
    return df


def _pick_best_sheet(wb: openpyxl.Workbook, sheet_names: list[str]) -> str:
    """Pick the sheet most likely to contain census data.

    Heuristic: largest sheet by row count, breaking ties by column count.
    Skips sheets whose name suggests they're metadata/summary.
    """
    skip_keywords = {"summary", "notes", "instructions", "readme", "config", "lookup", "meta"}

    candidates = []
    for name in sheet_names:
        if name.lower().strip() in skip_keywords:
            continue
        ws = wb[name]
        candidates.append((name, ws.max_row or 0, ws.max_column or 0))

    if not candidates:
        # Fall back to first sheet if all were skipped
        candidates = [(sheet_names[0], wb[sheet_names[0]].max_row or 0, 0)]

    candidates.sort(key=lambda t: (t[1], t[2]), reverse=True)
    return candidates[0][0]


def _unmerge_cells(ws) -> int:
    """Unmerge all merged cell ranges and forward-fill values."""
    merged_ranges = list(ws.merged_cells.ranges)
    count = len(merged_ranges)

    for mr in merged_ranges:
        min_row, min_col = mr.min_row, mr.min_col
        top_left_value = ws.cell(row=min_row, column=min_col).value
        ws.unmerge_cells(str(mr))
        for row in range(mr.min_row, mr.max_row + 1):
            for col in range(mr.min_col, mr.max_col + 1):
                ws.cell(row=row, column=col).value = top_left_value

    return count


def _detect_header_row(raw_rows: list, scan_limit: int = 15) -> int:
    """Find the row index most likely to be the header.

    Heuristic: the first row (within scan_limit) where:
    - At least 3 non-null values exist
    - Most values are strings (not pure numbers)
    - Values are mostly unique
    """
    best_idx = 0
    best_score = -1

    limit = min(scan_limit, len(raw_rows))
    for i in range(limit):
        row = raw_rows[i]
        non_null = [v for v in row if v is not None and str(v).strip() != ""]
        if len(non_null) < 3:
            continue

        string_count = sum(1 for v in non_null if isinstance(v, str))
        unique_ratio = len(set(str(v).strip().lower() for v in non_null)) / len(non_null) if non_null else 0

        # Score: prefer rows with many strings and high uniqueness
        score = (string_count / len(non_null)) * unique_ratio * len(non_null)

        if score > best_score:
            best_score = score
            best_idx = i

    return best_idx


def _deduplicate_columns(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Rename duplicate column names by appending _1, _2, etc."""
    cols = list(df.columns)
    seen: dict[str, int] = {}
    renames: list[str] = []

    for i, col in enumerate(cols):
        if col in seen:
            seen[col] += 1
            new_name = f"{col}_{seen[col]}"
            renames.append(f"{col} → {new_name}")
            cols[i] = new_name
        else:
            seen[col] = 0

    df.columns = cols
    return df, renames


def _fix_float_ids(df: pd.DataFrame) -> list[str]:
    """Detect columns that look like IDs stored as floats and convert to clean strings.

    A column is treated as a float-ID column if:
    - Its name contains 'id' (case-insensitive) or matches common ID patterns
    - All non-null values are floats that are whole numbers
    """
    id_patterns = re.compile(r"(^id$|_id$|id_| id|employee|manager|emp|mgr)", re.IGNORECASE)
    fixed = []

    for col in df.columns:
        if not id_patterns.search(col):
            continue

        non_null = df[col].dropna()
        if non_null.empty:
            continue

        # Check if all values are float-like whole numbers
        try:
            numeric = pd.to_numeric(non_null, errors="coerce")
            if numeric.isna().any():
                continue
            if (numeric == numeric.astype(int)).all():
                df[col] = df[col].apply(
                    lambda v: str(int(float(v))) if pd.notna(v) and v is not None else v
                )
                fixed.append(col)
        except (ValueError, TypeError):
            continue

    return fixed
