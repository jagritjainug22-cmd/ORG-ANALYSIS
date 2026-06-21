"""
Benchmark the full upload pipeline against sample_input_file.xlsx.
Prints per-step timing and key outputs.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

SAMPLE_FILE = Path(
    r"c:\Users\jagritjain\OneDrive - Alvarez and Marsal\Documents\APPS\ORG_ANALYSIS"
    r"\CENSUS_RATIONALISATION\app_2\app_2\excel data\sample_input_file.xlsx"
)


def section(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def timed(label: str, fn):
    t0 = time.perf_counter()
    result = fn()
    elapsed = time.perf_counter() - t0
    print(f"  Time: {elapsed:.2f}s")
    return result, elapsed


def main() -> None:
    timings: dict[str, float] = {}

    section("INPUT FILE")
    print(f"  Path: {SAMPLE_FILE}")
    print(f"  Exists: {SAMPLE_FILE.exists()}")

    # ── 1. Smart upload ──────────────────────────────────────────────
    section("STEP 1: Smart Excel read (preprocessing)")
    from services.upload_service import smart_read_excel

    file_bytes = SAMPLE_FILE.read_bytes()

    def do_read():
        return smart_read_excel(file_bytes, filename=SAMPLE_FILE.name)

    (df, preprocessing), timings["smart_read"] = timed("smart_read", do_read)

    print("  Preprocessing summary:")
    for k, v in preprocessing.items():
        print(f"    {k}: {v}")
    print(f"  Rows loaded: {len(df)}")
    print(f"  Columns ({len(df.columns)}): {list(df.columns)}")

    records = df.to_dict(orient="records")
    columns = df.columns.tolist()
    sample_rows = records[:10]

    # ── 2. Column mapping ────────────────────────────────────────────
    section("STEP 2: Auto column mapping")
    from services.column_mapping_service import auto_map_columns

    def do_map():
        return auto_map_columns(columns, sample_rows)

    col_mappings, timings["column_mapping"] = timed("column_mapping", do_map)

    mapped_count = sum(1 for m in col_mappings.values() if m.get("source_column"))
    print(f"  Mapped: {mapped_count}/{len(col_mappings)} target columns")
    print("\n  All mappings:")
    for tid, m in col_mappings.items():
        src = m.get("source_column") or "(none)"
        print(f"    {m['label']:22s} <- {src:35s} [{m['method']:12s} conf={m['confidence']}]")

    emp_col = (col_mappings.get("employee_id") or {}).get("source_column")
    mgr_col = (col_mappings.get("manager_id") or {}).get("source_column")
    country_col = (col_mappings.get("country") or {}).get("source_column")
    func_col = (col_mappings.get("function") or {}).get("source_column")
    subfunc_col = (col_mappings.get("subfunction") or {}).get("source_column")
    title_col = (col_mappings.get("job_title") or {}).get("source_column")

    # ── 3. Cleanup ───────────────────────────────────────────────────
    section("STEP 3: Cleanup (country flags + exclusion filter)")
    from services.cleanup_service import apply_exclusion_filter, build_country_flag
    import numpy as np

    def do_cleanup():
        d = df.copy()
        d = build_country_flag(d, country_col=country_col)
        d, removed = apply_exclusion_filter(d, remove=True)
        return d, removed

    (df, cleanup_removed), timings["cleanup"] = timed("cleanup", do_cleanup)
    records = df.to_dict(orient="records")
    print(f"  Exclusion rows removed: {cleanup_removed}")
    print(f"  Country column used: {country_col}")
    if country_col and country_col in df.columns:
        flags = df["Country_Flag"].dropna().unique()[:5]
        print(f"  Sample Country_Flag values: {list(flags)}")

    # ── 4. Rationalisation ───────────────────────────────────────────
    section("STEP 4: Rationalisation (exact + fuzzy + LLM)")
    from services.rationalisation_service import rationalise

    def do_rationalise():
        return rationalise(records, func_col, subfunc_col, title_col)

    rationalisation, timings["rationalisation"] = timed("rationalisation", do_rationalise)

    summary = rationalisation.get("summary", {})
    print("\n  Summary stats:")
    for k, v in sorted(summary.items()):
        print(f"    {k}: {v}")

    def print_mappings(label, items, limit=15):
        print(f"\n  {label} ({len(items)} unique) — showing up to {limit}:")
        # Show AI/unresolved first, then others
        priority = [m for m in items if m.get("method") in ("ai", "unresolved", "fuzzy")]
        rest = [m for m in items if m.get("method") not in ("ai", "unresolved", "fuzzy")]
        shown = (priority + rest)[:limit]
        for m in shown:
            if "function" in m and "input" in m and label.startswith("Sub"):
                print(
                    f"    [{m.get('function','')}] {m['input']!r} -> {m['resolved']!r} "
                    f"[{m['method']} conf={m.get('confidence')}]"
                )
            elif "function" in m and label.startswith("Title"):
                print(
                    f"    [{m.get('function','')}] {m['input']!r} -> {m['resolved']!r} "
                    f"[{m['method']} conf={m.get('confidence')}]"
                )
            else:
                print(
                    f"    {m.get('input','')!r} -> {m.get('resolved','')!r} "
                    f"[{m.get('method')} conf={m.get('confidence')}]"
                )

    print_mappings("Functions", rationalisation.get("function_mappings", []))
    print_mappings("Subfunctions", rationalisation.get("subfunction_mappings", []))
    print_mappings("Titles", rationalisation.get("title_mappings", []))

    # ── 5. Validation ────────────────────────────────────────────────
    section("STEP 5: Validation (hierarchy checks)")
    from services.validation_service import validate_org_data

    def do_validate():
        return validate_org_data(df, emp_col, mgr_col)

    validation, timings["validation"] = timed("validation", do_validate)

    if validation:
        val_summary = validation.get("summary", validation)
        print("  Validation summary:")
        if isinstance(val_summary, dict):
            for k, v in val_summary.items():
                if k != "records":
                    print(f"    {k}: {v}")
        # Count flags if present in returned df
        if "df" in validation:
            vdf = validation["df"]
            flag_cols = [c for c in vdf.columns if str(c).startswith("FLAG_")]
            for fc in flag_cols:
                count = int(vdf[fc].fillna(0).astype(bool).sum()) if fc in vdf.columns else 0
                if count:
                    print(f"    {fc}: {count} rows flagged")

    # ── 6. API end-to-end (optional) ─────────────────────────────────
    section("STEP 6: API process-upload (end-to-end via HTTP)")
    try:
        import requests

        base = "http://127.0.0.1:8001"
        t0 = time.perf_counter()
        login = requests.post(
            f"{base}/auth/login",
            json={"username": "am.admin", "password": "AM@dmin2026!"},
            timeout=30,
        )
        login.raise_for_status()
        token = login.json()["access_token"]
        t_login = time.perf_counter() - t0

        t0 = time.perf_counter()
        with open(SAMPLE_FILE, "rb") as f:
            resp = requests.post(
                f"{base}/projects/1/process-upload",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": (SAMPLE_FILE.name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                timeout=300,
            )
        t_api = time.perf_counter() - t0
        timings["api_login"] = t_login
        timings["api_process_upload"] = t_api

        print(f"  Login time: {t_login:.2f}s")
        print(f"  process-upload HTTP status: {resp.status_code}")
        print(f"  process-upload time: {t_api:.2f}s")

        if resp.status_code == 200:
            data = resp.json()
            print(f"  API rows returned: {len(data.get('records', []))}")
            print(f"  API columns: {len(data.get('columns', []))}")
            api_sum = (data.get("rationalisation") or {}).get("summary", {})
            if api_sum:
                print("  API rationalisation summary:", json.dumps(api_sum, indent=2))
            val = data.get("validation")
            if val and isinstance(val, dict):
                print("  API validation keys:", list(val.keys())[:10])
        else:
            print(f"  API error body: {resp.text[:500]}")
    except Exception as e:
        print(f"  API test skipped/failed: {type(e).__name__}: {e}")

    # ── Timing summary ─────────────────────────────────────────────────
    section("TIMING SUMMARY")
    total_local = sum(
        timings.get(k, 0)
        for k in ("smart_read", "column_mapping", "cleanup", "rationalisation", "validation")
    )
    for step, secs in timings.items():
        pct = (secs / total_local * 100) if total_local and step in (
            "smart_read", "column_mapping", "cleanup", "rationalisation", "validation"
        ) else None
        if pct is not None:
            print(f"  {step:25s} {secs:6.2f}s  ({pct:5.1f}% of local pipeline)")
        else:
            print(f"  {step:25s} {secs:6.2f}s")
    print(f"  {'TOTAL (local pipeline)':25s} {total_local:6.2f}s")
    if "api_process_upload" in timings:
        print(f"  {'TOTAL (API incl. login)':25s} {timings.get('api_login',0)+timings['api_process_upload']:6.2f}s")


if __name__ == "__main__":
    main()
