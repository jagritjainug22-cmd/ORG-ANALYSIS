"""
Parallel batch processing -- resolves Function names, then maps every input
row to a rationalised subfunction AND a rationalised title.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
import streamlit as st

from llm_client import resolve_functions, map_subfunction, map_title

MAX_WORKERS = 15


def _normalise_key(value):
    """Lowercase, strip whitespace, and treat '&' the same as 'and'."""
    import re
    s = str(value).strip().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _build_subfunc_lookup(master_df):
    """Build {normalised_function: [subfunction, ...]}."""
    lookup = {}
    for _, row in master_df.iterrows():
        key = _normalise_key(row["Function"])
        subfunc = str(row["Subfunction"]).strip()
        lookup.setdefault(key, []).append(subfunc)
    return lookup


def _build_title_lookup(title_df):
    """Build structures for title matching.

    Returns:
        exact_lookup : {(normalised_function, normalised_raw_title): standard_title}
        func_titles  : {normalised_function: [standard_title, ...]}
        all_titles   : [standard_title, ...]  (deduplicated)
    """
    exact_lookup = {}
    func_titles = {}
    all_set = set()

    for _, row in title_df.iterrows():
        func_key = _normalise_key(row["Function"])
        raw_key = _normalise_key(row["Title"])
        std = str(row["Standard Title"]).strip()

        exact_lookup[(func_key, raw_key)] = std
        func_titles.setdefault(func_key, []).append(std)
        all_set.add(std)

    return exact_lookup, func_titles, list(all_set)


def _resolve_input_functions(input_df, col_function, subfunc_lookup, title_by_func, func_display_names):
    """Run one-time LLM-based Function name resolution.

    Returns:
        func_resolution : dict  {original_input_function: normalised_master_key}
        resolution_df   : pd.DataFrame for UI display
    """
    input_funcs = sorted(set(
        str(v).strip() for v in input_df[col_function].unique() if pd.notna(v)
    ))

    master_funcs_set = set()
    for key in subfunc_lookup:
        master_funcs_set.add(key)
    for key in title_by_func:
        master_funcs_set.add(key)

    already_matched = {}
    needs_resolution = []
    for f in input_funcs:
        f_key = _normalise_key(f)
        if f_key in master_funcs_set:
            already_matched[f] = f_key
        else:
            needs_resolution.append(f)

    func_resolution = {}
    direct_match_set = set()
    for f, f_key in already_matched.items():
        func_resolution[f] = f_key
        direct_match_set.add(f)

    llm_resolved_set = set()
    if needs_resolution:
        master_display_list = sorted(func_display_names.values())
        llm_result = resolve_functions(needs_resolution, master_display_list)

        for f in needs_resolution:
            resolved = llm_result.get(f, f)
            resolved_key = _normalise_key(resolved)
            func_resolution[f] = resolved_key
            # Check if the LLM actually mapped it to a known master function
            if resolved_key in master_funcs_set:
                llm_resolved_set.add(f)

    # Build display table
    rows = []
    for f in input_funcs:
        resolved_key = func_resolution[f]
        display_name = func_display_names.get(resolved_key, f)

        if f in direct_match_set:
            method = "Direct Match"
        elif f in llm_resolved_set:
            method = "AI Resolved"
        else:
            method = "Unresolved - Not in mapping files"
            display_name = f  # keep original name

        rows.append({
            "Input Function": f,
            "Resolved To": display_name,
            "Method": method,
        })

    resolution_df = pd.DataFrame(rows)
    return func_resolution, resolution_df


# ---- task wrappers submitted to the thread pool ----

def _subfunc_task(idx, title, func, subfunc, candidates):
    return ("subfunc", map_subfunction(idx, title, func, subfunc, candidates))


def _title_task(idx, input_title, input_function, candidate_titles):
    return ("title", map_title(idx, input_title, input_function, candidate_titles))


def _build_display_names(master_df, title_df):
    """Build a mapping from normalised function key -> original-case display
    name, preferring the first occurrence found."""
    display = {}
    for name in master_df["Function"].unique():
        key = _normalise_key(name)
        if key not in display:
            display[key] = str(name).strip()
    for name in title_df["Function"].unique():
        key = _normalise_key(name)
        if key not in display:
            display[key] = str(name).strip()
    return display


def build_lookups(master_df, title_df):
    """Build all lookup structures from both mapping files.

    Returns (subfunc_lookup, title_exact, title_by_func,
             all_master_titles, func_display_names).
    """
    subfunc_lookup = _build_subfunc_lookup(master_df)
    title_exact, title_by_func, all_master_titles = _build_title_lookup(title_df)
    func_display_names = _build_display_names(master_df, title_df)

    return (subfunc_lookup, title_exact, title_by_func,
            all_master_titles, func_display_names)


def resolve_step(input_df, col_function, subfunc_lookup, title_by_func, func_display_names):
    """Step 1: resolve input Function names to master Function names.

    Returns (func_resolution_dict, resolution_display_df).
    """
    func_resolution, resolution_df = _resolve_input_functions(
        input_df, col_function, subfunc_lookup, title_by_func, func_display_names
    )
    return func_resolution, resolution_df


def process_rows(input_df, func_resolution, subfunc_lookup,
                 title_exact, title_by_func, all_master_titles,
                 col_title, col_function, col_subfunction):
    """Step 2: run parallel row-level processing using the verified
    function resolution.

    Adds four new columns to input_df:
      - Rationalised Subfunction / Subfunction Source
      - Rationalised Title / Title Source
    """

    # Build set of resolved keys that actually exist in the mapping files
    known_func_keys = set(subfunc_lookup.keys()) | set(title_by_func.keys())

    total = len(input_df)
    progress = st.progress(0, text="Processing rows...")

    subfunc_results = {}
    subfunc_sources = {}
    title_results = {}
    title_sources = {}

    completed = 0
    total_tasks = total * 2
    errors = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {}

        for idx, row in input_df.iterrows():
            title_val = str(row[col_title]).strip()
            func_val = str(row[col_function]).strip()
            subfunc_val = str(row[col_subfunction]).strip()

            resolved_func_key = func_resolution.get(func_val, _normalise_key(func_val))
            is_resolved = resolved_func_key in known_func_keys

            # --- subfunction ---
            sf_candidates = subfunc_lookup.get(resolved_func_key, [])
            if sf_candidates:
                sf_future = executor.submit(
                    _subfunc_task, idx, title_val, func_val, subfunc_val, sf_candidates
                )
                futures[sf_future] = ("subfunc", idx)
            else:
                # Unresolved function: use LLM to simplify the subfunction
                # without any master candidates
                sf_future = executor.submit(
                    _subfunc_task, idx, title_val, func_val, subfunc_val, []
                )
                futures[sf_future] = ("subfunc", idx)

            # --- title ---
            if is_resolved:
                title_key = _normalise_key(title_val)
                exact_match = title_exact.get((resolved_func_key, title_key))

                if exact_match is not None:
                    title_results[idx] = exact_match
                    title_sources[idx] = "Master File"
                    completed += 1
                else:
                    t_candidates = title_by_func.get(resolved_func_key, [])
                    if not t_candidates:
                        t_candidates = all_master_titles

                    t_future = executor.submit(
                        _title_task, idx, title_val, func_val, t_candidates
                    )
                    futures[t_future] = ("title", idx)
            else:
                # Unresolved function: keep original title as-is
                title_results[idx] = title_val
                title_sources[idx] = "Unresolved"
                completed += 1

        for future in as_completed(futures):
            completed += 1
            kind, row_idx = futures[future]

            try:
                task_kind, result_tuple = future.result()
                _, mapped_value, matched, was_error = result_tuple

                if kind == "subfunc":
                    subfunc_results[row_idx] = mapped_value
                    subfunc_sources[row_idx] = "Master File" if matched else "Gen AI"
                else:
                    title_results[row_idx] = mapped_value
                    title_sources[row_idx] = "Master File" if matched else "Gen AI"

                if was_error:
                    errors.append(f"Row {row_idx} ({kind})")

            except Exception as e:
                if kind == "subfunc":
                    subfunc_results[row_idx] = str(input_df.at[row_idx, col_subfunction])
                    subfunc_sources[row_idx] = "Gen AI"
                else:
                    title_results[row_idx] = str(input_df.at[row_idx, col_title])
                    title_sources[row_idx] = "Gen AI"
                errors.append(f"Row {row_idx} ({kind}): {e}")

            progress.progress(
                min(completed / total_tasks, 1.0),
                text=f"Processed {min(completed, total_tasks)} of {total_tasks} tasks...",
            )

    input_df["Rationalised Subfunction"] = input_df.index.map(subfunc_results)
    input_df["Subfunction Source"] = input_df.index.map(subfunc_sources)
    input_df["Rationalised Title"] = input_df.index.map(title_results)
    input_df["Title Source"] = input_df.index.map(title_sources)
    progress.progress(1.0, text="Done.")

    if errors:
        st.warning(
            f"LLM calls failed for {len(errors)} task(s). "
            "Original values kept for those rows."
        )

    return input_df
