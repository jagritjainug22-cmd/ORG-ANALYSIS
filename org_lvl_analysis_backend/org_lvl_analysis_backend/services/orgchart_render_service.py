"""
Server-side SVG renderer for a scenario's org chart.

Mirrors the frontend layout (Option D cards, bezier connectors) so the SVG
exports a faithful snapshot of what the user sees in the browser. The SVG is
then re-used by the existing PPT export pipeline (SVG -> Inkscape -> EMF ->
PPTX) and by a new PDF export route via cairosvg.
"""

from __future__ import annotations
from html import escape
from typing import Any, Dict, List, Optional, Tuple

# Layout constants -- must match orgChartLayout.js
CARD_W = 240
CARD_H = 138
HGAP = 18
VGAP = 60
PORT_RADIUS = 6

NAVY = "#01244a"
NAVY_LIGHT = "#0a3366"
NAVY_MID = "#1a4d7a"
BLUE = "#0085ca"
GOLD = "#c5a84a"
WHITE = "#ffffff"
BORDER = "#dce4ee"
TEXT_MUTED = "#8a9ab4"
TEXT_SECONDARY = "#4a6a8a"
DANGER = "#d94f4f"


def _header_color(level: int) -> Tuple[str, str]:
    if level <= 1:
        return NAVY, GOLD
    if level == 2:
        return NAVY_LIGHT, GOLD
    if level == 3:
        return NAVY_MID, BLUE
    if level == 4:
        return "#2d5a85", BLUE
    return "#3d6a95", "#5c8bb4"


def _header_label(record: Dict[str, Any], level: int) -> str:
    for key in ("Management Level", "managementLevel", "Mgmt Level", "Level Label"):
        if record.get(key):
            return f"L{level} | {record[key]}"
    mgmt = (
        "Executive" if level <= 1 else
        "VP" if level == 2 else
        "Director" if level == 3 else
        "Manager" if level == 4 else
        "Staff"
    )
    return f"L{level} | {mgmt}"


def _id_of(rec: Dict[str, Any], emp_col: str) -> str:
    val = rec.get("__emp_id")
    if val in (None, "", "None"):
        val = rec.get(emp_col)
    return "" if val is None else str(val)


def _mgr_of(rec: Dict[str, Any], mgr_col: str) -> Optional[str]:
    val = rec.get("__mgr_id")
    if val in (None, "", "None"):
        val = rec.get(mgr_col)
    return None if val in (None, "", "None") else str(val)


