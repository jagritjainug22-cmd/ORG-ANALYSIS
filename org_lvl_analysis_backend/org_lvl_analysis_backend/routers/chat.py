"""
Chat router — DuckDB init / status / teardown endpoints.

Provides the in-memory analytical layer for the "Ask OrgSight" feature.
All endpoints are project-scoped and require JWT authentication.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dependencies.auth import require_project_access
from services import db_service
from services import duckdb_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["chat"])


class ChatInitBody(BaseModel):
    dataset_id: int
    scenario_id: int


@router.post("/chat/init")
def chat_init(
    body: ChatInitBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Load a dataset + scenario into the in-memory DuckDB instance.

    If DuckDB is already loaded for this exact (project, dataset, scenario),
    returns the existing status without reloading.
    """
    if duckdb_manager.is_loaded_for(project_id, body.dataset_id, body.scenario_id):
        return {
            "status": "already_loaded",
            **duckdb_manager.get_status(),
        }

    records = db_service.get_scenario_records(body.scenario_id)
    if not records:
        raise HTTPException(status_code=404, detail="No records found for scenario")

    result = duckdb_manager.load(
        project_id=project_id,
        dataset_id=body.dataset_id,
        scenario_id=body.scenario_id,
        records=records,
    )

    return {"status": "loaded", **result}


@router.get("/chat/status")
def chat_status(
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    """Return metadata about the currently active DuckDB instance.

    Use this to verify that data was loaded correctly after init or
    baseline save.
    """
    status = duckdb_manager.get_status()
    if status is None:
        return {"status": "no_instance", "message": "No DuckDB instance is loaded"}
    return {"status": "active", **status}


@router.get("/chat/schema")
def chat_schema(
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    """Return the DuckDB table schema with column types and sample values."""
    schema = duckdb_manager.get_schema()
    if schema is None:
        raise HTTPException(status_code=404, detail="No DuckDB instance is loaded")
    return schema


@router.get("/chat/sample")
def chat_sample(
    project_id: int,
    n: int = Query(5, ge=1, le=50),
    _user: dict = Depends(require_project_access()),
):
    """Return n sample rows from the active DuckDB instance for verification."""
    rows = duckdb_manager.sample_rows(n)
    if rows is None:
        raise HTTPException(status_code=404, detail="No DuckDB instance is loaded")
    return {"rows": rows, "count": len(rows)}


@router.delete("/chat/session")
def chat_close(
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    """Tear down the active DuckDB instance."""
    duckdb_manager.close()
    return {"status": "closed"}
