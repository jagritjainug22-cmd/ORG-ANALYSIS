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
  isSameLevelDrop,
} from "./orgChartLayout";
import { FOCUSED_CARD_SCALE } from "./orgChartFocus";

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
  focused,
  isMultiSelected,
  isContext,
  issues,
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
  onClone,
  onCollapseToggle,
  collapsed,
  hasChildren,
  hiddenCount,
  activeDragId,
  dragDescendants,
  dragOldParentLevel,
  dragSrcLevel,
  mutationState,
}) {
  const empId = String(record.__emp_id ?? record[empCol] ?? "");
  const flagged = !!record.is_flagged_removed;
  const added = !!record.is_added;
  const moved = !!mutationState?.moved;
  const edited = !!mutationState?.edited;
  const cloned = !!mutationState?.cloned;

  const hasError   = issues?.some((i) => i.severity === "error");
  const hasWarning = !hasError && issues?.some((i) => i.severity === "warning");
  const issueCount = issues?.length ?? 0;
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
  const isSameLevel =
    dragOldParentLevel != null &&
    isSameLevelDrop(level, dragOldParentLevel, dragSrcLevel);
  const isDownward =
    dragOldParentLevel != null && isDownwardDrop(level, dragOldParentLevel, dragSrcLevel);
  // Same-level targets are valid but warn (amber); pure downward/self/descendant are invalid
  const isValidTarget = isOver && !isDescendant && !isSelf && !isDownward;
  const isWarnTarget = isOver && isSameLevel && !isDescendant && !isSelf;
  const isInvalidTarget = isOver && (isDescendant || isSelf || isDownward) && !isSameLevel;

  const title = record[jobTitleCol] || record["Job Title"] || record.jobTitle || empId;
  const fte = fteCol ? Number(record[fteCol] || 0) : null;
  const country =
    countryCol && record[countryCol]
      ? `${record.Country_Flag ? record.Country_Flag + " " : ""}${record[countryCol]}`
      : null;

  const cost = flcCol ? Number(record[flcCol] || 0) : null;
  const subtreeCost = stats ? stats.cost : cost || 0;
  const reportsLabel = stats?.headcount > 1 ? `${stats.headcount - 1} reports` : "0 reports";

  const borderColor = focused || selected
    ? AM.gold
    : isMultiSelected
    ? "#2563eb"
    : isWarnTarget
    ? "#d97706"
    : isValidTarget
    ? AM.gold
    : isInvalidTarget
    ? AM.danger
    : hasError
    ? AM.danger
    : hasWarning
    ? "#d97706"
    : flagged
    ? AM.danger
    : added
    ? AM.success
    : AM.border;
  const borderStyle = (isValidTarget || isWarnTarget || (isContext && !selected && !focused)) ? "dashed" : "solid";

  const portColor = isWarnTarget
    ? "#d97706"
    : isValidTarget
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
        onSelect?.(empId, e);
      }}
      className="org-node-card"
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        opacity: flagged ? 0.55 : (isSelf && activeDragId) ? 0.4 : isContext ? 0.50 : 1,
        cursor: isInvalidTarget
          ? "not-allowed"
          : isWarnTarget
          ? "copy"
          : editMode && !flagged
          ? isDragging ? "grabbing" : "grab"
          : "pointer",
        fontFamily: "Inter, system-ui, sans-serif",
        transition: "opacity 0.15s ease-out, transform 0.2s ease-out",
        transform: focused ? `scale(${FOCUSED_CARD_SCALE})` : undefined,
        transformOrigin: "50% 50%",
        zIndex: focused ? 30 : selected ? 10 : 1,
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

      {/* Issue badge — top-left corner */}
      {issueCount > 0 && (
        <div
          title={`${issueCount} validation issue${issueCount !== 1 ? "s" : ""}`}
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: hasError ? AM.danger : "#d97706",
            color: "#fff",
            fontSize: 9,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 5px",
            zIndex: 5,
            pointerEvents: "none",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {issueCount}
        </div>
      )}

      {/* Multi-select checkbox overlay */}
      {isMultiSelected && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 18,
            height: 18,
            borderRadius: 4,
            background: "#2563eb",
            border: "2px solid #fff",
            boxShadow: "0 1px 3px rgba(37,99,235,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,6 5,9 10,3" />
          </svg>
        </div>
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
          boxShadow: focused
            ? `0 0 0 4px ${AM.gold}55, 0 8px 28px rgba(197,168,74,0.35), 0 4px 16px rgba(1,36,74,0.2)`
            : selected
            ? `0 0 0 3px ${AM.gold}33, 0 4px 14px rgba(1,36,74,0.15)`
            : isMultiSelected
            ? "0 0 0 3px #2563eb33, 0 4px 14px rgba(37,99,235,0.15)"
            : hasError
            ? "0 0 0 3px rgba(220,38,38,0.2), 0 4px 14px rgba(220,38,38,0.12)"
            : hasWarning
            ? "0 0 0 3px rgba(217,119,6,0.2), 0 4px 10px rgba(217,119,6,0.1)"
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
          {!flagged && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 2 }}>
              {moved && <MutationDot color="#2563eb" title="Moved" />}
              {edited && <MutationDot color="#d97706" title="Edited" />}
              {(added || cloned) && <MutationDot color={AM.success} title={cloned ? "Cloned" : "Added"} />}
            </span>
          )}
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
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
              fontFamily: "Inter, system-ui, sans-serif",
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
                fontFamily: "Inter, system-ui, sans-serif",
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
        {editMode && (
          <ToolbarBtn title="Clone position" onClick={(e) => { e.stopPropagation(); onClone?.(empId); }} disabled={flagged}>
            <CloneIcon />
          </ToolbarBtn>
        )}
        {hasChildren && (
          <ToolbarBtn
            title={collapsed ? "Expand children" : "Collapse children"}
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
          title="Expand children"
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

      {/* View-mode collapse button — pill badge matching the +hidden style, sits below
          the card so it never overlaps card body content. Only shown when expanded and
          not in edit mode (the toolbar handles it there). */}
      {hasChildren && !collapsed && !editMode && (
        <div
          onClick={(e) => { e.stopPropagation(); onCollapseToggle?.(empId); }}
          title="Collapse children"
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
          Collapse
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
  if (prev.focused !== next.focused) return false;
  if (prev.isMultiSelected !== next.isMultiSelected) return false;
  if (prev.issues !== next.issues) return false;
  if (prev.editMode !== next.editMode) return false;
  if (prev.collapsed !== next.collapsed) return false;
  if (prev.hasChildren !== next.hasChildren) return false;
  if (prev.hiddenCount !== next.hiddenCount) return false;
  if (prev.activeDragId !== next.activeDragId) return false;
  if (prev.dragDescendants !== next.dragDescendants) return false;
  if (prev.dragOldParentLevel !== next.dragOldParentLevel) return false;
  if (prev.dragSrcLevel !== next.dragSrcLevel) return false;
  if (prev.mutationState !== next.mutationState) return false;
  return true;
});
export default OrgNodeCard;

function MutationDot({ color, title }) {
  return (
    <span
      title={title}
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
        boxShadow: `0 0 0 1px ${AM.white}`,
      }}
    />
  );
}

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

function CloneIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
