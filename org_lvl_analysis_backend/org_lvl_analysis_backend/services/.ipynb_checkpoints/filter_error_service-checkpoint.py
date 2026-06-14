import pandas as pd

def collect_subtree(df, emp_col, mgr_col, root_id):
    """Collect all descendants of a given root_id"""
    to_visit = [root_id]
    result = set()
    while to_visit:
        current = to_visit.pop()
        result.add(str(current))
        children = df[df[mgr_col].astype(str) == str(current)][emp_col].astype(str).tolist()
        to_visit.extend(children)
    return result

def filter_errors(df, emp_col, mgr_col, remove_dup=True, remove_missing=True, remove_invalid=True):
    """
    Filter out rows with validation errors.
    After filtering, removes all FLAG_ columns since the data is now clean.
    """
    df_new = df.copy()
    
    # Remove duplicates (keep first occurrence)
    if remove_dup:
        df_new = df_new.drop_duplicates(subset=[emp_col], keep="first")
    
    # Remove records with missing manager IDs
    if remove_missing:
        if "FLAG_MISSING_MANAGER_ID" in df_new.columns:
            df_new = df_new[df_new["FLAG_MISSING_MANAGER_ID"] == 0]
    
    # Remove invalid manager hierarchies (and their subtrees)
    if remove_invalid:
        if "FLAG_MANAGER_ID_NOT_EMPLOYEE" in df_new.columns:
            bad_mgrs = df_new[df_new["FLAG_MANAGER_ID_NOT_EMPLOYEE"] == 1][mgr_col].astype(str).unique().tolist()
            all_remove = set()
            for m in bad_mgrs:
                all_remove |= collect_subtree(df_new, emp_col, mgr_col, m)
            df_new = df_new[~df_new[emp_col].astype(str).isin(all_remove)]
    
    # CRITICAL FIX: Remove all FLAG columns after filtering
    # The data is now clean, so flags are no longer needed and can cause confusion
    flag_columns = [col for col in df_new.columns if col.startswith("FLAG_")]
    if flag_columns:
        df_new = df_new.drop(columns=flag_columns)
        print(f"✅ Removed {len(flag_columns)} FLAG columns: {flag_columns}")
    
    return df_new