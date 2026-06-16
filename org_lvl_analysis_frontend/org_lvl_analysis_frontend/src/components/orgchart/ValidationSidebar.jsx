import React, { useState, useMemo } from "react";
import { AM } from "./orgChartTheme";
import { flattenIssues } from "./validateScenarioClient";

const ISSUE_LABELS = {
  closed_manager_has_reports: "Closed manager has open reports",
  orphaned_position:          "Orphaned position",
  circular_reference:         "Circular reference",
  duplicate_id:               "Duplicate ID",
  self_report:                "Self-report",
  missing_change_reason:      "Missing change reason",
};

/**
 * Collapsible validation sidebar anchored to the left edge of the canvas.
 *
 * Collapsed:  a small red/amber pill badge showing total issue count.
 * Expanded:   a 300px panel listing issues grouped by severity.
 *
 * Props:
 *   nodeIssuesMap  Map<empId, Issue[]>   — from validateRecordsClient
 *   onJumpToNode   (empId) => void       — pan + select the node
 */
export default function ValidationSidebar({ nodeIssuesMap, onJumpToNode }) {
  const [expanded, setExpanded] = useState(false);

  const issues = useMemo(() => flattenIssues(nodeIssuesMap), [nodeIssuesMap]);

  const errorCount   = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const total        = issues.length;

  if (total === 0) {
    // Show a small green "all clear" pill that fades after first mount
    return (
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 200,
          background: AM.success,
          color: "#fff",
          borderRadius: 12,
          padding: "4px 12px",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "'IBM Plex Sans', sans-serif",
          boxShadow: "0 2px 8px rgba(22,163,74,0.3)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          pointerEvents: "none",
          opacity: 0.85,
        }}
      >
        <CheckIcon /> No issues
      </div>
    );
  }

  const badgeColor = errorCount > 0 ? AM.danger : "#d97706";

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        title="View validation issues"
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 200,
          background: badgeColor,
          color: "#fff",
          border: "none",
          borderRadius: 12,
          padding: "5px 12px",
          fontSize: 11,
          fontWeight: 800,
          fontFamily: "'IBM Plex Sans', sans-serif",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
        }}
      >
        <WarnIcon />
        {errorCount > 0 && `${errorCount} error${errorCount !== 1 ? "s" : ""}`}
        {errorCount > 0 && warningCount > 0 && " · "}
        {warningCount > 0 && `${warningCount} warning${warningCount !== 1 ? "s" : ""}`}
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 200,
        width: 300,
        maxHeight: "calc(100% - 48px)",
        background: AM.white,
        border: `1px solid ${AM.border}`,
        borderRadius: 12,
        boxShadow: "0 4px 24px rgba(1,36,74,0.15)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'IBM Plex Sans', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: badgeColor,
          color: "#fff",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Validation Issues</div>
          <div style={{ fontSize: 10, opacity: 0.85, marginTop: 1 }}>
            {errorCount > 0 && `${errorCount} error${errorCount !== 1 ? "s" : ""}`}
            {errorCount > 0 && warningCount > 0 && " · "}
            {warningCount > 0 && `${warningCount} warning${warningCount !== 1 ? "s" : ""}`}
          </div>
        </div>
        <button
          onClick={() => setExpanded(false)}
          style={{
            background: "rgba(255,255,255,0.2)",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 700,
            padding: "2px 7px",
            lineHeight: 1.4,
          }}
        >
          ×
        </button>
      </div>

      {/* Issue list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {issues.map((issue, i) => (
          <IssueRow
            key={`${issue.empId}-${issue.type}-${i}`}
            issue={issue}
            onJump={() => {
              onJumpToNode?.(issue.empId);
            }}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: "7px 14px",
          borderTop: `1px solid ${AM.border}`,
          fontSize: 10,
          color: AM.textMuted,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        Click a row to jump to the node
      </div>
    </div>
  );
}

function IssueRow({ issue, onJump }) {
  const isError = issue.severity === "error";
  const color   = isError ? AM.danger : "#d97706";
  const label   = ISSUE_LABELS[issue.type] || issue.type;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJump(); } }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 14px",
        cursor: "pointer",
        borderBottom: `1px solid ${AM.borderLight}`,
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = AM.borderLight)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          marginTop: 5,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: AM.textPrimary }}>{label}</div>
        <div style={{ fontSize: 10, color: AM.textSecondary, marginTop: 1, lineHeight: 1.4 }}>
          {issue.description}
        </div>
        <div
          style={{
            fontSize: 9,
            color: AM.textMuted,
            fontFamily: "'IBM Plex Mono', monospace",
            marginTop: 2,
          }}
        >
          {issue.empId}
        </div>
      </div>
      <svg
        width={10}
        height={10}
        viewBox="0 0 24 24"
        fill="none"
        stroke={AM.textMuted}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 4 }}
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </div>
  );
}

function WarnIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
