"""Rate card generation and lookup for OrgSight scenario modelling."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


def build_composite_key(record: Dict[str, Any], property_cols: List[str]) -> str:
    parts: List[str] = []
    for col in property_cols:
        val = record.get(col)
        if val is None or str(val).strip() == "":
            parts.append("—")
        else:
            # Normalize: lowercase + trim + replace underscores so
            # "Data Analyst" == "data analyst" == " Data Analyst "
            parts.append(str(val).strip().lower().replace("_", "-"))
    return "_".join(parts)


def _cost_series(df: pd.DataFrame, cost_col: str) -> pd.Series:
    if cost_col in df.columns:
        return pd.to_numeric(df[cost_col], errors="coerce")
    return pd.Series(dtype=float)


def compute_rate_card_rows(
    records: List[Dict[str, Any]],
    property_cols: List[str],
    cost_col: str,
    min_sample: int = 3,
) -> List[Dict[str, Any]]:
    """Group baseline records and compute quartile costs per composite key."""
    if not records:
        return []
    if not property_cols:
        raise ValueError("At least one property column is required")
    if len(property_cols) > 3:
        raise ValueError("Select up to three property columns")

    df = pd.DataFrame(records)
    costs = _cost_series(df, cost_col)
    df = df.copy()
    df["_cost"] = costs
    df = df[df["_cost"].notna()]
    df["_composite"] = df.apply(lambda r: build_composite_key(r.to_dict(), property_cols), axis=1)

    rows: List[Dict[str, Any]] = []
    for composite_key, group in df.groupby("_composite", sort=True):
        sample = group["_cost"].astype(float)
        n = int(sample.shape[0])
        if n < min_sample:
            rows.append(
                {
                    "composite_key": composite_key,
                    "p25": None,
                    "p50": None,
                    "p75": None,
                    "avg_cost": None,
                    "sample_count": n,
                    "is_available": False,
                }
            )
        else:
            rows.append(
                {
                    "composite_key": composite_key,
                    "p25": float(sample.quantile(0.25)),
                    "p50": float(sample.quantile(0.50)),
                    "p75": float(sample.quantile(0.75)),
                    "avg_cost": float(sample.mean()),
                    "sample_count": n,
                    "is_available": True,
                }
            )
    return rows


def parse_property_cols(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(c) for c in raw if str(c).strip()]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(c) for c in parsed if str(c).strip()]
        except json.JSONDecodeError:
            pass
        return [c.strip() for c in raw.split(",") if c.strip()]
    return []


def quartile_value(row: Dict[str, Any], quartile: str) -> Optional[float]:
    q = (quartile or "p50").lower()
    key = {"p25": "p25", "p50": "p50", "p75": "p75", "avg": "avg_cost"}.get(q, "p50")
    val = row.get(key)
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def lookup_cost_from_row(
    row: Optional[Dict[str, Any]],
    quartile: str = "p50",
) -> Optional[float]:
    if not row:
        return None
    if not row.get("is_available", True) and not row.get("is_manual_override"):
        return None
    return quartile_value(row, quartile)


def rows_from_upload_df(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Normalize an uploaded rate-card spreadsheet."""
    cols = {str(c).strip().lower(): c for c in df.columns}
    composite_col = None
    for candidate in ("composite_key", "rate card composite", "composite"):
        if candidate in cols:
            composite_col = cols[candidate]
            break
    if composite_col is None:
        raise ValueError("Upload must include a 'Composite Key' or 'Rate Card Composite' column")

    def _num(col_names: List[str]) -> Optional[str]:
        for name in col_names:
            if name in cols:
                return cols[name]
        return None

    p25_col = _num(["p25", "rate card cost"])
    p50_col = _num(["p50"])
    p75_col = _num(["p75"])
    avg_col = _num(["avg_cost", "average", "avg"])

    rows: List[Dict[str, Any]] = []
    for _, r in df.iterrows():
        composite_key = str(r[composite_col]).strip()
        if not composite_key or composite_key.lower() in ("nan", "not available"):
            continue

        def pick(col: Optional[str]) -> Optional[float]:
            if not col:
                return None
            val = pd.to_numeric(r[col], errors="coerce")
            if pd.isna(val):
                return None
            return float(val)

        p25 = pick(p25_col)
        p50 = pick(p50_col)
        p75 = pick(p75_col)
        avg_cost = pick(avg_col)
        if p50 is None and avg_col is None and p25_col:
            p50 = p25
        rows.append(
            {
                "composite_key": composite_key,
                "p25": p25,
                "p50": p50 if p50 is not None else avg_cost,
                "p75": p75,
                "avg_cost": avg_cost if avg_cost is not None else p50,
                "sample_count": 0,
                "is_available": any(v is not None for v in (p25, p50, p75, avg_cost)),
                "is_manual_override": True,
            }
        )
    if not rows:
        raise ValueError("No valid rate card rows found in upload")
    return rows
