# Cursor Prompt — Implement Benchmark Tool

## Context

We are adding A&M industry benchmarks to the Ask OrgSight chatbot. Benchmarks are NOT injected into the system prompt. They are exposed as a **tool** — `get_benchmarks` — that the LLM calls when it needs comparison data. This keeps the base prompt lean and allows benchmarks to scale (new categories, client-specific overrides) without bloating every query.

I am providing one new file. Your job is to integrate it and update the existing chatbot pipeline.

## New file provided

**`services/benchmark_constants.py`** — Contains:
- `BENCHMARKS` dict: structured benchmark data across 6 categories (span, layers, management, delayering, location, functions)
- `BENCHMARK_TOOL`: Azure OpenAI function-calling tool definition
- `execute_get_benchmarks()`: tool executor that returns formatted text for the requested categories
- The LLM picks which categories it needs via a `categories` array parameter

## Integration steps

### Step 1: Add the file

Drop `services/benchmark_constants.py` into the `services/` directory. No modifications needed.

### Step 2: Register the benchmark tool in the tool pipeline

Find where all tool definitions are collected and sent to Azure OpenAI (this is in `chat_tools.py` or wherever `ALL_TOOLS` is assembled). Add the benchmark tool:

```python
from services.benchmark_constants import BENCHMARK_TOOL

# Add to ALL_TOOLS list — this goes to Azure OpenAI
ALL_TOOLS = [
    RUN_SQL_TOOL,
    ORG_SUMMARY_TOOL,
    L2_BREAKDOWN_TOOL,
    SPAN_DISTRIBUTION_TOOL,
    LAYER_ANALYSIS_TOOL,
    MANAGER_EFFICIENCY_TOOL,
    COST_BY_DIMENSION_TOOL,
    GET_INSIGHTS_TOOL,
    NAVIGATE_TOOL,
    BENCHMARK_TOOL,       # ← NEW
]
```

### Step 3: Register the benchmark executor in the tool execution router

Find where tool calls are dispatched to their executors (the `execute_tool()` function or equivalent). Add the benchmark executor:

```python
from services.benchmark_constants import execute_get_benchmarks

# In your tool executor router / dispatch:
if tool_name == "get_benchmarks":
    return execute_get_benchmarks(tool_args, ctx)
```

The executor returns `(text_result, None)` — no raw data rows, just text for the LLM to read and weave into its response.

### Step 4: Update the system prompt

Remove any existing benchmark text from the system prompt (if any was added). Replace with a SHORT reference that tells the LLM the tool exists:

Add this block to the system prompt template (in `chat_prompt.py`), in the behavioral rules or tool guidance section:

```
## BENCHMARKING

You have access to A&M industry benchmarks via the get_benchmarks tool.

WHEN TO CALL get_benchmarks:
- User asks to "compare against benchmark" or "how do we compare"
- User asks "is this good/bad/normal" about a metric
- User asks about "industry standard" or "best practice"
- User asks about "optimization opportunities" or "efficiency"
- User asks "which functions are over-managed / under-managed"
- User asks about "delayering savings" or "managers to remove"
- User mentions "benchmark" explicitly
- You are analyzing spans, layers, or management ratios and need a reference point

HOW TO USE:
1. First run the data query (run_sql or named tool) to get the computed metric
2. Then call get_benchmarks with the relevant categories
3. Compare the computed value against the benchmark in your response
4. Always state BOTH numbers: "Average span is 3.2, below the industry benchmark of 6"

Available benchmark categories: span, layers, management, delayering, location, functions
Pick only the categories relevant to the question — don't request "all" unless doing a full org review.
```

This is ~200 tokens. It tells the LLM the tool exists and when to call it, without including the actual benchmark data in every query.

### Step 5: Update the intent classifier (if applicable)

If your intent classifier has a `benchmarking` category (it does — I saw `Intent Cat: benchmarking` in the logs), make sure queries classified as benchmarking still route to the appropriate data tool (span_distribution, manager_efficiency, etc.) — NOT to a separate "benchmark" route. The LLM will naturally chain: data tool first → benchmark tool second → summarize with comparison.

