"""
Project-scoped lifecycle router (Phase 3).

Every endpoint lives under /projects/{project_id}/… and is protected by
require_project_access(), which enforces JWT auth, project membership,
deadline, and status checks in a single dependency.  project_id is always
sourced from the URL path -- never from a request body.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from io import BytesIO
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import ORJSONResponse, StreamingResponse
from PIL import Image
from pptx import Presentation
from pptx.util import Inches
from pydantic import BaseModel

from dependencies.auth import get_current_user, require_project_access
from services import db_service
from services.cleanup_service import apply_exclusion_filter, build_country_flag
from services.crosstab_service import apply_others_grouping, generate_crosstab, generate_preview_data
from services.export_service import export_excel
from services.filter_error_service import filter_errors
from services.hierarchy_service import compute_avg_flc, compute_chains, compute_levels, compute_total_reports
from services.logging_service import get_activity_logs, get_user_stats, write_activity_log
from services.orgchart_render_service import render_scenario_svg
from services.orgchart_service import build_org_tree, build_tree_preserve_ancestors, make_json_serializable
from services.spans_layers_service import span_threshold, spans_and_layers
from services.upload_service import read_excel_file
from services.validation_service import validate_org_data

Image.MAX_IMAGE_PIXELS = None

router = APIRouter(prefix="/projects/{project_id}", tags=["lifecycle"])

# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class SaveBaselineBody(BaseModel):
    name: str
    records: List[Dict]
    emp_col: str
    mgr_col: str
    fte_col: Optional[str] = None
    flc_col: Optional[str] = None
    job_title_col: Optional[str] = None
    country_col: Optional[str] = None

class MoveBody(BaseModel):
    emp_id: str
    new_mgr_id: Optional[str] = None

class EditBody(BaseModel):
    emp_id: str
    updates: Dict

class AddBody(BaseModel):
    record: Dict
    emp_id: str
    mgr_id: Optional[str] = None
    level: Optional[int] = None
    fte: Optional[float] = None
    flc: Optional[float] = None

class FlagBody(BaseModel):
    emp_id: str
    flagged: bool = True

class ScenarioBody(BaseModel):
    name: str
    description: Optional[str] = ""
    source_scenario_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_dataset_in_project(dataset_id: int, project_id: int) -> Dict[str, Any]:
    """Load a dataset and verify it belongs to the given project."""
    ds = db_service.get_dataset(dataset_id)
    if not ds or ds.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found in this project")
    return ds


def _require_scenario_in_project(scenario_id: int, project_id: int) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Load a scenario + its parent dataset, verifying project ownership.
    Returns (scenario, dataset)."""
    scenario = db_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    ds = db_service.get_dataset(scenario["dataset_id"])
    if not ds or ds.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="Scenario not found in this project")
    return scenario, ds


# ---------------------------------------------------------------------------
# Inkscape-less PPT / PDF fallbacks (moved from main.py)
# ---------------------------------------------------------------------------

def _scenario_summary_rows(scenario: dict, dataset: dict, records: list) -> dict:
    summary = db_service.get_scenario_summary(scenario["id"])
    change_log = db_service.get_change_log(scenario["id"])
    return {
        "title": f"OrgSight 2.0 -- {dataset['name']} -- {scenario['name']}",
        "summary": summary,
        "change_log": change_log,
        "record_count": len(records),
    }


def _render_scenario_summary_pdf(scenario, dataset, records) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    data = _scenario_summary_rows(scenario, dataset, records)
    s = data["summary"]
    cur = s.get("current", {})
    base = s.get("baseline", {})
    delta = s.get("delta", {})
    flagged = s.get("flagged_removed", {})

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.5*cm, rightMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
        title=data["title"],
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=colors.HexColor("#0b234b"))
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=colors.HexColor("#0b234b"))
    body = styles["BodyText"]

    flow = []
    flow.append(Paragraph(data["title"], h1))
    flow.append(Spacer(1, 0.3*cm))
    flow.append(Paragraph(
        f"Dataset #{dataset['id']} &middot; {data['record_count']:,} records", body,
    ))
    flow.append(Spacer(1, 0.5*cm))
    flow.append(Paragraph("Headline metrics", h2))

    metric_rows = [
        ["", "Baseline", "Current", "Delta"],
        ["Headcount", f"{base.get('headcount', 0):,}", f"{cur.get('headcount', 0):,}", f"{delta.get('headcount', 0):+,}"],
        ["Total FTE", f"{base.get('total_fte', 0):,.1f}", f"{cur.get('total_fte', 0):,.1f}", f"{delta.get('fte', 0):+,.1f}"],
        ["Total Cost", f"${base.get('total_cost', 0):,.0f}", f"${cur.get('total_cost', 0):,.0f}", f"${delta.get('cost', 0):+,.0f}"],
        ["Flagged removed", "0", f"{flagged.get('count', 0):,}", f"-{flagged.get('count', 0):,}"],
    ]
    t = Table(metric_rows, colWidths=[4*cm, 4*cm, 4*cm, 4*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b234b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d6dee8")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f7fb")]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    flow.append(t)
    flow.append(Spacer(1, 0.8*cm))

    flow.append(Paragraph("Change log", h2))
    change_rows = [["When", "Action", "Employee", "User", "Details"]]
    for entry in data["change_log"]:
        when = (entry.get("created_at") or "")[:19].replace("T", " ")
        details = entry.get("details_json") or ""
        if len(details) > 80:
            details = details[:80] + "..."
        change_rows.append([
            when, entry.get("action", ""), entry.get("emp_id", "") or "",
            entry.get("username", "") or "", details,
        ])
    if len(change_rows) == 1:
        change_rows.append(["--", "no changes yet", "", "", ""])
    log_table = Table(change_rows, colWidths=[3.5*cm, 2.0*cm, 3.0*cm, 2.5*cm, 6.0*cm], repeatRows=1)
    log_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b234b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d6dee8")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f7fb")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    flow.append(log_table)
    flow.append(Spacer(1, 0.5*cm))
    flow.append(Paragraph(
        "<i>Note: this is the text summary export. For the full visual chart "
        "with editable shapes, install Inkscape on the server.</i>", body,
    ))
    doc.build(flow)
    return buf.getvalue()


