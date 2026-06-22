"""
NEW ENDPOINTS — Add to your existing chat_router.py

Two new routes:
  POST /projects/{pid}/chat/query  — raw SQL execution (the Phase 1 blocker)
  POST /projects/{pid}/chat/ask    — full chatbot agent loop

Copy these into your existing chat router file and adjust imports
to match your project structure.
"""

import os
import logging
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends

logger = logging.getLogger(__name__)


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class ChatQueryBody(BaseModel):
    """Request body for /chat/query (raw SQL execution)."""
    sql: str
    max_rows: int = 2000


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class AskBody(BaseModel):
    """Request body for /chat/ask (chatbot agent)."""
    message: str
    dataset_id: int
    scenario_id: int
    conversation_history: list[ChatMessage] = []


class ChartSpec(BaseModel):
    chart_type: str
    title: str
    x: str
    y: str
    x_label: str | None = None
    y_label: str | None = None


class DataPayload(BaseModel):
    columns: list[str]
    rows: list[dict]


class AskResponse(BaseModel):
    reply: str
    display: str = "text"  # "text" | "table" | "chart" | "table+chart"
    data: DataPayload | None = None
    chart: ChartSpec | None = None
    navigation: dict | None = None
    tool_calls_made: int = 0
    tools_used: list[str] = []


# =============================================================================
# ENDPOINT 1: /chat/query — Raw SQL execution
# =============================================================================

# @router.post("/chat/query")
# def chat_query(
#     body: ChatQueryBody,
#     project_id: int,
#     user: dict = Depends(require_project_access()),
# ):
#     """
#     Execute raw SQL against this user's DuckDB instance.
#     Used internally by the agent and also available for debugging.
#     """
#     from services.duckdb_manager import duckdb_manager
#
#     user_id = user["id"]
#
#     # Check DuckDB is initialized for this user
#     status = duckdb_manager.get_status(user_id)
#     if not status:
#         raise HTTPException(404, "No DuckDB instance loaded. Call POST /chat/init first.")
#
#     try:
#         result = duckdb_manager.query(user_id, body.sql, max_rows=body.max_rows)
#         return result  # {columns, data, row_count, total_rows, truncated}
#     except RuntimeError as e:
#         raise HTTPException(404, str(e))
#     except Exception as e:
#         raise HTTPException(400, {"error": "SQL execution failed", "detail": str(e)})


# =============================================================================
# ENDPOINT 2: /chat/ask — Full chatbot agent
# =============================================================================

# @router.post("/chat/ask", response_model=AskResponse)
# def ask_orgsight(
#     body: AskBody,
#     project_id: int,
#     user: dict = Depends(require_project_access()),
# ):
#     """
#     Ask OrgSight — natural language queries over the loaded DuckDB dataset.
#     This is the main chatbot endpoint.
#
#     Prerequisites:
#       POST /chat/init must have been called first to load data into DuckDB.
#     """
#     from services.duckdb_manager import duckdb_manager
#     from services.chat_agent import run_agent
#     from services.db_service import get_dataset  # adjust to your actual import
#
#     user_id = user["id"]
#
#     # 1. Check DuckDB is initialized
#     status = duckdb_manager.get_status(user_id)
#     if not status:
#         raise HTTPException(400, "No dataset loaded. Call POST /chat/init first.")
#
#     # 2. Ensure data is fresh (reloads if scenario was updated)
#     duckdb_manager.ensure_fresh(user_id, body.dataset_id, body.scenario_id)
#
#     # 3. Get live schema
#     schema_info = duckdb_manager.get_schema(user_id)
#     # Expected: {"columns": [{"name":..., "type":..., "sample_values":[...]}, ...], "row_count": int}
#
#     # 4. Get dataset metadata (column mappings) from PostgreSQL
#     dataset = get_dataset(body.dataset_id)
#     dataset_meta = {
#         "emp_col": dataset.get("emp_col"),
#         "mgr_col": dataset.get("mgr_col"),
#         "fte_col": dataset.get("fte_col"),
#         "flc_col": dataset.get("flc_col"),
#         "job_title_col": dataset.get("job_title_col"),
#         "func_col": dataset.get("func_col"),
#         "grade_col": dataset.get("grade_col"),
#         "country_col": dataset.get("country_col"),
#         "division_col": dataset.get("division_col"),
#         "subfunc_col": dataset.get("subfunc_col"),
#         "contract_type_col": dataset.get("contract_type_col"),
#         "start_date_col": dataset.get("start_date_col"),
#         "entity_col": dataset.get("entity_col"),
#     }
#
#     # 5. Azure OpenAI config
#     azure_config = {
#         "azure_openai_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT"),
#         "azure_openai_api_key": os.getenv("AZURE_OPENAI_API_KEY"),
#         "azure_openai_deployment": os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
#         "azure_openai_api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21"),
#     }
#
#     # 6. Build conversation history
#     conversation = [{"role": msg.role, "content": msg.content} for msg in body.conversation_history]
#
#     # 7. Run the agent
#     try:
#         result = run_agent(
#             duckdb_manager=duckdb_manager,
#             user_id=user_id,
#             schema_info=schema_info,
#             dataset_meta=dataset_meta,
#             conversation_history=conversation,
#             user_message=body.message,
#             azure_config=azure_config,
#         )
#     except Exception as e:
#         logger.error(f"Ask OrgSight error: {e}", exc_info=True)
#         raise HTTPException(500, "Something went wrong processing your question.")
#
#     # 8. Build response
#     data_payload = None
#     if result.get("data"):
#         data_payload = DataPayload(
#             columns=result["data"]["columns"],
#             rows=result["data"]["rows"],
#         )
#
#     chart_spec = None
#     if result.get("chart"):
#         try:
#             chart_spec = ChartSpec(**result["chart"])
#         except Exception:
#             chart_spec = None  # LLM gave a malformed chart spec — skip it
#
#     return AskResponse(
#         reply=result["reply"],
#         display=result.get("display", "text"),
#         data=data_payload,
#         chart=chart_spec,
#         navigation=result.get("navigation"),
#         tool_calls_made=result.get("tool_calls_made", 0),
#         tools_used=result.get("tools_used", []),
#     )


# =============================================================================
# CURSOR INTEGRATION CHECKLIST
# =============================================================================
#
# 1. Uncomment both endpoints above
#
# 2. Adjust imports:
#    - duckdb_manager: how you import your singleton
#    - require_project_access(): your auth dependency
#    - get_dataset(): your DB service for dataset metadata
#
# 3. Add to existing chat router (the one with /chat/init, /chat/schema, etc.)
#
# 4. New files in services/:
#    - services/chat_agent.py
#    - services/chat_tools.py
#    - services/chat_prompt.py
#
# 5. Environment variables (.env):
#    AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
#    AZURE_OPENAI_API_KEY=your-key
#    AZURE_OPENAI_DEPLOYMENT=gpt-4o
#    AZURE_OPENAI_API_VERSION=2024-10-21
#
# 6. pip install openai (if not already present)
#
# 7. Frontend calls:
#    POST /projects/{pid}/chat/ask
#    Body: { message, dataset_id, scenario_id, conversation_history }
#    Response: { reply, display, data, chart, navigation }
