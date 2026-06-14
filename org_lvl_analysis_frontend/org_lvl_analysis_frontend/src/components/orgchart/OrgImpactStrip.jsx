import React, { useState } from "react";
import { AM } from "./orgChartTheme";
import { fmtCompactCurrency, fmtNumber } from "./orgChartLayout";

/**
 * Collapsed: thin strip at bottom of viewport summarising live deltas.
 * Expanded: full Before vs After breakdown plus a change-log table.
 *
 * `summary` shape: { baseline, current, flagged_removed, delta, change_count }
 * `changes` shape: rows from db_service.get_change_log
 */
export default function OrgImpactStrip({ summary, changes }) {
  const [expanded, setExpanded] = useState(false);

  if (!summary) return null;

  const deltaFte = summary.delta?.fte || 0;
  const deltaCost = summary.delta?.cost || 0;
  const deltaHc = summary.delta?.headcount || 0;
  const changeCount = summary.change_count || 0;

  const flaggedCount = summary.flagged_removed?.count || 0;
  const flaggedCost = summary.flagged_removed?.cost || 0;

  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        background: AM.white,
        borderTop: `1px solid ${AM.border}`,
        boxShadow: "0 -2px 8px rgba(1,36,74,0.05)",
        zIndex: 5,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: AM.textPrimary,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12 }}>
          <ImpactPill icon={<TrendIcon />} label={`${changeCount} change${changeCount === 1 ? "" : "s"}`} />
          <Divider />
          <ImpactPill
            label={`${deltaFte >= 0 ? "+" : ""}${fmtNumber(deltaFte.toFixed(1))} FTE`}
            tone={deltaFte === 0 ? "neutral" : deltaFte < 0 ? "success" : "warning"}
          />
          <ImpactPill
            label={`${deltaCost >= 0 ? "+" : ""}${fmtCompactCurrency(deltaCost)} net`}
            tone={deltaCost === 0 ? "neutral" : deltaCost < 0 ? "success" : "warning"}
          />
          {flaggedCount > 0 && (
            <ImpactPill
              label={`${flaggedCount} flagged · ${fmtCompactCurrency(flaggedCost)} saved`}
              tone="danger"
            />
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            color: AM.textSecondary,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {expanded ? "Hide details" : "Show details"}
          <Chevron up={expanded} />
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${AM.borderLight}`, padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 18 }}>
            <ComparisonCard
              label="Baseline"
              headcount={summary.baseline.headcount}
              fte={summary.baseline.total_fte}
              cost={summary.baseline.total_cost}
              tone="neutral"
            />
            <ComparisonCard
              label="Current (To-Be)"
              headcount={summary.current.headcount}
              fte={summary.current.total_fte}
              cost={summary.current.total_cost}
              tone="primary"
            />
            <ComparisonCard
              label="Delta"
              headcount={deltaHc}
              fte={deltaFte}
              cost={deltaCost}
              tone={deltaCost < 0 ? "success" : deltaCost > 0 ? "warning" : "neutral"}
              isDelta
            />
          </div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: AM.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.7px",
              marginBottom: 8,
            }}
          >
            Change Log
          </div>
          {(!changes || changes.length === 0) ? (
            <div style={{ fontSize: 12, color: AM.textMuted, fontStyle: "italic" }}>
              No changes yet. Toggle Edit Mode and drag a card to move someone, or use the flag button to remove a role.
            </div>
          ) : (
            <div style={{ maxHeight: 220, overflow: "auto", border: `1px solid ${AM.borderLight}`, borderRadius: 6 }}>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: AM.borderLight }}>
                    <Th>When</Th>
                    <Th>Action</Th>
                    <Th>Employee</Th>
                    <Th>From → To</Th>
                    <Th>Field / Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {changes
                    .slice()
                    .reverse()
                    .map((c) => (
                      <tr key={c.id} style={{ borderTop: `1px solid ${AM.borderLight}` }}>
                        <Td>{formatTime(c.timestamp)}</Td>
                        <Td>
                          <ActionPill action={c.action} />
                        </Td>
                        <Td mono>{c.emp_id}</Td>
                        <Td mono>
                          {c.action === "move"
                            ? `${c.old_mgr_id || "—"} → ${c.new_mgr_id || "—"}`
                            : "—"}
                        </Td>
                        <Td>
                          {c.action === "edit"
                            ? `${c.field}: ${truncate(c.old_value)} → ${truncate(c.new_value)}`
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImpactPill({ icon, label, tone = "neutral" }) {
  const colors = {
    neutral: { bg: AM.borderLight, fg: AM.textSecondary },
    success: { bg: AM.successLight, fg: AM.success },
    warning: { bg: "#fef3d6", fg: "#8a6d00" },
    danger: { bg: AM.dangerLight, fg: AM.danger },
  }[tone];
  return (
    <span
      style={{
        background: colors.bg,
        color: colors.fg,
        fontSize: 11,
        fontWeight: 600,
        padding: "5px 10px",
        borderRadius: 14,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {icon}
      {label}
    </span>
  );
}

function ComparisonCard({ label, headcount, fte, cost, tone, isDelta }) {
  const accent = {
    neutral: AM.textSecondary,
    primary: AM.navy,
    success: AM.success,
    warning: "#8a6d00",
  }[tone];
  const sign = (n) => (isDelta && n > 0 ? "+" : "");
  return (
    <div
      style={{
        background: AM.white,
        border: `1px solid ${AM.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        borderTop: `3px solid ${accent}`,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          color: accent,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <Row label="Headcount" value={`${sign(headcount)}${fmtNumber(headcount)}`} />
      <Row label="FTE" value={`${sign(fte)}${fmtNumber(Number(fte).toFixed(1))}`} />
      <Row label="Cost" value={`${sign(cost)}${fmtCompactCurrency(cost)}`} bold />
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
      <span style={{ fontSize: 11, color: AM.textMuted }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: bold ? 700 : 500,
          color: AM.textPrimary,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ActionPill({ action }) {
  const map = {
    move: { bg: "#dde7f5", fg: AM.navy, label: "Move" },
    edit: { bg: AM.borderLight, fg: AM.textSecondary, label: "Edit" },
    add: { bg: AM.successLight, fg: AM.success, label: "Add" },
    clone: { bg: "#cffafe", fg: "#0e7490", label: "Clone" },
    flag_remove: { bg: AM.dangerLight, fg: AM.danger, label: "Flag" },
    unflag_restore: { bg: AM.successLight, fg: AM.success, label: "Restore" },
    delete: { bg: AM.dangerLight, fg: AM.danger, label: "Delete" },
  };
  const c = map[action] || { bg: AM.borderLight, fg: AM.textSecondary, label: action };
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: "1px 7px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
      }}
    >
      {c.label}
    </span>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "6px 10px",
        fontSize: 10,
        fontWeight: 700,
        color: AM.textMuted,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono }) {
  return (
    <td
      style={{
        padding: "6px 10px",
        color: AM.textPrimary,
        fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 14, background: AM.border }} />;
}

function Chevron({ up }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d={up ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function truncate(s) {
  if (s === null || s === undefined) return "—";
  const str = String(s);
  return str.length > 24 ? str.slice(0, 22) + "…" : str;
}
