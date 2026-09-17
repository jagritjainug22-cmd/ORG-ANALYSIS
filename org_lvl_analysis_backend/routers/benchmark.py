"""
Benchmarking router — pack management, deterministic preview, and the
streaming deep-analysis report.

Mirrors the project scoping and SSE event shape of routers/chat.py so the
frontend can reuse the same stream parser.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from dependencies.auth import require_project_access
from services import benchmark_template, benchmark_tools, db_service, duckdb_manager
from services import benchmark_registry as reg

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["benchmark"])


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _require_dataset(dataset_id: int) -> Dict[str, Any]:
    dataset = db_service.get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


def _ensure_duckdb(user_id: int, project_id: int, dataset_id: int, scenario_id: int) -> Dict[str, Any]:
    try:
        duckdb_manager.ensure_fresh(
            user_id=user_id, project_id=project_id,
            dataset_id=dataset_id, scenario_id=scenario_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    schema = duckdb_manager.get_schema(user_id)
    if schema is None:
        raise HTTPException(status_code=500, detail="DuckDB schema unavailable after init")
    return schema


def _require_pack_access(pack_id: int, project_id: int) -> Dict[str, Any]:
    pack = db_service.get_benchmark_pack(pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Benchmark pack not found")
    owner = pack.get("project_id")
    if owner is not None and owner != project_id:
        raise HTTPException(status_code=403, detail="This benchmark pack belongs to another project")
    return pack


# ---------------------------------------------------------------------------
# Metric catalogue
# ---------------------------------------------------------------------------

@router.get("/benchmark/metrics")
def benchmark_metric_catalogue(project_id: int, user: dict = Depends(require_project_access())):
    """The canonical metric dictionary — labels, units, directions, context needs."""
    return {"metrics": reg.metric_dictionary()}


# ---------------------------------------------------------------------------
# Packs
# ---------------------------------------------------------------------------

@router.get("/benchmark/packs")
def list_packs(project_id: int, user: dict = Depends(require_project_access())):
    return {"packs": db_service.list_benchmark_packs(project_id)}


@router.get("/benchmark/packs/{pack_id}")
def get_pack(pack_id: int, project_id: int, user: dict = Depends(require_project_access())):
    pack = _require_pack_access(pack_id, project_id)
    return {"pack": pack, "metrics": db_service.get_benchmark_metrics(pack_id)}


class PackPatchBody(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    region: Optional[str] = None
    size_band: Optional[str] = None
    currency: Optional[str] = None
    effective_year: Optional[int] = None
    notes: Optional[str] = None
    metrics: Optional[List[Dict[str, Any]]] = None


@router.patch("/benchmark/packs/{pack_id}")
def patch_pack(
    pack_id: int, body: PackPatchBody, project_id: int,
    user: dict = Depends(require_project_access()),
):
    pack = _require_pack_access(pack_id, project_id)
    if pack.get("is_builtin") and body.metrics is not None:
        raise HTTPException(
            status_code=400,
            detail="Built-in packs are reseeded on restart. Duplicate the pack before editing its values.",
        )
    updated = db_service.update_benchmark_pack(pack_id, **body.dict(exclude_none=True))
    benchmark_tools.invalidate()
    return {"pack": updated}


@router.delete("/benchmark/packs/{pack_id}")
def delete_pack(pack_id: int, project_id: int, user: dict = Depends(require_project_access())):
    _require_pack_access(pack_id, project_id)
    try:
        deleted = db_service.delete_benchmark_pack(pack_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    benchmark_tools.invalidate()
    return {"deleted": deleted}


class DuplicatePackBody(BaseModel):
    name: Optional[str] = None


@router.post("/benchmark/packs/{pack_id}/duplicate")
def duplicate_pack(
    pack_id: int, body: DuplicatePackBody, project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Copy any pack (including built-ins) into an editable project-owned pack."""
    source = _require_pack_access(pack_id, project_id)
    metrics = db_service.get_benchmark_metrics(pack_id)
    created = db_service.create_benchmark_pack(
        name=body.name or f"{source['name']} (copy)",
        metrics=metrics,
        industry=source.get("industry"),
        region=source.get("region"),
        size_band=source.get("size_band"),
        currency=source.get("currency") or "USD",
        effective_year=source.get("effective_year"),
        notes=source.get("notes"),
        project_id=project_id,
        created_by=user.get("username"),
        source_type="custom",
    )
    return {"pack": created}


