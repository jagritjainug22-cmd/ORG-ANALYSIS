import pandas as pd
from functools import lru_cache


def compute_levels(df, emp_col, mgr_col):
    df = df.copy()
    df[emp_col] = df[emp_col].astype(str)
    df[mgr_col] = df[mgr_col].astype(str).replace(["nan", "None", ""], pd.NA)

    manager_map = dict(zip(df[emp_col], df[mgr_col]))

    def get_level(emp):
        """Iterative (non-recursive) level computation with cycle detection."""
        visited = set()
        chain = []
        curr = emp

        # Walk up the chain until we hit a root or a cycle
        while True:
            if curr in visited:
                # Cycle detected — assign level 1 to every node in the cycle
                for node in chain:
                    level_cache[node] = 1
                return 1

            if curr in level_cache:
                # We've already computed this node; resolve the chain
                base = level_cache[curr]
                for i, node in enumerate(reversed(chain)):
                    level_cache[node] = base + i + 1
                return level_cache[emp]

            mgr = manager_map.get(curr)
            if pd.isna(mgr) or mgr not in manager_map or mgr == curr:
                # Root node
                level_cache[curr] = 1
                base = 1
                for i, node in enumerate(reversed(chain)):
                    level_cache[node] = base + i + 1
                return level_cache[emp]

            visited.add(curr)
            chain.append(curr)
            curr = mgr

    level_cache = {}
    df["Level"] = df[emp_col].apply(get_level)
    return df


def compute_chains(df, emp_col, mgr_col):
    df = df.copy()
    manager_map = dict(zip(df[emp_col], df[mgr_col]))

    def get_chain(emp):
        chain = []
        visited = set()
        curr = emp
        while curr in manager_map:
            mgr = manager_map[curr]
            if pd.isna(mgr) or mgr in ["nan", "None", ""]:
                break
            if mgr in visited:
                # Cycle — stop here instead of looping forever
                break
            visited.add(curr)
            chain.append(mgr)
            curr = mgr
        return chain

    df["Chain"] = df[emp_col].apply(get_chain)
    df["Chain"] = df["Chain"].apply(lambda x: [v for v in x if pd.notna(v)])
    df["Chain_reversed"] = df.apply(
        lambda r: list(reversed(r["Chain"])) + [r[emp_col]], axis=1
    )

    max_depth = max(df["Chain_reversed"].apply(len))
    for i in range(max_depth):
        df[f"L{i+1}"] = df["Chain_reversed"].apply(
            lambda x: x[i] if len(x) > i else ""
        )

    return df, max_depth


def compute_direct_span(df, emp_col, mgr_col):
    """Count direct reports per employee (Span of control)."""
    df = df.copy()
    span_dict = df[mgr_col].value_counts().to_dict()
    df["Span"] = df[emp_col].apply(lambda x: span_dict.get(x, 0))
    return df


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
    """
    df = df.copy()
    blank_cols = [f"L{i+1}" for i in range(max_depth)]

    def count_blanks_after_level(row):
        level = row["Level"]
        remaining_cols = blank_cols[level:]
        return sum(1 for c in remaining_cols if row[c] == "")

    df["Blank_After_Level"] = df.apply(count_blanks_after_level, axis=1)
    df = df.sort_values(
        by=["Level", "Blank_After_Level"],
        ascending=[True, False]
    ).drop(columns="Blank_After_Level")

    return df