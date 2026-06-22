# Ask OrgSight — Final Implementation Plan

## Architecture decision

**Single tool-use loop with 10 tools. No intent classifier. No LangChain.**

The final plan proposed a separate LLM call to classify intent before routing to tools. I'm cutting that. Here's why:

When GPT-4o sees 10 tool definitions with clear descriptions, it classifies intent *as part of deciding which tool to call*. "Average span by level" → it reads the `span_distribution` tool description → calls it. "Top 10 employees by cost" → it reads `run_sql` → generates SQL. That IS intent classification — you get it for free with function calling. Adding a separate classifier means 2-3 LLM calls per question instead of 1-2, adding ~2 seconds of latency and tripling token cost for zero accuracy gain.

The 7 named query tools from the plan are kept — they're the best idea in the entire design. They eliminate SQL hallucination for the 15-20 most common analytical questions by giving the LLM pre-validated SQL templates it can call by name.

---

## The 10 tools

### Tool 1: `run_sql` (the escape hatch)
- LLM generates arbitrary SELECT SQL when no named query fits
- Used for: ad-hoc filters, lookups, custom aggregations, any Tier 1-2 question
- Executor: `duckdb_manager.query(user_id, sql)`
- Guard: block writes, validate column names exist

### Tool 2: `org_summary` (no params)
- Pre-built SQL: total HC, FTE, cost, avg cost, avg span, max depth, manager/IC counts
- Used for: "give me an overview", "how big is the org", "summary"

### Tool 3: `l2_breakdown` (no params)
- Pre-built SQL: per-L2 leader table with HC, cost, span, depth, IC/mgr split
- Used for: "by leader", "by division", "which unit has highest X"

### Tool 4: `span_distribution` (optional: benchmark_span param)
- Pre-built SQL: span bucket analysis with cost per bucket
- Used for: "span analysis", "management density", "narrow spans"

### Tool 5: `layer_analysis` (no params)
- Pre-built SQL: HC/FTE/cost at each hierarchy Level
- Used for: "org depth", "layers", "delayering"

### Tool 6: `manager_efficiency` (optional: benchmark_span param)
- Pre-built SQL: managers below benchmark span + their cost = delayering opportunity
- Used for: "managers to remove", "delayering savings", "span below benchmark"

### Tool 7: `cost_by_dimension` (required: dimension_col param)
- Pre-built SQL: HC/FTE/cost grouped by any column
- Used for: "cost by country", "headcount by function", "by grade"
- The LLM picks the right column name from the schema

### Tool 8: `get_insights` (no params)
- NOT SQL — calls `spans_layers_service.get_insights()` directly
- Returns: 1:1 managers, thin layers, below-benchmark spans, FTE opportunity
- Used for: "what are the org risks", "structural issues", "optimization opportunities"
- This is already computed and available — just needs to be exposed as a tool

### Tool 9: `show_chart` (chart spec params)
- Generates a chart specification JSON for the frontend
- Called AFTER a data tool when results are visual
- Frontend renders via Recharts using the spec + data rows

### Tool 10: `navigate` (target param)
- Switches the user to a specific workspace tab
- Targets: hierarchy, spans_layers, crosstab, org_chart, scenarios, activity, upload

---

## System prompt structure

The system prompt is assembled dynamically at session start from three sources:

### Block 1: Live schema (from /chat/schema)
```
TABLE: employees ({row_count} rows)

CORE STRUCTURAL COLUMNS (always present):
  emp_id TEXT — mapped from "{actual_emp_col}"
  mgr_id TEXT — mapped from "{actual_mgr_col}"
  Level INT — hierarchy depth (1=CEO)
  Span INT — direct reports count (0=IC)
  Total_Reports INT — subtree headcount
  Avg_FLC FLOAT — mean cost of direct reports
  L1...L{n} TEXT — ancestor name at each level

UPLOADED DATA COLUMNS:
  "{col_name}" {type} — e.g. {sample_val1}, {sample_val2}, {sample_val3}
  ... (one line per column from /chat/schema)

KNOWN MISSING (not uploaded for this dataset):
  ⚠ {list any standard cols where datasets.*_col is NULL}
```

