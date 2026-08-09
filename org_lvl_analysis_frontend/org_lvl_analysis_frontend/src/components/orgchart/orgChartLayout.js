// Pure functions for computing OrgSight 2.0 tree layout, subtree stats, and
// bezier connector paths. No React; safe to memoize against record arrays.

export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 138;
export const HORIZONTAL_GAP = 18;
export const VERTICAL_GAP = 60;

// Radius of the connection ports that protrude above/below each card. The
// connector endpoints aim at the port centers, which sit half-outside the
// card border so the arrows clearly originate from / terminate at the dots.
export const PORT_RADIUS = 6;
export const PORT_OFFSET = PORT_RADIUS;

// Multi-row wrapping for managers with lots of LEAF direct reports. When all
// children are leaves AND there are more than this threshold, they get
// stacked into multiple rows to keep the tree narrow. We only do this when
// every child is a leaf so descendant alignment is unaffected.
//
// Enable by lowering MULTIROW_LEAF_THRESHOLD. Defaults are tuned to leave
// multi-row OFF until the connector router learns to route around row 0
// cards when row 1+ children sit directly below them. Until then the
// straight stepPath would visually pass through row 0 cards.
export const MULTIROW_LEAF_THRESHOLD = 9999;
export const MULTIROW_LEAVES_PER_ROW = 5;
export const MULTIROW_ROW_GAP = 28;

/**
 * Pick a vertical gap between levels based on how many levels are currently
 * visible. With only L1-L2 shown, generous spacing makes the arrows obvious;
 * deep trees (L1-L5+) keep the original tight gap so they fit on screen.
 *
 * maxDepth=0 means "all levels", treated like the deepest setting.
 */
export function getVerticalGap(maxDepth) {
  const m = Number(maxDepth);
  if (!m || m <= 0) return 60;
  if (m === 1) return 140;
  if (m === 2) return 110;
  if (m === 3) return 90;
  if (m === 4) return 75;
  return 60;
}

/**
 * Normalize a manager id from raw parentOf() output.
 * null / undefined / blank / whitespace => no manager (true root candidate).
 */
export function normalizeParentKey(parentId) {
  if (parentId == null) return null;
  const key = String(parentId).trim();
  return key ? key : null;
}

/**
 * Build a parent-child index. `idOf` and `parentOf` let the caller use whichever
 * field name the dataset stores employee/manager IDs under (e.g. "Employee ID"
 * vs "ID"); the function gracefully falls back to the __emp_id / __mgr_id
 * fields that db_service.get_scenario_records adds.
 *
 * Returns:
 *   roots       — true top-of-house (no manager listed)
 *   brokenRefs  — manager id present but not found in the dataset (data error);
 *                 these must NOT be laid out as main-tree roots
 */
export function buildIndex(records, idOf, parentOf) {
  const byId = new Map();
  const childrenByParent = new Map();
  const roots = [];
  const brokenRefs = [];

  records.forEach((rec, i) => {
    const id = String(idOf(rec) ?? "");
    if (!id) return;
    byId.set(id, { ...rec, __index: i });
    if (!childrenByParent.has(id)) childrenByParent.set(id, []);
  });

  records.forEach((rec) => {
    const id = String(idOf(rec) ?? "");
    if (!id) return;
    const parentKey = normalizeParentKey(parentOf(rec));
    if (!parentKey) {
      roots.push(id);
    } else if (byId.has(parentKey)) {
      childrenByParent.get(parentKey).push(id);
    } else {
      // Manager listed but missing from dataset — keep out of main roots.
      brokenRefs.push(id);
    }
  });

  return { byId, childrenByParent, roots, brokenRefs };
}

/**
 * Compute subtree aggregates (headcount, FTE, total cost) excluding any
 * records flagged as removed. Useful for showing live stats on manager cards.
 */
