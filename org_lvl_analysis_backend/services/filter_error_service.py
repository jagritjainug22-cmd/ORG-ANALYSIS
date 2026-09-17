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


def _is_flagged(series: pd.Series) -> pd.Series:
    """True where a FLAG_ column marks the row (handles int/bool/str from JSON)."""
    return series.isin([1, True, "1"])


def filter_errors(df, emp_col, mgr_col, remove_dup=True, remove_missing=True, remove_invalid=True, remove_circular=True):
    """
    Filter out rows with validation errors.
    After filtering, removes all FLAG_ columns since the data is now clean.

    Invalid manager references: remove only the flagged rows (not their subtrees).
    External/parent-company manager IDs often sit at the top of a real census;
    cascading subtree deletes would wipe the entire org.
    Circular references still remove the cycle members and their subtrees.
    """
    df_new = df.copy()

    # 1. Remove duplicates (keep first occurrence)
    if remove_dup:
        df_new = df_new.drop_duplicates(subset=[emp_col], keep="first")

    # 2. Remove records with missing manager IDs
    if remove_missing:
        if "FLAG_MISSING_MANAGER_ID" in df_new.columns:
            df_new = df_new[~_is_flagged(df_new["FLAG_MISSING_MANAGER_ID"])]

    # 3. Remove only rows flagged for invalid/external manager IDs.
    #    Do NOT cascade to subtrees — those people are still in the census;
    #    only their manager link pointed outside the file.
    if remove_invalid:
        if "FLAG_MANAGER_ID_NOT_EMPLOYEE" in df_new.columns:
            before = len(df_new)
            df_new = df_new[~_is_flagged(df_new["FLAG_MANAGER_ID_NOT_EMPLOYEE"])]
            print(f"[filter] Removed {before - len(df_new)} rows with invalid manager references (flagged rows only)")

    # 4. Remove circular reference employees and their entire subtrees
    #    Employees who report UP INTO the cycle are also orphaned once the
    #    cycle members are gone, so we pull the full subtree of every node
    #    in the cycle before removing anyone.
    if remove_circular:
        if "FLAG_CIRCULAR_REFERENCE" in df_new.columns:
            circular_emps = (
                df_new.loc[_is_flagged(df_new["FLAG_CIRCULAR_REFERENCE"]), emp_col]
                .astype(str)
                .unique()
                .tolist()
            )
            all_remove = set()
            for emp in circular_emps:
                all_remove |= collect_subtree(df_new, emp_col, mgr_col, emp)
            df_new = df_new[~df_new[emp_col].astype(str).isin(all_remove)]
            print(f"[filter] Removed {len(all_remove)} employees in/under circular reference chains")

    # 5. Drop all FLAG_ columns — data is now clean
    flag_columns = [col for col in df_new.columns if col.startswith("FLAG_")]
    if flag_columns:
        df_new = df_new.drop(columns=flag_columns)
        print(f"[filter] Removed {len(flag_columns)} FLAG columns: {flag_columns}")

    return df_new
