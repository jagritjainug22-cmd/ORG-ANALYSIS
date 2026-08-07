import pandas as pd
import numpy as np

def generate_preview_data(df, col_x, col_y, fte_col, flc_col, threshold_metric, col_x_threshold, col_y_threshold):
    """Generate preview data showing which categories will be grouped as 'Others'"""
    try:
        preview = {}
        
        # Helper to get metric value
        def get_metric_total(df, metric_name, fte_col, flc_col):
            try:
                if metric_name == "Count":
                    return len(df)
                elif metric_name == "FTEs" and fte_col and fte_col in df.columns:
                    return float(df[fte_col].sum())
                elif metric_name == "FLC" and flc_col and flc_col in df.columns:
                    return float(df[flc_col].sum())
                elif metric_name == "Avg_FTE_cost" and fte_col and flc_col and fte_col in df.columns and flc_col in df.columns:
                    total_fte = float(df[fte_col].sum())
                    total_flc = float(df[flc_col].sum())
                    return total_flc / total_fte if total_fte > 0 else 0
                return 0
            except Exception as e:
                print(f"Error in get_metric_total: {e}")
                return 0
        
        # Column X preview
        if col_x and col_x in df.columns and col_x_threshold is not None:
            total_metric = get_metric_total(df, threshold_metric, fte_col, flc_col)
            if total_metric == 0:
                total_metric = 1  # Avoid division by zero
            
            categories = []
            for category in df[col_x].dropna().unique():
                cat_df = df[df[col_x] == category]
                metric_value = get_metric_total(cat_df, threshold_metric, fte_col, flc_col)
                percentage = (metric_value / total_metric * 100) if total_metric > 0 else 0
                categories.append({
                    "name": str(category),
                    "percentage": float(round(percentage, 2)),
                    "metric_value": float(round(metric_value, 2))
                })
            preview["colX_categories"] = categories
        
        # Column Y preview
        if col_y and col_y in df.columns and col_y_threshold is not None:
            total_metric = get_metric_total(df, threshold_metric, fte_col, flc_col)
            if total_metric == 0:
                total_metric = 1  # Avoid division by zero
            
            categories = []
            for category in df[col_y].dropna().unique():
                cat_df = df[df[col_y] == category]
                metric_value = get_metric_total(cat_df, threshold_metric, fte_col, flc_col)
                percentage = (metric_value / total_metric * 100) if total_metric > 0 else 0
                categories.append({
                    "name": str(category),
                    "percentage": float(round(percentage, 2)),
                    "metric_value": float(round(metric_value, 2))
                })
            preview["colY_categories"] = categories
        
        return preview
    except Exception as e:
        print(f"Error in generate_preview_data: {e}")
        import traceback
        traceback.print_exc()
        raise


def apply_others_grouping(df, col_x, col_y, fte_col, flc_col, 
                          col_x_threshold, col_y_threshold, 
                          threshold_metric, excluded_categories):
    """Apply 'Others' grouping to minority categories"""
    try:
        df = df.copy()
        
        def get_metric_total(df, metric_name, fte_col, flc_col):
            try:
                if metric_name == "Count":
                    return len(df)
                elif metric_name == "FTEs" and fte_col and fte_col in df.columns:
                    return float(df[fte_col].sum())
                elif metric_name == "FLC" and flc_col and flc_col in df.columns:
                    return float(df[flc_col].sum())
                elif metric_name == "Avg_FTE_cost" and fte_col and flc_col and fte_col in df.columns and flc_col in df.columns:
                    total_fte = float(df[fte_col].sum())
                    total_flc = float(df[flc_col].sum())
                    return total_flc / total_fte if total_fte > 0 else 0
                return 0
            except Exception as e:
                print(f"Error in get_metric_total: {e}")
                return 0
        
        # Group Column X
        if col_x and col_x in df.columns and col_x_threshold is not None:
            total_metric = get_metric_total(df, threshold_metric, fte_col, flc_col)
            if total_metric == 0:
                total_metric = 1  # Avoid division by zero
            
            categories_to_group = []
            
            for category in df[col_x].dropna().unique():
                cat_df = df[df[col_x] == category]
                metric_value = get_metric_total(cat_df, threshold_metric, fte_col, flc_col)
                percentage = (metric_value / total_metric * 100) if total_metric > 0 else 0
                
                # Check if below threshold and not excluded
                if percentage < col_x_threshold and f"colX:{category}" not in excluded_categories:
                    categories_to_group.append(category)
            
            # Replace with "Others"
            if categories_to_group:
                df.loc[df[col_x].isin(categories_to_group), col_x] = "Others"
        
        # Group Column Y
        if col_y and col_y in df.columns and col_y_threshold is not None:
            total_metric = get_metric_total(df, threshold_metric, fte_col, flc_col)
            if total_metric == 0:
                total_metric = 1  # Avoid division by zero
            
            categories_to_group = []
            
            for category in df[col_y].dropna().unique():
                cat_df = df[df[col_y] == category]
                metric_value = get_metric_total(cat_df, threshold_metric, fte_col, flc_col)
                percentage = (metric_value / total_metric * 100) if total_metric > 0 else 0
                
                # Check if below threshold and not excluded
                if percentage < col_y_threshold and f"colY:{category}" not in excluded_categories:
                    categories_to_group.append(category)
            
            # Replace with "Others"
            if categories_to_group:
                df.loc[df[col_y].isin(categories_to_group), col_y] = "Others"
        
        return df
    except Exception as e:
        print(f"Error in apply_others_grouping: {e}")
        import traceback
        traceback.print_exc()
        raise

