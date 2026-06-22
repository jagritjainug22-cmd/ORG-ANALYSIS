# Ask OrgSight — Cursor Implementation Prompt

## Context

We are adding a conversational chatbot ("Ask OrgSight") to the existing OrgSight 2.0 platform. It lets users ask natural language questions about their org data. The chatbot queries the existing DuckDB in-memory `employees` table via Azure OpenAI function calling — no LangChain, no embeddings, no new databases.

I am providing you with 4 reference files that contain the complete architecture. Your job is to integrate them into the existing codebase, adapting imports, function signatures, and patterns to match what already exists.

## Reference files provided (DO NOT use as-is — adapt to existing patterns)

1. `services/chat_agent.py` — the tool-use loop (core orchestrator)
2. `services/chat_tools.py` — 9 tool definitions, SQL validation, named query templates, executors
3. `services/chat_prompt.py` — dynamic system prompt builder
4. `router_endpoint.py` — two new endpoints to add to the existing chat router
5. `frontend/AskOrgSight.reference.jsx` — React chat panel reference

## What already exists (DO NOT modify unless noted)

- `services/duckdb_manager.py` — per-user DuckDB sessions with `.query()`, `.get_schema()`, `.get_status()`, `.ensure_fresh()`. Uses an OrderedDict with LRU eviction, max 32 concurrent sessions.
- `services/llm_service.py` — Azure OpenAI client with retry logic, JSON mode, token metrics. **Use this instead of creating a new OpenAI client.** Check its interface — it likely has a method like `llm_service.chat()` or `llm_service.complete()` that wraps `client.chat.completions.create()`. The reference `chat_agent.py` creates its own client — replace that with calls to `llm_service`.
- `services/spans_layers_service.py` — has `get_insights()` that computes 1:1 managers, thin layers, below-benchmark spans, FTE opportunity. The `get_insights` tool in `chat_tools.py` should call this.
- `routers/chat.py` — existing chat router with `POST /chat/init`, `GET /chat/schema`, `GET /chat/sample`, `DELETE /chat/session`. Add the two new endpoints here.
- `services/db_service.py` — PostgreSQL access. Has functions to get dataset metadata (column mappings like `emp_col`, `flc_col`, etc.).
- Auth system: `Depends(require_project_access())` pattern for JWT auth on routes.

## Step-by-step implementation

### Step 1: Add the three service files

Create these in `services/`:
- `services/chat_agent.py`
- `services/chat_tools.py`  
- `services/chat_prompt.py`

**Critical adaptations needed:**

a) **`chat_agent.py` — replace the raw OpenAI client with `llm_service`.**
   - Find how `llm_service.py` currently makes Azure OpenAI calls. It likely wraps `client.chat.completions.create()`.
   - Replace the `_get_client()` pattern and direct `client.chat.completions.create()` calls with whatever `llm_service` provides.
   - If `llm_service` doesn't support passing `tools=` and `tool_choice=`, extend it to accept those parameters. The core call needs: `model`, `messages`, `tools`, `tool_choice="auto"`.
   - Keep the retry/iteration logic from the reference — `llm_service` retry logic is for HTTP failures, the agent loop retries are for tool-call iterations.

b) **`chat_tools.py` — match the `duckdb_manager.query()` return format.**
   - Check what `duckdb_manager.query(user_id, sql)` actually returns. The reference assumes `{"columns": [...], "data": [...], "total_rows": int, "truncated": bool}`.
   - If it returns a different shape (e.g. list of dicts, DataFrame, or raw tuples), adjust `execute_run_sql()` and `execute_named_query()` accordingly.
   - The `_format_result_text()` function needs to match the actual return format.
   - For `execute_get_insights()`: check the actual import path and function signature of `spans_layers_service.get_insights()`. It may take `user_id`, `dataset_id`, `scenario_id`, or other params.

c) **`chat_prompt.py` — verify schema_info shape.**
   - Call `GET /chat/schema` or `duckdb_manager.get_schema(user_id)` and check the actual response shape.
   - The reference assumes `{"columns": [{"name":..., "type":..., "sample_values":[], "unique_count": int}], "row_count": int}`.
   - Adjust `_build_schema_block()` if the actual shape differs.

### Step 2: Add endpoints to the existing chat router

Open `routers/chat.py` and add two new endpoints:

a) `POST /projects/{project_id}/chat/query`
   - Takes `{"sql": str, "max_rows": int}`
   - Calls `duckdb_manager.query(user_id, sql, max_rows=max_rows)`
   - Returns the raw result
   - This is used internally by the agent and for debugging
   - Follow the same auth pattern as existing endpoints in this file

b) `POST /projects/{project_id}/chat/ask`
   - Takes `{"message": str, "dataset_id": int, "scenario_id": int, "conversation_history": [...]}`
   - Calls `duckdb_manager.ensure_fresh()` to check data is current
   - Gets schema via `duckdb_manager.get_schema(user_id)`
   - Gets dataset metadata (column mappings) from db_service
   - Calls `chat_agent.run_agent()` with all the above
   - Returns `{"reply", "display", "data", "chart", "navigation", "tool_calls_made", "tools_used"}`
   - Follow the same auth, error handling, and response patterns as existing endpoints

**The `router_endpoint.py` reference has the full code commented out with integration notes — uncomment and adapt.**

### Step 3: Environment variables

Add to `.env` (if not already present for `llm_service`):
```
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-10-21
```

