"""
Census data rationalisation service (v2 — optimised).

Standardises Function, Subfunction, and Job Title values using a four-layer
matching strategy:
  1. Exact normalised match against master taxonomy        (free, instant)
  1b. Abbreviation expansion + prefix stripping → re-match (free, instant)
  2. Fuzzy string match using rapidfuzz                    (free, fast)
  3. Mega-batch LLM call for ALL remaining unresolved      (paid, batched)

Optimisations over v1:
  - Abbreviation expansion catches "Sr.", "Mgr", "HRBP" etc. before fuzzy
  - Prefix stripping removes "SA ", "0100 -" etc. internal codes
  - Mega-batch: all subfunctions in 1 call, all titles in 1 call (not per-function)
  - Subfunctions + titles resolved in parallel via ThreadPoolExecutor
  - Trimmed prompts (~100 tokens vs ~300)
  - Structured JSON mode (guaranteed valid output)
  - Cross-run caching via PostgreSQL
  - Progressive taxonomy enrichment (AI mappings saved for future exact matches)
"""

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import pandas as pd
from rapidfuzz import fuzz, process as rfprocess

from services.llm_service import call_llm_json, get_llm_metrics, reset_llm_metrics

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Load master taxonomy + auto-learned supplements
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _load_json(filename: str) -> dict:
    path = _DATA_DIR / filename
    if not path.exists():
        log.warning("Master file not found: %s", path)
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_json(filename: str, data: dict) -> None:
    path = _DATA_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


MASTER_TAXONOMY: dict[str, list[str]] = _load_json("master_taxonomy.json")
MASTER_TITLES: dict[str, dict] = _load_json("master_titles.json")

_LEARNED_ALIASES: dict[str, Any] = _load_json("auto_learned_taxonomy.json") or {
    "function_aliases": {},
    "subfunction_aliases": {},
    "title_aliases": {},
}


# ---------------------------------------------------------------------------
# Exhaustive abbreviation expansion
# ---------------------------------------------------------------------------

_TITLE_ABBREVIATIONS: dict[str, str] = {
    # Seniority / Level
    "sr.": "senior", "sr ": "senior ", "snr ": "senior ", "snr.": "senior",
    "jr.": "junior", "jr ": "junior ",
    "asst.": "assistant", "asst ": "assistant ",
    "assoc.": "associate", "assoc ": "associate ",
    "princ.": "principal", "princ ": "principal ",
    "exec.": "executive", "exec ": "executive ",
    # Role types
    "mgr": "manager", "mngr": "manager",
    "dir.": "director",
    "vp ": "vice president ", "v.p.": "vice president",
    "svp ": "senior vice president ", "evp ": "executive vice president ",
    "ceo": "chief executive officer", "cfo": "chief financial officer",
    "cto": "chief technology officer", "cio": "chief information officer",
    "coo": "chief operating officer", "chro": "chief human resources officer",
    "cmo": "chief marketing officer", "cco": "chief compliance officer",
    "gm ": "general manager ",
    "supvr": "supervisor", "supv": "supervisor",
    "coord": "coordinator", "coord.": "coordinator",
    "rep.": "representative", "rep ": "representative ",
    # Functions / domains
    "engr": "engineer", "eng.": "engineer",
    "acct": "accountant", "acctnt": "accountant",
    "admin": "administrator", "admn": "administrator",
    "spclst": "specialist", "spec.": "specialist",
    "anlyst": "analyst", "anlst": "analyst",
    "tech ": "technician ",
    "dev.": "developer",
    "progmr": "programmer",
    "conslt": "consultant", "conslt.": "consultant",
    "advsr": "advisor", "advsr.": "advisor",
    "offcr": "officer", "offcr.": "officer",
    # Departments / areas
    "mktg": "marketing",
    "comms": "communications", "comm ": "communications ",
    "ops": "operations", "oper": "operations",
    "mfg": "manufacturing",
    "svc ": "service ", "svcs": "services",
    "dept": "department",
    "acq": "acquisition",
    "biz": "business", "bus.": "business",
    "corp.": "corporate",
    "intl": "international",
    "natl": "national",
    "govt": "government",
    "mgt": "management", "mgmt": "management",
    "rel ": "relations ", "rels": "relations",
    # HR-specific
    "hrbp": "hr business partner",
    "l&d": "learning and development",
    "c&b": "compensation and benefits",
    "comp ": "compensation ",
    "ben ": "benefits ",
    "ta ": "talent acquisition ",
    "od ": "organizational development ",
    "er ": "employee relations ",
    # Finance-specific
    "fp&a": "financial planning and analysis",
    "fpna": "financial planning and analysis",
    "a/p": "accounts payable", "ap ": "accounts payable ",
    "a/r": "accounts receivable", "ar ": "accounts receivable ",
    "gl ": "general ledger ",
    "treas": "treasury",
    "payrl": "payroll",
    # IT-specific
    "infosec": "information security",
    "cybsec": "cybersecurity",
    "qa ": "quality assurance ", "qa/": "quality assurance/",
    "qc ": "quality control ",
    "db ": "database ",
    "sw ": "software ",
    "netwk": "network",
    "sys ": "system ",
    "devops": "development operations",
    # Procurement / Supply Chain
    "proc": "procurement",
    "scm": "supply chain management",
    "whse": "warehouse",
    "dist ": "distribution ", "distr": "distribution",
    "inv ": "inventory ",
    "purch": "purchasing",
    # Sales
    "bde": "business development executive",
    "bdm": "business development manager",
    "kam": "key account manager",
    "am ": "account manager ",
    # Compliance / Legal
    "aml": "anti-money laundering",
    "kyc": "know your customer",
    "reg ": "regulatory ",
    "compl.": "compliance",
    # Research
    "rnd": "research and development",
    "rsch": "research",
    "cra": "clinical research associate",
}

