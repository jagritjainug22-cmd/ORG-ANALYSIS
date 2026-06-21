"""
Benchmark rationalisation with batch=200, workers=10 on a clean run.

Clean run = no cache, no learned aliases, fresh LLM metrics.
Uses sample_input_file.xlsx (48 rows, messy census data).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

# Force config before import side-effects
os.environ.setdefault("RATIONALISATION_BATCH_SIZE", "200")
os.environ.setdefault("LLM_MAX_WORKERS", "10")
os.environ.setdefault("RATIONALISATION_BATCH_MAX_TOKENS", "12000")

SAMPLE_FILE = Path(
    r"c:\Users\jagritjain\OneDrive - Alvarez and Marsal\Documents\APPS\ORG_ANALYSIS"
    r"\CENSUS_RATIONALISATION\app_2\app_2\excel data\sample_input_file.xlsx"
)


def section(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def main() -> None:
    from services.upload_service import smart_read_excel
    from services.column_mapping_service import auto_map_columns
    from services.rationalisation_service import rationalise, get_rationalisation_config
    from services.llm_service import reset_llm_metrics, get_llm_metrics

    section("CONFIG")
    cfg = get_rationalisation_config()
    for k, v in cfg.items():
        print(f"  {k}: {v}")
    print(f"  deployment: {os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME', '?')}")

    section("INPUT")
    print(f"  File: {SAMPLE_FILE}")
    print(f"  Exists: {SAMPLE_FILE.exists()}")

    t0 = time.perf_counter()
    df, prep = smart_read_excel(SAMPLE_FILE.read_bytes(), filename=SAMPLE_FILE.name)
    t_read = time.perf_counter() - t0
    print(f"  Rows: {len(df)}")
    print(f"  Read time: {t_read:.2f}s")
    print(f"  Sheet: {prep.get('sheet_used')}")

    records = df.to_dict(orient="records")
    columns = df.columns.tolist()

    t0 = time.perf_counter()
    col_map = auto_map_columns(columns, records[:10])
    t_map = time.perf_counter() - t0

    func_col = (col_map.get("function") or {}).get("source_column")
    subfunc_col = (col_map.get("subfunction") or {}).get("source_column")
    title_col = (col_map.get("job_title") or {}).get("source_column")

    print(f"  Column mapping time: {t_map:.2f}s")
    print(f"  Function col: {func_col}")
    print(f"  Subfunction col: {subfunc_col}")
    print(f"  Title col: {title_col}")

    # Unique counts
    import pandas as pd
    d = pd.DataFrame(records)
    n_func = d[func_col].nunique() if func_col else 0
    n_sub = d[[func_col, subfunc_col]].drop_duplicates().shape[0] if func_col and subfunc_col else 0
    n_title = d[[func_col, title_col]].drop_duplicates().shape[0] if func_col and title_col else 0
    print(f"  Unique functions: {n_func}")
    print(f"  Unique (func, subfunc) pairs: {n_sub}")
    print(f"  Unique (func, title) pairs: {n_title}")

    section("CLEAN RATIONALISATION RUN (no cache, no learned aliases)")
    reset_llm_metrics()

    t0 = time.perf_counter()
    result = rationalise(
        records,
        func_col,
        subfunc_col,
        title_col,
        use_cache=False,
        enrich_learned=False,
        ignore_learned_aliases=True,
        reset_metrics=True,
    )
    t_rat = time.perf_counter() - t0

    print(f"  Wall-clock rationalisation: {t_rat:.2f}s")

    section("SUMMARY BY METHOD")
    summary = result.get("summary", {})
    for k in sorted(summary.keys()):
        print(f"  {k}: {summary[k]}")

    section("LLM ACCURACY / COMPLETENESS")
    accuracy = result.get("accuracy", {})
    for k, v in accuracy.items():
        print(f"  {k}: {v}")

    unresolved = sum(1 for m in result.get("subfunction_mappings", []) if m.get("method") == "unresolved")
    unresolved += sum(1 for m in result.get("title_mappings", []) if m.get("method") == "unresolved")
    unresolved += sum(1 for m in result.get("function_mappings", []) if m.get("method") == "unresolved")
    total_unique = (
        len(result.get("function_mappings", []))
        + len(result.get("subfunction_mappings", []))
        + len(result.get("title_mappings", []))
    )
    resolved_all = total_unique - unresolved
    print(f"  overall_resolved_pct: {round(100.0 * resolved_all / total_unique, 2) if total_unique else 100}%")
    print(f"  overall_unresolved_count: {unresolved}")

    section("LLM TOKEN USAGE")
    metrics = result.get("llm_metrics") or get_llm_metrics()
    if metrics.get("call_count", 0) == 0 and (accuracy.get("subfunctions_sent_to_llm", 0) or accuracy.get("titles_sent_to_llm", 0)):
        print("  WARNING: No successful LLM calls — check Azure connectivity (403 = private endpoint / VPN required)")
    print(f"  total_llm_calls: {metrics.get('call_count')}")
    print(f"  prompt_tokens (input): {metrics.get('prompt_tokens')}")
    print(f"  completion_tokens (output): {metrics.get('completion_tokens')}")
    print(f"  total_tokens: {metrics.get('total_tokens')}")
    print(f"  llm_completeness_pct: {metrics.get('completeness_pct')}%")
    print(f"  sum_call_latency_ms: {metrics.get('total_latency_ms')} (parallel calls overlap in wall-clock)")

    print("\n  Per-call breakdown:")
    for i, call in enumerate(metrics.get("calls", []), 1):
        print(
            f"    [{i}] {call['call_type']:20s} "
            f"in={call['prompt_tokens']:5d} out={call['completion_tokens']:5d} "
            f"total={call['total_tokens']:5d} "
            f"items={call['outputs_returned']}/{call['inputs_requested']} "
            f"batch={call['batch_size']} "
            f"latency={call['latency_ms']}ms "
            f"{'RETRY' if call.get('retry') else ''}"
        )

    section("SAMPLE AI MAPPINGS (first 10 each)")
    for label, items in [
        ("Functions", result.get("function_mappings", [])),
        ("Subfunctions", [m for m in result.get("subfunction_mappings", []) if m.get("method") == "ai"][:10]),
        ("Titles", [m for m in result.get("title_mappings", []) if m.get("method") == "ai"][:10]),
    ]:
        print(f"\n  {label}:")
        for m in items[:10]:
            if "function" in m and label != "Functions":
                print(f"    [{m['function']}] {m['input']!r} -> {m['resolved']!r} [{m['method']}]")
            else:
                print(f"    {m.get('input','')!r} -> {m.get('resolved','')!r} [{m.get('method')}]")

    section("TIMING TOTAL")
    total = t_read + t_map + t_rat
    print(f"  excel_read:        {t_read:6.2f}s")
    print(f"  column_mapping:    {t_map:6.2f}s")
    print(f"  rationalisation:   {t_rat:6.2f}s")
    print(f"  TOTAL:             {total:6.2f}s")

    out_path = BACKEND / "benchmark_output.txt"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "config": cfg,
                "timings": {"read": t_read, "column_mapping": t_map, "rationalisation": t_rat, "total": total},
                "summary": summary,
                "accuracy": accuracy,
                "llm_metrics": metrics,
            },
            f,
            indent=2,
        )
    print(f"\n  Full JSON written to: {out_path}")


if __name__ == "__main__":
    main()