@router.post("/benchmark/packs/upload")
async def upload_pack(
    project_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(require_project_access()),
):
    """Parse a completed benchmark template and store it as a custom pack."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    try:
        parsed = benchmark_template.parse_template(content)
    except benchmark_template.TemplateError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error("Benchmark template parse failed: %s", e, exc_info=True)
        raise HTTPException(status_code=400, detail=f"Could not parse the workbook: {e}") from e

    info = parsed["pack"]
    pack = db_service.create_benchmark_pack(
        name=info["name"],
        metrics=parsed["metrics"],
        industry=info.get("industry"),
        region=info.get("region"),
        size_band=info.get("size_band"),
        currency=info.get("currency") or "USD",
        effective_year=info.get("effective_year"),
        notes=info.get("notes"),
        project_id=project_id,
        created_by=user.get("username"),
        source_type="custom",
    )
    benchmark_tools.invalidate()
    return {
        "pack": pack,
        "metric_count": len(parsed["metrics"]),
        "warnings": parsed.get("warnings") or [],
    }


@router.get("/benchmark/template")
def download_template(
    project_id: int,
    pack_id: Optional[int] = Query(None, description="Pre-fill from an existing pack"),
    user: dict = Depends(require_project_access()),
):
    pack = None
    metrics = None
    if pack_id:
        pack = _require_pack_access(pack_id, project_id)
        metrics = db_service.get_benchmark_metrics(pack_id)

    content = benchmark_template.build_template(pack, metrics)
    filename = "orgsight_benchmark_template.xlsx"
    if pack:
        safe = "".join(c for c in pack["name"] if c.isalnum() or c in " -_").strip().replace(" ", "_")
        filename = f"orgsight_benchmark_{safe or 'pack'}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Per-dataset configuration
# ---------------------------------------------------------------------------

@router.get("/benchmark/config")
def get_config(
    project_id: int,
    dataset_id: int = Query(...),
    user: dict = Depends(require_project_access()),
):
    dataset = _require_dataset(dataset_id)
    config = db_service.get_dataset_benchmark_config(dataset_id)
    pack = db_service.get_benchmark_pack(config["pack_id"]) if config.get("pack_id") else None
    pack_functions = sorted({
        m["function"] for m in (db_service.get_benchmark_metrics(pack["id"]) if pack else [])
        if m.get("function")
    })
    return {
        "config": config,
        "pack": pack,
        "pack_functions": pack_functions,
        "dataset": {
            "id": dataset["id"],
            "name": dataset.get("name"),
            "func_col": dataset.get("func_col"),
            "subfunc_col": dataset.get("subfunc_col"),
            "fte_col": dataset.get("fte_col"),
            "flc_col": dataset.get("flc_col"),
            "country_col": dataset.get("country_col"),
        },
    }


class ConfigBody(BaseModel):
    dataset_id: int
    pack_id: Optional[int] = None
    context: Optional[Dict[str, Any]] = None
    function_map: Optional[Dict[str, str]] = None
    realization_low: Optional[float] = None
    realization_high: Optional[float] = None
    target_span: Optional[float] = None


@router.put("/benchmark/config")
def put_config(body: ConfigBody, project_id: int, user: dict = Depends(require_project_access())):
    _require_dataset(body.dataset_id)
    if body.pack_id:
        _require_pack_access(body.pack_id, project_id)
    low = body.realization_low
    high = body.realization_high
    if low is not None and (low < 0 or low > 1):
        raise HTTPException(status_code=400, detail="realization_low must be between 0 and 1")
    if high is not None and (high < 0 or high > 1):
        raise HTTPException(status_code=400, detail="realization_high must be between 0 and 1")
    if low is not None and high is not None and low > high:
        low, high = high, low

    config = db_service.save_dataset_benchmark_config(
        body.dataset_id,
        pack_id=body.pack_id,
        context=body.context,
        function_map=body.function_map,
        realization_low=low,
        realization_high=high,
        target_span=body.target_span,
    )
    benchmark_tools.invalidate(body.dataset_id)
    return {"config": config}


# ---------------------------------------------------------------------------
# Deterministic preview
# ---------------------------------------------------------------------------

class PreviewBody(BaseModel):
    dataset_id: int
    scenario_id: int
    pack_id: Optional[int] = None
    context: Optional[Dict[str, Any]] = None
    function_map: Optional[Dict[str, str]] = None
    realization_low: Optional[float] = None
    realization_high: Optional[float] = None
    target_span: Optional[float] = None


@router.post("/benchmark/preview")
def preview(body: PreviewBody, project_id: int, user: dict = Depends(require_project_access())):
    """Run the deterministic engine only — no LLM. Powers the live variance grid.

    Overrides supplied in the body are applied without being persisted, so the
    tab can preview a different pack or realisation factor before saving.
    """
    from services import benchmark_service

    dataset = _require_dataset(body.dataset_id)
    schema = _ensure_duckdb(user["id"], project_id, body.dataset_id, body.scenario_id)

    config = db_service.get_dataset_benchmark_config(body.dataset_id)
    overrides = body.dict(exclude_none=True, exclude={"dataset_id", "scenario_id"})
    config = {**config, **overrides}
    if body.pack_id:
        _require_pack_access(body.pack_id, project_id)

    try:
        comparison = benchmark_service.build_comparison(
            user["id"], body.dataset_id, dataset, schema, config,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error("Benchmark preview failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Benchmark preview failed: {e}") from e

    return comparison


# ---------------------------------------------------------------------------
# Deep analysis (SSE)
# ---------------------------------------------------------------------------

class AnalysisBody(BaseModel):
    dataset_id: int
    scenario_id: int
    pack_id: Optional[int] = None
    section_ids: Optional[List[str]] = None
    focus: Optional[str] = None


@router.post("/benchmark/analysis/stream")
async def analysis_stream(
    body: AnalysisBody, project_id: int, user: dict = Depends(require_project_access()),
):
    """Stream the full benchmark report as Server-Sent Events.

    Event types mirror /chat/stream so the frontend parser is shared:
      status         phase + progress
      deterministic  the full computed comparison, emitted before narration
      section_start  a narrative section is beginning
      evidence       drill-down queries the model ran for that section
      token          narration text chunk, tagged with its section id
      section_end    the completed section payload
      done           the assembled report
      error          fatal error
    """
    from services import benchmark_analysis

    dataset = _require_dataset(body.dataset_id)
    schema = _ensure_duckdb(user["id"], project_id, body.dataset_id, body.scenario_id)

    config = db_service.get_dataset_benchmark_config(body.dataset_id)
    if body.pack_id:
        _require_pack_access(body.pack_id, project_id)
        config = {**config, "pack_id": body.pack_id}

    async def event_generator():
        try:
            async for event in benchmark_analysis.run_benchmark_analysis_stream(
                user_id=user["id"],
                project_id=project_id,
                dataset_id=body.dataset_id,
                dataset_meta=dataset,
                schema=schema,
                config=config,
                section_ids=body.section_ids,
                focus=body.focus,
            ):
                payload = json.dumps(event.get("data", {}), default=str)
                yield f"event: {event.get('type', 'message')}\ndata: {payload}\n\n"
        except Exception as e:
            logger.error("Benchmark analysis stream failed: %s", e, exc_info=True)
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Saved reports
# ---------------------------------------------------------------------------

class SaveReportBody(BaseModel):
    dataset_id: int
    scenario_id: Optional[int] = None
    pack_id: Optional[int] = None
    title: Optional[str] = None
    report: Dict[str, Any]


@router.post("/benchmark/reports")
def save_report(body: SaveReportBody, project_id: int, user: dict = Depends(require_project_access())):
    _require_dataset(body.dataset_id)
    report_id = db_service.save_benchmark_report(
        body.dataset_id, body.report,
        scenario_id=body.scenario_id, pack_id=body.pack_id,
        title=body.title, created_by=user.get("username"),
    )
    return {"id": report_id}


@router.get("/benchmark/reports")
def list_reports(
    project_id: int, dataset_id: int = Query(...),
    user: dict = Depends(require_project_access()),
):
    return {"reports": db_service.list_benchmark_reports(dataset_id)}


@router.get("/benchmark/reports/{report_id}")
def get_report(report_id: int, project_id: int, user: dict = Depends(require_project_access())):
    report = db_service.get_benchmark_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.delete("/benchmark/reports/{report_id}")
def delete_report(report_id: int, project_id: int, user: dict = Depends(require_project_access())):
    return {"deleted": db_service.delete_benchmark_report(report_id)}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

class ExportBody(BaseModel):
    report: Dict[str, Any]
    title: Optional[str] = None


@router.post("/benchmark/export")
def export_report(body: ExportBody, project_id: int, user: dict = Depends(require_project_access())):
    """Export a generated report to a formatted Excel workbook."""
    from services import benchmark_export

    try:
        content = benchmark_export.build_workbook(body.report, title=body.title)
    except Exception as e:
        logger.error("Benchmark export failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Export failed: {e}") from e

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="orgsight_benchmark_report.xlsx"'},
    )
