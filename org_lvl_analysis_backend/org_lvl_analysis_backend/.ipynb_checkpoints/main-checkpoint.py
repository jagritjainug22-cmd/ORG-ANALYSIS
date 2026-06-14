# main.py
from fastapi import FastAPI, UploadFile, Form, Request, Header
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from io import BytesIO
import json
from fastapi.encoders import jsonable_encoder
from typing import List, Dict, Optional
import numpy as np
from fastapi.responses import ORJSONResponse, StreamingResponse
from fastapi import Query, Request
from fastapi import HTTPException, Request
import subprocess
import os
import tempfile
from pptx import Presentation
from pptx.util import Inches
from PIL import Image

# Import your backend service functions
from services.upload_service import read_excel_file
from services.cleanup_service import build_country_flag, apply_exclusion_filter
from services.validation_service import validate_org_data
from services.filter_error_service import filter_errors
from services.hierarchy_service import compute_levels, compute_chains, compute_total_reports, compute_avg_flc
from services.spans_layers_service import spans_and_layers, span_threshold
from services.crosstab_service import generate_crosstab, generate_preview_data, apply_others_grouping
from services.orgchart_service import build_org_tree, make_json_serializable
from services.auth_service import authenticate_user
from services.export_service import export_excel
from services.logging_service import write_activity_log, get_activity_logs, get_user_stats

app = FastAPI(title="Org Level Analysis Backend")

# Allow CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # replace "*" with frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper function to extract username from headers
def get_username_from_headers(request: Request) -> str:
    """Extract username from X-Username header"""
    return request.headers.get("X-Username", "anonymous")

# -------------------------
# Login Endpoint
# -------------------------

@app.post("/auth/login")
def login(username: str = Form(...), password: str = Form(...)):
    try:
        if authenticate_user(username, password):
            write_activity_log(
                username=username,
                action="login",
                status="success",
                details="User logged in successfully"
            )
            return {"user": username}
        else:
            write_activity_log(
                username=username,
                action="login",
                status="error",
                details="Invalid credentials"
            )
            return {"error": "Invalid credentials"}
    except Exception as e:
        write_activity_log(
            username=username,
            action="login",
            status="error",
            details=str(e)
        )
        return {"error": "Login failed"}

# -------------------------
# Logout Endpoint
# -------------------------

@app.post("/auth/logout")
def logout(request: Request):
    username = get_username_from_headers(request)
    write_activity_log(
        username=username,
        action="logout",
        status="success",
        details="User logged out"
    )
    return {"status": "logged out"}

