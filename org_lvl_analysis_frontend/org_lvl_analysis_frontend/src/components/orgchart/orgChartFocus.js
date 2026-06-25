// Zoom levels and pan math for org-chart node focus / navigation.

import { CARD_WIDTH, CARD_HEIGHT } from "./orgChartLayout";

/** Zoom when focusing a specific employee (search, jump-from-spans, validation). */
export const FOCUS_ZOOM = 0.90;

/** Zoom when first entering the org chart at the root / top-level position. */
export const ROOT_ENTRY_ZOOM = 0.80;

/** Visual scale applied to the focused card on top of viewport zoom. */
export const FOCUSED_CARD_SCALE = 0.85;

/*
 * Compute pan offsets so a node center lands near the viewport center.
 * Returns { panX, panY } in screen pixels for the stage transform.
 */
export function computeFocusPan(nodePos, viewport, zoom, { verticalBias = 0.38 } = {}) {
  const vw = viewport.width || 1200;
  const vh = viewport.height || 800;
  const cx = nodePos.x + CARD_WIDTH / 2;
  const cy = nodePos.y + CARD_HEIGHT / 2;
  return {
    panX: vw / 2 - cx * zoom,
    panY: vh * verticalBias - cy * zoom,
  };
}