_PREFIX_PATTERNS: list[re.Pattern] = [
    re.compile(r"^SA\s+", re.IGNORECASE),
    re.compile(r"^SA\s*[-–]\s*", re.IGNORECASE),
    re.compile(r"^\d{2,4}\s*[-–]\s*"),
    re.compile(r"^\d{2,4}\s+"),
    re.compile(r"^[A-Z]{2,4}\d+\s*[-–]\s*"),
]


def _expand_abbreviations(value: str) -> str:
    """Expand common abbreviations in a title/subfunction string."""
    result = " " + value.lower() + " "
    for abbr, expansion in sorted(_TITLE_ABBREVIATIONS.items(), key=lambda x: -len(x[0])):
        result = result.replace(abbr, expansion)
    return result.strip()


def _strip_prefixes(value: str) -> str:
    """Remove internal code prefixes (SA, numeric codes, etc.)."""
    result = value
    for pat in _PREFIX_PATTERNS:
        result = pat.sub("", result).strip()
    if result and result != value:
        result = result.lstrip("- ").strip()
    return result or value


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def _normalise(value: str) -> str:
    """Lowercase, strip, replace & with 'and', collapse whitespace."""
    s = str(value).strip().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------------
# Fuzzy matching thresholds
# ---------------------------------------------------------------------------

_FUNC_FUZZY_THRESHOLD = 80
_SUBFUNC_FUZZY_THRESHOLD = 78
_TITLE_FUZZY_THRESHOLD = 82


# ---------------------------------------------------------------------------
# Build normalised lookup keys (includes auto-learned aliases)
# ---------------------------------------------------------------------------

_NORM_FUNC_KEYS: dict[str, str] = {}
_NORM_SUBFUNC_LOOKUP: dict[str, list[str]] = {}
_NORM_TITLE_EXACT: dict[tuple[str, str], str] = {}
_NORM_TITLE_BY_FUNC: dict[str, list[str]] = {}
_ALL_STANDARD_TITLES: list[str] = []


def _rebuild_lookups(*, include_learned: bool = True):
    """Build normalised lookup structures from master data + learned aliases."""
    global _NORM_FUNC_KEYS, _NORM_SUBFUNC_LOOKUP
    global _NORM_TITLE_EXACT, _NORM_TITLE_BY_FUNC, _ALL_STANDARD_TITLES

    _NORM_FUNC_KEYS = {}
    _NORM_SUBFUNC_LOOKUP = {}
    for func_name, subfuncs in MASTER_TAXONOMY.items():
        key = _normalise(func_name)
        _NORM_FUNC_KEYS[key] = func_name
        _NORM_SUBFUNC_LOOKUP[key] = subfuncs

    if include_learned:
        for alias, master in _LEARNED_ALIASES.get("function_aliases", {}).items():
            _NORM_FUNC_KEYS[_normalise(alias)] = master

    _NORM_TITLE_EXACT = {}
    _NORM_TITLE_BY_FUNC = {}
    all_titles_set: set[str] = set()
    for func_name, tdata in MASTER_TITLES.items():
        fkey = _normalise(func_name)
        for raw, std in tdata.get("raw_to_standard", {}).items():
            _NORM_TITLE_EXACT[(fkey, _normalise(raw))] = std
        std_titles = tdata.get("standard_titles", [])
        _NORM_TITLE_BY_FUNC[fkey] = std_titles
        all_titles_set.update(std_titles)

    if include_learned:
        for func, aliases in _LEARNED_ALIASES.get("title_aliases", {}).items():
            fkey = _normalise(func)
            for raw, std in aliases.items():
                _NORM_TITLE_EXACT[(fkey, _normalise(raw))] = std

    _ALL_STANDARD_TITLES = sorted(all_titles_set)


_rebuild_lookups()


# ---------------------------------------------------------------------------
# Parallelism + batch config (env overrides)
# ---------------------------------------------------------------------------