Check if `llm_service.py` already reads these — if so, reuse the same env vars rather than adding new ones.

### Step 4: Pre-apply dataset formulas (small change to duckdb_manager)

In `duckdb_manager.py`, inside `ensure_fresh()` or `load()`, after building the DataFrame from `scenario_records` but before writing to DuckDB:

```python
# Apply user-defined formula columns
from services.db_service import list_formulas  # or wherever this lives
formulas = list_formulas(dataset_id)
if formulas:
    from services.formula_service import apply_formulas_to_records
    records = apply_formulas_to_records(df.to_dict("records"), formulas)
    df = pd.DataFrame(records)
```

This makes user-defined computed columns (like `Monthly_Cost = FLC / 12`) available to the chatbot. Check the actual function names and import paths — `dataset_formulas` table has the formulas, and there's likely an existing apply function used by the `/hierarchy` endpoint.

### Step 5: Frontend — Ask OrgSight panel

The "Ask OrgSight" tab already exists as a stub in `ProjectWorkspace`. Wire it up:

a) Create `components/AskOrgSight.jsx` (or `.tsx`) based on the reference file.

b) Adapt to your existing patterns:
   - Auth headers: use your existing `useAuth()` context or `apiClient` for the fetch call
   - Project context: get `projectId`, `datasetId`, `scenarioId` from your existing `useProject()` context or props
   - Navigation: the `onNavigate` callback should switch the active tab in `ProjectWorkspace` (e.g. `setActiveTab("hierarchy")`)
   - Styling: the reference uses inline styles. If you use Tailwind, convert to Tailwind classes. Keep the white-and-navy color scheme.

c) Add `recharts` to dependencies if not already present:
   ```
   npm install recharts
   ```

d) The component needs three sub-components:
   - `DataTable` — sortable table with CSV export (for "table" and "table+chart" display modes)
   - `DynamicChart` — Recharts wrapper that renders from `{chart_type, x, y, title}` spec + data rows
   - `EmptyState` — suggestion chips that trigger sendMessage on click

### Step 6: Test the integration

Test in this order:

1. `POST /chat/init` — verify DuckDB loads correctly (existing endpoint, should already work)
2. `GET /chat/schema` — verify schema response shape matches what `chat_prompt.py` expects
3. `POST /chat/query` with a simple SQL: `SELECT COUNT(*) FROM employees` — verify raw SQL execution works
4. `POST /chat/ask` with `{"message": "Give me an org summary"}` — this should trigger the `org_summary` named tool
5. `POST /chat/ask` with `{"message": "Top 10 employees by cost"}` — this should trigger `run_sql` with LLM-generated SQL
6. `POST /chat/ask` with `{"message": "What are the structural risks?"}` — this should trigger `get_insights`
7. Test a query with a non-existent column to verify validation catches it
8. Test the frontend panel end-to-end

## Architecture summary for context

```
User message
    │
    ▼
POST /chat/ask (chat router)
    │
    ├─ ensure_fresh() — reload DuckDB if stale
    ├─ get_schema()   — live column metadata
    ├─ get_dataset()  — column mappings from PostgreSQL
    │
    ▼
chat_agent.run_agent()
    │
    ├─ Builds system prompt (schema + benchmarks + few-shots)
    ├─ Sends to Azure OpenAI with 9 tool definitions
    │
    ▼
TOOL-USE LOOP (max 6 iterations):
    │
    ├─ LLM calls run_sql         → validate SQL → duckdb_manager.query()
    ├─ LLM calls org_summary     → pre-built SQL template → duckdb_manager.query()
    ├─ LLM calls l2_breakdown    → pre-built SQL template → duckdb_manager.query()
    ├─ LLM calls span_distribution → pre-built SQL template → duckdb_manager.query()
    ├─ LLM calls layer_analysis  → pre-built SQL template → duckdb_manager.query()
    ├─ LLM calls manager_efficiency → pre-built SQL template → duckdb_manager.query()
    ├─ LLM calls cost_by_dimension → pre-built SQL template → duckdb_manager.query()
    ├─ LLM calls get_insights    → spans_layers_service.get_insights()
    ├─ LLM calls navigate        → pass target to frontend
    │
    ▼
LLM final response (JSON):
    { reply, display, chart }
    │
    ▼
Frontend renders based on display mode:
    "text"        → reply bubble only
    "table"       → reply + sortable data table
    "chart"       → reply + Recharts visualization
    "table+chart" → reply + chart + collapsible table
```

## What NOT to do

- Do NOT install LangChain or any agent framework
- Do NOT create a new Azure OpenAI client if `llm_service.py` already has one — extend it if needed
- Do NOT modify `duckdb_manager.py` beyond the formula pre-application step
- Do NOT modify existing endpoints (init, schema, sample, session)
- Do NOT hardcode column names — everything is dynamic from /chat/schema
- Do NOT add embeddings, vector stores, or RAG pipelines
- Do NOT create separate intent classification — the LLM's function calling IS the classifier

## Key files to read before starting

Read these first so you understand the existing patterns:
1. `services/duckdb_manager.py` — understand `.query()` return format, `.get_schema()` return format, user session management
2. `services/llm_service.py` — understand how it wraps Azure OpenAI calls, what parameters it accepts
3. `services/spans_layers_service.py` — understand `get_insights()` signature and return format
4. `routers/chat.py` — understand existing endpoint patterns, auth, error handling
5. `services/db_service.py` — understand how to get dataset metadata (column mappings)
