"""
Data completeness matrix for properties cleaning heatmap (Feature 8).

For each group × field cell, reports how many rows have a non-null / non-empty value.
"""

from typing import Any, Dict, List

import pandas as pd


def _is_filled(val: Any) -> bool:
    if val is None:
        return False
    try:
        if pd.isna(val):
            return False
    except (TypeError, ValueError):
        pass
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none", "null", "n/a"):
        return False
    return True


def get_completeness_matrix(
    df: pd.DataFrame,
    critical_fields: List[str],
    group_col: str,
) -> Dict[str, Any]:
    """
    Build a flat completeness matrix and summary stats.

    Returns::

        {
            "matrix": [{group, field, total, filled, missing, pct_complete}, ...],
            "groups": [...],
            "fields": [...],
            "summary": {overall_pct, groups_count, fields_count, total_cells, filled_cells},
        }
    """
    if df.empty:
        return {
            "matrix": [],
            "groups": [],
            "fields": [],
            "summary": {
                "overall_pct": 0.0,
                "groups_count": 0,
                "fields_count": 0,
                "total_cells": 0,
                "filled_cells": 0,
            },
        }

    if group_col not in df.columns:
        raise ValueError(f"Group column '{group_col}' not found in data")

    fields = [f for f in critical_fields if f in df.columns and f != group_col]
    if not fields:
        raise ValueError("No valid fields selected for completeness analysis")

    group_series = df[group_col].apply(lambda v: "(blank)" if _is_filled(v) is False else str(v).strip())
    groups = sorted(group_series.unique().tolist(), key=lambda x: (x == "(blank)", x.lower()))

    matrix: List[Dict[str, Any]] = []
    total_cells = 0
    filled_cells = 0

    for group_val in groups:
        mask = group_series == group_val
        group_df = df.loc[mask]
        total = len(group_df)

        for field in fields:
            filled = int(group_df[field].apply(_is_filled).sum())
            missing = total - filled
            pct = round(100.0 * filled / total, 1) if total else 0.0
            matrix.append({
                "group": group_val,
                "field": field,
                "total": total,
                "filled": filled,
                "missing": missing,
                "pct_complete": pct,
            })
            total_cells += total
            filled_cells += filled

    overall_pct = round(100.0 * filled_cells / total_cells, 1) if total_cells else 0.0

    return {
        "matrix": matrix,
        "groups": groups,
        "fields": fields,
        "summary": {
            "overall_pct": overall_pct,
            "groups_count": len(groups),
            "fields_count": len(fields),
            "total_cells": total_cells,
            "filled_cells": filled_cells,
        },
    }