def generate_crosstab(df: pd.DataFrame, col_x=None, col_y=None, fte_col=None, flc_col=None) -> pd.DataFrame:
    """
    Generate a crosstab summary with FTEs / FLC / Avg_FTE_cost.
    Adds TOTAL row and TOTAL column.
    Works for:
      - No columns selected
      - Only X
      - Only Y
      - Both X and Y (with multi-level columns)
    """
    df = df.copy()

    # Convert numeric safely
    for col in [fte_col, flc_col]:
        if col and col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    fte = fte_col if fte_col in df.columns else None
    flc = flc_col if flc_col in df.columns else None

    # Helper function to sort index with Others and TOTAL at the end
    def sort_index_with_others_and_total(df):
        """Sort dataframe index so Others comes second-to-last and TOTAL comes last"""
        index_list = df.index.tolist()
        
        # Separate Others, TOTAL, and regular items
        regular_items = [i for i in index_list if i not in ["Others", "TOTAL"]]
        has_others = "Others" in index_list
        has_total = "TOTAL" in index_list
        
        # Sort regular items
        regular_items.sort()
        
        # Build final order
        final_order = regular_items
        if has_others:
            final_order.append("Others")
        if has_total:
            final_order.append("TOTAL")
        
        return df.reindex(final_order)

    # ----------------- CASE 1: neither X nor Y -----------------
    if not col_x and not col_y:
        total_fte = df[fte].sum() if fte else 0
        total_flc = df[flc].sum() if flc else 0
        avg = total_flc / total_fte if total_fte else 0
        return pd.DataFrame({
            "FTEs": [round(total_fte, 0)],
            "FLC": [round(total_flc, 1)],
            "Avg_FTE_cost": [round(avg, 1)]
        }, index=["TOTAL"])

    # ----------------- CASE 2: only Y -----------------
    if col_y and not col_x:
        grp = df.groupby(col_y).agg(
            FTEs=(fte, "sum") if fte else ("FTEs", lambda x: 0),
            FLC=(flc, "sum") if flc else ("FLC", lambda x: 0)
        )
        grp["FTEs"] = grp["FTEs"].round(0)
        grp["FLC"] = grp["FLC"].round(1)
        grp["Avg_FTE_cost"] = (grp["FLC"] / grp["FTEs"].replace(0, np.nan)).fillna(0).round(1)

        # TOTAL row
        total_fte = grp["FTEs"].sum()
        total_flc = grp["FLC"].sum()
        total_row = pd.DataFrame({
            "FTEs": [round(total_fte, 0)],
            "FLC": [round(total_flc, 1)],
            "Avg_FTE_cost": [round(total_flc / total_fte if total_fte else 0, 1)]
        }, index=["TOTAL"])
        
        result = pd.concat([grp, total_row])
        return sort_index_with_others_and_total(result)

    # ----------------- CASE 3: only X -----------------
    if col_x and not col_y:
        grp = df.groupby(col_x).agg(
            FTEs=(fte, "sum") if fte else ("FTEs", lambda x: 0),
            FLC=(flc, "sum") if flc else ("FLC", lambda x: 0)
        )
        grp["FTEs"] = grp["FTEs"].round(0)
        grp["FLC"] = grp["FLC"].round(1)
        grp["Avg_FTE_cost"] = (grp["FLC"] / grp["FTEs"].replace(0, np.nan)).fillna(0).round(1)

        # TOTAL row
        total_fte = grp["FTEs"].sum()
        total_flc = grp["FLC"].sum()
        total_row = pd.DataFrame({
            "FTEs": [round(total_fte, 0)],
            "FLC": [round(total_flc, 1)],
            "Avg_FTE_cost": [round(total_flc / total_fte if total_fte else 0, 1)]
        }, index=["TOTAL"])
        
        result = pd.concat([grp, total_row])
        return sort_index_with_others_and_total(result)

    # ----------------- CASE 4: both X and Y -----------------
    # When col_x or col_y overlaps with the numeric value columns (fte/flc),
    # pivot_table would try to use the same column as both grouper and value,
    # causing "Grouper not 1-dimensional". Use temp names to avoid the conflict.
    pivot_df = df.copy()
    fte_val_col = fte
    flc_val_col = flc
    conflict_cols = {col_x, col_y}

    if fte and fte in conflict_cols:
        fte_val_col = f"__fte_val__"
        pivot_df[fte_val_col] = pivot_df[fte]

    if flc and flc in conflict_cols:
        flc_val_col = f"__flc_val__"
        pivot_df[flc_val_col] = pivot_df[flc]

    # Rows dimension = col_x, Columns dimension = col_y (standard crosstab convention)
    pivot_values = [c for c in [fte_val_col, flc_val_col] if c]
    pivot_raw = pd.pivot_table(
        pivot_df,
        index=col_x,
        columns=col_y,
        values=pivot_values,
        aggfunc="sum",
        fill_value=0
    )

    fte_pivot = pivot_raw[fte_val_col] if fte_val_col else pd.DataFrame(0, index=pivot_raw.index, columns=pivot_raw.columns.levels[1])
    flc_pivot = pivot_raw[flc_val_col] if flc_val_col else pd.DataFrame(0, index=pivot_raw.index, columns=pivot_raw.columns.levels[1])
    
    # Round before calculating avg
    fte_pivot = fte_pivot.round(0)
    flc_pivot = flc_pivot.round(1)
    avg = (flc_pivot / fte_pivot.replace(0, np.nan)).fillna(0).round(1)

    # Sort columns: regular columns first (alphabetically), then Others, then TOTAL
    cols = list(fte_pivot.columns)
    regular_cols = [c for c in cols if c not in ["Others", "TOTAL"]]
    regular_cols.sort()
    
    final_col_order = regular_cols
    if "Others" in cols:
        final_col_order.append("Others")
    if "TOTAL" in cols:
        final_col_order.append("TOTAL")
    
    fte_pivot = fte_pivot[final_col_order]
    flc_pivot = flc_pivot[final_col_order]
    avg = avg[final_col_order]

    # MultiIndex columns: under each Columns-dimension value: FTEs, FLC, Avg_FTE_cost
    multi_cols = pd.MultiIndex.from_product([final_col_order, ["FTEs", "FLC", "Avg_FTE_cost"]],
                                            names=["Columns", "Metric"])
    data = []
    for row_key in fte_pivot.index:
        row = []
        for col_key in final_col_order:
            row.extend([fte_pivot.loc[row_key, col_key], flc_pivot.loc[row_key, col_key], avg.loc[row_key, col_key]])
        data.append(row)
    pivot = pd.DataFrame(data, columns=multi_cols, index=fte_pivot.index)

    # TOTAL column
    total_fte = pivot.xs("FTEs", level="Metric", axis=1).sum(axis=1).round(0)
    total_flc = pivot.xs("FLC", level="Metric", axis=1).sum(axis=1).round(1)
    total_avg = (total_flc / total_fte.replace(0, np.nan)).fillna(0).round(1)
    pivot[("TOTAL", "FTEs")] = total_fte
    pivot[("TOTAL", "FLC")] = total_flc
    pivot[("TOTAL", "Avg_FTE_cost")] = total_avg

    # TOTAL row
    total_row = {}
    for (x, metric) in pivot.columns:
        if metric == "FTEs":
            total_row[(x, metric)] = round(pivot[(x, metric)].sum(), 0)
        elif metric == "FLC":
            total_row[(x, metric)] = round(pivot[(x, metric)].sum(), 1)
        else:
            fte_sum = pivot[(x, "FTEs")].sum()
            flc_sum = pivot[(x, "FLC")].sum()
            total_row[(x, metric)] = round(flc_sum / fte_sum if fte_sum else 0, 1)
    pivot.loc["TOTAL"] = total_row

    # Sort rows: regular rows first, then Others, then TOTAL
    return sort_index_with_others_and_total(pivot)