### Block 2: Benchmark constants (static, A&M defaults)
```
INDUSTRY BENCHMARKS:

SPAN OF CONTROL:
  Front-line managers ideal range: 6–10 direct reports
  Mid-level managers ideal range: 5–7 direct reports
  Senior leaders ideal range: 4–6 direct reports
  Default target span: 6
  Below benchmark: < 4 direct reports
  Above benchmark: > 12 direct reports

ORGANIZATIONAL LAYERS:
  Max recommended layers (enterprise): 7
  Layers beyond 7 = "excessive layering"

MANAGEMENT RATIOS:
  Target manager-to-IC ratio: 1:6
  Management cost target: < 25% of total workforce cost
  Managers with < 4 reports = delayering candidates

LOCATION TIERS:
  High cost: USA, UK, Germany, Switzerland, Australia, Singapore
  Low cost: India, Philippines, Malaysia, Vietnam, Egypt, Poland, Romania, Mexico

FUNCTION CLASSIFICATION:
  Customer-facing: Sales, Account Mgmt, Customer Success, Client Delivery
  Support: HR, Finance, Legal, IT, Compliance, Procurement
```

### Block 3: Few-shot examples (Tier 2-3 patterns the LLM struggles with)

Include 6-8 worked examples for the patterns that hallucinate most:
- Self-join (employee vs manager comparison)
- L2 subtree grouping
- Ratio calculations (manager % of total)
- FILTER clause syntax (DuckDB-specific)
- Delayering CTE (benchmark math)
- Missing column handling ("this dataset doesn't have Function data")

These go in the system prompt, not as separate documents.

---

## What to build, in what order

### Phase 1: Bare minimum (1 day)
**Goal: 60% question coverage**

1. `POST /chat/query` endpoint — 15 lines in chat_router.py
   - Takes SQL string, calls `duckdb_manager.query(user_id, sql)`
   - Returns `{columns, data, row_count, truncated}`
   - This is the single blocker

2. `POST /chat/ask` endpoint — the agent loop
   - Takes message + conversation_history
   - Builds system prompt from /chat/schema
   - Runs tool-use loop via `llm_service.py`
   - Returns reply + charts + navigation

3. Three service files:
   - `services/chat_agent.py` — the loop (~80 lines)
   - `services/chat_tools.py` — tool definitions + executors
   - `services/chat_prompt.py` — prompt builder

Start with just `run_sql` + `show_chart` + `navigate` tools.
The LLM generates all SQL directly. This handles all Tier 1-2 questions.

### Phase 2: Named queries + benchmarks (2 days)
**Goal: 84% coverage**

4. Add the 6 named query tools (org_summary through cost_by_dimension)
   - Each tool has a SQL template with `{fte_col}`, `{flc_col}` placeholders
   - Placeholders filled at runtime from `datasets` metadata
   - Executor runs the filled SQL via duckdb_manager

5. Inject benchmark constants into system prompt
   - Static block, no code needed — just prompt content
   - Unlocks 8 benchmark comparison questions immediately

6. Add Tier 2-3 few-shot SQL examples to system prompt
   - Self-join, CTE, FILTER clause patterns
   - Test each against your actual schema before including

### Phase 3: Insights bridge + robustness (2 days)
**Goal: 95% coverage**

7. `get_insights` tool
   - Calls `spans_layers_service.get_insights(user_id)` from within the agent
   - Returns pre-computed: 1:1 managers, thin layers, FTE opportunity
   - The LLM narrativizes the result — no SQL generation needed

8. Column validation before SQL execution
   - Parse SQL, extract referenced column names
   - Check against known columns from /chat/schema
   - Catch hallucinated column names before they hit DuckDB

9. Missing column graceful handling
   - Check `datasets.*_col` metadata for NULL mappings
   - If user asks "by function" but func_col is NULL:
     LLM response: "This dataset doesn't have Function mapped. Upload with that column to enable this analysis."

10. Pre-apply dataset formulas before DuckDB load
    - ~10 lines in `duckdb_manager.ensure_fresh()`
    - Makes user-defined computed columns available to chatbot

### Phase 4: Frontend + polish (2 days)

