import pandas as pd
from typing import Dict, Any, Optional

def validate_org_data(df: pd.DataFrame, emp_col: str, mgr_col: str, span_col: Optional[str] = None) -> Dict[str, Any]:
    df = df.copy()
    
    # Initialize flags
    df["FLAG_DUPLICATE_EMP_ID"] = 0
    df["FLAG_MISSING_MANAGER_ID"] = 0
    df["FLAG_MANAGER_ID_NOT_EMPLOYEE"] = 0

    # --- Step 0: Calculate Span if not provided ---
    if not span_col or span_col not in df.columns:
        span_dict = df[mgr_col].value_counts().to_dict()
        df["Span"] = df[emp_col].apply(lambda x: span_dict.get(x, 0))
        span_col = "Span"

    # 1️⃣ Duplicate employee IDs
    duplicate_ids = df[df[emp_col].duplicated()][emp_col].unique().tolist()

    # 2️⃣ Missing manager IDs
    missing_mgr_ids = df[df[mgr_col].isna()][emp_col].tolist()

    # 3️⃣ Detect top manager (exclude from missing manager errors)
    top_manager = None
    other_missing = missing_mgr_ids.copy()
    if missing_mgr_ids:
        # Pick top manager as the missing manager with max span
        top_manager = (
            df.loc[df[emp_col].isin(missing_mgr_ids)]
              .sort_values(span_col, ascending=False)
              .iloc[0][emp_col]
        )
        other_missing = [x for x in missing_mgr_ids if x != top_manager]

    # 4️⃣ Invalid manager IDs
    emp_ids = set(df[emp_col].astype(str))
    mgr_ids = set(df[mgr_col].dropna().astype(str))
    invalid_mgr_ids = sorted(list(mgr_ids - emp_ids))

    # 5️⃣ Assign flags
    if duplicate_ids:
        df.loc[df[emp_col].isin(duplicate_ids), "FLAG_DUPLICATE_EMP_ID"] = 1

    if other_missing:
        df.loc[df[emp_col].isin(other_missing), "FLAG_MISSING_MANAGER_ID"] = 1

    if invalid_mgr_ids:
        df.loc[df[mgr_col].astype(str).isin(invalid_mgr_ids), "FLAG_MANAGER_ID_NOT_EMPLOYEE"] = 1

    # Return results
    return {
        "duplicate_ids": duplicate_ids,
        "missing_manager_ids": other_missing,
        "invalid_manager_ids": invalid_mgr_ids,
        "df_with_flags": df,
        "top_manager": top_manager
    }