def _populate_scenario_summary_pptx(prs, scenario, dataset, records) -> None:
    from pptx.util import Inches as I, Pt
    from pptx.dml.color import RGBColor

    NAVY = RGBColor(0x0B, 0x23, 0x4B)
    GOLD = RGBColor(0xC8, 0xA0, 0x4E)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)
    GREY = RGBColor(0x4F, 0x60, 0x77)

    data = _scenario_summary_rows(scenario, dataset, records)
    s = data["summary"]
    cur = s.get("current", {})
    base = s.get("baseline", {})
    delta = s.get("delta", {})

    slide = prs.slides.add_slide(prs.slide_layouts[6])
    band = slide.shapes.add_shape(1, I(0), I(0), I(10), I(1.2))
    band.fill.solid(); band.fill.fore_color.rgb = NAVY
    band.line.fill.background()
    title_box = slide.shapes.add_textbox(I(0.4), I(0.25), I(9.2), I(0.7))
    p = title_box.text_frame.paragraphs[0]
    p.text = data["title"]
    p.runs[0].font.size = Pt(22); p.runs[0].font.bold = True; p.runs[0].font.color.rgb = WHITE

    sub = slide.shapes.add_textbox(I(0.4), I(0.85), I(9.2), I(0.35))
    sub.text_frame.text = f"Dataset #{dataset['id']} - {data['record_count']:,} records"
    for r in sub.text_frame.paragraphs[0].runs:
        r.font.size = Pt(11); r.font.color.rgb = GOLD

    metrics = [
        ("Headcount", f"{cur.get('headcount', 0):,}", f"vs {base.get('headcount', 0):,} baseline"),
        ("Total FTE", f"{cur.get('total_fte', 0):,.1f}", f"{delta.get('fte', 0):+,.1f} delta"),
        ("Total Cost", f"${cur.get('total_cost', 0):,.0f}", f"{delta.get('cost', 0):+,.0f} delta"),
        ("Changes", f"{s.get('change_count', 0)}", "logged mutations"),
    ]
    card_w = 2.2
    for i, (label, value, sub_text) in enumerate(metrics):
        left = I(0.4 + i * (card_w + 0.15))
        card = slide.shapes.add_shape(1, left, I(1.6), I(card_w), I(1.5))
        card.fill.solid(); card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = NAVY
        tb = slide.shapes.add_textbox(left, I(1.7), I(card_w), I(0.4))
        tb.text_frame.text = label.upper()
        for r in tb.text_frame.paragraphs[0].runs:
            r.font.size = Pt(9); r.font.bold = True; r.font.color.rgb = GREY
        vb = slide.shapes.add_textbox(left, I(2.05), I(card_w), I(0.6))
        vb.text_frame.text = value
        for r in vb.text_frame.paragraphs[0].runs:
            r.font.size = Pt(20); r.font.bold = True; r.font.color.rgb = NAVY
        sb = slide.shapes.add_textbox(left, I(2.65), I(card_w), I(0.4))
        sb.text_frame.text = sub_text
        for r in sb.text_frame.paragraphs[0].runs:
            r.font.size = Pt(9); r.font.color.rgb = GREY

    slide2 = prs.slides.add_slide(prs.slide_layouts[6])
    th = slide2.shapes.add_textbox(I(0.4), I(0.3), I(9.2), I(0.5))
    th.text_frame.text = "Change log"
    for r in th.text_frame.paragraphs[0].runs:
        r.font.size = Pt(22); r.font.bold = True; r.font.color.rgb = NAVY

    log_rows = data["change_log"][:30]
    if not log_rows:
        nb = slide2.shapes.add_textbox(I(0.4), I(1.0), I(9.2), I(0.5))
        nb.text_frame.text = "No changes recorded for this scenario yet."
        for r in nb.text_frame.paragraphs[0].runs:
            r.font.size = Pt(13); r.font.color.rgb = GREY
    else:
        table_shape = slide2.shapes.add_table(
            len(log_rows) + 1, 4, I(0.4), I(1.0), I(9.2), I(min(6.0, 0.35 * (len(log_rows) + 1)))
        )
        tbl = table_shape.table
        headers = ["When", "Action", "Employee", "User"]
        for c, h in enumerate(headers):
            cell = tbl.cell(0, c)
            cell.text = h
            for p in cell.text_frame.paragraphs:
                for r in p.runs:
                    r.font.bold = True; r.font.size = Pt(10); r.font.color.rgb = WHITE
            cell.fill.solid(); cell.fill.fore_color.rgb = NAVY
        for i, entry in enumerate(log_rows, start=1):
            when = (entry.get("created_at") or "")[:19].replace("T", " ")
            tbl.cell(i, 0).text = when
            tbl.cell(i, 1).text = str(entry.get("action", "") or "")
            tbl.cell(i, 2).text = str(entry.get("emp_id", "") or "")
            tbl.cell(i, 3).text = str(entry.get("username", "") or "")
            for c in range(4):
                for p in tbl.cell(i, c).text_frame.paragraphs:
                    for r in p.runs:
                        r.font.size = Pt(9)

    fb = slide.shapes.add_textbox(I(0.4), I(6.6), I(9.2), I(0.4))
    fb.text_frame.text = (
        "Visual org chart requires Inkscape on the server. This deck shows the "
        "metrics + change log so it stays editable in PowerPoint."
    )
    for r in fb.text_frame.paragraphs[0].runs:
        r.font.size = Pt(9); r.font.color.rgb = GREY