11. `AskOrgSight` chat panel in the ProjectWorkspace
    - Calls /chat/init on mount (or checks /chat/status)
    - Sends messages to /chat/ask
    - Renders text + charts + navigation
    - Shows suggestion chips for common questions
    - Maintains conversation_history (last 6 turns, passed per request)

12. Chart data pairing
    - Agent stashes the last `run_sql` result
    - When `show_chart` is called, pairs the spec with the data rows
    - Frontend gets `{spec, data}` — renders via Recharts

### NOT building (deferred)

- **Simulation engine** — 4 questions, 5-7 days. The LLM can give benchmark-math estimates ("you have 45 managers with span < 4, costing $4.2M — removing them saves ~$3.8M"). That's good enough for Phase 1.
- **Rate card as second DuckDB table** — only relevant when clients upload grade data. Current live data has no grade_col mapped. Add when there's a use case.
- **Change log queries** — "what changed in this scenario" is nice to have but low priority vs the 75 analytical questions.
- **Per-session conversation memory beyond 6 turns** — just pass the last 6 messages in each request. No database, no vector store.

---

## Data flow for a single question

```
1. User types: "Which functions have the narrowest average span?"

2. Frontend sends POST /chat/ask:
   { message: "Which functions have the narrowest average span?",
     conversation_history: [...] }

3. Backend (chat_agent.py):
   a. Fetches schema from duckdb_manager.get_schema(user_id)
   b. Builds system prompt (schema + benchmarks + examples)
   c. Sends to Azure OpenAI with 10 tool definitions

4. GPT-4o decides: this is a cost_by_dimension query with dimension="Function" + ordering by span.
   But wait — does this dataset have a Function column?
   
   IF Function exists in schema:
     → Calls cost_by_dimension(dimension_col="Function")
     → Pre-built SQL runs, returns data
     → LLM summarizes: "Engineering has the narrowest avg span at 3.2, 
        well below the benchmark of 6. HR follows at 4.1."
     → LLM calls show_chart(type="horizontal_bar", x="Function", y="avg_span")
   
   IF Function is missing:
     → LLM responds: "This dataset doesn't have Function/department mapped. 
        I can break down spans by Country or L2 leader instead — 
        which would you prefer?"

5. Backend returns:
   { reply: "Engineering has the narrowest...",
     charts: [{spec: {type: "horizontal_bar", ...}, data: [...]}],
     navigation: null }

6. Frontend renders text + chart
```

---

## Existing code to reuse (no changes needed)

- `duckdb_manager.py` — per-user sessions, .query(), .get_schema(), .ensure_fresh()
- `llm_service.py` — Azure OpenAI client, retry logic, JSON mode, token metrics
- `spans_layers_service.get_insights()` — pre-computed org analysis
- `POST /chat/init` — loads scenario into DuckDB
- `GET /chat/schema` — column metadata + sample values
- `GET /chat/sample` — sample rows for debugging

## Existing code to modify (small changes)

- `chat_router.py` — add /chat/query and /chat/ask endpoints
- `duckdb_manager.ensure_fresh()` — add ~10 lines to pre-apply dataset formulas

## New files to create

- `services/chat_agent.py` — tool-use loop (~100 lines)
- `services/chat_tools.py` — 10 tool definitions + executors (~300 lines)
- `services/chat_prompt.py` — system prompt builder (~150 lines)
- `frontend/AskOrgSight.jsx` — chat panel component

---

## Question coverage summary

| Phase | Effort | Coverage | What it unlocks |
|-------|--------|----------|-----------------|
| Phase 1: /chat/query + agent loop + run_sql | 1 day | 60% | All Tier 1-2 SQL questions |
| Phase 2: Named queries + benchmarks | 2 days | 84% | Tier 3 + benchmark comparisons |
| Phase 3: Insights + validation + formulas | 2 days | 95% | Pre-computed analytics + robustness |
| Phase 4: Frontend + charts | 2 days | 95% + UX | Visual output + suggestion chips |
| (Deferred) Simulation engine | 5-7 days | 100% | 4 what-if questions |

Total to 95% coverage: ~7 days.