def _layout(records: List[Dict[str, Any]], emp_col: str, mgr_col: str):
    by_id: Dict[str, Dict[str, Any]] = {}
    children: Dict[str, List[str]] = {}
    roots: List[str] = []

    for r in records:
        rid = _id_of(r, emp_col)
        if not rid:
            continue
        by_id[rid] = r
        children.setdefault(rid, [])

    for r in records:
        rid = _id_of(r, emp_col)
        if not rid:
            continue
        pid = _mgr_of(r, mgr_col)
        if pid and pid in by_id:
            children[pid].append(rid)
        else:
            roots.append(rid)

    subtree_w: Dict[str, float] = {}
    nodes: Dict[str, Tuple[float, float, int]] = {}

    def measure(node_id: str) -> float:
        kids = children.get(node_id, [])
        if not kids:
            subtree_w[node_id] = CARD_W
            return CARD_W
        total = 0.0
        for i, k in enumerate(kids):
            total += measure(k)
            if i < len(kids) - 1:
                total += HGAP
        subtree_w[node_id] = max(CARD_W, total)
        return subtree_w[node_id]

    def place(node_id: str, left_x: float, depth: int) -> None:
        kids = children.get(node_id, [])
        my_w = subtree_w[node_id]
        if kids:
            total_kid = sum(subtree_w[k] for k in kids) + HGAP * (len(kids) - 1)
            cursor = left_x + (my_w - total_kid) / 2
            kid_centers: List[float] = []
            for k in kids:
                place(k, cursor, depth + 1)
                kid_centers.append(cursor + subtree_w[k] / 2)
                cursor += subtree_w[k] + HGAP
            x = (kid_centers[0] + kid_centers[-1]) / 2 - CARD_W / 2
        else:
            x = left_x + (my_w - CARD_W) / 2
        y = depth * (CARD_H + VGAP)
        nodes[node_id] = (x, y, depth)

    x_off = 0.0
    for r in roots:
        w = measure(r)
        place(r, x_off, 0)
        x_off += w + HGAP * 3

    max_x = max((p[0] + CARD_W for p in nodes.values()), default=CARD_W)
    max_y = max((p[1] + CARD_H for p in nodes.values()), default=CARD_H)

    # Compute subtree headcount and cost (excluding flagged) for each node
    stats: Dict[str, Dict[str, float]] = {}

    def compute_stats(node_id: str) -> Dict[str, float]:
        if node_id in stats:
            return stats[node_id]
        node = by_id.get(node_id)
        if not node:
            stats[node_id] = {"hc": 0, "cost": 0}
            return stats[node_id]
        removed = bool(node.get("is_flagged_removed"))
        self_cost = 0.0
        if not removed:
            for cost_field in ("flc_col", "FLC", "Avg_FLC"):
                # placeholder; caller supplies flc_col separately when rendering
                pass
        s = {"hc": 0 if removed else 1, "cost": 0.0}
        for k in children.get(node_id, []):
            c = compute_stats(k)
            s["hc"] += c["hc"]
            s["cost"] += c["cost"]
        stats[node_id] = s
        return s

    for nid in by_id:
        compute_stats(nid)

    return by_id, children, nodes, stats, max_x, max_y


def _format_compact_currency(n: float) -> str:
    if n is None:
        return "$0"
    abs_n = abs(n)
    sign = "-" if n < 0 else ""
    if abs_n >= 1_000_000:
        return f"{sign}${abs_n / 1_000_000:.1f}M"
    if abs_n >= 1_000:
        return f"{sign}${abs_n / 1_000:.0f}K"
    return f"{sign}${abs_n:.0f}"


import math as _math


def _shared_bus_path(
    parent_pos: Tuple[float, float],
    child_positions: List[Tuple[float, float]],
) -> str:
    """Shared-bus connector: one stem + one trunk + N drops.

    PARITY: must produce identical SVG path strings to the JS function
    ``stepPath`` in orgChartLayout.js for the same inputs.  Both sides use
    ``math.floor(n + 0.5)`` rounding.  The shared fixture at
    tests/fixtures/shared_bus_paths.json asserts this.
    """
    if not child_positions:
        return ""

    def r(n: float) -> int:
        return _math.floor(n + 0.5)

    px = r(parent_pos[0] + CARD_W / 2)
    py = r(parent_pos[1] + CARD_H)

    children = [
        (r(c[0] + CARD_W / 2), r(c[1]))
        for c in child_positions
    ]

    mid_y = r(py + (children[0][1] - py) * 0.45)

    if len(children) == 1:
        cx, cy = children[0]
        return f"M {px} {py} V {mid_y} H {cx} V {cy}"

    all_x = [px] + [c[0] for c in children]
    trunk_left = min(all_x)
    trunk_right = max(all_x)

    parts = [f"M {px} {py} V {mid_y}"]
    parts.append(f"M {trunk_left} {mid_y} H {trunk_right}")
    for cx, cy in children:
        parts.append(f"M {cx} {mid_y} V {cy}")
    return " ".join(parts)