# -------------------------
# Upload Endpoint
# -------------------------
@app.post("/upload")
async def upload(file: UploadFile, request: Request):
    username = get_username_from_headers(request)
    try:
        contents = await file.read()
        df = read_excel_file(BytesIO(contents))
        
        rows_count = len(df)
        
        # Convert dataframe to records
        records = df.to_dict(orient="records")
        safe_records = jsonable_encoder(records)
        
        write_activity_log(
            username=username,
            action="process",
            module="Upload",
            rows_output=rows_count,
            status="success",
            details=f"Uploaded file: {file.filename}"
        )
        
        return {
            "columns": df.columns.tolist(),
            "records": safe_records
        }
    except Exception as e:
        write_activity_log(
            username=username,
            action="process",
            module="Upload",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Cleanup Endpoint
# -------------------------
@app.post("/cleanup", response_class=ORJSONResponse)
def cleanup(
    payload: List[Dict],
    remove_exclusion: bool = True,
    country_col: Optional[str] = None,  # Add this parameter
    request: Request = None
):
    username = get_username_from_headers(request)
    try:
        df = pd.DataFrame(payload)
        rows_input = len(df)
        
        # Pass country_col to build_country_flag
        df = build_country_flag(df, country_col=country_col)
        df, removed_count = apply_exclusion_filter(df, remove=remove_exclusion)
        df = df.replace([np.inf, -np.inf], np.nan)
        
        rows_output = len(df)
        records = df.to_dict(orient="records")
        
        write_activity_log(
            username=username,
            action="process",
            module="Cleanup",
            rows_input=rows_input,
            rows_output=rows_output,
            status="success",
            details=f"Removed {removed_count} exclusion rows, Country_Flag generated from '{country_col or 'not specified'}'"
        )
        
        return {
            "df": records,
            "removed": int(removed_count)
        }
    except Exception as e:
        write_activity_log(
            username=username,
            action="process",
            module="Cleanup",
            rows_input=len(payload),
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Validation Endpoint
# -------------------------
@app.post("/validate")
async def validate(
    request: Request,
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    span_col: str | None = Query(None),
    download: bool = Query(False)
):
    username = get_username_from_headers(request)
    try:
        payload = await request.json()
        df = pd.DataFrame(payload)
        rows_input = len(df)
        
        result = validate_org_data(df, emp_col, mgr_col, span_col)
        
        # Download path
        if download:
            excel_bytes = export_excel(
                result["df_with_flags"],
                sheet_name="Data_With_Flags"
            )
            
            write_activity_log(
                username=username,
                action="download",
                module="Validate",
                rows_input=rows_input,
                rows_output=len(result["df_with_flags"]),
                status="success",
                details="Downloaded validated data with flags"
            )
            
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": "attachment; filename=validated_org_data.xlsx"
                }
            )
        
        # API path
        df_flags = result["df_with_flags"].replace([np.inf, -np.inf], np.nan)
        records = df_flags.where(pd.notnull(df_flags), None).to_dict(orient="records")
        
        write_activity_log(
            username=username,
            action="process",
            module="Validate",
            rows_input=rows_input,
            rows_output=len(records),
            status="success",
            details=f"Found {len(result['duplicate_ids'])} duplicates, {len(result['missing_manager_ids'])} missing managers, {len(result['invalid_manager_ids'])} invalid managers"
        )
        
        return ORJSONResponse({
            "duplicate_ids": result["duplicate_ids"],
            "missing_manager_ids": result["missing_manager_ids"],
            "invalid_manager_ids": result["invalid_manager_ids"],
            "top_manager": result["top_manager"],
            "df_with_flags": records
        })
    except Exception as e:
        write_activity_log(
            username=username,
            action="download" if download else "process",
            module="Validate",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Filter Errors Endpoint
# -------------------------
@app.post("/filter_errors")
async def filter_invalids(
    request: Request,
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    remove_dup: bool = Query(True),
    remove_missing: bool = Query(True),
    remove_invalid: bool = Query(True),
):
    username = get_username_from_headers(request)
    try:
        payload = await request.json()
        df = pd.DataFrame(payload)
        
        original_count = len(df)
        
        df_filtered = filter_errors(
            df,
            emp_col,
            mgr_col,
            remove_dup=remove_dup,
            remove_missing=remove_missing,
            remove_invalid=remove_invalid,
        )
        
        filtered_count = len(df_filtered)
        removed_count = original_count - filtered_count
        
        df_filtered = df_filtered.replace([np.inf, -np.inf], np.nan)
        records = df_filtered.where(pd.notnull(df_filtered), None).to_dict(orient="records")
        
        write_activity_log(
            username=username,
            action="process",
            module="Filter Errors",
            rows_input=original_count,
            rows_output=filtered_count,
            status="success",
            details=f"Removed {removed_count} error rows"
        )
        
        return ORJSONResponse({
            "df": records,
            "original_count": original_count,
            "filtered_count": filtered_count,
            "removed_count": removed_count
        })
    except Exception as e:
        write_activity_log(
            username=username,
            action="process",
            module="Filter Errors",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Hierarchy Endpoint
# -------------------------
@app.post("/hierarchy")
async def hierarchy_endpoint(
    request: Request,
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    flc_col: str | None = Query(None),
    fte_col: str | None = Query(None),
    download: bool = Query(False)
):
    username = get_username_from_headers(request)
    try:
        payload = await request.json()
        df = pd.DataFrame(payload)
        rows_input = len(df)

        if emp_col not in df.columns or mgr_col not in df.columns:
            raise ValueError(f"Selected columns '{emp_col}' or '{mgr_col}' not in dataframe")

        # Hierarchy computation
        df = compute_levels(df, emp_col, mgr_col)
        df, max_depth = compute_chains(df, emp_col, mgr_col)
        df = compute_total_reports(df, emp_col, mgr_col)
        df = compute_avg_flc(df, flc_col, fte_col)

        # Build display dataframe
        base_cols = [
            c for c in ["Job Title", "Division (Reporting Line)", "Country", "Level"]
            if c in df.columns
        ]

        df["Last_Employee"] = df["Chain_reversed"].apply(
            lambda x: x[-1] if isinstance(x, list) and len(x) > 0 else None
        )

        level_cols = [f"L{i+1}" for i in range(max_depth)] if max_depth > 0 else []
        ordered_cols = level_cols + ["Last_Employee"] + base_cols + ["Total_Reports", "Avg_FLC"]
        df_final = df[ordered_cols].copy()
        
        from services.hierarchy_service import sort_hierarchy
        df_final = sort_hierarchy(df_final, max_depth)
        df_final = df_final.replace([pd.NA, np.nan, np.inf, -np.inf], "")

        # Download
        if download:
            excel_bytes = export_excel(df_final, sheet_name="Hierarchy")
            
            write_activity_log(
                username=username,
                action="download",
                module="Hierarchy",
                rows_input=rows_input,
                rows_output=len(df_final),
                status="success",
                details=f"Downloaded hierarchy with max depth {max_depth}"
            )
            
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": "attachment; filename=org_hierarchy_output.xlsx"
                }
            )

        write_activity_log(
            username=username,
            action="process",
            module="Hierarchy",
            rows_input=rows_input,
            rows_output=len(df),
            status="success",
            details=f"Processed hierarchy with max depth {max_depth}"
        )

        return ORJSONResponse({
            "preview": df_final.head(20).to_dict(orient="records"),
            "df": df.to_dict(orient="records"),
            "rows_processed": len(df),
            "max_depth": max_depth
        })

    except Exception as e:
        write_activity_log(
            username=username,
            action="download" if download else "process",
            module="Hierarchy",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Spans & Layers Endpoint
# -------------------------
@app.post("/spans_layers")
async def spans_layers_endpoint(
    request: Request,
    threshold: float = Query(0.0),
    download: bool = Query(False)
):
    username = get_username_from_headers(request)
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
        
        # Download
        if download:
            if threshold <= 0:
                raise ValueError("Threshold must be greater than 0 for download")
            
            if df_threshold is None:
                raise ValueError("Threshold data not computed")
            
            excel_bytes = export_excel(
                df_threshold.fillna(""),
                sheet_name="Spans_and_Layers"
            )
            
            write_activity_log(
                username=username,
                action="download",
                module="Spans & Layers",
                rows_input=rows_input,
                rows_output=len(df_threshold),
                status="success",
                details=f"Downloaded with threshold {threshold} (High: {high}, Low: {low})"
            )
            
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": "attachment; filename=spans_layers_with_threshold.xlsx"
                }
            )
        
        df_out = df_threshold if df_threshold is not None else df
        df_out = df_out.replace([np.inf, -np.inf], np.nan)
        summary = summary.replace([np.inf, -np.inf], np.nan)
        
        write_activity_log(
            username=username,
            action="process",
            module="Spans & Layers",
            rows_input=rows_input,
            rows_output=len(df_out),
            status="success",
            details=f"Computed with threshold {threshold}"
        )
        
        return ORJSONResponse({
            "summary": summary.to_dict(orient="records"),
            "df": df_out.to_dict(orient="records"),
            "high": high,
            "low": low,
            "rows_processed": len(df_out)
        })
        
    except Exception as e:
        write_activity_log(
            username=username,
            action="download" if download else "process",
            module="Spans & Layers",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Crosstab Endpoint
# -------------------------
@app.post("/crosstab")
def crosstab_endpoint(
    df: list[dict],
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
    request: Request = None
):
    username = get_username_from_headers(request)
    try:
        df = pd.DataFrame(df)
        rows_input = len(df)
        col_x = col_x if col_x in df.columns else None
        col_y = col_y if col_y in df.columns else None
        fte_col = fte_col if fte_col in df.columns else None
        flc_col = flc_col if flc_col in df.columns else None
        
        # Parse excluded categories
        excluded_list = []
        if excluded_categories:
            excluded_list = [cat.strip() for cat in excluded_categories.split(',') if cat.strip()]
        
        # Preview mode - return category statistics
        if preview_only:
            preview_data = generate_preview_data(
                df, col_x, col_y, fte_col, flc_col, 
                threshold_metric, col_x_threshold, col_y_threshold
            )
            return {"preview_data": preview_data}
        
        # Apply "Others" grouping if thresholds provided
        if (col_x_threshold is not None or col_y_threshold is not None) and threshold_metric:
            df = apply_others_grouping(
                df, col_x, col_y, fte_col, flc_col,
                col_x_threshold, col_y_threshold, 
                threshold_metric, excluded_list
            )
        
        result_df = generate_crosstab(df, col_x, col_y, fte_col, flc_col)
        
        if download:
            excel_bytes = export_excel(result_df, sheet_name="Crosstab")
            
            write_activity_log(
                username=username,
                action="download",
                module="Crosstab",
                rows_input=rows_input,
                rows_output=len(result_df),
                status="success",
                details=f"Crosstab by {col_x} x {col_y}"
            )
            
            return StreamingResponse(
                BytesIO(excel_bytes),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=crosstab.xlsx"}
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
            username=username,
            action="process",
            module="Crosstab",
            rows_input=rows_input,
            rows_output=len(result_df),
            status="success",
            details=f"Generated crosstab by {col_x} x {col_y}"
        )
        
        return {
            "columns": columns,
            "index": result_df.index.tolist(),
            "crosstab": result_df.to_numpy().tolist(),
            "is_multiindex": is_multiindex
        }
    except Exception as e:
        write_activity_log(
            username=username,
            action="download" if download else "process",
            module="Crosstab",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Org Chart Endpoint
# -------------------------
@app.post("/orgchart")
def orgchart_endpoint(
    df: List[Dict], 
    emp_col: str = Query(...),
    mgr_col: str = Query(...),
    filter1_col: Optional[str] = Query(None),
    filter1_values: Optional[str] = Query(None),
    filter2_col: Optional[str] = Query(None),
    filter2_values: Optional[str] = Query(None),
    filter3_col: Optional[str] = Query(None),
    filter3_values: Optional[str] = Query(None),
    request: Request = None
):
    username = get_username_from_headers(request)
    try:
        df = pd.DataFrame(df)
        rows_input = len(df)

        for col in df.select_dtypes(include=[np.number]).columns:
            df[col] = df[col].replace([np.inf, -np.inf], np.nan).fillna(0)

        filtered_df = df.copy()
        filters_applied = False
        
        if filter1_col and filter1_values:
            values1 = [v.strip() for v in filter1_values.split(',') if v.strip()]
            if values1:
                filtered_df = filtered_df[filtered_df[filter1_col].isin(values1)]
                filters_applied = True
        
        if filter2_col and filter2_values:
            values2 = [v.strip() for v in filter2_values.split(',') if v.strip()]
            if values2:
                filtered_df = filtered_df[filtered_df[filter2_col].isin(values2)]
                filters_applied = True
        
        if filter3_col and filter3_values:
            values3 = [v.strip() for v in filter3_values.split(',') if v.strip()]
            if values3:
                filtered_df = filtered_df[filtered_df[filter3_col].isin(values3)]
                filters_applied = True

        if filters_applied and len(filtered_df) < len(df):
            from services.orgchart_service import build_tree_preserve_ancestors
            df_with_ancestors = build_tree_preserve_ancestors(df, filtered_df, emp_col, mgr_col)
        else:
            df_with_ancestors = filtered_df

        tree = build_org_tree(df_with_ancestors, emp_col, mgr_col, limit_level=None)
        serializable_tree = make_json_serializable(tree)
        
        write_activity_log(
            username=username,
            action="process",
            module="Org Chart",
            rows_input=rows_input,
            rows_output=len(df_with_ancestors),
            status="success",
            details="Generated org chart tree"
        )
        
        return jsonable_encoder(serializable_tree)

    except Exception as e:
        write_activity_log(
            username=username,
            action="process",
            module="Org Chart",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Export PPT Endpoint
# -------------------------


# Increase Pillow's decompression bomb limit
Image.MAX_IMAGE_PIXELS = None  # Remove limit (or set to a higher value like 500000000)

@app.post("/export_ppt")
async def export_ppt(request: dict, req: Request = None):
    username = get_username_from_headers(req)
    try:
        svg_content = request.get("svg_content")
        if not svg_content:
            raise HTTPException(status_code=400, detail="svg_content is required")
        
        print("📥 Received SVG content for PPT export")
        print(f"📏 Original SVG length: {len(svg_content)} characters")
        
        # Parse SVG to get dimensions and scale down if too large
        import re
        
        # Extract width and height from SVG
        width_match = re.search(r'width="(\d+(?:\.\d+)?)"', svg_content)
        height_match = re.search(r'height="(\d+(?:\.\d+)?)"', svg_content)
        
        original_width = float(width_match.group(1)) if width_match else 1000
        original_height = float(height_match.group(1)) if height_match else 1000
        
        print(f"📐 Original dimensions: {original_width}x{original_height}")
        
        # Scale down if dimensions are too large (max 5000px on either side)
        max_dimension = 5000
        scale_factor = 1.0
        
        if original_width > max_dimension or original_height > max_dimension:
            scale_factor = min(max_dimension / original_width, max_dimension / original_height)
            new_width = original_width * scale_factor
            new_height = original_height * scale_factor
            
            print(f"⚠️ Image too large, scaling down by {scale_factor:.2f}")
            print(f"📐 New dimensions: {new_width}x{new_height}")
            
            # Update SVG dimensions
            if width_match:
                svg_content = svg_content.replace(
                    f'width="{original_width}"', 
                    f'width="{new_width}"'
                )
            if height_match:
                svg_content = svg_content.replace(
                    f'height="{original_height}"', 
                    f'height="{new_height}"'
                )
            
            # Add viewBox if not present to maintain aspect ratio
            if 'viewBox' not in svg_content:
                svg_content = svg_content.replace(
                    '<svg',
                    f'<svg viewBox="0 0 {original_width} {original_height}"'
                )
        
        # Create temp directory
        with tempfile.TemporaryDirectory() as temp_dir:
            svg_file_path = os.path.join(temp_dir, "OrgChart.svg")
            emf_file_path = svg_file_path.replace(".svg", ".emf")
            
            # Save scaled SVG
            with open(svg_file_path, "w", encoding="utf-8") as f:
                f.write(svg_content)
            print(f"💾 Saved SVG to: {svg_file_path}")
            
            # Verify Inkscape exists
            inkscape_exe_path = r"C:\Program Files\Inkscape\bin\inkscape.exe"
            if not os.path.exists(inkscape_exe_path):
                raise HTTPException(status_code=500, detail="Inkscape not found")
            
            # Convert to EMF
            print("🔄 Converting SVG to EMF using Inkscape...")
            inkscape_cmd = f'"{inkscape_exe_path}" "{svg_file_path}" --export-type=emf --export-filename="{emf_file_path}"'
            result = subprocess.run(inkscape_cmd, shell=True, capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"❌ Inkscape error: {result.stderr}")
                raise HTTPException(status_code=500, detail=f"Inkscape failed: {result.stderr}")
            
            if not os.path.exists(emf_file_path):
                raise HTTPException(status_code=500, detail="EMF file was not created")
            
            emf_size = os.path.getsize(emf_file_path)
            print(f"📄 EMF file created: {emf_file_path} ({emf_size / 1024:.2f} KB)")
            
            # Read EMF into memory
            with open(emf_file_path, "rb") as emf_file:
                emf_data = emf_file.read()
            
            print(f"📦 EMF data size: {len(emf_data)} bytes")
        
        # Create PPT using in-memory EMF data
        from pptx import Presentation
        from pptx.util import Inches
        
        print("📊 Creating PowerPoint presentation...")
        prs = Presentation()
        
        # Use blank slide layout
        slide = prs.slides.add_slide(prs.slide_layouts[6])  # Blank layout
        
        # Write EMF to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".emf") as temp_emf:
            temp_emf.write(emf_data)
            temp_emf_path = temp_emf.name
        
        try:
            # Calculate slide dimensions (standard 16:9)
            slide_width = prs.slide_width
            slide_height = prs.slide_height
            
            # Add picture and fit to slide with margins
            margin = Inches(0.5)
            max_width = slide_width - (2 * margin)
            max_height = slide_height - (2 * margin)
            
            # Calculate aspect ratio
            aspect_ratio = original_width / original_height if original_height > 0 else 1
            
            if max_width / aspect_ratio <= max_height:
                # Width is limiting factor
                pic_width = max_width
                pic_height = pic_width / aspect_ratio
            else:
                # Height is limiting factor
                pic_height = max_height
                pic_width = pic_height * aspect_ratio
            
            # Center the image
            left = (slide_width - pic_width) / 2
            top = (slide_height - pic_height) / 2
            
            slide.shapes.add_picture(temp_emf_path, left, top, width=pic_width)
            print("✅ EMF added to PowerPoint slide")
            
            # Save PPT to BytesIO
            ppt_bytes = BytesIO()
            prs.save(ppt_bytes)
            ppt_bytes.seek(0)
            
            ppt_size = ppt_bytes.getbuffer().nbytes
            print(f"✅ PPT created successfully, size: {ppt_size / 1024:.2f} KB")
            
        finally:
            # Clean up temp EMF file
            if os.path.exists(temp_emf_path):
                os.unlink(temp_emf_path)
                print(f"🗑️ Cleaned up temp file")
        
        write_activity_log(
            username=username,
            action="download",
            module="Org Chart",
            status="success",
            details=f"Downloaded org chart as PPT (scaled: {scale_factor:.2f}x)"
        )
        
        return StreamingResponse(
            ppt_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={
                "Content-Disposition": "attachment; filename=OrgChart.pptx"
            }
        )
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("❌ ERROR OCCURRED:")
        traceback.print_exc()
        
        write_activity_log(
            username=username,
            action="download",
            module="Org Chart",
            status="error",
            details=str(e)
        )
        raise HTTPException(status_code=500, detail=str(e))
# -------------------------
# Export Excel Endpoint
# -------------------------
@app.post("/export/excel")
async def export_excel_endpoint(
    payload: List[Dict],
    sheet_name: str = Query("Sheet1"),
    request: Request = None
):
    username = get_username_from_headers(request)
    try:
        df = pd.DataFrame(payload)
        rows_count = len(df)
        
        df = df.replace([np.inf, -np.inf], np.nan)
        df = df.fillna("")
        
        excel_bytes = export_excel(df, sheet_name=sheet_name)
        
        write_activity_log(
            username=username,
            action="download",
            module="Export",
            rows_output=rows_count,
            status="success",
            details=f"Downloaded {sheet_name} as Excel"
        )
        
        return StreamingResponse(
            BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename=org_data_export.xlsx"
            }
        )
    except Exception as e:
        write_activity_log(
            username=username,
            action="download",
            module="Export",
            status="error",
            details=str(e)
        )
        raise

# -------------------------
# Activity Logs Endpoints
# -------------------------
@app.get("/logs/activity")
def get_logs(limit: Optional[int] = Query(100), request: Request = None):
    """Get recent activity logs"""
    username = get_username_from_headers(request)
    logs = get_activity_logs(limit=limit)
    return {"logs": logs}

@app.get("/logs/stats/{username}")
def get_stats(username: str):
    """Get statistics for a specific user"""
    stats = get_user_stats(username)
    return stats

# -------------------------
# Health Check
# -------------------------
@app.get("/")
def root():
    return {"status": "ok", "message": "Org Level Analysis Backend2 running"}