_MAX_ITEMS_PER_BATCH = int(os.getenv("RATIONALISATION_BATCH_SIZE", "200"))
_MAX_LLM_WORKERS = int(os.getenv("LLM_MAX_WORKERS", "10"))
_BATCH_MAX_TOKENS = int(os.getenv("RATIONALISATION_BATCH_MAX_TOKENS", "12000"))

_use_cache: bool = True
_enrich_learned: bool = True


# ---------------------------------------------------------------------------
# Cross-run caching (PostgreSQL)
# ---------------------------------------------------------------------------

_cache_available: bool | None = None  # None = not yet tested


def _cache_lookup_batch(items: list[tuple[str, str, str | None]]) -> dict[tuple[str, str, str | None], dict]:
    """Batch-lookup cached rationalisation results from PostgreSQL.

    Uses a single DB connection for all lookups. Fails fast and remembers
    if the cache is unavailable to avoid repeated connection attempts.
    """
    global _cache_available
    results: dict[tuple[str, str, str | None], dict] = {}
    if not _use_cache or not items or _cache_available is False:
        return results

    try:
        from services.pg_adapter import _connect_ro
        with _connect_ro() as conn:
            _cache_available = True
            for val, itype, ctx in items:
                row = conn.execute(
                    "SELECT resolved, method, matched, confidence FROM rationalisation_cache "
                    "WHERE input_value = ? AND input_type = ? AND "
                    "(context_func = ? OR (context_func IS NULL AND ? IS NULL))",
                    (val, itype, ctx, ctx),
                ).fetchone()
                if row:
                    results[(val, itype, ctx)] = {
                        "resolved": row["resolved"],
                        "method": row["method"],
                        "matched": row["matched"],
                        "confidence": row["confidence"],
                    }
    except Exception as e:
        _cache_available = False
        log.debug("Cache unavailable (non-critical, will skip future lookups): %s", e)

    return results


def _cache_store(entries: list[dict]) -> None:
    """Store rationalisation results in the cache for future runs."""
    global _cache_available
    if not _use_cache or not entries or _cache_available is False:
        return
    try:
        from services.pg_adapter import _connect as pg_connect
        with pg_connect() as conn:
            _cache_available = True
            for e in entries:
                try:
                    conn.execute(
                        "INSERT INTO rationalisation_cache "
                        "(input_value, input_type, context_func, resolved, method, matched, confidence) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?) "
                        "ON CONFLICT (input_value, input_type, context_func) DO UPDATE SET "
                        "resolved = EXCLUDED.resolved, method = EXCLUDED.method, "
                        "matched = EXCLUDED.matched, confidence = EXCLUDED.confidence",
                        (e["input_value"], e["input_type"], e.get("context_func"),
                         e["resolved"], e["method"], e.get("matched", False),
                         e.get("confidence", "medium")),
                    )
                except Exception:
                    pass
            conn.commit()
    except Exception as e:
        _cache_available = False
        log.debug("Cache store failed (non-critical): %s", e)


def _update_learned_aliases(func_map: dict, subfunc_results: list, title_results: list) -> None:
    """Save AI-resolved mappings into auto_learned_taxonomy.json for future
    exact matches (progressive taxonomy enrichment)."""
    changed = False

    for f, data in func_map.items():
        if data.get("method") == "ai" and data.get("resolved") != f:
            _LEARNED_ALIASES.setdefault("function_aliases", {})[f] = data["resolved"]
            changed = True

    for m in title_results:
        if m.get("method") == "ai" and m.get("input") != m.get("resolved"):
            func = m.get("function", "")
            _LEARNED_ALIASES.setdefault("title_aliases", {}).setdefault(func, {})[m["input"]] = m["resolved"]
            changed = True

    if changed and _enrich_learned:
        try:
            _save_json("auto_learned_taxonomy.json", _LEARNED_ALIASES)
            _rebuild_lookups()
        except Exception as e:
            log.debug("Failed to save learned aliases: %s", e)