# ===================================================================
# Pipeline endpoints (stateless -- data in body, no DB interaction)
# ===================================================================

@router.post("/upload")
async def upload(
    file: UploadFile,
    request: Request,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        contents = await file.read()
        df = read_excel_file(BytesIO(contents))
        rows_count = len(df)
        records = df.to_dict(orient="records")
        safe_records = jsonable_encoder(records)
        write_activity_log(
            username=username, action="process", module="Upload",
            rows_output=rows_count, status="success",
            details=f"Uploaded file: {file.filename}",
        )
        return {"columns": df.columns.tolist(), "records": safe_records}
    except Exception as e:
        write_activity_log(
            username=username, action="process", module="Upload",
            status="error", details=str(e),
        )
        raise


@router.post("/cleanup", response_class=ORJSONResponse)
def cleanup_endpoint(
    payload: List[Dict],
    project_id: int,
    remove_exclusion: bool = True,
    country_col: Optional[str] = None,
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        df = pd.DataFrame(payload)
        rows_input = len(df)
        df = build_country_flag(df, country_col=country_col)
        df, removed_count = apply_exclusion_filter(df, remove=remove_exclusion)
        df = df.replace([np.inf, -np.inf], np.nan)
        rows_output = len(df)
        records = df.to_dict(orient="records")
        write_activity_log(
            username=username, action="process", module="Cleanup",
            rows_input=rows_input, rows_output=rows_output, status="success",
            details=f"Removed {removed_count} exclusion rows, Country_Flag generated from '{country_col or 'not specified'}'",
        )
        return {"df": records, "removed": int(removed_count)}
    except Exception as e:
        write_activity_log(
            username=username, action="process", module="Cleanup",
            rows_input=len(payload), status="error", details=str(e),
        )
        raise


@router.post("/validate")
async def validate_endpoint(
    request: Request,
    project_id: int,
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    span_col: str | None = Query(None),
    download: bool = Query(False),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        payload = await request.json()
        df = pd.DataFrame(payload)
        rows_input = len(df)
        result = validate_org_data(df, emp_col, mgr_col, span_col)

        if download:
            excel_bytes = export_excel(result["df_with_flags"], sheet_name="Data_With_Flags")
            write_activity_log(
                username=username, action="download", module="Validate",
                rows_input=rows_input, rows_output=len(result["df_with_flags"]),
                status="success", details="Downloaded validated data with flags",
            )
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=validated_org_data.xlsx"},
            )

        df_flags = result["df_with_flags"].replace([np.inf, -np.inf], np.nan)
        records = df_flags.where(pd.notnull(df_flags), None).to_dict(orient="records")
        circular_ids = result.get("circular_reference_ids", [])

        write_activity_log(
            username=username, action="process", module="Validate",
            rows_input=rows_input, rows_output=len(records), status="success",
            details=(
                f"Found {len(result['duplicate_ids'])} duplicates, "
                f"{len(result['missing_manager_ids'])} missing managers, "
                f"{len(result['invalid_manager_ids'])} invalid managers, "
                f"{len(circular_ids)} circular references"
            ),
        )
        return ORJSONResponse({
            "duplicate_ids": result["duplicate_ids"],
            "missing_manager_ids": result["missing_manager_ids"],
            "invalid_manager_ids": result["invalid_manager_ids"],
            "circular_reference_ids": circular_ids,
            "top_manager": result["top_manager"],
            "df_with_flags": records,
        })
    except Exception as e:
        write_activity_log(
            username=username, action="download" if download else "process",
            module="Validate", status="error", details=str(e),
        )
        raise


@router.post("/filter_errors")
async def filter_invalids(
    request: Request,
    project_id: int,
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    remove_dup: bool = Query(True),
    remove_missing: bool = Query(True),
    remove_invalid: bool = Query(True),
    remove_circular: bool = Query(True),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        payload = await request.json()
        df = pd.DataFrame(payload)
        original_count = len(df)
        df_filtered = filter_errors(
            df, emp_col, mgr_col,
            remove_dup=remove_dup, remove_missing=remove_missing,
            remove_invalid=remove_invalid, remove_circular=remove_circular,
        )
        filtered_count = len(df_filtered)
        removed_count = original_count - filtered_count
        df_filtered = df_filtered.replace([np.inf, -np.inf], np.nan)
        records = df_filtered.where(pd.notnull(df_filtered), None).to_dict(orient="records")
        write_activity_log(
            username=username, action="process", module="Filter Errors",
            rows_input=original_count, rows_output=filtered_count,
            status="success", details=f"Removed {removed_count} error rows",
        )
        return ORJSONResponse({
            "df": records, "original_count": original_count,
            "filtered_count": filtered_count, "removed_count": removed_count,
        })
    except Exception as e:
        write_activity_log(
            username=username, action="process", module="Filter Errors",
            status="error", details=str(e),
        )
        raise


@router.post("/hierarchy")
async def hierarchy_endpoint(
    request: Request,
    project_id: int,
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    flc_col: str | None = Query(None),
    fte_col: str | None = Query(None),
    job_title_col: str | None = Query(None),
    download: bool = Query(False),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        payload = await request.json()
        df = pd.DataFrame(payload)
        rows_input = len(df)

        if emp_col not in df.columns or mgr_col not in df.columns:
            raise ValueError(f"Selected columns '{emp_col}' or '{mgr_col}' not in dataframe")

        df = compute_levels(df, emp_col, mgr_col)
        df, max_depth = compute_chains(df, emp_col, mgr_col)
        df = compute_total_reports(df, emp_col, mgr_col)
        df = compute_avg_flc(df, flc_col, fte_col)

        potential_base_cols = []
        if job_title_col and job_title_col in df.columns:
            potential_base_cols.append(job_title_col)
        elif "Job Title" in df.columns and not job_title_col:
            potential_base_cols.append("Job Title")
        for col in ["Division (Reporting Line)", "Country", "Level"]:
            if col in df.columns:
                potential_base_cols.append(col)

        df["Last_Employee"] = df["Chain_reversed"].apply(
            lambda x: x[-1] if isinstance(x, list) and len(x) > 0 else None
        )
        level_cols = [f"L{i+1}" for i in range(max_depth)] if max_depth > 0 else []
        ordered_cols = level_cols + ["Last_Employee"] + potential_base_cols + ["Total_Reports", "Avg_FLC"]
        df_final = df[ordered_cols].copy()

        from services.hierarchy_service import sort_hierarchy
        df_final = sort_hierarchy(df_final, max_depth)
        df_final = df_final.replace([pd.NA, np.nan, np.inf, -np.inf], "")

        if download:
            excel_bytes = export_excel(df_final, sheet_name="Hierarchy")
            write_activity_log(
                username=username, action="download", module="Hierarchy",
                rows_input=rows_input, rows_output=len(df_final),
                status="success", details=f"Downloaded hierarchy with max depth {max_depth}",
            )
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=org_hierarchy_output.xlsx"},
            )

        write_activity_log(
            username=username, action="process", module="Hierarchy",
            rows_input=rows_input, rows_output=len(df),
            status="success", details=f"Processed hierarchy with max depth {max_depth}",
        )
        return ORJSONResponse({
            "preview": df_final.head(20).to_dict(orient="records"),
            "df": df.to_dict(orient="records"),
            "rows_processed": len(df), "max_depth": max_depth,
        })
    except Exception as e:
        write_activity_log(
            username=username, action="download" if download else "process",
            module="Hierarchy", status="error", details=str(e),
        )
        raise


@router.post("/spans_layers")
async def spans_layers_endpoint(
    request: Request,
    project_id: int,
    threshold: float = Query(0.0),
    download: bool = Query(False),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        payload = await request.json()
        df = pd.DataFrame(payload)
        rows_input = len(df)

        if "Span" not in df.columns or "Level" not in df.columns:
            raise ValueError("Required columns 'Span' or 'Level' missing")

        summary = spans_and_layers(df)
        df_threshold = None
        high = low = None
        if threshold > 0:
            df_threshold, high, low = span_threshold(df, threshold=threshold)

        if download:
            if threshold <= 0:
                raise ValueError("Threshold must be greater than 0 for download")
            if df_threshold is None:
                raise ValueError("Threshold data not computed")
            excel_bytes = export_excel(df_threshold.fillna(""), sheet_name="Spans_and_Layers")
            write_activity_log(
                username=username, action="download", module="Spans & Layers",
                rows_input=rows_input, rows_output=len(df_threshold),
                status="success", details=f"Downloaded with threshold {threshold} (High: {high}, Low: {low})",
            )
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=spans_layers_with_threshold.xlsx"},
            )

        df_out = df_threshold if df_threshold is not None else df
        df_out = df_out.replace([np.inf, -np.inf], np.nan)
        summary = summary.replace([np.inf, -np.inf], np.nan)
        write_activity_log(
            username=username, action="process", module="Spans & Layers",
            rows_input=rows_input, rows_output=len(df_out),
            status="success", details=f"Computed with threshold {threshold}",
        )
        return ORJSONResponse({
            "summary": summary.to_dict(orient="records"),
            "df": df_out.to_dict(orient="records"),
            "high": high, "low": low, "rows_processed": len(df_out),
        })
    except Exception as e:
        write_activity_log(
            username=username, action="download" if download else "process",
            module="Spans & Layers", status="error", details=str(e),
        )
        raise


@router.post("/crosstab")
def crosstab_endpoint(
    df: list[dict],
    project_id: int,
    col_x: str | None = None,
    col_y: str | None = None,
    fte_col: str | None = None,
    flc_col: str | None = None,
    download: bool = Query(False),
    col_x_threshold: float | None = Query(None),
    col_y_threshold: float | None = Query(None),
    threshold_metric: str | None = Query(None),
    excluded_categories: str | None = Query(None),
    preview_only: bool = Query(False),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        df = pd.DataFrame(df)
        rows_input = len(df)
        col_x = col_x if col_x in df.columns else None
        col_y = col_y if col_y in df.columns else None
        fte_col = fte_col if fte_col in df.columns else None
        flc_col = flc_col if flc_col in df.columns else None

        excluded_list = []
        if excluded_categories:
            excluded_list = [cat.strip() for cat in excluded_categories.split(",") if cat.strip()]

        if preview_only:
            preview_data = generate_preview_data(
                df, col_x, col_y, fte_col, flc_col,
                threshold_metric, col_x_threshold, col_y_threshold,
            )
            return {"preview_data": preview_data}

        if (col_x_threshold is not None or col_y_threshold is not None) and threshold_metric:
            df = apply_others_grouping(
                df, col_x, col_y, fte_col, flc_col,
                col_x_threshold, col_y_threshold, threshold_metric, excluded_list,
            )

        result_df = generate_crosstab(df, col_x, col_y, fte_col, flc_col)

        if download:
            excel_bytes = export_excel(result_df, sheet_name="Crosstab")
            write_activity_log(
                username=username, action="download", module="Crosstab",
                rows_input=rows_input, rows_output=len(result_df),
                status="success", details=f"Crosstab by {col_x} x {col_y}",
            )
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=crosstab.xlsx"},
            )

        result_df = result_df.replace([np.inf, -np.inf], np.nan)
        result_df = result_df.where(pd.notnull(result_df), None)

        if isinstance(result_df.columns, pd.MultiIndex):
            columns = [{"x": str(cat), "metric": str(metric)} for cat, metric in result_df.columns]
            is_multiindex = True
        else:
            columns = [{"name": str(c)} for c in result_df.columns]
            is_multiindex = False

        write_activity_log(
            username=username, action="process", module="Crosstab",
            rows_input=rows_input, rows_output=len(result_df),
            status="success", details=f"Generated crosstab by {col_x} x {col_y}",
        )
        return {
            "columns": columns, "index": result_df.index.tolist(),
            "crosstab": result_df.to_numpy().tolist(), "is_multiindex": is_multiindex,
        }
    except Exception as e:
        write_activity_log(
            username=username, action="download" if download else "process",
            module="Crosstab", status="error", details=str(e),
        )
        raise


@router.post("/orgchart")
def orgchart_endpoint(
    df: List[Dict],
    project_id: int,
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    filter1_col: Optional[str] = Query(None),
    filter1_values: Optional[str] = Query(None),
    filter2_col: Optional[str] = Query(None),
    filter2_values: Optional[str] = Query(None),
    filter3_col: Optional[str] = Query(None),
    filter3_values: Optional[str] = Query(None),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        df = pd.DataFrame(df)
        rows_input = len(df)
        for col in df.select_dtypes(include=[np.number]).columns:
            df[col] = df[col].replace([np.inf, -np.inf], np.nan).fillna(0)

        filtered_df = df.copy()
        filters_applied = False
        for fcol, fvals in [(filter1_col, filter1_values), (filter2_col, filter2_values), (filter3_col, filter3_values)]:
            if fcol and fvals:
                vals = [v.strip() for v in fvals.split(",") if v.strip()]
                if vals:
                    filtered_df = filtered_df[filtered_df[fcol].isin(vals)]
                    filters_applied = True

        if filters_applied and len(filtered_df) < len(df):
            df_with_ancestors = build_tree_preserve_ancestors(df, filtered_df, emp_col, mgr_col)
        else:
            df_with_ancestors = filtered_df

        tree = build_org_tree(df_with_ancestors, emp_col, mgr_col, limit_level=None)
        serializable_tree = make_json_serializable(tree)
        write_activity_log(
            username=username, action="process", module="Org Chart",
            rows_input=rows_input, rows_output=len(df_with_ancestors),
            status="success", details="Generated org chart tree",
        )
        return jsonable_encoder(serializable_tree)
    except Exception as e:
        write_activity_log(
            username=username, action="process", module="Org Chart",
            status="error", details=str(e),
        )
        raise


# ===================================================================
# Export endpoints
# ===================================================================

@router.post("/export_ppt")
async def export_ppt(
    request_body: dict,
    request: Request,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        svg_content = request_body.get("svg_content")
        if not svg_content:
            raise HTTPException(status_code=400, detail="svg_content is required")

        import re
        width_match = re.search(r'width="(\d+(?:\.\d+)?)"', svg_content)
        height_match = re.search(r'height="(\d+(?:\.\d+)?)"', svg_content)
        original_width = float(width_match.group(1)) if width_match else 1000
        original_height = float(height_match.group(1)) if height_match else 1000

        max_dimension = 5000
        scale_factor = 1.0
        if original_width > max_dimension or original_height > max_dimension:
            scale_factor = min(max_dimension / original_width, max_dimension / original_height)
            new_width = original_width * scale_factor
            new_height = original_height * scale_factor
            if width_match:
                svg_content = svg_content.replace(f'width="{original_width}"', f'width="{new_width}"')
            if height_match:
                svg_content = svg_content.replace(f'height="{original_height}"', f'height="{new_height}"')
            if "viewBox" not in svg_content:
                svg_content = svg_content.replace("<svg", f'<svg viewBox="0 0 {original_width} {original_height}"')

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_file_path = os.path.join(temp_dir, "OrgChart.svg")
            emf_file_path = svg_file_path.replace(".svg", ".emf")
            with open(svg_file_path, "w", encoding="utf-8") as f:
                f.write(svg_content)

            inkscape_exe_path = r"C:\Program Files\Inkscape\bin\inkscape.exe"
            if not os.path.exists(inkscape_exe_path):
                raise HTTPException(status_code=500, detail="Inkscape not found")

            inkscape_cmd = f'"{inkscape_exe_path}" "{svg_file_path}" --export-type=emf --export-filename="{emf_file_path}"'
            result = subprocess.run(inkscape_cmd, shell=True, capture_output=True, text=True)
            if result.returncode != 0:
                raise HTTPException(status_code=500, detail=f"Inkscape failed: {result.stderr}")
            if not os.path.exists(emf_file_path):
                raise HTTPException(status_code=500, detail="EMF file was not created")

            with open(emf_file_path, "rb") as emf_file:
                emf_data = emf_file.read()

        prs = Presentation()
        slide = prs.slides.add_slide(prs.slide_layouts[6])

        with tempfile.NamedTemporaryFile(delete=False, suffix=".emf") as temp_emf:
            temp_emf.write(emf_data)
            temp_emf_path = temp_emf.name

        try:
            slide_width = prs.slide_width
            slide_height = prs.slide_height
            margin = Inches(0.5)
            max_width = slide_width - (2 * margin)
            max_height = slide_height - (2 * margin)
            aspect_ratio = original_width / original_height if original_height > 0 else 1
            if max_width / aspect_ratio <= max_height:
                pic_width = max_width
                pic_height = pic_width / aspect_ratio
            else:
                pic_height = max_height
                pic_width = pic_height * aspect_ratio
            left = (slide_width - pic_width) / 2
            top = (slide_height - pic_height) / 2
            slide.shapes.add_picture(temp_emf_path, left, top, width=pic_width)

            ppt_bytes = BytesIO()
            prs.save(ppt_bytes)
            ppt_bytes.seek(0)
        finally:
            if os.path.exists(temp_emf_path):
                os.unlink(temp_emf_path)

        write_activity_log(
            username=username, action="download", module="Org Chart",
            status="success", details=f"Downloaded org chart as PPT (scaled: {scale_factor:.2f}x)",
        )
        return StreamingResponse(
            ppt_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": "attachment; filename=OrgChart.pptx"},
        )
    except HTTPException:
        raise
    except Exception as e:
        write_activity_log(
            username=username, action="download", module="Org Chart",
            status="error", details=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export/excel")
async def export_excel_endpoint(
    payload: List[Dict],
    project_id: int,
    sheet_name: str = Query("Sheet1"),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        df = pd.DataFrame(payload)
        rows_count = len(df)
        df = df.replace([np.inf, -np.inf], np.nan).fillna("")
        excel_bytes = export_excel(df, sheet_name=sheet_name)
        write_activity_log(
            username=username, action="download", module="Export",
            rows_output=rows_count, status="success",
            details=f"Downloaded {sheet_name} as Excel",
        )
        return StreamingResponse(
            BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=org_data_export.xlsx"},
        )
    except Exception as e:
        write_activity_log(
            username=username, action="download", module="Export",
            status="error", details=str(e),
        )
        raise


# ===================================================================
# Activity Logs
# ===================================================================

@router.get("/logs/activity")
def get_logs(
    project_id: int,
    limit: Optional[int] = Query(100),
    user: dict = Depends(require_project_access()),
):
    logs = get_activity_logs(limit=limit)
    return {"logs": logs}


@router.get("/logs/stats/{username}")
def get_stats(
    username: str,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    stats = get_user_stats(username)
    return stats


# ===================================================================
# DB / Baseline / Scenario endpoints -- project-scoped
# ===================================================================

@router.post("/db/save_baseline")
def db_save_baseline(
    body: SaveBaselineBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    try:
        dataset_id = db_service.save_baseline(
            name=body.name, username=username, records=body.records,
            emp_col=body.emp_col, mgr_col=body.mgr_col,
            fte_col=body.fte_col, flc_col=body.flc_col,
            job_title_col=body.job_title_col, country_col=body.country_col,
            project_id=project_id,
        )
        scenarios = db_service.list_scenarios(dataset_id)
        write_activity_log(
            username=username, action="db_save_baseline", module="Org Chart",
            rows_input=len(body.records), rows_output=len(body.records),
            status="success", details=f"Saved dataset id={dataset_id} ({body.name}) in project {project_id}",
        )
        return {"dataset_id": dataset_id, "scenarios": scenarios}
    except Exception as e:
        write_activity_log(
            username=username, action="db_save_baseline", module="Org Chart",
            status="error", details=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/db/datasets")
def db_list_datasets(
    project_id: int,
    mine_only: bool = Query(False),
    user: dict = Depends(require_project_access()),
):
    username = user["username"]
    return {
        "datasets": db_service.list_datasets(
            username=username if mine_only else None,
            project_id=project_id,
        )
    }


@router.get("/db/datasets/{dataset_id}")
def db_get_dataset(
    dataset_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    ds = _require_dataset_in_project(dataset_id, project_id)
    return {"dataset": ds, "scenarios": db_service.list_scenarios(dataset_id)}


@router.delete("/db/datasets/{dataset_id}")
def db_delete_dataset(
    dataset_id: int,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_dataset_in_project(dataset_id, project_id)
    db_service.delete_dataset(dataset_id)
    return {"status": "deleted"}


@router.get("/db/datasets/{dataset_id}/baseline")
def db_get_baseline(
    dataset_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    _require_dataset_in_project(dataset_id, project_id)
    return {"records": db_service.get_baseline_records(dataset_id)}


@router.post("/db/datasets/{dataset_id}/scenarios")
def db_create_scenario(
    dataset_id: int,
    body: ScenarioBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_dataset_in_project(dataset_id, project_id)
    username = user["username"]
    try:
        scenario_id = db_service.create_scenario(
            dataset_id=dataset_id, name=body.name,
            description=body.description or "",
            source_scenario_id=body.source_scenario_id,
        )
        write_activity_log(
            username=username, action="scenario_create", module="Org Chart",
            status="success", details=f"Created scenario {scenario_id} ({body.name})",
        )
        return {"scenario": db_service.get_scenario(scenario_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/db/datasets/{dataset_id}/compare")
def db_compare_scenarios(
    dataset_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    _require_dataset_in_project(dataset_id, project_id)
    scenarios = db_service.list_scenarios(dataset_id)
    return {"scenarios": [db_service.get_scenario_summary(s["id"]) for s in scenarios]}


# ---------------------------------------------------------------------------
# Scenario endpoints -- all verify scenario belongs to project via dataset
# ---------------------------------------------------------------------------

@router.get("/db/scenarios/{scenario_id}")
def db_get_scenario(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    scenario, _ = _require_scenario_in_project(scenario_id, project_id)
    return {
        "scenario": scenario,
        "records": db_service.get_scenario_records(scenario_id),
        "summary": db_service.get_scenario_summary(scenario_id),
    }


@router.patch("/db/scenarios/{scenario_id}/rename")
def db_rename_scenario(
    scenario_id: int,
    body: ScenarioBody,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    db_service.rename_scenario(scenario_id, body.name, body.description)
    return {"scenario": db_service.get_scenario(scenario_id)}


@router.delete("/db/scenarios/{scenario_id}")
def db_delete_scenario(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    db_service.delete_scenario(scenario_id)
    return {"status": "deleted"}


@router.post("/db/scenarios/{scenario_id}/move")
def db_scenario_move(
    scenario_id: int,
    body: MoveBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    username = user["username"]
    try:
        record = db_service.move_employee(
            scenario_id=scenario_id, emp_id=body.emp_id,
            new_mgr_id=body.new_mgr_id, username=username,
        )
        return {"record": record, "summary": db_service.get_scenario_summary(scenario_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/db/scenarios/{scenario_id}/edit")
def db_scenario_edit(
    scenario_id: int,
    body: EditBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    username = user["username"]
    try:
        record = db_service.edit_employee(
            scenario_id=scenario_id, emp_id=body.emp_id,
            updates=body.updates, username=username,
        )
        return {"record": record, "summary": db_service.get_scenario_summary(scenario_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/db/scenarios/{scenario_id}/add")
def db_scenario_add(
    scenario_id: int,
    body: AddBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    username = user["username"]
    try:
        record = db_service.add_employee(
            scenario_id=scenario_id, record=body.record,
            emp_id=body.emp_id, mgr_id=body.mgr_id, level=body.level,
            fte=body.fte, flc=body.flc, username=username,
        )
        return {"record": record, "summary": db_service.get_scenario_summary(scenario_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/db/scenarios/{scenario_id}/flag")
def db_scenario_flag(
    scenario_id: int,
    body: FlagBody,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    username = user["username"]
    try:
        record = db_service.flag_employee(
            scenario_id=scenario_id, emp_id=body.emp_id,
            flagged=body.flagged, username=username,
        )
        return {"record": record, "summary": db_service.get_scenario_summary(scenario_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/db/scenarios/{scenario_id}/promote")
def db_scenario_promote(
    scenario_id: int,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    username = user["username"]
    try:
        db_service.promote_scenario(scenario_id)
        write_activity_log(
            username=username, action="scenario_promote", module="Org Chart",
            status="success", details=f"Promoted scenario {scenario_id} to baseline",
        )
        return {"status": "promoted", "scenario": db_service.get_scenario(scenario_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/db/scenarios/{scenario_id}/summary")
def db_scenario_summary(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    try:
        return db_service.get_scenario_summary(scenario_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/db/scenarios/{scenario_id}/reset")
def db_scenario_reset(
    scenario_id: int,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    username = user["username"]
    try:
        db_service.reset_scenario_to_baseline(scenario_id, username=username)
        write_activity_log(
            username=username, action="scenario_reset", module="Org Chart",
            status="success", details=f"Reset scenario {scenario_id} to baseline",
        )
        return {"status": "reset", "summary": db_service.get_scenario_summary(scenario_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/db/scenarios/{scenario_id}/undo")
def db_scenario_undo(
    scenario_id: int,
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    username = user["username"]
    try:
        entry = db_service.undo_last_change(scenario_id, username=username)
        if entry is None:
            return {"status": "nothing_to_undo"}
        return {"status": "undone", "reversed": entry, "summary": db_service.get_scenario_summary(scenario_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/db/scenarios/{scenario_id}/change_log")
def db_scenario_change_log(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    _require_scenario_in_project(scenario_id, project_id)
    return {"changes": db_service.get_change_log(scenario_id)}


# ---------------------------------------------------------------------------
# Scenario exports
# ---------------------------------------------------------------------------

@router.get("/db/scenarios/{scenario_id}/export/changes")
def db_export_change_summary(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    scenario, _ = _require_scenario_in_project(scenario_id, project_id)
    summary = db_service.get_scenario_summary(scenario_id)
    changes = db_service.get_change_log(scenario_id)

    summary_rows = [
        {"Metric": "Headcount", "Baseline": summary["baseline"]["headcount"],
         "Current": summary["current"]["headcount"], "Delta": summary["delta"]["headcount"]},
        {"Metric": "Total FTE", "Baseline": round(summary["baseline"]["total_fte"], 2),
         "Current": round(summary["current"]["total_fte"], 2), "Delta": round(summary["delta"]["fte"], 2)},
        {"Metric": "Total Cost", "Baseline": round(summary["baseline"]["total_cost"], 2),
         "Current": round(summary["current"]["total_cost"], 2), "Delta": round(summary["delta"]["cost"], 2)},
        {"Metric": "Flagged-removed roles", "Baseline": 0,
         "Current": summary["flagged_removed"]["count"], "Delta": summary["flagged_removed"]["count"]},
        {"Metric": "Flagged-removed cost", "Baseline": 0,
         "Current": round(summary["flagged_removed"]["cost"], 2), "Delta": round(summary["flagged_removed"]["cost"], 2)},
        {"Metric": "Total changes logged", "Baseline": "\u2014",
         "Current": summary["change_count"], "Delta": "\u2014"},
    ]
    summary_df = pd.DataFrame(summary_rows)
    changes_df = pd.DataFrame(changes) if changes else pd.DataFrame(
        columns=["id", "scenario_id", "action", "emp_id", "old_mgr_id",
                 "new_mgr_id", "field", "old_value", "new_value", "timestamp", "username"]
    )
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        summary_df.to_excel(writer, index=False, sheet_name="Summary")
        changes_df.to_excel(writer, index=False, sheet_name="Changes")
    buf.seek(0)

    safe_name = "".join(c for c in scenario["name"] if c.isalnum() or c in "-_") or "scenario"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="orgsight_changes_{safe_name}.xlsx"'},
    )


@router.get("/db/scenarios/{scenario_id}/export/svg")
def db_export_scenario_svg(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    scenario, dataset = _require_scenario_in_project(scenario_id, project_id)
    records = db_service.get_scenario_records(scenario_id)
    svg = render_scenario_svg(
        records, emp_col=dataset["emp_col"], mgr_col=dataset["mgr_col"],
        job_title_col=dataset.get("job_title_col"), fte_col=dataset.get("fte_col"),
        flc_col=dataset.get("flc_col"), country_col=dataset.get("country_col"),
        title=f"OrgSight 2.0  -  {dataset['name']}  -  {scenario['name']}",
    )
    safe_name = "".join(c for c in scenario["name"] if c.isalnum() or c in "-_") or "scenario"
    return StreamingResponse(
        BytesIO(svg.encode("utf-8")), media_type="image/svg+xml",
        headers={"Content-Disposition": f'attachment; filename="orgsight_{safe_name}.svg"'},
    )


@router.get("/db/scenarios/{scenario_id}/export/ppt")
def db_export_scenario_ppt(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    scenario, dataset = _require_scenario_in_project(scenario_id, project_id)
    records = db_service.get_scenario_records(scenario_id)
    svg_content = render_scenario_svg(
        records, emp_col=dataset["emp_col"], mgr_col=dataset["mgr_col"],
        job_title_col=dataset.get("job_title_col"), fte_col=dataset.get("fte_col"),
        flc_col=dataset.get("flc_col"), country_col=dataset.get("country_col"),
        title=f"OrgSight 2.0  -  {scenario['name']}",
    )

    inkscape_exe_path = r"C:\Program Files\Inkscape\bin\inkscape.exe"
    image_bytes: Optional[bytes] = None
    if os.path.exists(inkscape_exe_path):
        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = os.path.join(temp_dir, "scenario.svg")
            emf_path = svg_path.replace(".svg", ".emf")
            with open(svg_path, "w", encoding="utf-8") as f:
                f.write(svg_content)
            cmd = f'"{inkscape_exe_path}" "{svg_path}" --export-type=emf --export-filename="{emf_path}"'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and os.path.exists(emf_path):
                with open(emf_path, "rb") as fh:
                    image_bytes = fh.read()

    prs = Presentation()
    if image_bytes is not None:
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        slide.shapes.add_picture(BytesIO(image_bytes), Inches(0.25), Inches(0.25), width=Inches(9.5))
    else:
        _populate_scenario_summary_pptx(prs, scenario, dataset, records)

    out = BytesIO()
    prs.save(out)
    out.seek(0)
    safe_name = "".join(c for c in scenario["name"] if c.isalnum() or c in "-_") or "scenario"
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="orgsight_{safe_name}.pptx"'},
    )


@router.get("/db/scenarios/{scenario_id}/export/pdf")
def db_export_scenario_pdf(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    scenario, dataset = _require_scenario_in_project(scenario_id, project_id)
    records = db_service.get_scenario_records(scenario_id)
    svg_content = render_scenario_svg(
        records, emp_col=dataset["emp_col"], mgr_col=dataset["mgr_col"],
        job_title_col=dataset.get("job_title_col"), fte_col=dataset.get("fte_col"),
        flc_col=dataset.get("flc_col"), country_col=dataset.get("country_col"),
        title=f"OrgSight 2.0  -  {scenario['name']}",
    )

    inkscape_exe_path = r"C:\Program Files\Inkscape\bin\inkscape.exe"
    pdf_bytes: Optional[bytes] = None
    if os.path.exists(inkscape_exe_path):
        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = os.path.join(temp_dir, "scenario.svg")
            pdf_path = svg_path.replace(".svg", ".pdf")
            with open(svg_path, "w", encoding="utf-8") as f:
                f.write(svg_content)
            cmd = f'"{inkscape_exe_path}" "{svg_path}" --export-type=pdf --export-filename="{pdf_path}"'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and os.path.exists(pdf_path):
                with open(pdf_path, "rb") as fh:
                    pdf_bytes = fh.read()

    if pdf_bytes is None:
        try:
            pdf_bytes = _render_scenario_summary_pdf(scenario, dataset, records)
        except Exception as svglib_err:
            try:
                import cairosvg
                pdf_bytes = cairosvg.svg2pdf(bytestring=svg_content.encode("utf-8"))
            except Exception as cairo_err:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"PDF export failed. Tried Inkscape ({inkscape_exe_path}, not found), "
                        f"summary PDF ({svglib_err}), and cairosvg ({cairo_err})."
                    ),
                )

    safe_name = "".join(c for c in scenario["name"] if c.isalnum() or c in "-_") or "scenario"
    return StreamingResponse(
        BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="orgsight_{safe_name}.pdf"'},
    )


@router.get("/db/scenarios/{scenario_id}/export/records")
def db_export_scenario_records(
    scenario_id: int,
    project_id: int,
    _user: dict = Depends(require_project_access()),
):
    scenario, _ = _require_scenario_in_project(scenario_id, project_id)
    records = db_service.get_scenario_records(scenario_id)
    if not records:
        df = pd.DataFrame()
    else:
        cleaned = [{k: v for k, v in r.items() if not k.startswith("__")} for r in records]
        df = pd.DataFrame(cleaned)

    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Org Records")
    buf.seek(0)

    safe_name = "".join(c for c in scenario["name"] if c.isalnum() or c in "-_") or "scenario"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="orgsight_records_{safe_name}.xlsx"'},
    )