export function computeSubtreeStats(records, idOf, parentOf, opts = {}) {
  const fteOf = opts.fteOf || (() => 0);
  const flcOf = opts.flcOf || (() => 0);
  const flaggedOf = opts.flaggedOf || (() => false);

  const { byId, childrenByParent } = buildIndex(records, idOf, parentOf);
  const stats = new Map();
  const computing = new Set(); // cycle guard: nodes currently in the call stack

  function walk(id) {
    if (stats.has(id)) return stats.get(id);
    // Cycle detected — return empty sentinel rather than infinite-looping
    if (computing.has(id)) return { headcount: 0, fte: 0, cost: 0, directReports: 0 };
    computing.add(id);
    const node = byId.get(id);
    if (!node) {
      const empty = { headcount: 0, fte: 0, cost: 0, directReports: 0 };
      stats.set(id, empty);
      computing.delete(id);
      return empty;
    }
    const removed = flaggedOf(node);
    const self = {
      headcount: removed ? 0 : 1,
      fte: removed ? 0 : Number(fteOf(node) || 0),
      cost: removed ? 0 : Number(flcOf(node) || 0),
      directReports: (childrenByParent.get(id) || []).length,
    };
    let total = { ...self };
    (childrenByParent.get(id) || []).forEach((cid) => {
      const c = walk(cid);
      total.headcount += c.headcount;
      total.fte += c.fte;
      total.cost += c.cost;
    });
    stats.set(id, total);
    computing.delete(id);
    return total;
  }

  byId.forEach((_v, id) => walk(id));
  return stats;
}

/**
 * Tidy-tree layout (Reingold-Tilford-style) for an org tree.
 *
 * Returns:
 *   nodes:        Map<id, { x, y, depth }>
 *   width/height: bounding box of the entire tree
 *
 * The algorithm makes one pass to find a "preferred" x for each node based on
 * the average of its children, then sweeps subtrees right if they would
 * collide with their left sibling's subtree. Pure JS, no D3 dependency.
 */