The intent classifier should NOT block benchmarking queries or route them differently. It should route them to the same data tools as non-benchmark queries. The benchmark tool call happens inside the LLM's tool-use loop, not at the routing level.

```
User: "How does our span compare to industry benchmarks?"

Intent classifier → route to span_distribution (data tool)
LLM iteration 1 → calls span_distribution → gets span bucket data
LLM iteration 2 → calls get_benchmarks(["span"]) → gets benchmark constants
LLM iteration 3 → final response: "Average span is 3.2, below the benchmark of 6. 
                   38% of managers have span below 4, flagged as delayering candidates..."
```

This two-tool chain is the expected behavior. The LLM handles the sequencing — it sees the data, realizes it needs benchmarks to compare, and calls the tool. No special routing needed.

### Step 6: Verify the tool works in the tool-use loop

The key thing to verify: the LLM can call multiple tools in sequence. When a benchmark question comes in:

1. LLM should call a data tool first (e.g., `span_distribution`)
2. LLM sees the data results
3. LLM should then call `get_benchmarks(["span"])` in the NEXT iteration
4. LLM sees the benchmark constants
5. LLM produces a final response comparing data vs benchmarks

If the tool-use loop is working correctly (iterates on tool_calls, feeds results back), this will work automatically. No special handling needed.

One thing to check: make sure `MAX_TOOL_ITERATIONS` is at least 4. Benchmark queries may need: data tool (1) → benchmark tool (2) → possibly show_chart (3) → final response (4). If max is set to 3, benchmark queries will get cut short.

```python
MAX_TOOL_ITERATIONS = 6  # should already be this, verify
```

### Step 7: Test

Run these queries after integration:

```bash
python test_chatbot_queries.py --only Q24,Q49,Q50,Q51,Q52,Q53,Q54,Q55
```

Expected behavior for each:

**Q24: "How does our average span compare to the industry benchmark of 6?"**
- Tools called: span_distribution → get_benchmarks(["span"])
- Response should state: computed avg span, benchmark of 6, above/below, % in each bucket

**Q49: "How does our span of control compare to industry benchmarks?"**
- Same as Q24 — should chain span_distribution → get_benchmarks(["span"])

**Q50: "Which functions appear over-managed?"**
- Tools called: cost_by_dimension(Function) or run_sql → get_benchmarks(["management"])
- Response should state: mgr_pct per function, flag any above 25%

**Q51: "Which business units are structurally inefficient?"**
- Tools called: l2_breakdown → get_benchmarks(["span", "layers", "management"])
- Response should flag L2 leaders with low span + deep layers

**Q52: "What cost can be removed through delayering?"**
- Tools called: manager_efficiency → get_benchmarks(["delayering"])
- Response should state: count of managers below threshold, total cost, 60-70% realization range

**Q53: "Which managers have spans below internal benchmarks?"**
- Tools called: manager_efficiency(benchmark=4) → get_benchmarks(["span"])
- Response should list managers, compare to threshold of 4

**Q54: "Which managers have spans above internal benchmarks?"**
- Tools called: run_sql (WHERE Span > 12) → get_benchmarks(["span"])
- Response should list overloaded managers

**Q55: "What percentage of managers supervise fewer than five employees?"**
- Tools called: run_sql (ratio query) → get_benchmarks(["span"])
- Response should state percentage and compare to benchmark

### What NOT to do

- Do NOT put benchmark data in the system prompt — it's a tool now
- Do NOT create a separate "benchmark route" in the intent classifier — benchmarking is handled by the LLM chaining tools
- Do NOT force the LLM to always call get_benchmarks — it should only call it when the question involves comparison
- Do NOT hardcode benchmark values anywhere except `benchmark_constants.py` — single source of truth

## Files to read before starting

1. `services/benchmark_constants.py` (the new file I'm providing)
2. `services/chat_tools.py` — understand where ALL_TOOLS is defined and how execute_tool() dispatches
3. `services/chat_agent.py` — understand the tool-use loop and MAX_TOOL_ITERATIONS
4. `services/chat_prompt.py` — understand where to add the benchmark guidance block
5. The intent classifier — make sure benchmarking queries route to data tools, not a dead end
