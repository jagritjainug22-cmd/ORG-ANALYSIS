"""
Chat router — DuckDB init / status / teardown endpoints.

Provides the in-memory analytical layer for the "Ask OrgSight" feature.
All endpoints are project-scoped and require JWT authentication.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from dependencies.auth import require_project_access
from services import db_service
from services import duckdb_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["chat"])


class ChatInitBody(BaseModel):
    dataset_id: int
    scenario_id: int


def _require_scenario_in_dataset(dataset_id: int, scenario_id: int) -> None:
    scenario = db_service.get_scenario(scenario_id)
    if not scenario or scenario.get("dataset_id") != dataset_id:
        raise HTTPException(status_code=404, detail="Scenario not found in dataset")


@router.post("/chat/init")
def chat_init(
    body: ChatInitBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Load or refresh this user's DuckDB cache for a dataset + scenario."""
    _require_scenario_in_dataset(body.dataset_id, body.scenario_id)
    try:
        result = duckdb_manager.ensure_fresh(
            user_id=user["id"],
            project_id=project_id,
            dataset_id=body.dataset_id,
            scenario_id=body.scenario_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    status = "loaded" if result.pop("reloaded", True) else "already_loaded"
    return {"status": status, **result}


@router.post("/chat/ensure")
def chat_ensure(
    body: ChatInitBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Prefetch hook for future chat UI — same as init (stale-check + reload if needed)."""
    return chat_init(body, project_id, user)


@router.get("/chat/status")
def chat_status(
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Return metadata about this user's active DuckDB instance."""
    status = duckdb_manager.get_status(user["id"])
    if status is None:
        return {"status": "no_instance", "message": "No DuckDB instance is loaded for this user"}
    scenario = db_service.get_scenario(status["scenario_id"]) or {}
    loaded_at = status.get("scenario_updated_at")
    current_at = scenario.get("updated_at")
    is_stale = bool(current_at and loaded_at and current_at != loaded_at)
    return {"status": "active", "is_stale": is_stale, "current_updated_at": current_at, **status}


@router.get("/chat/schema")
def chat_schema(
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    schema = duckdb_manager.get_schema(user["id"])
    if schema is None:
        raise HTTPException(status_code=404, detail="No DuckDB instance is loaded for this user")
    return schema


@router.get("/chat/sample")
def chat_sample(
    project_id: int,
    n: int = Query(5, ge=1, le=50),
    user: dict = Depends(require_project_access()),
):
    rows = duckdb_manager.sample_rows(user["id"], n)
    if rows is None:
        raise HTTPException(status_code=404, detail="No DuckDB instance is loaded for this user")
    return {"rows": rows, "count": len(rows)}


@router.delete("/chat/session")
def chat_close(
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    duckdb_manager.close(user["id"])
    return {"status": "closed"}


# ---------------------------------------------------------------------------
# SQL query endpoint — direct DuckDB execution
# ---------------------------------------------------------------------------

class ChatQueryBody(BaseModel):
    sql: str
    max_rows: int = 2000


@router.post("/chat/query")
def chat_query(
    body: ChatQueryBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Execute a SQL query against this user's DuckDB employees table.

    The DuckDB instance must be initialised first via POST /chat/init.
    The SQL runs against a single table called ``employees`` which contains
    all active (non-flagged) records for the loaded scenario, plus computed
    hierarchy columns (Level, Span, Total_Reports, Avg_FLC, L1…Ln, Chain).

    Returns up to ``max_rows`` rows (default 2 000). When the result set is
    larger the response includes ``truncated: true`` and ``total_rows`` so the
    caller can paginate or re-query with a LIMIT clause.
    """
    status = duckdb_manager.get_status(user["id"])
    if status is None:
        raise HTTPException(
            status_code=404,
            detail="No DuckDB instance is loaded for this user. Call POST /chat/init first.",
        )
    try:
        result = duckdb_manager.query(user["id"], body.sql, max_rows=body.max_rows)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        logger.warning("chat_query SQL error user_id=%s: %s", user["id"], e)
        raise HTTPException(
            status_code=400,
            detail={"error": "SQL execution failed", "detail": str(e)},
        ) from e


# ---------------------------------------------------------------------------
# Agent message endpoint — orchestrated chatbot turn
# ---------------------------------------------------------------------------

class ChatMessageBody(BaseModel):
    message: str
    dataset_id: int
    scenario_id: int
    history: list = []


@router.post("/chat/message")
def chat_message(
    body: ChatMessageBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Process a natural-language message through the OrgSight chat agent.

    Ensures the DuckDB instance is fresh, then runs the full orchestrator
    turn: intent classification → tool routing → SQL/insight execution →
    LLM response formatting.
    """
    _require_scenario_in_dataset(body.dataset_id, body.scenario_id)

    # Ensure DuckDB is loaded and fresh for this user
    try:
        duckdb_manager.ensure_fresh(
            user_id=user["id"],
            project_id=project_id,
            dataset_id=body.dataset_id,
            scenario_id=body.scenario_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    # Retrieve dataset metadata for column name resolution
    dataset = db_service.get_dataset(body.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    schema = duckdb_manager.get_schema(user["id"])
    if schema is None:
        raise HTTPException(status_code=500, detail="DuckDB schema unavailable after init")

    try:
        from services.chat_agent import run_agent_turn
        response = run_agent_turn(
            message=body.message,
            user_id=user["id"],
            project_id=project_id,
            dataset_meta=dataset,
            schema=schema,
            history=body.history,
        )
        return response
    except Exception as e:
        logger.error("chat_message agent error user_id=%s: %s", user["id"], e, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Agent error", "detail": str(e)}) from e


# ---------------------------------------------------------------------------
# Streaming agent endpoint — SSE (Server-Sent Events)
# ---------------------------------------------------------------------------

@router.post("/chat/stream")
async def chat_stream(
    body: ChatMessageBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Stream a chat agent turn as Server-Sent Events.

    Emits named SSE events:
      event: status  — phase progress (intent / query / formatting)
      event: token   — individual LLM text chunks
      event: done    — final structured metadata (data, columns, chart_hint…)
      event: error   — agent-level error message

    The existing POST /chat/message endpoint remains untouched for
    non-streaming clients and backward compatibility.
    """
    _require_scenario_in_dataset(body.dataset_id, body.scenario_id)

    try:
        duckdb_manager.ensure_fresh(
            user_id=user["id"],
            project_id=project_id,
            dataset_id=body.dataset_id,
            scenario_id=body.scenario_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    dataset = db_service.get_dataset(body.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    schema = duckdb_manager.get_schema(user["id"])
    if schema is None:
        raise HTTPException(status_code=500, detail="DuckDB schema unavailable after init")

    async def event_generator():
        from services.chat_agent import run_agent_turn_stream
        try:
            async for event in run_agent_turn_stream(
                message=body.message,
                user_id=user["id"],
                project_id=project_id,
                dataset_meta=dataset,
                schema=schema,
                history=body.history,
            ):
                event_type = event.get("type", "message")
                event_data = json.dumps(event.get("data", {}), default=str)
                yield f"event: {event_type}\ndata: {event_data}\n\n"
        except Exception as e:
            logger.error("chat_stream generator error user_id=%s: %s", user["id"], e, exc_info=True)
            err_data = json.dumps({"message": str(e)})
            yield f"event: error\ndata: {err_data}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