export function layoutTree({
  rootIds,
  childrenByParent,
  collapsed,
  hidden,
  maxDepth,
}) {
  const nodes = new Map();
  const subtreeWidth = new Map();
  // For nodes whose direct children are wrapped into multiple rows, remember
  // how many rows the children consumed so connectors can be drawn correctly.
  const childRowsInfo = new Map();

  const vGap = getVerticalGap(maxDepth);
  const levelStep = CARD_HEIGHT + vGap;

  function getVisibleChildren(id) {
    if (collapsed.has(id)) return [];
    return (childrenByParent.get(id) || []).filter((c) => !hidden.has(c));
  }

  // Children all-leaves AND count > threshold => stack into multiple rows.
  function shouldWrapChildren(kids) {
    if (kids.length <= MULTIROW_LEAF_THRESHOLD) return false;
    return kids.every((k) => getVisibleChildren(k).length === 0);
  }

  const measuring = new Set(); // cycle guard for measure
  function measure(id, depth) {
    if (subtreeWidth.has(id)) return subtreeWidth.get(id); // already measured
    if (measuring.has(id)) { subtreeWidth.set(id, CARD_WIDTH); return CARD_WIDTH; } // cycle → treat as leaf
    measuring.add(id);
    const kids = getVisibleChildren(id);
    if (!kids.length) {
      subtreeWidth.set(id, CARD_WIDTH);
      measuring.delete(id);
      return CARD_WIDTH;
    }
    if (shouldWrapChildren(kids)) {
      // Wrap into rows: width = perRow cards + gaps.
      const perRow = Math.min(MULTIROW_LEAVES_PER_ROW, kids.length);
      kids.forEach((k) => {
        measure(k, depth + 1);
      });
      const rowWidth = perRow * CARD_WIDTH + (perRow - 1) * HORIZONTAL_GAP;
      const w = Math.max(CARD_WIDTH, rowWidth);
      subtreeWidth.set(id, w);
      measuring.delete(id);
      return w;
    }
    let total = 0;
    kids.forEach((kid, i) => {
      total += measure(kid, depth + 1);
      if (i < kids.length - 1) total += HORIZONTAL_GAP;
    });
    const w = Math.max(CARD_WIDTH, total);
    subtreeWidth.set(id, w);
    measuring.delete(id);
    return w;
  }

  const placing = new Set(); // cycle guard for place
  function place(id, leftX, depth) {
    if (placing.has(id)) return; // cycle → skip to prevent infinite recursion
    placing.add(id);
    const kids = getVisibleChildren(id);
    const myWidth = subtreeWidth.get(id);

    if (kids.length && shouldWrapChildren(kids)) {
      // Multi-row leaf placement: split children into rows of MULTIROW_LEAVES_PER_ROW.
      const perRow = Math.min(MULTIROW_LEAVES_PER_ROW, kids.length);
      const rowCount = Math.ceil(kids.length / perRow);
      const childY = depth * levelStep;
      const rowGap = CARD_HEIGHT + MULTIROW_ROW_GAP;

      // First-row child centers are used to anchor the parent over the group.
      const firstRowCount = Math.min(perRow, kids.length);
      const firstRowWidth =
        firstRowCount * CARD_WIDTH + (firstRowCount - 1) * HORIZONTAL_GAP;
      const firstRowStartX = leftX + (myWidth - firstRowWidth) / 2;

      kids.forEach((kid, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const kidsInThisRow = Math.min(perRow, kids.length - row * perRow);
        const thisRowWidth =
          kidsInThisRow * CARD_WIDTH + (kidsInThisRow - 1) * HORIZONTAL_GAP;
        const thisRowStartX = leftX + (myWidth - thisRowWidth) / 2;
        const kidX = thisRowStartX + col * (CARD_WIDTH + HORIZONTAL_GAP);
        const kidYAdjusted = childY + row * rowGap;
        nodes.set(kid, { x: kidX, y: kidYAdjusted, depth: depth + 1, row });
      });

      // Parent x: centered horizontally over the first-row group so the
      // outgoing port lines up with the top row of children.
      const lastFirstRowChildX =
        firstRowStartX + (firstRowCount - 1) * (CARD_WIDTH + HORIZONTAL_GAP);
      const x = (firstRowStartX + lastFirstRowChildX) / 2;
      const y = depth * levelStep;
      nodes.set(id, { x, y, depth });
      childRowsInfo.set(id, { rows: rowCount, perRow });
      placing.delete(id);
      return;
    }

    const totalKidWidth = kids.reduce(
      (acc, k, i) =>
        acc + subtreeWidth.get(k) + (i < kids.length - 1 ? HORIZONTAL_GAP : 0),
      0
    );
    let cursor;
    if (kids.length) {
      cursor = leftX + (myWidth - totalKidWidth) / 2;
    }

    let childCenters = [];
    kids.forEach((kid) => {
      const kidWidth = subtreeWidth.get(kid);
      place(kid, cursor, depth + 1);
      childCenters.push(cursor + kidWidth / 2);
      cursor += kidWidth + HORIZONTAL_GAP;
    });

    let x;
    if (kids.length) {
      const first = childCenters[0];
      const last = childCenters[childCenters.length - 1];
      x = (first + last) / 2 - CARD_WIDTH / 2;
    } else {
      x = leftX + (myWidth - CARD_WIDTH) / 2;
    }

    const y = depth * levelStep;
    nodes.set(id, { x, y, depth });
    placing.delete(id);
  }

  let xOffset = 0;
  rootIds.forEach((rootId) => {
    const w = measure(rootId, 0);
    place(rootId, xOffset, 0);
    xOffset += w + HORIZONTAL_GAP * 3;
  });

  let maxX = 0;
  let maxY = 0;
  nodes.forEach((p) => {
    if (p.x + CARD_WIDTH > maxX) maxX = p.x + CARD_WIDTH;
    if (p.y + CARD_HEIGHT > maxY) maxY = p.y + CARD_HEIGHT;
  });

  return { nodes, width: maxX, height: maxY, childRowsInfo };
}

