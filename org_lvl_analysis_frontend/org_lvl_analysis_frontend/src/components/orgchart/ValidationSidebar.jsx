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
 * Collapsible validation sidebar — navigation only.
 *
 * Shows a compact list of issues. Clicking any row pans to the node and
 * selects it so the user can open the detail panel on the right to fix it.
 * All fix UI lives in OrgDetailPanel, not here.
 *
 * Issues can be individually dismissed ("Ignore") or dismissed in bulk
 * ("Ignore all") so the chart/badge can be made to look clean without
 * requiring every underlying data issue to be fixed first. The same
 * ignore/restore actions are also available on the employee detail card and
 * via multi-select — this component doesn't own the ignore state itself,
 * it's lifted up to OrgChart (see useIgnoredIssues) so it stays in sync
 * everywhere.
 *
 * Props:
 *   nodeIssuesMap  Map<empId, Issue[]>   — already filtered to VISIBLE (non-ignored) issues
 *   onJumpToNode   (empId) => void       — pan + select the node
 *   ignoredCount   number                — how many issues are currently hidden
 *   onIgnoreIssue  (empId, issue) => void
 *   onIgnoreMany   (pairs: {empId, issue}[]) => void
 *   onRestoreAll   () => void
 */
export default function ValidationSidebar({
  nodeIssuesMap,
  onJumpToNode,
  ignoredCount = 0,
  onIgnoreIssue,
  onIgnoreMany,
  onRestoreAll,
}) {
  const [expanded, setExpanded] = useState(false);

  const issues = useMemo(() => flattenIssues(nodeIssuesMap), [nodeIssuesMap]);

  const errorCount   = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const total        = issues.length;

  const ignoreAll = () => {
    onIgnoreMany?.(issues.map((i) => ({ empId: i.empId, issue: i })));
  };

  if (total === 0) {
    return (
      <div style={{
        position: "absolute", top: 16, left: 16, zIndex: 200,
        display: "flex", alignItems: "center", gap: 6,
        fontFamily: "Inter, system-ui, sans-serif",
      }}>
        <div style={{
          background: AM.success, color: "#fff", borderRadius: 12,
          padding: "4px 12px", fontSize: 11, fontWeight: 700,
          boxShadow: "0 2px 8px rgba(22,163,74,0.3)",
          display: "flex", alignItems: "center", gap: 6,
          opacity: 0.9,
        }}>
          <CheckIcon /> No issues
        </div>
        {ignoredCount > 0 && (
          <button
            onClick={onRestoreAll}
            title="Show ignored validation issues again"
            style={{
              background: AM.white, color: AM.textSecondary,
              border: `1px solid ${AM.border}`, borderRadius: 12,
              padding: "4px 10px", fontSize: 10, fontWeight: 700,
              cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            {ignoredCount} ignored · Restore
          </button>
        )}
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
          position: "absolute", top: 16, left: 16, zIndex: 200,
          background: badgeColor, color: "#fff", border: "none",
          borderRadius: 12, padding: "5px 12px", fontSize: 11, fontWeight: 800,
          fontFamily: "Inter, system-ui, sans-serif", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
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
    <div style={{
      position: "absolute", top: 16, left: 16, zIndex: 200,
      width: 300, maxHeight: "calc(100% - 48px)",
      background: AM.white, border: `1px solid ${AM.border}`,
      borderRadius: 12, boxShadow: "0 4px 24px rgba(1,36,74,0.15)",
      display: "flex", flexDirection: "column",
      fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        background: badgeColor, color: "#fff",
        padding: "10px 14px",
        display: "flex", alignItems: "center",
        justifyContent: "space-between", flexShrink: 0,
      }}>
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
            background: "rgba(255,255,255,0.2)", border: "none",
            borderRadius: 6, color: "#fff", cursor: "pointer",
            fontSize: 14, fontWeight: 700, padding: "2px 7px", lineHeight: 1.4,
          }}
        >×</button>
      </div>

      {/* Bulk actions */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 14px", borderBottom: `1px solid ${AM.borderLight}`,
        background: "#fafbfc", flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: AM.textMuted }}>
          {ignoredCount > 0 ? `${ignoredCount} ignored` : "Dismiss issues to hide them"}
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          {ignoredCount > 0 && (
            <button
              onClick={onRestoreAll}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 700, color: AM.blue,
                padding: 0,
              }}
            >
              Restore all
            </button>
          )}
          <button
            onClick={ignoreAll}
            title="Ignore all current issues so the chart looks clean"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 10, fontWeight: 700, color: AM.textSecondary,
              padding: 0,
            }}
          >
            Ignore all
          </button>
        </div>
      </div>

      {/* Issue list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {issues.map((issue, i) => (
          <IssueRow
            key={`${issue.empId}-${issue.type}-${i}`}
            issue={issue}
            onJump={() => onJumpToNode?.(issue.empId)}
            onIgnore={() => onIgnoreIssue?.(issue.empId, issue)}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: "7px 14px",
        borderTop: `1px solid ${AM.border}`,
        fontSize: 10, color: AM.textMuted,
        textAlign: "center", flexShrink: 0,
      }}>
        Click a row to jump to the node, then open it to fix
      </div>
    </div>
  );
}

function IssueRow({ issue, onJump, onIgnore }) {
  const isError  = issue.severity === "error";
  const color    = isError ? AM.danger : "#d97706";
  const label    = ISSUE_LABELS[issue.type] || issue.type;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJump(); } }}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "8px 14px", cursor: "pointer",
        borderBottom: `1px solid ${AM.borderLight}`,
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = AM.borderLight)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: color, flexShrink: 0, marginTop: 5,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: AM.textPrimary }}>{label}</div>
        <div style={{ fontSize: 10, color: AM.textSecondary, marginTop: 1, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {issue.description}
        </div>
        <div style={{ fontSize: 9, color: AM.textMuted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", marginTop: 2 }}>
          {issue.empId}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onIgnore(); }}
        title="Ignore this issue"
        style={{
          flexShrink: 0, marginTop: 2,
          background: "none", border: `1px solid ${AM.border}`, borderRadius: 6,
          color: AM.textMuted, cursor: "pointer",
          fontSize: 9, fontWeight: 700, padding: "2px 6px", lineHeight: 1.4,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = AM.textPrimary; e.currentTarget.style.borderColor = AM.textMuted; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = AM.textMuted; e.currentTarget.style.borderColor = AM.border; }}
      >
        Ignore
      </button>
      <svg width={10} height={10} viewBox="0 0 24 24" fill="none"
        stroke={AM.textMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
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