def render_scenario_svg(
    records: List[Dict[str, Any]],
    *,
    emp_col: str,
    mgr_col: str,
    job_title_col: Optional[str] = None,
    fte_col: Optional[str] = None,
    flc_col: Optional[str] = None,
    country_col: Optional[str] = None,
    title: str = "OrgSight 2.0",
    include_flagged: bool = True,
) -> str:
    if not records:
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80">'
            '<text x="20" y="40" font-family="sans-serif" font-size="14" fill="#666">'
            'No records to render</text></svg>'
        )

    rows = records if include_flagged else [r for r in records if not r.get("is_flagged_removed")]
    by_id, children, nodes, _stats, max_x, max_y = _layout(rows, emp_col, mgr_col)

    # Compute live subtree headcount + cost ourselves so we can use the actual
    # flc/fte columns at render time.
    def cost_of(rec):
        if not flc_col or rec.get("is_flagged_removed"):
            return 0.0
        v = rec.get(flc_col)
        try:
            return float(v) if v not in (None, "") else 0.0
        except (TypeError, ValueError):
            return 0.0

    def hc_of(rec):
        return 0 if rec.get("is_flagged_removed") else 1

    subtree_stats: Dict[str, Tuple[int, float]] = {}

    def walk(nid: str) -> Tuple[int, float]:
        if nid in subtree_stats:
            return subtree_stats[nid]
        rec = by_id.get(nid, {})
        hc = hc_of(rec)
        cost = cost_of(rec)
        for k in children.get(nid, []):
            kh, kc = walk(k)
            hc += kh
            cost += kc
        subtree_stats[nid] = (hc, cost)
        return subtree_stats[nid]

    for nid in by_id:
        walk(nid)

    pad = 40
    width = int(max_x + pad * 2)
    height = int(max_y + pad * 2 + 50)  # extra 50 for title bar

    parts: List[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="\'IBM Plex Sans\', Arial, sans-serif">'
    )

    # Background
    parts.append(f'<rect x="0" y="0" width="{width}" height="{height}" fill="#f4f6f9"/>')

    # Title bar
    parts.append(f'<rect x="0" y="0" width="{width}" height="40" fill="{NAVY}"/>')
    parts.append(
        f'<text x="20" y="26" font-size="14" font-weight="700" fill="{WHITE}">'
        f'{escape(title)}</text>'
    )

    g_open = f'<g transform="translate({pad},{pad + 50})">'
    parts.append(g_open)

    # Connectors — shared-bus per parent (matches live UI stepPath)
    for pid, kids in children.items():
        if pid not in nodes:
            continue
        ppos = nodes[pid]
        visible_kids = [cid for cid in kids if cid in nodes]
        if not visible_kids:
            continue
        child_pos = [(nodes[cid][0], nodes[cid][1]) for cid in visible_kids]
        d = _shared_bus_path((ppos[0], ppos[1]), child_pos)
        if d:
            parts.append(
                f'<path d="{d}" stroke="{NAVY}" stroke-opacity="0.4" '
                f'stroke-width="1.5" fill="none" stroke-linecap="round"/>'
            )

    # Cards
    for nid, (x, y, depth) in nodes.items():
        rec = by_id[nid]
        flagged = bool(rec.get("is_flagged_removed"))
        level = int(rec.get("Level") or 0)
        header_bg, dot_color = _header_color(level)
        if flagged:
            header_bg = DANGER

        # Card outer + drop shadow
        parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{CARD_W}" height="{CARD_H}" '
            f'rx="10" ry="10" fill="{WHITE}" stroke="{DANGER if flagged else BORDER}" '
            f'stroke-width="2" opacity="{0.55 if flagged else 1}"/>'
        )

        # Header stripe (clip-rect technique: solid rect for the stripe, no rounded corners issue since it's clipped by the card border anyway)
        parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{CARD_W}" height="28" '
            f'fill="{header_bg}" opacity="{0.55 if flagged else 1}"/>'
        )
        parts.append(
            f'<rect x="{x:.1f}" y="{y + 28 - 10:.1f}" width="{CARD_W}" height="10" '
            f'fill="{WHITE}"/>'  # mask any rounded-corner overflow on the bottom of header
        )
        # Re-draw card border on top so it's not partially covered
        parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{CARD_W}" height="{CARD_H}" '
            f'rx="10" ry="10" fill="none" stroke="{DANGER if flagged else BORDER}" '
            f'stroke-width="2"/>'
        )

        # Header dot + label
        parts.append(
            f'<circle cx="{x + 16:.1f}" cy="{y + 14:.1f}" r="3" fill="{dot_color}"/>'
        )
        parts.append(
            f'<text x="{x + 24:.1f}" y="{y + 18:.1f}" font-size="11" font-weight="600" '
            f'fill="{WHITE}" letter-spacing="0.4">'
            f'{escape(_header_label(rec, level))}</text>'
        )
        if flagged:
            parts.append(
                f'<rect x="{x + CARD_W - 60:.1f}" y="{y + 6:.1f}" width="50" height="14" '
                f'rx="3" fill="{WHITE}"/>'
                f'<text x="{x + CARD_W - 35:.1f}" y="{y + 16:.1f}" font-size="9" '
                f'font-weight="700" fill="{DANGER}" text-anchor="middle">FLAGGED</text>'
            )

        # Job title (truncated)
        title_txt = ""
        if job_title_col and rec.get(job_title_col):
            title_txt = str(rec[job_title_col])
        else:
            title_txt = str(rec.get("Job Title") or _id_of(rec, emp_col))
        if len(title_txt) > 28:
            title_txt = title_txt[:26] + "…"
        td = "line-through" if flagged else "none"
        parts.append(
            f'<text x="{x + 12:.1f}" y="{y + 50:.1f}" font-size="13" font-weight="700" '
            f'fill="{NAVY}" text-decoration="{td}">{escape(title_txt)}</text>'
        )

        # Employee ID
        emp_id = _id_of(rec, emp_col)
        parts.append(
            f'<text x="{x + 12:.1f}" y="{y + 66:.1f}" font-size="10" '
            f'fill="{TEXT_MUTED}" font-family="\'IBM Plex Mono\', monospace">'
            f'{escape(emp_id)}</text>'
        )

        # Pills
        hc, cost = subtree_stats[nid]
        reports = max(0, hc - 1)
        pill_y = y + 76
        # navy pill
        pill_text = f"{reports} reports"
        pill_w = max(60, len(pill_text) * 6 + 12)
        parts.append(
            f'<rect x="{x + 12:.1f}" y="{pill_y:.1f}" width="{pill_w}" height="16" '
            f'rx="4" fill="{NAVY}"/>'
            f'<text x="{x + 12 + pill_w/2:.1f}" y="{pill_y + 11:.1f}" font-size="10" '
            f'font-weight="600" fill="{WHITE}" text-anchor="middle" '
            f'font-family="\'IBM Plex Mono\', monospace">{pill_text}</text>'
        )
        # gold pill (cost)
        if flc_col:
            cost_text = _format_compact_currency(cost)
            cw = max(50, len(cost_text) * 6 + 12)
            cx2 = x + 12 + pill_w + 6
            parts.append(
                f'<rect x="{cx2:.1f}" y="{pill_y:.1f}" width="{cw}" height="16" '
                f'rx="4" fill="{GOLD}"/>'
                f'<text x="{cx2 + cw/2:.1f}" y="{pill_y + 11:.1f}" font-size="10" '
                f'font-weight="700" fill="{NAVY}" text-anchor="middle" '
                f'font-family="\'IBM Plex Mono\', monospace">{cost_text}</text>'
            )

        # FTE + Country
        meta_parts = []
        if fte_col and rec.get(fte_col) not in (None, ""):
            try:
                meta_parts.append(f"{float(rec[fte_col]):.1f} FTE")
            except (TypeError, ValueError):
                pass
        if country_col and rec.get(country_col):
            meta_parts.append(str(rec[country_col]))
        if meta_parts:
            parts.append(
                f'<text x="{x + 12:.1f}" y="{y + 116:.1f}" font-size="10" '
                f'fill="{TEXT_SECONDARY}">{escape(" · ".join(meta_parts))}</text>'
            )

    parts.append("</g></svg>")
    return "".join(parts)