/**
 * @deprecated Use stepPath(parentPos, childPositions) instead. This per-edge
 * bezier is kept only for reference; nothing in the live UI or backend export
 * calls it any more.
 */
export function bezierPath(parentX, parentY, childX, childY) {
  const px = parentX + CARD_WIDTH / 2;
  const py = parentY + CARD_HEIGHT;
  const cx = childX + CARD_WIDTH / 2;
  const cy = childY;
  const midY = (py + cy) / 2;
  return `M ${px} ${py} C ${px} ${midY}, ${cx} ${midY}, ${cx} ${cy}`;
}

/**
 * Detect if `targetId` is `dragId` or any of its descendants. Used to prevent
 * an employee from being dropped onto themselves or one of their own reports.
 */
export function isDescendant(targetId, dragId, childrenByParent) {
  if (targetId === dragId) return true;
  const queue = [dragId];
  while (queue.length) {
    const cur = queue.shift();
    const kids = childrenByParent.get(cur) || [];
    for (const k of kids) {
      if (k === targetId) return true;
      queue.push(k);
    }
  }
  return false;
}

/**
 * Collect the full set of descendant IDs for a given node (including itself).
 * Used to cache cycle-prevention during drag-and-drop so we don't BFS on
 * every dragOver event.
 */
export function collectDescendants(rootId, childrenByParent) {
  const out = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift();
    for (const k of childrenByParent.get(cur) || []) {
      if (!out.has(k)) {        // cycle guard: only enqueue unseen nodes
        out.add(k);
        queue.push(k);
      }
    }
  }
  return out;
}

/**
 * Build a Set of node IDs that should be auto-collapsed because their depth
 * meets or exceeds `maxDepth`. Used for the level-filter feature: nodes AT
 * maxDepth are visible but their children are hidden (collapsed).
 */
export function autoCollapseAtDepth(rootIds, childrenByParent, maxDepth) {
  if (maxDepth == null || maxDepth <= 0) return new Set();
  const out = new Set();
  function walk(id, depth) {
    if (depth >= maxDepth) {
      const kids = childrenByParent.get(id) || [];
      if (kids.length > 0) out.add(id);
      return;
    }
    for (const kid of childrenByParent.get(id) || []) {
      walk(kid, depth + 1);
    }
  }
  for (const rid of rootIds) walk(rid, 0);
  return out;
}

/**
 * Shared-bus connector from one parent to N children.
 *
 * Emits three segments per parent instead of N independent Z-shapes:
 *   1. One vertical drop from the parent's outgoing port to the bus Y
 *   2. One horizontal trunk spanning from the leftmost to the rightmost
 *      child center (extended to include the parent's x if needed)
 *   3. N short vertical drops from the bus Y to each child's incoming port
 *
 * Endpoints are anchored to the card edges, which is where the visual centers
 * of the `ConnectionPort` dots actually sit (the dots protrude PORT_RADIUS
 * beyond the edge, but their CSS-positioned centers are exactly on the edge).
 *
 * PARITY: the Python function `_shared_bus_path` in orgchart_render_service.py
 * must produce identical SVG path strings for the same inputs. Both use
 * `Math.floor(n + 0.5)` rounding to avoid platform divergence on .5 values.
 *
 * @param {{ x: number, y: number }} parentPos  Layout position of parent card
 * @param {{ x: number, y: number }[]} childPositions  Layout positions of children
 * @returns {string}  SVG path `d` attribute value, or "" if no children
 */
