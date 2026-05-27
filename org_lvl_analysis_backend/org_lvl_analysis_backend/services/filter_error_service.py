import pandas as pd

def collect_subtree(df, emp_col, mgr_col, root_id):
    """Collect all descendants of a given root_id, including root_id itself.
    Tracks visited nodes to prevent infinite loops from circular references."""
    to_visit = [root_id]
    result = set()
    while to_visit:
        current = to_visit.pop()
        if current in result:   # already visited — skip to prevent infinite loop
            continue
        result.add(str(current))
        children = df[df[mgr_col].astype(str) == str(current)][emp_col].astype(str).tolist()
        to_visit.extend(children)
    return result


def filter_errors(df, emp_col, mgr_col, remove_dup=True, remove_missing=True, remove_invalid=True, remove_circular=True):
    """
    Filter out rows with validation errors.
    After filtering, removes all FLAG_ columns since the data is now clean.
    """
    df_new = df.copy()

    # 1. Remove duplicates (keep first occurrence)
    if remove_dup:
        df_new = df_new.drop_duplicates(subset=[emp_col], keep="first")

    # 2. Remove records with missing manager IDs
    if remove_missing:
        if "FLAG_MISSING_MANAGER_ID" in df_new.columns:
            df_new = df_new[df_new["FLAG_MISSING_MANAGER_ID"] == 0]

    # 3. Remove invalid manager hierarchies and their entire subtrees
    if remove_invalid:
        if "FLAG_MANAGER_ID_NOT_EMPLOYEE" in df_new.columns:
            bad_mgrs = df_new[df_new["FLAG_MANAGER_ID_NOT_EMPLOYEE"] == 1][mgr_col].astype(str).unique().tolist()
            all_remove = set()
            for m in bad_mgrs:
                all_remove |= collect_subtree(df_new, emp_col, mgr_col, m)
            df_new = df_new[~df_new[emp_col].astype(str).isin(all_remove)]

    # 4. Remove circular reference employees and their entire subtrees
    #    Employees who report UP INTO the cycle are also orphaned once the
    #    cycle members are gone, so we pull the full subtree of every node
    #    in the cycle before removing anyone.
    if remove_circular:
        if "FLAG_CIRCULAR_REFERENCE" in df_new.columns:
            circular_emps = df_new[df_new["FLAG_CIRCULAR_REFERENCE"] == 1][emp_col].astype(str).unique().tolist()
            all_remove = set()
            for emp in circular_emps:
                all_remove |= collect_subtree(df_new, emp_col, mgr_col, emp)
            df_new = df_new[~df_new[emp_col].astype(str).isin(all_remove)]
            print(f"✅ Removed {len(all_remove)} employees in/under circular reference chains")

    # 5. Drop all FLAG_ columns — data is now clean
    flag_columns = [col for col in df_new.columns if col.startswith("FLAG_")]
    if flag_columns:
        df_new = df_new.drop(columns=flag_columns)
        print(f"✅ Removed {len(flag_columns)} FLAG columns: {flag_columns}")

    return df_new