def get_rationalisation_config() -> dict[str, Any]:
    """Return current batch/worker settings (for benchmarks)."""
    return {
        "batch_size": _MAX_ITEMS_PER_BATCH,
        "max_workers": _MAX_LLM_WORKERS,
        "batch_max_tokens": _BATCH_MAX_TOKENS,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def rationalise(
    records: list[dict],
    func_col: str | None,
    subfunc_col: str | None,
    title_col: str | None,
    *,
    use_cache: bool = True,
    enrich_learned: bool = True,
    ignore_learned_aliases: bool = False,
    reset_metrics: bool = False,
) -> dict[str, Any]:
    """Run full rationalisation pipeline on the dataset.

    use_cache=False + ignore_learned_aliases=True gives a clean LLM-only benchmark run.
    """
    global _use_cache, _enrich_learned

    if reset_metrics:
        reset_llm_metrics()

    _use_cache = use_cache
    _enrich_learned = enrich_learned
    if ignore_learned_aliases:
        _rebuild_lookups(include_learned=False)
    else:
        _rebuild_lookups(include_learned=True)

    df = pd.DataFrame(records)
    result: dict[str, Any] = {
        "function_mappings": [],
        "subfunction_mappings": [],
        "title_mappings": [],
        "summary": {},
        "config": get_rationalisation_config(),
    }

    # ── Step 1: Resolve functions (must complete first) ──────────────
    func_map: dict[str, dict] = {}
    if func_col and func_col in df.columns:
        unique_funcs = sorted(
            set(str(v).strip() for v in df[func_col].dropna().unique())
        )
        func_map = _resolve_functions(unique_funcs)
        result["function_mappings"] = [
            {"input": f, **func_map[f]} for f in unique_funcs
        ]

    unique_pairs: list[tuple[str, str]] = []
    unique_title_pairs: list[tuple[str, str]] = []

    if subfunc_col and subfunc_col in df.columns and func_col and func_col in df.columns:
        unique_pairs = [
            (str(f).strip(), str(s).strip())
            for f, s in df[[func_col, subfunc_col]].dropna().drop_duplicates().values.tolist()
        ]

    if title_col and title_col in df.columns and func_col and func_col in df.columns:
        unique_title_pairs = [
            (str(f).strip(), str(t).strip())
            for f, t in df[[func_col, title_col]].dropna().drop_duplicates().values.tolist()
        ]

    # ── Step 2: Deterministic layers (parallel) ─────────────────────
    subfunc_result: dict[tuple[str, str], dict] = {}
    subfunc_unresolved: list[dict] = []
    title_result: dict[tuple[str, str], dict] = {}
    title_unresolved: list[dict] = []

    with ThreadPoolExecutor(max_workers=2) as pool:
        sf_fut = (
            pool.submit(_preresolve_subfunctions, unique_pairs, func_map)
            if unique_pairs else None
        )
        ti_fut = (
            pool.submit(_preresolve_titles, unique_title_pairs, func_map)
            if unique_title_pairs else None
        )
        if sf_fut:
            subfunc_result, subfunc_unresolved = sf_fut.result()
        if ti_fut:
            title_result, title_unresolved = ti_fut.result()

    # ── Step 3: All LLM batches in one parallel pool (max workers) ───
    llm_jobs: list[tuple[str, list]] = []
    for i in range(0, len(subfunc_unresolved), _MAX_ITEMS_PER_BATCH):
        llm_jobs.append(("subfunction", subfunc_unresolved[i:i + _MAX_ITEMS_PER_BATCH]))
    for i in range(0, len(title_unresolved), _MAX_ITEMS_PER_BATCH):
        llm_jobs.append(("title", title_unresolved[i:i + _MAX_ITEMS_PER_BATCH]))

    llm_merged = _run_llm_batches_parallel(llm_jobs)

    for item in subfunc_unresolved:
        key = (item["func_raw"], item["sub_raw"])
        if item["sub_raw"] in llm_merged["subfunction"]:
            mapped, matched = llm_merged["subfunction"][item["sub_raw"]]
            subfunc_result[key] = {
                "resolved": mapped,
                "method": "ai",
                "confidence": "medium" if matched else "low",
            }
        elif key not in subfunc_result:
            subfunc_result[key] = {
                "resolved": item["sub_raw"],
                "method": "unresolved",
                "confidence": "low",
            }

    for item in title_unresolved:
        key = (item["func_raw"], item["title_raw"])
        if item["title_raw"] in llm_merged["title"]:
            mapped, matched = llm_merged["title"][item["title_raw"]]
            title_result[key] = {
                "resolved": mapped,
                "method": "ai",
                "confidence": "medium" if matched else "low",
            }
        elif key not in title_result:
            title_result[key] = {
                "resolved": item["title_raw"],
                "method": "unresolved",
                "confidence": "low",
            }

    if unique_pairs:
        result["subfunction_mappings"] = [
            {"function": f, "input": s, **subfunc_result[(f, s)]}
            for f, s in unique_pairs
        ]
    if unique_title_pairs:
        result["title_mappings"] = [
            {"function": f, "input": t, **title_result[(f, t)]}
            for f, t in unique_title_pairs
        ]

    result["summary"] = _build_summary(
        result["function_mappings"],
        result["subfunction_mappings"],
        result["title_mappings"],
    )

    # Accuracy / completeness stats
    result["accuracy"] = _build_accuracy_stats(
        subfunc_unresolved, title_unresolved, llm_merged,
    )

    _update_learned_aliases(
        func_map,
        result["subfunction_mappings"],
        result["title_mappings"],
    )

    _cache_store_from_results(
        result["function_mappings"],
        result["subfunction_mappings"],
        result["title_mappings"],
    )

    result["llm_metrics"] = get_llm_metrics()

    if ignore_learned_aliases:
        _rebuild_lookups(include_learned=True)

    return result


def apply_rationalisation(
    records: list[dict],
    func_col: str | None,
    subfunc_col: str | None,
    title_col: str | None,
    approved_functions: list[dict],
    approved_subfunctions: list[dict],
    approved_titles: list[dict],
) -> list[dict]:
    """Apply user-approved rationalisation mappings to all rows.

    Adds six new columns: Rationalised Function/Subfunction/Title + Sources.
    """
    func_lookup = {m["input"]: (m["resolved"], m["method"]) for m in approved_functions}
    subfunc_lookup = {(m["function"], m["input"]): (m["resolved"], m["method"]) for m in approved_subfunctions}
    title_lookup = {(m["function"], m["input"]): (m["resolved"], m["method"]) for m in approved_titles}

    for row in records:
        if func_col and func_col in row and row[func_col] is not None:
            raw = str(row[func_col]).strip()
            resolved, method = func_lookup.get(raw, (raw, "original"))
            row["Rationalised Function"] = resolved
            row["Function Source"] = _method_to_source(method)
        else:
            row["Rationalised Function"] = None
            row["Function Source"] = None

        if (subfunc_col and subfunc_col in row and row[subfunc_col] is not None
                and func_col and func_col in row):
            raw_f, raw_s = str(row[func_col]).strip(), str(row[subfunc_col]).strip()
            resolved, method = subfunc_lookup.get((raw_f, raw_s), (raw_s, "original"))
            row["Rationalised Subfunction"] = resolved
            row["Subfunction Source"] = _method_to_source(method)
        else:
            row["Rationalised Subfunction"] = None
            row["Subfunction Source"] = None

        if (title_col and title_col in row and row[title_col] is not None
                and func_col and func_col in row):
            raw_f, raw_t = str(row[func_col]).strip(), str(row[title_col]).strip()
            resolved, method = title_lookup.get((raw_f, raw_t), (raw_t, "original"))
            row["Rationalised Title"] = resolved
            row["Title Source"] = _method_to_source(method)
        else:
            row["Rationalised Title"] = None
            row["Title Source"] = None

    return records


# ---------------------------------------------------------------------------
# Function resolution (4 layers)
# ---------------------------------------------------------------------------

def _resolve_functions(unique_funcs: list[str]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    need_cache: list[str] = []
    master_display_names = list(_NORM_FUNC_KEYS.values())

    for f in unique_funcs:
        key = _normalise(f)

        # Layer 1: Exact match (includes learned aliases)
        if key in _NORM_FUNC_KEYS:
            result[f] = {"resolved": _NORM_FUNC_KEYS[key], "method": "exact", "confidence": "high"}
            continue

        # Layer 1b: Abbreviation expansion → re-match
        expanded_key = _normalise(_expand_abbreviations(f))
        if expanded_key in _NORM_FUNC_KEYS:
            result[f] = {"resolved": _NORM_FUNC_KEYS[expanded_key], "method": "exact", "confidence": "high"}
            continue

        # Layer 2: Fuzzy match
        if master_display_names:
            match = rfprocess.extractOne(f, master_display_names, scorer=fuzz.token_sort_ratio, score_cutoff=_FUNC_FUZZY_THRESHOLD)
            if match:
                result[f] = {"resolved": match[0], "method": "fuzzy", "confidence": "high" if match[1] >= 90 else "medium"}
                continue

        need_cache.append(f)

    # Layer 2.5: Batch cache lookup for all remaining
    if need_cache:
        cached = _cache_lookup_batch([(f, "function", None) for f in need_cache])
        unresolved = []
        for f in need_cache:
            if (f, "function", None) in cached:
                c = cached[(f, "function", None)]
                result[f] = {"resolved": c["resolved"], "method": "cached", "confidence": c.get("confidence", "medium")}
            else:
                unresolved.append(f)
    else:
        unresolved = []

    # Layer 3: Batch LLM
    if unresolved:
        llm_results = _llm_resolve_functions(unresolved, master_display_names)
        for f in unresolved:
            if f in llm_results and llm_results[f] != f:
                result[f] = {"resolved": llm_results[f], "method": "ai", "confidence": "medium"}
            else:
                result[f] = {"resolved": f, "method": "unresolved", "confidence": "low"}

    return result


# ---------------------------------------------------------------------------
# Subfunction resolution (4 layers + mega-batch LLM)
# ---------------------------------------------------------------------------

def _preresolve_subfunctions(
    unique_pairs: list[tuple[str, str]],
    func_map: dict[str, dict],
) -> tuple[dict[tuple[str, str], dict], list[dict]]:
    """Deterministic layers only; returns (partial results, items needing LLM)."""
    result: dict[tuple[str, str], dict] = {}
    need_cache: list[dict] = []

    for func_raw, sub_raw in unique_pairs:
        resolved_func = func_map.get(func_raw, {}).get("resolved", func_raw)
        resolved_func_key = _normalise(resolved_func)
        master_subs = _NORM_SUBFUNC_LOOKUP.get(resolved_func_key, [])
        norm_master = {_normalise(s): s for s in master_subs}

        sub_key = _normalise(sub_raw)

        if sub_key in norm_master:
            result[(func_raw, sub_raw)] = {"resolved": norm_master[sub_key], "method": "exact", "confidence": "high"}
            continue

        cleaned = _strip_prefixes(sub_raw)
        expanded = _expand_abbreviations(cleaned)
        exp_key = _normalise(expanded)
        if exp_key in norm_master:
            result[(func_raw, sub_raw)] = {"resolved": norm_master[exp_key], "method": "exact", "confidence": "high"}
            continue

        if master_subs:
            best_input = expanded if expanded != sub_raw.lower() else sub_raw
            match = rfprocess.extractOne(best_input, master_subs, scorer=fuzz.token_sort_ratio, score_cutoff=_SUBFUNC_FUZZY_THRESHOLD)
            if match:
                result[(func_raw, sub_raw)] = {"resolved": match[0], "method": "fuzzy", "confidence": "high" if match[1] >= 90 else "medium"}
                continue

        need_cache.append({"func_raw": func_raw, "sub_raw": sub_raw, "resolved_func": resolved_func, "master_subs": master_subs})

    unresolved_items: list[dict] = []
    if need_cache:
        cache_keys = [(item["sub_raw"], "subfunction", item["resolved_func"]) for item in need_cache]
        cached = _cache_lookup_batch(cache_keys)
        for item in need_cache:
            ck = (item["sub_raw"], "subfunction", item["resolved_func"])
            if ck in cached:
                c = cached[ck]
                result[(item["func_raw"], item["sub_raw"])] = {"resolved": c["resolved"], "method": "cached", "confidence": c.get("confidence", "medium")}
            else:
                unresolved_items.append(item)

    return result, unresolved_items


def _preresolve_titles(
    unique_pairs: list[tuple[str, str]],
    func_map: dict[str, dict],
) -> tuple[dict[tuple[str, str], dict], list[dict]]:
    """Deterministic layers only; returns (partial results, items needing LLM)."""
    result: dict[tuple[str, str], dict] = {}
    need_cache: list[dict] = []

    for func_raw, title_raw in unique_pairs:
        resolved_func = func_map.get(func_raw, {}).get("resolved", func_raw)
        resolved_func_key = _normalise(resolved_func)

        title_key = _normalise(title_raw)

        exact = _NORM_TITLE_EXACT.get((resolved_func_key, title_key))
        if exact:
            result[(func_raw, title_raw)] = {"resolved": exact, "method": "exact", "confidence": "high"}
            continue

        std_titles = _NORM_TITLE_BY_FUNC.get(resolved_func_key, [])
        norm_std = {_normalise(t): t for t in std_titles}
        if title_key in norm_std:
            result[(func_raw, title_raw)] = {"resolved": norm_std[title_key], "method": "exact", "confidence": "high"}
            continue

        expanded = _expand_abbreviations(title_raw)
        exp_key = _normalise(expanded)
        exact_exp = _NORM_TITLE_EXACT.get((resolved_func_key, exp_key))
        if exact_exp:
            result[(func_raw, title_raw)] = {"resolved": exact_exp, "method": "exact", "confidence": "high"}
            continue
        if exp_key in norm_std:
            result[(func_raw, title_raw)] = {"resolved": norm_std[exp_key], "method": "exact", "confidence": "high"}
            continue

        candidates = std_titles or _ALL_STANDARD_TITLES
        if candidates:
            best_input = expanded if expanded != title_raw.lower() else title_raw
            match = rfprocess.extractOne(best_input, candidates, scorer=fuzz.token_sort_ratio, score_cutoff=_TITLE_FUZZY_THRESHOLD)
            if match:
                result[(func_raw, title_raw)] = {"resolved": match[0], "method": "fuzzy", "confidence": "high" if match[1] >= 92 else "medium"}
                continue

        need_cache.append({"func_raw": func_raw, "title_raw": title_raw, "resolved_func": resolved_func, "std_titles": std_titles})

    unresolved_items: list[dict] = []
    if need_cache:
        cache_keys = [(item["title_raw"], "title", item["resolved_func"]) for item in need_cache]
        cached = _cache_lookup_batch(cache_keys)
        for item in need_cache:
            ck = (item["title_raw"], "title", item["resolved_func"])
            if ck in cached:
                c = cached[ck]
                result[(item["func_raw"], item["title_raw"])] = {"resolved": c["resolved"], "method": "cached", "confidence": c.get("confidence", "medium")}
            else:
                unresolved_items.append(item)

    return result, unresolved_items


# ---------------------------------------------------------------------------
# LLM prompts (trimmed, mega-batched, parallel)
# ---------------------------------------------------------------------------

_SYS_MSG = "Corporate data standardisation expert. Return JSON only."


def _run_llm_batches_parallel(
    jobs: list[tuple[str, list]],
) -> dict[str, dict[str, tuple[str, bool]]]:
    """Run subfunction/title batch jobs on a shared worker pool."""
    merged: dict[str, dict[str, tuple[str, bool]]] = {
        "subfunction": {},
        "title": {},
    }
    if not jobs:
        return merged

    def _run_one(kind: str, chunk: list) -> tuple[str, dict[str, tuple[str, bool]]]:
        if kind == "subfunction":
            return kind, _llm_subfunc_batch_with_retry(chunk)
        return kind, _llm_title_batch_with_retry(chunk)

    with ThreadPoolExecutor(max_workers=_MAX_LLM_WORKERS) as pool:
        futures = [pool.submit(_run_one, kind, chunk) for kind, chunk in jobs]
        for fut in as_completed(futures):
            kind, batch_result = fut.result()
            merged[kind].update(batch_result)

    return merged


def _llm_resolve_functions(unresolved: list[str], master_list: list[str]) -> dict[str, str]:
    input_str = ", ".join(f'"{f}"' for f in sorted(unresolved))
    master_str = ", ".join(f'"{f}"' for f in sorted(master_list))

    prompt = f"""Map each input function to the closest master function.
Common patterns: HR=Human Resources, S&D=Sales & Distribution, R&D=Research & Development, Comms=Communications.
If no match, map to itself.

Inputs: [{input_str}]
Masters: [{master_str}]

Return JSON object: {{"input": "master_or_self", ...}}"""

    try:
        result = call_llm_json(
            prompt,
            system_message=_SYS_MSG,
            max_tokens=2000,
            call_type="function",
            inputs_requested=len(unresolved),
            batch_size=len(unresolved),
        )
        if isinstance(result, dict):
            return result
    except Exception as e:
        log.error("Function resolution LLM failed: %s", e)

    return {f: f for f in unresolved}


def _parse_results_list(raw: Any) -> dict[str, tuple[str, bool]]:
    items_list = raw.get("results", raw) if isinstance(raw, dict) else raw
    if not isinstance(items_list, list):
        return {}
    return {
        r["input"]: (r["resolved"], r.get("matched", False))
        for r in items_list
        if isinstance(r, dict) and "input" in r and "resolved" in r
    }


def _llm_subfunc_batch(items: list[dict], *, retry: bool = False) -> dict[str, tuple[str, bool]]:
    groups: dict[str, dict] = {}
    for item in items:
        func = item["resolved_func"]
        groups.setdefault(func, {"inputs": [], "master": item["master_subs"]})
        groups[func]["inputs"].append(item["sub_raw"])

    lines = []
    for func, data in groups.items():
        inputs = ", ".join(f'"{s}"' for s in data["inputs"])
        master = ", ".join(f'"{s}"' for s in sorted(set(data["master"]))) if data["master"] else "(none)"
        lines.append(f'{func}: inputs=[{inputs}] master=[{master}]')

    grouped_str = "\n".join(lines)
    input_keys = {item["sub_raw"] for item in items}

    prompt = f"""Map each input subfunction to its best master match. Strip internal codes/prefixes (SA, numeric).
Prefer master list. Create concise new name only if nothing fits.
You MUST return exactly one result for every input ({len(input_keys)} inputs).

{grouped_str}

Return JSON: {{"results": [{{"input": "exact input", "resolved": "match", "matched": true/false}}, ...]}}"""

    try:
        raw = call_llm_json(
            prompt,
            system_message=_SYS_MSG,
            max_tokens=_BATCH_MAX_TOKENS,
            call_type="subfunction_retry" if retry else "subfunction",
            inputs_requested=len(input_keys),
            batch_size=len(items),
            retry=retry,
        )
        return _parse_results_list(raw)
    except Exception as e:
        log.error("Mega-batch subfunction LLM failed: %s", e)
    return {}


def _llm_subfunc_batch_with_retry(items: list[dict]) -> dict[str, tuple[str, bool]]:
    if not items:
        return {}
    result = _llm_subfunc_batch(items, retry=False)
    missing = {item["sub_raw"] for item in items} - set(result.keys())
    if missing:
        retry_items = [item for item in items if item["sub_raw"] in missing]
        log.warning("Subfunction batch missing %d/%d — retrying", len(missing), len(items))
        result.update(_llm_subfunc_batch(retry_items, retry=True))
    return result


def _llm_title_batch(items: list[dict], *, retry: bool = False) -> dict[str, tuple[str, bool]]:
    groups: dict[str, dict] = {}
    for item in items:
        func = item["resolved_func"]
        groups.setdefault(func, {"inputs": [], "master": item["std_titles"]})
        groups[func]["inputs"].append(item["title_raw"])

    lines = []
    for func, data in groups.items():
        inputs = ", ".join(f'"{t}"' for t in data["inputs"])
        master = ", ".join(f'"{t}"' for t in sorted(set(data["master"]))) if data["master"] else "(none)"
        lines.append(f'{func}: inputs=[{inputs}] master=[{master}]')

    grouped_str = "\n".join(lines)
    input_keys = {item["title_raw"] for item in items}

    prompt = f"""Map each input job title to its best master match. Expand abbreviations (Sr=Senior, Mgr=Manager, Engr=Engineer).
Stay within functional domain. Prefer master list. Create concise new title only if nothing fits.
You MUST return exactly one result for every input ({len(input_keys)} inputs).

{grouped_str}

Return JSON: {{"results": [{{"input": "exact input", "resolved": "match", "matched": true/false}}, ...]}}"""

    try:
        raw = call_llm_json(
            prompt,
            system_message=_SYS_MSG,
            max_tokens=_BATCH_MAX_TOKENS,
            call_type="title_retry" if retry else "title",
            inputs_requested=len(input_keys),
            batch_size=len(items),
            retry=retry,
        )
        return _parse_results_list(raw)
    except Exception as e:
        log.error("Mega-batch title LLM failed: %s", e)
    return {}


def _llm_title_batch_with_retry(items: list[dict]) -> dict[str, tuple[str, bool]]:
    if not items:
        return {}
    result = _llm_title_batch(items, retry=False)
    missing = {item["title_raw"] for item in items} - set(result.keys())
    if missing:
        retry_items = [item for item in items if item["title_raw"] in missing]
        log.warning("Title batch missing %d/%d — retrying", len(missing), len(items))
        result.update(_llm_title_batch(retry_items, retry=True))
    return result


def _build_accuracy_stats(
    subfunc_unresolved: list[dict],
    title_unresolved: list[dict],
    llm_merged: dict[str, dict[str, tuple[str, bool]]],
) -> dict[str, Any]:
    """Completeness and resolution quality metrics for benchmark reporting."""
    sf_sent = len(subfunc_unresolved)
    ti_sent = len(title_unresolved)
    sf_returned = len(llm_merged.get("subfunction", {}))
    ti_returned = len(llm_merged.get("title", {}))

    sf_matched = sum(1 for _, matched in llm_merged.get("subfunction", {}).values() if matched)
    ti_matched = sum(1 for _, matched in llm_merged.get("title", {}).values() if matched)

    return {
        "subfunctions_sent_to_llm": sf_sent,
        "subfunctions_returned_by_llm": sf_returned,
        "subfunctions_llm_completeness_pct": round(100.0 * sf_returned / sf_sent, 2) if sf_sent else 100.0,
        "subfunctions_matched_from_master_pct": round(100.0 * sf_matched / sf_returned, 2) if sf_returned else 0.0,
        "titles_sent_to_llm": ti_sent,
        "titles_returned_by_llm": ti_returned,
        "titles_llm_completeness_pct": round(100.0 * ti_returned / ti_sent, 2) if ti_sent else 100.0,
        "titles_matched_from_master_pct": round(100.0 * ti_matched / ti_returned, 2) if ti_returned else 0.0,
    }


# ---------------------------------------------------------------------------
# Cache storage helper
# ---------------------------------------------------------------------------

def _cache_store_from_results(func_maps: list, subfunc_maps: list, title_maps: list) -> None:
    entries = []
    for m in func_maps:
        if m.get("method") in ("ai", "fuzzy", "exact"):
            entries.append({"input_value": m["input"], "input_type": "function", "context_func": None,
                            "resolved": m["resolved"], "method": m["method"],
                            "matched": m["method"] != "ai", "confidence": m.get("confidence", "medium")})
    for m in subfunc_maps:
        if m.get("method") in ("ai", "fuzzy"):
            entries.append({"input_value": m["input"], "input_type": "subfunction",
                            "context_func": m.get("function"),
                            "resolved": m["resolved"], "method": m["method"],
                            "matched": m["method"] != "ai", "confidence": m.get("confidence", "medium")})
    for m in title_maps:
        if m.get("method") in ("ai", "fuzzy"):
            entries.append({"input_value": m["input"], "input_type": "title",
                            "context_func": m.get("function"),
                            "resolved": m["resolved"], "method": m["method"],
                            "matched": m["method"] != "ai", "confidence": m.get("confidence", "medium")})
    _cache_store(entries)


# ---------------------------------------------------------------------------
# Summary + helpers
# ---------------------------------------------------------------------------

def _build_summary(func_mappings: list, subfunc_mappings: list, title_mappings: list) -> dict[str, int]:
    summary = {}
    for label, mappings in [("functions", func_mappings), ("subfunctions", subfunc_mappings), ("titles", title_mappings)]:
        total = len(mappings)
        summary[f"{label}_total"] = total
        for method in ("exact", "fuzzy", "ai", "cached", "unresolved"):
            summary[f"{label}_{method}"] = sum(1 for m in mappings if m.get("method") == method)
    return summary


def _method_to_source(method: str) -> str:
    return {"exact": "Master File", "fuzzy": "Master File (Fuzzy)", "ai": "Gen AI",
            "cached": "Cached", "unresolved": "Unresolved"}.get(method, "Original")