export function stepPath(parentPos, childPositions) {
  if (!childPositions || !childPositions.length) return "";

  const r = (n) => Math.floor(n + 0.5);

  const px = r(parentPos.x + CARD_WIDTH / 2);
  const py = r(parentPos.y + CARD_HEIGHT);

  const childCenters = childPositions.map((c) => ({
    cx: r(c.x + CARD_WIDTH / 2),
    cy: r(c.y),
  }));

  const midY = r(py + (childCenters[0].cy - py) * 0.45);

  if (childCenters.length === 1) {
    const { cx, cy } = childCenters[0];
    return `M ${px} ${py} V ${midY} H ${cx} V ${cy}`;
  }

  const allX = [px, ...childCenters.map((c) => c.cx)];
  const trunkLeft = Math.min(...allX);
  const trunkRight = Math.max(...allX);

  const parts = [];
  parts.push(`M ${px} ${py} V ${midY}`);
  parts.push(`M ${trunkLeft} ${midY} H ${trunkRight}`);
  for (const { cx, cy } of childCenters) {
    parts.push(`M ${cx} ${midY} V ${cy}`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Drop validity & significance checks
// ---------------------------------------------------------------------------

export const SIGNIFICANT_MOVE_SUBTREE_SIZE = 10;
export const SIGNIFICANT_MOVE_LEVEL_DELTA = 2;

/**
 * L1 = top of hierarchy (CEO), higher numbers = less senior.
 * A drop is downward (invalid) when the target's level number exceeds the
 * dragged node's current parent's level number.
 */
export function isDownwardDrop(targetLevel, oldParentLevel) {
  return targetLevel > oldParentLevel;
}

const FUNCTION_COL_CANDIDATES = [
  "Department", "Dept", "Function", "FunctionalL1",
  "Business Unit", "BusinessUnit", "Org",
];

function findFunctionColumn(record) {
  if (!record) return null;
  for (const col of FUNCTION_COL_CANDIDATES) {
    if (record[col] !== undefined && record[col] !== null) return col;
  }
  return null;
}

/**
 * Determine whether a drag-and-drop move is "significant" enough to warrant
 * a confirmation modal. Returns { significant: bool, reasons: string[] }.
 *
 * Three triggers (any one is enough):
 *   1. Subtree size >= SIGNIFICANT_MOVE_SUBTREE_SIZE
 *   2. Cross-function (src and target have different department/function)
 *   3. Level-jump >= SIGNIFICANT_MOVE_LEVEL_DELTA (old parent vs new parent)
 *
 * With downward drops banned, level-jump only fires on upward moves.
 */
export function isSignificantMove(srcId, targetId, index) {
  const reasons = [];
  const srcNode = index.byId.get(srcId);
  const targetNode = index.byId.get(targetId);
  if (!srcNode || !targetNode) return { significant: false, reasons };

  const descendants = collectDescendants(srcId, index.childrenByParent);
  descendants.delete(srcId);
  if (descendants.size >= SIGNIFICANT_MOVE_SUBTREE_SIZE) {
    reasons.push(`subtree-size:${descendants.size}`);
  }

  const funcCol = findFunctionColumn(srcNode);
  if (
    funcCol &&
    srcNode[funcCol] &&
    targetNode[funcCol] &&
    srcNode[funcCol] !== targetNode[funcCol]
  ) {
    reasons.push(`cross-function:${srcNode[funcCol]}\u2192${targetNode[funcCol]}`);
  }

  const oldMgrId = srcNode.__mgr_id;
  const oldMgr = oldMgrId ? index.byId.get(String(oldMgrId)) : null;
  const targetLevel = Number(targetNode.Level) || 0;
  const oldMgrLevel = oldMgr ? Number(oldMgr.Level) || 0 : targetLevel;
  const delta = oldMgrLevel - targetLevel;
  if (delta >= SIGNIFICANT_MOVE_LEVEL_DELTA) {
    reasons.push(`level-jump:L${oldMgrLevel}\u2192L${targetLevel}`);
  }

  return { significant: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a number as a compact currency string (e.g. $450K, $4.2M).
 */
export function fmtCompactCurrency(n) {
  if (n == null || isNaN(n)) return "$0";
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtNumber(n) {
  if (n == null || isNaN(n)) return "0";
  return Number(n).toLocaleString();
}
