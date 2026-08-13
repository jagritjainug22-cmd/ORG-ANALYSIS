"""
Editable org-chart shape renderer for PowerPoint.

Replaces the SVG → PNG → add_picture pipeline with native python-pptx shapes so
the resulting PPTX is fully editable: each org card is composed of a rounded-rect
background, a white body overlay, a dot oval, and text-box/pill shapes.  Connectors
use STRAIGHT line shapes arranged in the shared-bus pattern (stem + trunk + drops).

Entry point:
    add_orgchart_slides(prs, records, dataset, scenario,
                        scope="all", root_id_filter=None, detail="summary",
                        page_start=5) -> int   # returns next available page number
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple


# ── Layout constants (must stay in sync with orgchart_render_service.py) ──────
CARD_W   = 240
CARD_H   = 138
HGAP     = 18
VGAP     = 60
HEADER_H = 28
RADIUS   = 10

# ── Slide geometry ─────────────────────────────────────────────────────────────
EMU_PER_PX   = 9525          # pixels to EMU at 96 dpi
SLIDE_W_IN   = 13.333
SLIDE_H_IN   = 7.5

HEADER_BAND_IN = 0.65        # top navy header band (inches)
FOOTER_TOP_IN  = 7.12        # footer line y position (inches)
MARGIN_LR_IN   = 0.28        # left/right content margin
CONTENT_TOP_IN = HEADER_BAND_IN + 0.08

# Usable content area (pixels at 96 dpi)
CONTENT_LEFT_PX  = MARGIN_LR_IN * 96
CONTENT_TOP_PX   = CONTENT_TOP_IN * 96
CONTENT_W_PX     = (SLIDE_W_IN - 2 * MARGIN_LR_IN) * 96   # ≈ 1245
CONTENT_H_PX     = (FOOTER_TOP_IN - CONTENT_TOP_IN - 0.05) * 96  # ≈ 613

# Don't scale cards below this factor (ensures readability)
MIN_SCALE          = 0.62
MAX_NODES_PER_SLIDE = 24

# ── Brand colours ──────────────────────────────────────────────────────────────
_NAVY    = "#01244a"
_NAVY_L2 = "#0a3366"
_NAVY_L3 = "#1a4d7a"
_NAVY_L4 = "#2d5a85"
_NAVY_L5 = "#3d6a95"
_GOLD    = "#c5a84a"
_BLUE    = "#0085ca"
_BL5     = "#5c8bb4"
_WHITE   = "#ffffff"
_BORDER  = "#dce4ee"
_MUTED   = "#8a9ab4"
_SECOND  = "#4a6a8a"
_DANGER  = "#d94f4f"
_BG      = "#f4f6f9"
# Approximate navy @ 65% opacity over _BG background (matches SVG connector opacity)
_CONN    = "#566e87"


def _rgb(h: str):
    from pptx.dml.color import RGBColor
    h = h.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _header_colors(level: int) -> Tuple[str, str]:
    if level <= 1: return _NAVY,    _GOLD
    if level == 2: return _NAVY_L2, _GOLD
    if level == 3: return _NAVY_L3, _BLUE
    if level == 4: return _NAVY_L4, _BLUE
    return              _NAVY_L5, _BL5


def _header_label(rec: Dict, level: int) -> str:
    for key in ("Management Level", "managementLevel", "Mgmt Level", "Level Label"):
        if rec.get(key):
            return f"L{level} | {rec[key]}"
    mgmt = (
        "Executive" if level <= 1 else "VP" if level == 2
        else "Director" if level == 3 else "Manager" if level == 4
        else "Staff"
    )
    return f"L{level} | {mgmt}"


def _compact_currency(n) -> str:
    if n is None:
        return "$0"
    abs_n = abs(float(n))
    sign = "-" if float(n) < 0 else ""
    if abs_n >= 1_000_000: return f"{sign}${abs_n/1_000_000:.1f}M"
    if abs_n >= 1_000:     return f"{sign}${abs_n/1_000:.0f}K"
    return f"{sign}${abs_n:.0f}"


def _node_id(rec: Dict, emp_col: str) -> str:
    val = rec.get("__emp_id")
    if val in (None, "", "None"):
        val = rec.get(emp_col)
    return "" if val is None else str(val)


def _node_title(rec: Dict, jtc: Optional[str], emp_col: str) -> str:
    title = str(rec.get(jtc) or rec.get("Job Title") or "") if jtc else str(rec.get("Job Title") or "")
    return title or _node_id(rec, emp_col)


# ── Subtree helpers ────────────────────────────────────────────────────────────

def _count_subtree(nid: str, children: Dict[str, List[str]],
                   max_d: Optional[int] = None, d: int = 0) -> int:
    if max_d is not None and d >= max_d:
        return 1
    return 1 + sum(_count_subtree(k, children, max_d, d + 1) for k in children.get(nid, []))


def _build_parent_map(children: Dict[str, List[str]]) -> Dict[str, str]:
    pm: Dict[str, str] = {}
    for pid, kids in children.items():
        for k in kids:
            pm[k] = pid
    return pm


def _breadcrumb(nid: str, parent_map: Dict[str, str],
                by_id: Dict, jtc: Optional[str], emp_col: str) -> str:
    parts: List[str] = []
    cur = parent_map.get(nid)
    while cur is not None:
        rec = by_id.get(cur, {})
        t = _node_title(rec, jtc, emp_col)
        short = t[:20] + "…" if len(t) > 20 else t
        parts.insert(0, short)
        cur = parent_map.get(cur)
    return " › ".join(parts)


# ── Slide spec planner ─────────────────────────────────────────────────────────

def _plan_slide_specs(
    by_id: Dict, children: Dict, roots: List[str], full_stats: Dict,
    scope: str, root_id_filter: Optional[str], detail: str,
    jtc: Optional[str], emp_col: str,
    scenario_name: str, page_start: int,
) -> List[Dict]:
    """
    Return an ordered list of slide-spec dicts:
        { title, breadcrumb, root_id, max_depth, page_num, scenario_name }
    """
    parent_map = _build_parent_map(children)
    page = page_start
    specs: List[Dict] = []

    def ntitle(nid: str) -> str:
        return _node_title(by_id.get(nid, {}), jtc, emp_col)

    def add_spec(title: str, root_id: Optional[str], max_depth: Optional[int]) -> None:
        nonlocal page
        bc = _breadcrumb(root_id, parent_map, by_id, jtc, emp_col) if root_id else ""
        specs.append(dict(
            title=title, breadcrumb=bc,
            root_id=root_id, max_depth=max_depth,
            scenario_name=scenario_name, page_num=page,
        ))
        page += 1

    def process_subtree(nid: str, depth_budget: int = 3) -> None:
        hc = full_stats.get(nid, {}).get("hc", 0)
        t  = ntitle(nid)
        if hc <= MAX_NODES_PER_SLIDE:
            add_spec(f"{t} — Team", nid, None)
        else:
            add_spec(f"{t} — Overview", nid, 2)
            if depth_budget > 0:
                for kid in children.get(nid, []):
                    if full_stats.get(kid, {}).get("hc", 0) >= 3:
                        process_subtree(kid, depth_budget - 1)

    # Active root(s)
    if scope == "subtree" and root_id_filter and root_id_filter in by_id:
        active_roots = [root_id_filter]
    else:
        active_roots = roots

    # Overview slide: root(s) down to L2
    ov_title = (
        f"{ntitle(active_roots[0])} — Overview"
        if len(active_roots) == 1
        else "Organization Chart — Overview"
    )
    ov_root = active_roots[0] if len(active_roots) == 1 else None
    add_spec(ov_title, ov_root, 2)

    if detail in ("summary", "full"):
        for rid in active_roots:
            for kid in children.get(rid, []):
                if full_stats.get(kid, {}).get("hc", 0) < 2:
                    continue
                t   = ntitle(kid)
                hc  = full_stats.get(kid, {}).get("hc", 0)
                if detail == "summary":
                    if hc <= MAX_NODES_PER_SLIDE:
                        add_spec(f"{t} — Team", kid, None)
                    else:
                        add_spec(f"{t} — Overview", kid, 3)
                else:
                    process_subtree(kid, depth_budget=3)

    return specs


# ── Shape rendering helpers ────────────────────────────────────────────────────

def _add_textbox(slide, left_emu, top_emu, w_emu, h_emu,
                 text: str, font_size, bold=False, italic=False,
                 color_hex=_NAVY, font_name="Calibri",
                 align="left", word_wrap=False, margin_pt=2):
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN

    ALIGN_MAP = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}
    tb = slide.shapes.add_textbox(left_emu, top_emu, w_emu, h_emu)
    tf = tb.text_frame
    tf.word_wrap = word_wrap
    tf.margin_left  = Pt(margin_pt)
    tf.margin_right = Pt(margin_pt)
    tf.margin_top   = Pt(margin_pt)
    tf.margin_bottom = Pt(0)
    para = tf.paragraphs[0]
    para.alignment = ALIGN_MAP.get(align, PP_ALIGN.LEFT)
    run = para.add_run()
    run.text = text
    run.font.size  = Pt(font_size)
    run.font.bold  = bold
    run.font.italic = italic
    run.font.color.rgb = _rgb(color_hex)
    run.font.name  = font_name
    return tb


def _add_pill(slide, left_emu, top_emu, w_emu, h_emu,
              text: str, font_size, bg_hex: str, text_hex: str):
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN

    pill = slide.shapes.add_shape(5, left_emu, top_emu, w_emu, h_emu)  # 5 = rounded rect
    pill.fill.solid()
    pill.fill.fore_color.rgb = _rgb(bg_hex)
    pill.line.fill.background()
    pill.adjustments[0] = 0.5  # pill shape
    tf = pill.text_frame
    tf.word_wrap = False
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = Pt(0)
    para = tf.paragraphs[0]
    para.alignment = PP_ALIGN.CENTER
    run = para.add_run()
    run.text = text
    run.font.size = Pt(font_size)
    run.font.bold = True
    run.font.color.rgb = _rgb(text_hex)
    run.font.name = "Calibri"
    return pill


def _draw_org_card(
    slide,
    rec: Dict,
    left_emu: int, top_emu: int,
    card_w_emu: int, card_h_emu: int,
    scale: float,
    jtc: Optional[str], ftc: Optional[str],
    flc: Optional[str], ctc: Optional[str],
    full_stats: Dict, emp_col: str,
) -> None:
    from pptx.util import Pt, Emu

    flagged = bool(rec.get("is_flagged_removed"))
    added   = bool(rec.get("is_added"))
    level   = int(rec.get("Level") or 0)

    hdr_hex, dot_hex = _header_colors(level)
    if flagged:
        hdr_hex = _DANGER

    # Scale helpers (all dimensions relative to base CARD_W/H)
    def sw(px): return Emu(int(px * scale * EMU_PER_PX))
    def sh(px): return Emu(int(px * scale * EMU_PER_PX))

    hdr_h_emu  = sh(HEADER_H)
    body_h_emu = Emu(int(card_h_emu - hdr_h_emu - sh(1)))
    rad_adj    = RADIUS / min(CARD_W, CARD_H)   # ≈ 0.072

    # 1. Card background rounded rect (header colour fill + border)
    card_bg = slide.shapes.add_shape(5, left_emu, top_emu, card_w_emu, card_h_emu)
    card_bg.fill.solid()
    card_bg.fill.fore_color.rgb = _rgb(hdr_hex)
    card_bg.line.color.rgb = _rgb(_DANGER if flagged else _BORDER)
    card_bg.line.width = Pt(1.5 if flagged else 1.0)
    card_bg.adjustments[0] = rad_adj

    # 2. White body overlay rectangle (covers everything below the header stripe)
    body = slide.shapes.add_shape(
        1,
        Emu(left_emu + sw(1)), Emu(top_emu + hdr_h_emu),
        Emu(card_w_emu - sw(2)), body_h_emu,
    )
    body.fill.solid()
    body.fill.fore_color.rgb = _rgb(_WHITE)
    body.line.fill.background()

    # Added/green border overlay (second rounded rect, no fill, green border)
    if added and not flagged:
        overlay = slide.shapes.add_shape(5, left_emu, top_emu, card_w_emu, card_h_emu)
        overlay.fill.background()
        overlay.line.color.rgb = _rgb("#2e9e6a")
        overlay.line.width = Pt(2.0)
        overlay.adjustments[0] = rad_adj

    # 3. Header dot (oval)
    dot_sz = sh(6)
    dot = slide.shapes.add_shape(
        9,  # OVAL
        Emu(left_emu + sw(13)), Emu(top_emu + sh(11)),
        dot_sz, dot_sz,
    )
    dot.fill.solid()
    dot.fill.fore_color.rgb = _rgb(dot_hex)
    dot.line.fill.background()

    # 4. Header label
    _add_textbox(
        slide,
        Emu(left_emu + sw(23)), Emu(top_emu + sh(3)),
        Emu(card_w_emu - sw(28)), sh(22),
        _header_label(rec, level),
        font_size=max(6.5, 10.5 * scale),
        bold=True, color_hex=_WHITE, align="left",
    )

    # 5. Job title
    emp_id_str = _node_id(rec, emp_col)
    title_txt  = _node_title(rec, jtc, emp_col)
    if len(title_txt) > 30:
        title_txt = title_txt[:28] + "…"

    _add_textbox(
        slide,
        Emu(left_emu + sw(10)), Emu(top_emu + sh(31)),
        Emu(card_w_emu - sw(16)), sh(19),
        title_txt,
        font_size=max(7.0, 12.5 * scale),
        bold=True,
        color_hex=_DANGER if flagged else _NAVY,
        align="left",
    )

    # 6. Employee ID
    eid_display = emp_id_str[:20] + "…" if len(emp_id_str) > 20 else emp_id_str
    _add_textbox(
        slide,
        Emu(left_emu + sw(10)), Emu(top_emu + sh(51)),
        Emu(card_w_emu - sw(16)), sh(16),
        eid_display,
        font_size=max(6.0, 9.5 * scale),
        color_hex=_MUTED,
        font_name="Consolas",
        align="left",
    )

    # 7. Reports pill + optional cost pill
    nid = emp_id_str
    st  = full_stats.get(nid, {})
    hc  = st.get("hc", 0)
    cost = st.get("cost", 0.0)
    reports = max(0, hc - 1)

    pill_txt = f"{reports} report{'s' if reports != 1 else ''}"
    pill_w_px = max(62, len(pill_txt) * 6.2 + 14)
    pill_l = Emu(left_emu + sw(10))
    pill_t = Emu(top_emu + sh(72))

    _add_pill(slide, pill_l, pill_t,
              sw(pill_w_px), sh(16),
              pill_txt, max(5.5, 9.0 * scale), _NAVY, _WHITE)

    if flc and cost:
        cost_txt  = _compact_currency(cost)
        cpw_px    = max(50, len(cost_txt) * 6.8 + 14)
        cp_l      = Emu(left_emu + sw(10 + pill_w_px + 6))
        _add_pill(slide, cp_l, pill_t,
                  sw(cpw_px), sh(16),
                  cost_txt, max(5.5, 9.0 * scale), _GOLD, _NAVY)

    # 8. FTE + country meta line
    meta: List[str] = []
    if ftc and rec.get(ftc) not in (None, ""):
        try:
            meta.append(f"{float(rec[ftc]):.1f} FTE")
        except (TypeError, ValueError):
            pass
    if ctc and rec.get(ctc):
        meta.append(str(rec[ctc])[:14])
    if meta:
        _add_textbox(
            slide,
            Emu(left_emu + sw(10)), Emu(top_emu + sh(96)),
            Emu(card_w_emu - sw(16)), sh(16),
            " · ".join(meta),
            font_size=max(6.0, 9.0 * scale),
            color_hex=_SECOND,
            align="left",
        )

    # 9. FLAGGED badge in top-right of header
    if flagged:
        badge_w = sw(48)
        _add_pill(
            slide,
            Emu(left_emu + card_w_emu - sw(56)), Emu(top_emu + sh(7)),
            badge_w, sh(13),
            "FLAGGED", max(5.0, 7.5 * scale), _WHITE, _DANGER,
        )


def _draw_connectors(
    slide,
    parent_xy: Tuple[float, float],
    child_xys: List[Tuple[float, float]],
    scale: float,
    base_x_emu_offset: int, base_y_emu_offset: int,
) -> None:
    from pptx.util import Pt, Emu
    from pptx.enum.shapes import MSO_CONNECTOR_TYPE

    if not child_xys:
        return

    def lx(px: float) -> int:
        return base_x_emu_offset + int(px * scale * EMU_PER_PX)

    def ly(py: float) -> int:
        return base_y_emu_offset + int(py * scale * EMU_PER_PX)

    def add_line(x1, y1, x2, y2) -> None:
        if abs(x2 - x1) < 2 and abs(y2 - y1) < 2:
            return
        try:
            conn = slide.shapes.add_connector(
                MSO_CONNECTOR_TYPE.STRAIGHT,
                Emu(lx(x1)), Emu(ly(y1)),
                Emu(lx(x2)), Emu(ly(y2)),
            )
            conn.line.color.rgb = _rgb(_CONN)
            conn.line.width = Pt(1.5)
        except Exception:
            pass

    px_base, py_base = parent_xy
    parent_cx = px_base + CARD_W / 2
    parent_by = py_base + CARD_H

    child_tops = [(cx + CARD_W / 2, cy) for cx, cy in child_xys]
    mid_y = parent_by + (child_tops[0][1] - parent_by) * 0.45

    if len(child_tops) == 1:
        cx, cy = child_tops[0]
        add_line(parent_cx, parent_by, parent_cx, mid_y)
        add_line(parent_cx, mid_y, cx, mid_y)
        add_line(cx, mid_y, cx, cy)
    else:
        # Stem
        add_line(parent_cx, parent_by, parent_cx, mid_y)
        # Trunk
        trunk_l = min(c[0] for c in child_tops)
        trunk_r = max(c[0] for c in child_tops)
        add_line(trunk_l, mid_y, trunk_r, mid_y)
        # Drops
        for cx, cy in child_tops:
            add_line(cx, mid_y, cx, cy)


def _add_footer(slide, prs, scenario_name: str, page_num: int, breadcrumb: str = "") -> None:
    from pptx.util import Inches as I, Pt, Emu
    from pptx.enum.text import PP_ALIGN

    line = slide.shapes.add_shape(1, I(0.5), I(FOOTER_TOP_IN), I(12.3), Pt(1.5))
    line.fill.solid()
    line.fill.fore_color.rgb = _rgb(_BORDER)
    line.line.fill.background()

    foot_parts = [f"OrgSight  |  {scenario_name}  |  Page {page_num}"]
    if breadcrumb:
        foot_parts.insert(0, breadcrumb)
    foot_text = "   ·   ".join(foot_parts)

    foot = slide.shapes.add_textbox(I(0.5), I(FOOTER_TOP_IN + 0.03), I(12.3), I(0.3))
    fp = foot.text_frame.paragraphs[0]
    fp.alignment = PP_ALIGN.CENTER
    run = fp.add_run()
    run.text = foot_text
    run.font.size = Pt(8.5)
    run.font.color.rgb = _rgb(_MUTED)
    run.font.name = "Calibri"


# ── Slide assembler ────────────────────────────────────────────────────────────

def _add_orgchart_shapes_slide(
    prs,
    records: List[Dict],
    emp_col: str, mgr_col: str,
    jtc: Optional[str], ftc: Optional[str],
    flc: Optional[str], ctc: Optional[str],
    spec: Dict,
    full_stats: Dict,
) -> None:
    from pptx.util import Inches as I, Pt, Emu
    from pptx.enum.text import PP_ALIGN
    from services.orgchart_render_service import _layout as _oc_layout

    title        = spec["title"]
    breadcrumb   = spec.get("breadcrumb", "")
    root_id      = spec.get("root_id")
    max_depth    = spec.get("max_depth")
    scenario_name = spec.get("scenario_name", "")
    page_num     = spec.get("page_num", 1)

    # Compute layout for this slide's subtree
    by_id, children, _roots, nodes, _stats, max_x, max_y = _oc_layout(
        records, emp_col, mgr_col,
        root_id=root_id, max_depth=max_depth,
    )
    if not nodes:
        return

    # ── Scale to fit content area ──────────────────────────────────────────────
    scale = min(
        CONTENT_W_PX / max(max_x, 1),
        CONTENT_H_PX / max(max_y, 1),
        1.0,
    )
    scale = max(scale, MIN_SCALE)

    scaled_w = max_x * scale
    scaled_h = max_y * scale

    # Centre within content area
    x_off_px = CONTENT_LEFT_PX + max(0.0, (CONTENT_W_PX - scaled_w) / 2)
    y_off_px = CONTENT_TOP_PX  + max(0.0, (CONTENT_H_PX  - scaled_h) / 2)

    base_x_emu = int(x_off_px * EMU_PER_PX)
    base_y_emu = int(y_off_px * EMU_PER_PX)

    card_w_emu = int(CARD_W * scale * EMU_PER_PX)
    card_h_emu = int(CARD_H * scale * EMU_PER_PX)

    # ── Add slide ──────────────────────────────────────────────────────────────
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    # Grey content background
    bg = slide.shapes.add_shape(
        1, Emu(0), I(HEADER_BAND_IN),
        prs.slide_width, Emu(int((FOOTER_TOP_IN - HEADER_BAND_IN) * 96 * EMU_PER_PX)),
    )
    bg.fill.solid()
    bg.fill.fore_color.rgb = _rgb(_BG)
    bg.line.fill.background()

    # Navy header band
    band = slide.shapes.add_shape(1, Emu(0), Emu(0), prs.slide_width, I(HEADER_BAND_IN))
    band.fill.solid()
    band.fill.fore_color.rgb = _rgb(_NAVY)
    band.line.fill.background()

    # Title
    _add_textbox(
        slide,
        I(0.38), I(0.1), I(10.5), I(0.38),
        title,
        font_size=18, bold=True, color_hex=_WHITE, align="left",
    )

    # Node count / headcount hint (top-right of header)
    n_nodes = len(nodes)
    hint_txt = f"{n_nodes} role{'s' if n_nodes != 1 else ''} shown"
    if max_depth:
        hint_txt += f"  ·  {max_depth} level{'s' if max_depth != 1 else ''}"
    _add_textbox(
        slide,
        I(10.9), I(0.15), I(2.1), I(0.32),
        hint_txt,
        font_size=8.5, color_hex=_MUTED, align="right",
    )

    # Breadcrumb (subtitle)
    if breadcrumb:
        _add_textbox(
            slide,
            I(0.38), I(0.46), I(12.0), I(0.19),
            breadcrumb,
            font_size=9, color_hex=_BL5, align="left",
        )

    # ── Draw connectors (behind cards) ────────────────────────────────────────
    for pid, kids in children.items():
        if pid not in nodes:
            continue
        px, py, _depth = nodes[pid]
        visible_kids = [k for k in kids if k in nodes]
        if not visible_kids:
            continue
        child_positions = [(nodes[k][0], nodes[k][1]) for k in visible_kids]
        _draw_connectors(slide, (px, py), child_positions, scale,
                         base_x_emu, base_y_emu)

    # ── Draw cards ────────────────────────────────────────────────────────────
    for nid, (x_px, y_px, _depth) in nodes.items():
        rec   = by_id[nid]
        card_l = Emu(base_x_emu + int(x_px * scale * EMU_PER_PX))
        card_t = Emu(base_y_emu + int(y_px * scale * EMU_PER_PX))
        _draw_org_card(
            slide, rec,
            card_l, card_t,
            Emu(card_w_emu), Emu(card_h_emu),
            scale, jtc, ftc, flc, ctc, full_stats, emp_col,
        )

    # Footer
    _add_footer(slide, prs, scenario_name, page_num, breadcrumb)


# ── Public entry point ─────────────────────────────────────────────────────────

def add_orgchart_slides(
    prs,
    records: List[Dict],
    dataset: Dict,
    scenario: Dict,
    scope: str = "all",
    root_id_filter: Optional[str] = None,
    detail: str = "summary",
    page_start: int = 5,
) -> int:
    """
    Append editable org-chart shape slides to *prs*.

    Returns the next available page number (page_start + number of slides added).

    Parameters
    ----------
    prs           : python-pptx Presentation
    records       : flat list of employee record dicts
    dataset       : dict with emp_col, mgr_col, job_title_col, fte_col, flc_col, country_col
    scenario      : dict with at least "name"
    scope         : "all" | "subtree"
    root_id_filter: empId of the subtree root when scope="subtree"
    detail        : "overview" | "summary" | "full"
    page_start    : starting slide page number for footer pagination
    """
    from services.orgchart_render_service import _layout as _oc_layout

    emp_col = dataset["emp_col"]
    mgr_col = dataset["mgr_col"]
    jtc = dataset.get("job_title_col")
    ftc = dataset.get("fte_col")
    flc = dataset.get("flc_col")
    ctc = dataset.get("country_col")

    # Compute full-tree layout once for stats (headcount + cost per subtree)
    by_id, children, roots, _nodes, full_stats_raw, _mx, _my = _oc_layout(
        records, emp_col, mgr_col,
    )

    # full_stats_raw from _layout has {"hc": N, "cost": C} per node
    full_stats: Dict[str, Dict] = dict(full_stats_raw)

    # Plan which slides to generate
    specs = _plan_slide_specs(
        by_id, children, roots, full_stats,
        scope, root_id_filter, detail,
        jtc, emp_col,
        scenario["name"], page_start,
    )

    for spec in specs:
        try:
            _add_orgchart_shapes_slide(
                prs, records, emp_col, mgr_col, jtc, ftc, flc, ctc,
                spec, full_stats,
            )
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "Skipped org chart slide %r: %s", spec.get("title"), exc,
                exc_info=True,
            )

    return page_start + len(specs)
