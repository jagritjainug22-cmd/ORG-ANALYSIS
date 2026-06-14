import pandas as pd
import numpy as np

def build_org_tree(df, emp_col, mgr_col, limit_level=None):
    """
    Build org tree from dataframe.
    If limit_level is provided, filters nodes by level but preserves all ancestors.
    """
    print(f"🌳 [build_org_tree] Starting with {len(df)} rows")
    print(f"🌳 [build_org_tree] limit_level: {limit_level}")
    
    df = df.copy()
    df[emp_col] = df[emp_col].astype(str)
    df[mgr_col] = df[mgr_col].astype(str)
    
    # Replace inf/-inf with NaN and fill with 0
    for col in df.select_dtypes(include=[np.number]).columns:
        df[col] = df[col].replace([np.inf, -np.inf], np.nan).fillna(0)
    
    print(f"📊 [build_org_tree] Sample levels in df: {df['Level'].value_counts().head().to_dict()}")
    
    # Apply level filtering with ancestor preservation
    if limit_level is not None:
        print(f"🔍 [build_org_tree] Applying level filter <= {limit_level}")
        filtered_subset = df[df["Level"] <= limit_level].copy()
        print(f"📊 [build_org_tree] Filtered subset has {len(filtered_subset)} rows")
        df = build_tree_preserve_ancestors(df, filtered_subset, emp_col, mgr_col)
        print(f"📊 [build_org_tree] After preserving ancestors: {len(df)} rows")
    
    # Find root
    df[mgr_col] = df[mgr_col].replace('nan', np.nan)
    roots = df[pd.isna(df[mgr_col]) | 
               ~df[mgr_col].isin(df[emp_col])]
    
    print(f"🌟 [build_org_tree] Found {len(roots)} root candidates")
    
    if roots.empty:
        if "Total_Reports" in df.columns:
            root_emp = df.loc[df["Total_Reports"].idxmax()][emp_col]
        else:
            root_emp = df.iloc[0][emp_col]
    else:
        root_emp = roots.iloc[0][emp_col]
    
    print(f"🌟 [build_org_tree] Selected root: {root_emp}")
    
    # Build nodes dict
    nodes = {}
    for _, row in df.iterrows():
        emp_id = str(row[emp_col])
        node_data = row.to_dict()
        node_data["children"] = []
        nodes[emp_id] = node_data
    
    print(f"📦 [build_org_tree] Created {len(nodes)} nodes")
    
    # Build tree structure
    for _, row in df.iterrows():
        emp_id = str(row[emp_col])
        mgr_id = str(row[mgr_col])
        
        if emp_id == root_emp:
            continue
            
        if pd.notna(row[mgr_col]) and mgr_id in nodes:
            nodes[mgr_id]["children"].append(nodes[emp_id])
    
    tree = nodes[root_emp]
    
    # Count children at each level
    def count_children_by_level(node, level=1):
        counts = {level: 1}
        if node.get("children"):
            for child in node["children"]:
                child_counts = count_children_by_level(child, level + 1)
                for k, v in child_counts.items():
                    counts[k] = counts.get(k, 0) + v
        return counts
    
    level_counts = count_children_by_level(tree)
    print(f"📊 [build_org_tree] Tree node counts by level: {level_counts}")
    
    return make_json_serializable(tree)


def build_tree_preserve_ancestors(df_full, df_subset, emp_col, mgr_col):
    """
    Build tree from filtered subset but preserve all ancestors from full dataset.
    Nodes not in filtered subset are marked as added_ancestor=True.
    """
    print(f"🔧 [preserve_ancestors] Starting with full df: {len(df_full)} rows, subset: {len(df_subset)} rows")
    
    nodes_to_include = df_subset.copy()
    nodes_to_include["added_ancestor"] = False
    
    print(f"📊 [preserve_ancestors] Subset levels: {df_subset['Level'].value_counts().to_dict()}")
    
    # Quick lookup dict
    full_lookup = {str(r[emp_col]): r for _, r in df_full.iterrows()}
    
    print(f"🔍 [preserve_ancestors] Starting ancestor walk for {len(df_subset)} nodes")
    
    ancestors_added = 0
    
    # Add all ancestors
    for idx, row in df_subset.iterrows():
        emp_id = str(row[emp_col])
        mgr_id = str(row[mgr_col])
        
        ancestor_chain = []
        
        while pd.notna(mgr_id) and mgr_id != 'nan':
            # Check if already included
            if mgr_id in nodes_to_include[emp_col].astype(str).values:
                break
            
            mgr_row = full_lookup.get(mgr_id)
            if mgr_row is None:
                print(f"⚠️ [preserve_ancestors] Manager {mgr_id} not found in full dataset")
                break
            
            ancestor_chain.append(mgr_id)
            
            # Add ancestor
            mgr_row_copy = mgr_row.copy()
            mgr_row_copy["added_ancestor"] = True
            nodes_to_include = pd.concat(
                [nodes_to_include, pd.DataFrame([mgr_row_copy])], 
                ignore_index=True
            )
            ancestors_added += 1
            
            mgr_id = str(mgr_row[mgr_col])
        
        if ancestor_chain:
            print(f"🔗 [preserve_ancestors] Employee {emp_id} (Level {row['Level']}): added {len(ancestor_chain)} ancestors: {ancestor_chain}")
    
    print(f"✅ [preserve_ancestors] Added {ancestors_added} ancestors")
    
    # Remove duplicates
    nodes_to_include = nodes_to_include.drop_duplicates(subset=[emp_col])
    
    print(f"📊 [preserve_ancestors] Final df: {len(nodes_to_include)} rows")
    print(f"📊 [preserve_ancestors] Final levels: {nodes_to_include['Level'].value_counts().to_dict()}")
    print(f"📊 [preserve_ancestors] Ancestors count: {nodes_to_include['added_ancestor'].sum()}")
    
    return nodes_to_include


def make_json_serializable(d):
    """
    Recursively convert data structure to JSON-serializable format.
    Handles pandas types, numpy types, NaN, and infinity.
    """
    if isinstance(d, dict):
        return {k: make_json_serializable(v) for k, v in d.items()}
    
    if isinstance(d, list):
        return [make_json_serializable(x) for x in d]
    
    if isinstance(d, (pd.Timestamp, pd.Timedelta)):
        return str(d)
    
    if isinstance(d, np.generic):
        val = d.item()
        if isinstance(val, float) and (np.isnan(val) or np.isinf(val)):
            return None
        return val
    
    if isinstance(d, float):
        if np.isnan(d) or np.isinf(d):
            return None
        return d
    
    if isinstance(d, (int, str, bool)) or d is None:
        return d
    
    return str(d)