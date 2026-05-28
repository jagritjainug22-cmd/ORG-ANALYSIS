import React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AM, headerColorForLevel, headerLabel } from "./orgChartTheme";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  PORT_RADIUS,
  fmtCompactCurrency,
  fmtNumber,
  isDownwardDrop,
} from "./orgChartLayout";

/**
 * Option D card: navy header stripe + white body. Hover-reveal toolbar.
 *
 * Visual states:
 *   - default:  white body, navy header
 *   - hovered:  toolbar fades in
 *   - selected: gold border + raised shadow
 *   - flagged:  red-tinted header, faded body, strikethrough title
 *   - validTarget: gold solid outline + gold-filled port with glow
 *   - invalidTarget: red outline + not-allowed cursor (self/descendant/downward)
 *
 * Wrapped in React.memo because a single org chart can mount thousands of
 * these cards. Without memo, every pan/zoom or unrelated parent re-render
 * would reconcile every card.
 */
function OrgNodeCardImpl({
  record,
  position,
  stats,
  selected,
  editMode,
  jobTitleCol,
  empCol,
  fteCol,
  flcCol,
  countryCol,
  onSelect,
  onStartEdit,
  onFlagToggle,
  onAddChild,
  onCollapseToggle,
  collapsed,
  hasChildren,
  hiddenCount,
  activeDragId,
  dragDescendants,
  // dragOldParentLevel mirrors dragOldParentLevelRef -- they must stay in sync.
  dragOldParentLevel,
}) {
  const empId = String(record.__emp_id ?? record[empCol] ?? "");
  const flagged = !!record.is_flagged_removed;
  const level = Number(record.Level) || 0;
  const header = headerColorForLevel(level);
  const headerLbl = headerLabel(record, level, jobTitleCol);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: empId,
    disabled: !editMode || flagged,
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: empId,
    disabled: !editMode,
  });

  const isSelf = activeDragId === empId;
  const isDescendant = !!dragDescendants?.has(empId);
  const isDownward =
    dragOldParentLevel != null && isDownwardDrop(level, dragOldParentLevel);
  const isValidTarget = isOver && !isDescendant && !isSelf && !isDownward;
  const isInvalidTarget = isOver && (isDescendant || isSelf || isDownward);

  const title = record[jobTitleCol] || record["Job Title"] || record.jobTitle || empId;
  const fte = fteCol ? Number(record[fteCol] || 0) : null;
  const country =
    countryCol && record[countryCol]
      ? `${record.Country_Flag ? record.Country_Flag + " " : ""}${record[countryCol]}`
      : null;

  const cost = flcCol ? Number(record[flcCol] || 0) : null;
  const subtreeCost = stats ? stats.cost : cost || 0;
  const reportsLabel = stats?.headcount > 1 ? `${stats.headcount - 1} reports` : "0 reports";

  const borderColor = selected
    ? AM.gold
    : isValidTarget
    ? AM.gold
    : isInvalidTarget
    ? AM.danger
    : flagged
    ? AM.danger
    : AM.border;
  const borderStyle = isValidTarget ? "dashed" : "solid";

  const portColor = isValidTarget
    ? AM.gold
    : isInvalidTarget
    ? AM.danger
    : flagged
    ? AM.danger
    : AM.navy;
  const portBg = AM.white;

  const mergedRef = (node) => {
    setDragRef(node);
    setDropRef(node);
  };

  return (
    <div
      ref={mergedRef}
      data-emp-id={empId}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(empId);
      }}
      className="org-node-card"
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        opacity: flagged ? 0.55 : (isSelf && activeDragId) ? 0.4 : 1,
        cursor: isInvalidTarget
          ? "not-allowed"
          : editMode && !flagged
          ? isDragging ? "grabbing" : "grab"
          : "pointer",
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        transition: "opacity 0.15s ease-out",
        userSelect: "none",
      }}
    >
      <ConnectionPort
        position="top"
        color={portColor}
        bg={portBg}
        active={isValidTarget}
      />
      {hasChildren && (
        <ConnectionPort
          position="bottom"
          color={portColor}
          bg={portBg}
          active={false}
        />
      )}

      {/* The actual rounded card visual. overflow:hidden clips the inner
          header/toolbar to the rounded corners; the ports above sit outside
          this clipped region. */}
      <div
        style={{
          width: "100%",
          height: "100%",
          background: AM.cardBg,
          borderRadius: 10,
          border: `2px ${borderStyle} ${borderColor}`,
          boxShadow: selected
            ? `0 0 0 3px ${AM.gold}33, 0 4px 14px rgba(1,36,74,0.15)`
            : "0 1px 4px rgba(1,36,74,0.08)",
          transition: "border-color 0.15s, box-shadow 0.15s",
          overflow: "hidden",
          position: "relative",
        }}
      >
      {/* Navy header stripe */}
      <div
        style={{
          background: flagged ? AM.danger : header.bg,
          color: AM.white,
          padding: "6px 12px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 28,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: header.dot,
              display: "inline-block",
            }}
          />
          {headerLbl}
        </span>
        {flagged && (
          <span
            style={{
              fontSize: 9,
              background: AM.white,
              color: AM.danger,
              padding: "1px 6px",
              borderRadius: 3,
              fontWeight: 700,
              letterSpacing: "0.6px",
            }}
          >
            FLAGGED
          </span>
        )}
      </div>

      {/* White body */}
      <div style={{ padding: "8px 12px 6px", position: "relative" }}>
        <div
          title={title}
          style={{
            color: AM.textPrimary,
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.3,
            textDecoration: flagged ? "line-through" : "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11.5,
            color: AM.textSecondary,
            fontWeight: 500,
            marginTop: 2,
          }}
        >
          {empId}
        </div>

        <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
          <span
            style={{
              background: AM.navy,
              color: AM.white,
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {reportsLabel}
          </span>
          {flcCol && (
            <span
              style={{
                background: AM.gold,
                color: AM.navy,
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 4,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {fmtCompactCurrency(subtreeCost)}
            </span>
          )}
        </div>

        <div
          style={{
            fontSize: 11.5,
            color: AM.textSecondary,
            fontWeight: 500,
            marginTop: 6,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {fte != null && <span>{fmtNumber(fte)} FTE</span>}
          {country && (
            <>
              {fte != null && <span style={{ color: AM.textMuted }}>·</span>}
              <span>{country}</span>
            </>
          )}
        </div>
      </div>

      {/* Toolbar: hover-reveal by default, always visible in Edit Mode for discoverability */}
      <div
        className="org-node-toolbar"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 28,
          background: AM.borderLight,
          borderTop: `1px solid ${AM.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: editMode ? 1 : 0,
          transition: "opacity 0.15s",
          pointerEvents: editMode ? "auto" : "none",
        }}
      >
        {editMode && (
          <ToolbarBtn title="Edit" onClick={(e) => { e.stopPropagation(); onStartEdit?.(empId); }} disabled={flagged}>
            <PencilIcon />
          </ToolbarBtn>
        )}
        {editMode && (
          <ToolbarBtn
            title={flagged ? "Restore" : "Flag as removed"}
            onClick={(e) => { e.stopPropagation(); onFlagToggle?.(empId, !flagged); }}
            tone={flagged ? "success" : "danger"}
          >
            {flagged ? <RestoreIcon /> : <FlagIcon />}
          </ToolbarBtn>
        )}
        {editMode && (
          <ToolbarBtn title="Add direct report" onClick={(e) => { e.stopPropagation(); onAddChild?.(empId); }} disabled={flagged}>
            <PlusIcon />
          </ToolbarBtn>
        )}
        {hasChildren && (
          <ToolbarBtn
            title={collapsed ? "Expand" : "Collapse"}
            onClick={(e) => { e.stopPropagation(); onCollapseToggle?.(empId); }}
          >
            {collapsed ? <ExpandIcon /> : <CollapseIcon />}
          </ToolbarBtn>
        )}
      </div>
      </div>
      {/* End inner clipped card */}

      {collapsed && hiddenCount > 0 && (
        <div
          onClick={(e) => { e.stopPropagation(); onCollapseToggle?.(empId); }}
          style={{
            position: "absolute",
            left: "50%",
            bottom: -22,
            transform: "translateX(-50%)",
            background: AM.navy,
            color: AM.white,
            fontSize: 9,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 8,
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
            zIndex: 3,
          }}
        >
          +{hiddenCount} hidden
        </div>
      )}
    </div>
  );
}

/**
 * Small circular port indicator that anchors connectors. Half of the port
 * sits above/below the card border so the SVG paths (whose endpoints are
 * shifted by PORT_OFFSET to match) connect cleanly to its center.
 */
function ConnectionPort({ position, color, bg, active }) {
  const size = PORT_RADIUS * 2;
  const isTop = position === "top";
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        [isTop ? "top" : "bottom"]: -PORT_RADIUS,
        transform: "translateX(-50%)",
        width: size,
        height: size,
        borderRadius: "50%",
        background: active ? color : bg,
        border: `2px solid ${color}`,
        boxShadow: active
          ? `0 0 0 4px ${color}33, 0 1px 3px rgba(1,36,74,0.25)`
          : "0 1px 2px rgba(1,36,74,0.18)",
        pointerEvents: "none",
        transition: "transform 0.15s, box-shadow 0.15s, background 0.15s",
        zIndex: 4,
      }}
    />
  );
}

const OrgNodeCard = React.memo(OrgNodeCardImpl, (prev, next) => {
  if (prev.record !== next.record) return false;
  if (prev.position.x !== next.position.x || prev.position.y !== next.position.y) return false;
  if (prev.stats !== next.stats) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.editMode !== next.editMode) return false;
  if (prev.collapsed !== next.collapsed) return false;
  if (prev.hasChildren !== next.hasChildren) return false;
  if (prev.hiddenCount !== next.hiddenCount) return false;
  if (prev.activeDragId !== next.activeDragId) return false;
  if (prev.dragDescendants !== next.dragDescendants) return false;
  if (prev.dragOldParentLevel !== next.dragOldParentLevel) return false;
  return true;
});
export default OrgNodeCard;

function ToolbarBtn({ children, onClick, title, disabled, tone }) {
  const color =
    tone === "danger"
      ? AM.danger
      : tone === "success"
      ? AM.success
      : AM.textSecondary;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        border: "none",
        padding: "3px 6px",
        cursor: disabled ? "not-allowed" : "pointer",
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = AM.white; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function PencilIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 21V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
