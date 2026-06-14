import pandas as pd
from functools import lru_cache

def compute_levels(df, emp_col, mgr_col):
    df = df.copy()
    df[emp_col] = df[emp_col].astype(str)
    df[mgr_col] = df[mgr_col].astype(str).replace(["nan", "None", ""], pd.NA)

    manager_map = dict(zip(df[emp_col], df[mgr_col]))

    def get_level(emp, cache={}):
        if emp in cache:
            return cache[emp]
        mgr = manager_map.get(emp)
        if pd.isna(mgr) or mgr not in manager_map or mgr == emp:
            cache[emp] = 1
        else:
            cache[emp] = get_level(mgr, cache) + 1
        return cache[emp]

    df["Level"] = df[emp_col].apply(get_level)
    return df


def compute_chains(df, emp_col, mgr_col):
    df = df.copy()
    manager_map = dict(zip(df[emp_col], df[mgr_col]))

    def get_chain(emp):
        chain = []
        curr = emp
        while curr in manager_map:
            mgr = manager_map[curr]
            if pd.isna(mgr) or mgr in ["nan", "None", ""]:
                break
            chain.append(mgr)
            curr = mgr
        return chain

    df["Chain"] = df[emp_col].apply(get_chain)
    df["Chain"] = df["Chain"].apply(lambda x: [v for v in x if pd.notna(v)])
    df["Chain_reversed"] = df.apply(lambda r: list(reversed(r["Chain"])) + [r[emp_col]], axis=1)

    max_depth = max(df["Chain_reversed"].apply(len))
    for i in range(max_depth):
        df[f"L{i+1}"] = df["Chain_reversed"].apply(lambda x: x[i] if len(x) > i else "")

    return df, max_depth


def compute_total_reports(df, emp_col, mgr_col):
    df = df.copy()

    children = {}
    for m, e in zip(df[mgr_col], df[emp_col]):
        children.setdefault(m, []).append(e)

    @lru_cache(None)
    def subtree_size(mgr):
        if mgr not in children:
            return 0
        total = len(children[mgr])
        for c in children[mgr]:
            total += subtree_size(c)
        return total

    df["Total_Reports"] = df[emp_col].apply(lambda x: subtree_size(x))
    return df


def compute_avg_flc(df, flc_col, fte_col):
    df = df.copy()
    if flc_col in df.columns and fte_col in df.columns:
        def safe_calc(r):
            fte = r[fte_col]
            if pd.isna(fte) or fte in (0, 0.0, None):
                return 0
            return round(r[flc_col] / fte, 1)
        df["Avg_FLC"] = df.apply(safe_calc, axis=1)
    else:
        df["Avg_FLC"] = 0
    return df

def sort_hierarchy(df, max_depth):
    """
    Sort dataframe by Level ascending, then by number of blanks descending.
    This puts top-level managers first and ensures proper hierarchical ordering.
    """
    df = df.copy()
    
    # Get all L* columns
    blank_cols = [f"L{i+1}" for i in range(max_depth)]
    
    def count_blanks_after_level(row):
        """Count blank cells in L* columns after the employee's level"""
        level = row["Level"]
        # L* indices are 0-based: L1 is index 0
        remaining_cols = blank_cols[level:]  # columns after current level
        return sum(1 for c in remaining_cols if row[c] == "")
    
    df["Blank_After_Level"] = df.apply(count_blanks_after_level, axis=1)
    
    # Sort by Level ascending, then by Blank_After_Level descending within each level
    df = df.sort_values(
        by=["Level", "Blank_After_Level"], 
        ascending=[True, False]
    ).drop(columns="Blank_After_Level")
    
    return df