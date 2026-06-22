"""One-off benchmark: rationalise OrgSight_Rationalisation_Test_100rows.xlsx."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent
ROOT = BACKEND.parents[1]
SAMPLE = ROOT / "sample_data" / "OrgSight_Rationalisation_Test_100rows.xlsx"

load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

from services.upload_service import smart_read_excel  # noqa: E402
from services.column_mapping_service import auto_map_columns  # noqa: E402
from services.rationalisation_service import rationalise, get_rationalisation_config  # noqa: E402
from services.llm_service import reset_llm_metrics, get_llm_metrics  # noqa: E402
import pandas as pd  # noqa: E402


def section(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def main() -> None:
    section("CONFIG")
    cfg = get_rationalisation_config()
    for k, v in cfg.items():
        print(f"  {k}: {v}")
    print(f"  deployment: {os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME', '?')}")

    section("INPUT")
    print(f"  File: {SAMPLE}")
    t0 = time.perf_counter()
    df, prep = smart_read_excel(SAMPLE.read_bytes(), filename=SAMPLE.name)
    t_read = time.perf_counter() - t0
    records = df.to_dict(orient="records")
    print(f"  Rows: {len(df)}  Cols: {len(df.columns)}  Read: {t_read:.2f}s")
    print(f"  Sheet: {prep.get('sheet_used')}  Header row: {prep.get('header_row')}")

    t0 = time.perf_counter()
    col_map = auto_map_columns(df.columns.tolist(), records[:10])
    t_map = time.perf_counter() - t0
    func_col = (col_map.get("function") or {}).get("source_column")
    subfunc_col = (col_map.get("subfunction") or {}).get("source_column")
    title_col = (col_map.get("job_title") or {}).get("source_column")
    print(f"  Column map: {t_map:.2f}s")
    print(f"  Function: {func_col}  Subfunction: {subfunc_col}  Title: {title_col}")

    d = pd.DataFrame(records)
    print(f"  Unique functions: {d[func_col].nunique() if func_col else 0}")
    if func_col and subfunc_col:
        print(f"  Unique (func,subfunc): {d[[func_col, subfunc_col]].drop_duplicates().shape[0]}")
    if func_col and title_col:
        print(f"  Unique (func,title): {d[[func_col, title_col]].drop_duplicates().shape[0]}")

    section("CLEAN RATIONALISATION (no cache, no learned aliases)")
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
    print(f"  Wall-clock: {t_rat:.2f}s")

    bp = result.get("batch_plan", {})
    if bp:
        print(f"  Batch plan: subfunc={bp.get('subfunction_batches')} title={bp.get('title_batches')}")
        print(f"  LLM jobs: {bp.get('total_llm_jobs')}  workers_used: {bp.get('workers_used')}")

    section("SUMMARY BY METHOD")
    summary = result.get("summary", {})
    for k in sorted(summary.keys()):
        print(f"  {k}: {summary[k]}")

    section("LLM METRICS")
    metrics = result.get("llm_metrics") or get_llm_metrics()
    print(f"  calls: {metrics.get('call_count')}  tokens: {metrics.get('total_tokens')}  completeness: {metrics.get('completeness_pct')}%")
    for i, call in enumerate(metrics.get("calls", []), 1):
        print(
            f"    [{i}] {call['call_type']:18s} in={call['prompt_tokens']} out={call['completion_tokens']} "
            f"items={call['outputs_returned']}/{call['inputs_requested']} {call['latency_ms']}ms"
        )

    section("FUNCTION MAPPINGS (all)")
    for m in result.get("function_mappings", []):
        flag = " ***" if m["input"] != m["resolved"] else ""
        print(f"  {m['input']!r} -> {m['resolved']!r} [{m['method']}]{flag}")

    section("FUNCTIONS CHANGED FROM INPUT")
    changed = [m for m in result.get("function_mappings", []) if m["input"] != m["resolved"]]
    print(f"  Count: {len(changed)}")
    for m in changed:
        print(f"  {m['input']!r} -> {m['resolved']!r} [{m['method']}]")

    watch = {"Lubricants", "Corporate", "HSSE & Health", "Retail", "S&D", "Human Resources", "ERA", "Supply"}
    section("WATCHLIST FUNCTIONS")
    for m in result.get("function_mappings", []):
        if m["input"] in watch:
            print(f"  {m['input']!r} -> {m['resolved']!r} [{m['method']}]")

    section("SUBFUNCTION SAMPLE (AI + changed, first 20)")
    subs = [m for m in result.get("subfunction_mappings", []) if m["method"] == "ai" or m["input"] != m["resolved"]]
    for m in subs[:20]:
        print(f"  [{m.get('function')}] {m['input']!r} -> {m['resolved']!r} [{m['method']}]")
    print(f"  ... pool size: {len(subs)}")

    section("TITLE SAMPLE (AI + changed, first 15)")
    titles = [m for m in result.get("title_mappings", []) if m["method"] == "ai" or m["input"] != m["resolved"]]
    for m in titles[:15]:
        print(f"  [{m.get('function')}] {m['input']!r} -> {m['resolved']!r} [{m['method']}]")
    print(f"  ... pool size: {len(titles)}")

    unres = sum(
        1
        for lst in [
            result.get("function_mappings", []),
            result.get("subfunction_mappings", []),
            result.get("title_mappings", []),
        ]
        for m in lst
        if m.get("method") == "unresolved"
    )
    orig = sum(1 for m in result.get("function_mappings", []) if m.get("method") == "original")
    section("TOTALS")
    total_u = (
        len(result.get("function_mappings", []))
        + len(result.get("subfunction_mappings", []))
        + len(result.get("title_mappings", []))
    )
    print(f"  unique items: {total_u}  unresolved: {unres}  functions_preserved_original: {orig}")
    print(f"  total time: read+map+rat = {t_read + t_map + t_rat:.2f}s")


if __name__ == "__main__":
    main()
