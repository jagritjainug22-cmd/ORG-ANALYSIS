import React from "react";
import { AM } from "./orgChartTheme";

const ISSUE_META = {
  closed_manager_has_reports: {
    label: "Closed manager has open reports",
    icon: "⚠",
    color: "#dc2626",
  },
  orphaned_add: {
    label: "Orphaned added position",
    icon: "⚠",
    color: "#dc2626",
  },
  self_report: {
    label: "Self-report",
    icon: "⚠",
    color: "#dc2626",
  },
  missing_change_reason: {
    label: "Missing Change Reason",
    icon: "○",
    color: "#d97706",
  },
};

/**
 * Slide-in panel that lists validation issues for the active scenario.
 * Clicking an issue row fires `onJumpToNode(emp_id)`.
 */
export default function ValidationPanel({ open, issues, onClose, onJumpToNode }) {
  if (!open) return null;

  const errors   = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        background: AM.white,
        borderLeft: `1px solid ${AM.border}`,
        boxShadow: "-4px 0 24px rgba(1,36,74,0.12)",
        zIndex: 500,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: `1px solid ${AM.border}`,
          background: AM.navy,
          color: AM.white,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Validation Results</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
            {errors.length} error{errors.length !== 1 ? "s" : ""},&nbsp;
            {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: AM.white,
            fontSize: 20,
            cursor: "pointer",
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {issues.length === 0 ? (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              color: AM.success,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            No issues found — scenario looks good!
          </div>
        ) : (
          <>
            {errors.length > 0 && (
              <SectionHeader label="Errors" color="#dc2626" count={errors.length} />
            )}
            {errors.map((issue, i) => (
              <IssueRow key={`e-${i}`} issue={issue} onJump={onJumpToNode} />
            ))}
            {warnings.length > 0 && (
              <SectionHeader label="Warnings" color="#d97706" count={warnings.length} />
            )}
            {warnings.map((issue, i) => (
              <IssueRow key={`w-${i}`} issue={issue} onJump={onJumpToNode} />
            ))}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: "10px 20px",
          borderTop: `1px solid ${AM.border}`,
          fontSize: 11,
          color: AM.textMuted,
          textAlign: "center",
        }}
      >
        Click a row to jump to the node in the chart
      </div>
    </div>
  );
}

function SectionHeader({ label, color, count }) {
  return (
    <div
      style={{
        padding: "6px 20px 4px",
        fontSize: 10,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.7px",
        color,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {label}
      <span
        style={{
          background: color,
          color: "#fff",
          borderRadius: 8,
          padding: "1px 7px",
          fontSize: 9,
          fontWeight: 800,
        }}
      >
        {count}
      </span>
    </div>
  );
}

function IssueRow({ issue, onJump }) {
  const meta = ISSUE_META[issue.issue_type] || {
    label: issue.issue_type,
    icon: "·",
    color: AM.textSecondary,
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onJump?.(issue.emp_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onJump?.(issue.emp_id);
        }
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "9px 20px",
        cursor: "pointer",
        borderBottom: `1px solid ${AM.borderLight}`,
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = AM.borderLight)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: meta.color, fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>
        {meta.icon}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: AM.textPrimary }}>
          {meta.label}
        </div>
        <div style={{ fontSize: 11, color: AM.textSecondary, marginTop: 2 }}>
          {issue.description}
        </div>
        <div
          style={{
            fontSize: 10,
            color: AM.textMuted,
            fontFamily: "'IBM Plex Mono', monospace",
            marginTop: 3,
          }}
        >
          {issue.emp_id}
        </div>
      </div>
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke={AM.textMuted}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </div>
  );
}
