import React, { useEffect, useMemo, useState } from "react";
import { AM } from "./orgChartTheme";
import { fmtCompactCurrency, fmtNumber } from "./orgChartLayout";
import { dbGetScenarioSummaryByDim } from "../../api/backend";

/**
 * Collapsed: thin strip at bottom summarising live deltas.
 * Expanded: Baseline vs To-Be totals, dimensional breakdown table, change log.
 */
export default function OrgImpactStrip({
  summary,
  changes,
  scenarioId = null,
  dimensionColumns = [],
  onExportChanges,
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedDim, setSelectedDim] = useState("");
  const [breakdown, setBreakdown] = useState(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState("");
  const [sortKey, setSortKey] = useState("dimension_value");
  const [sortAsc, setSortAsc] = useState(true);

  const dims = useMemo(() => {
    const preferred = ["Country", "Department", "Division", "Grade", "Job Grade", "Location", "Level"];
    const ordered = [];
    for (const p of preferred) {
      if (dimensionColumns.includes(p)) ordered.push(p);
    }
    for (const c of dimensionColumns) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }, [dimensionColumns]);

  useEffect(() => {
    if (!dims.length) {
      setSelectedDim("");
      return;
    }
    setSelectedDim((prev) => (prev && dims.includes(prev) ? prev : dims[0]));
  }, [dims]);

  useEffect(() => {
    if (!expanded || !scenarioId || !selectedDim) {
      setBreakdown(null);
      return;
    }
    let cancelled = false;
    setBreakdownLoading(true);
    setBreakdownError("");
    (async () => {
      try {
        const resp = await dbGetScenarioSummaryByDim(scenarioId, selectedDim);
        if (!cancelled) setBreakdown(resp.breakdown || null);
      } catch (e) {
        if (!cancelled) {
          setBreakdownError(e?.response?.data?.detail || e.message || "Failed to load breakdown");
          setBreakdown(null);
        }
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, scenarioId, selectedDim]);

  if (!summary) return null;

  const deltaFte = summary.delta?.fte || 0;
  const deltaCost = summary.delta?.cost || 0;
  const deltaHc = summary.delta?.headcount || 0;
  const changeCount = summary.change_count || 0;
  const flaggedCount = summary.flagged_removed?.count || 0;
  const flaggedCost = summary.flagged_removed?.cost || 0;

  const sortedRows = useMemo(() => {
    if (!breakdown?.rows) return [];
    const rows = [...breakdown.rows];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [breakdown, sortKey, sortAsc]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  };

  const showDimBreakdown = scenarioId && dims.length > 0;

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
        <span style={{ fontSize: 11, color: AM.textSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          {expanded ? "Hide details" : "Show details"}
          <Chevron up={expanded} />
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${AM.borderLight}`, padding: 20 }}>
          {/* Totals row */}
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

          {/* Dimensional breakdown */}
          {showDimBreakdown && (
            <div style={{ marginBottom: 18 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 10, flexWrap: "wrap", gap: 10,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={sectionLabel()}>Breakdown by</span>
                  <select
                    value={selectedDim}
                    onChange={(e) => setSelectedDim(e.target.value)}
                    style={{
                      border: `1px solid ${AM.border}`,
                      borderRadius: 6,
                      padding: "5px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      color: AM.navy,
                      background: AM.white,
                      cursor: "pointer",
                    }}
                  >
                    {dims.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  {breakdownLoading && (
                    <span style={{ fontSize: 11, color: AM.textMuted }}>Loading…</span>
                  )}
                </div>
                {onExportChanges && (
                  <button
                    onClick={onExportChanges}
                    style={{
                      border: `1px solid ${AM.border}`,
                      background: AM.white,
                      color: AM.navy,
                      borderRadius: 6,
                      padding: "5px 12px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ↓ Export full report (Excel)
                  </button>
                )}
              </div>

              {breakdownError && (
                <div style={{ fontSize: 12, color: AM.danger, marginBottom: 8 }}>{breakdownError}</div>
              )}

              {!breakdownLoading && breakdown && (
                <div style={{ border: `1px solid ${AM.border}`, borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ overflow: "auto", maxHeight: 260 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: AM.navy, color: AM.white }}>
                          <SortTh label={selectedDim} sortKey="dimension_value" current={sortKey} asc={sortAsc} onSort={toggleSort} />
                          <SortTh label="Baseline HC" sortKey="baseline_hc" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="Baseline FTE" sortKey="baseline_fte" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="Baseline Cost" sortKey="baseline_cost" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="To-Be HC" sortKey="tobe_hc" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="To-Be FTE" sortKey="tobe_fte" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="To-Be Cost" sortKey="tobe_cost" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="Δ HC" sortKey="delta_hc" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="Δ FTE" sortKey="delta_fte" current={sortKey} asc={sortAsc} onSort={toggleSort} right />
                          <SortTh label="Δ Cost" sortKey="delta_cost" current={sortKey} asc={sortAsc} onSort={toggleSort} right highlight />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((row) => (
                          <tr key={row.dimension_value} style={{ borderTop: `1px solid ${AM.borderLight}` }}>
                            <Td>{row.dimension_value}</Td>
                            <Td right mono>{fmtNumber(row.baseline_hc)}</Td>
                            <Td right mono>{fmtNumber(row.baseline_fte)}</Td>
                            <Td right mono>{fmtCompactCurrency(row.baseline_cost)}</Td>
                            <Td right mono>{fmtNumber(row.tobe_hc)}</Td>
                            <Td right mono>{fmtNumber(row.tobe_fte)}</Td>
                            <Td right mono>{fmtCompactCurrency(row.tobe_cost)}</Td>
                            <DeltaTd value={row.delta_hc} fmt="number" />
                            <DeltaTd value={row.delta_fte} fmt="number" decimals={1} />
                            <DeltaTd value={row.delta_cost} fmt="currency" />
                          </tr>
                        ))}
                        {breakdown.totals && (
                          <tr style={{ borderTop: `2px solid ${AM.border}`, background: AM.borderLight, fontWeight: 700 }}>
                            <Td bold>Total</Td>
                            <Td right mono bold>{fmtNumber(breakdown.totals.baseline_hc)}</Td>
                            <Td right mono bold>{fmtNumber(breakdown.totals.baseline_fte)}</Td>
                            <Td right mono bold>{fmtCompactCurrency(breakdown.totals.baseline_cost)}</Td>
                            <Td right mono bold>{fmtNumber(breakdown.totals.tobe_hc)}</Td>
                            <Td right mono bold>{fmtNumber(breakdown.totals.tobe_fte)}</Td>
                            <Td right mono bold>{fmtCompactCurrency(breakdown.totals.tobe_cost)}</Td>
                            <DeltaTd value={breakdown.totals.delta_hc} fmt="number" bold />
                            <DeltaTd value={breakdown.totals.delta_fte} fmt="number" decimals={1} bold />
                            <DeltaTd value={breakdown.totals.delta_cost} fmt="currency" bold />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "6px 12px", fontSize: 10, color: AM.textMuted, borderTop: `1px solid ${AM.borderLight}` }}>
                    Click column headers to sort. Moves between {selectedDim} values appear as deltas on both sides.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Change log */}
          <div style={{
            fontSize: 11, fontWeight: 600, color: AM.textMuted,
            textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 8,
          }}>
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
                  {changes.slice().reverse().map((c) => (
                    <tr key={c.id} style={{ borderTop: `1px solid ${AM.borderLight}` }}>
                      <Td>{formatTime(c.timestamp)}</Td>
                      <Td><ActionPill action={c.action} /></Td>
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortTh({ label, sortKey, current, asc, onSort, right, highlight }) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        textAlign: right ? "right" : "left",
        padding: "8px 10px",
        fontSize: 10,
        fontWeight: 700,
        color: highlight ? "#fde68a" : active ? AM.white : "rgba(255,255,255,0.75)",
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        userSelect: "none",
        background: active ? "rgba(255,255,255,0.12)" : "transparent",
      }}
    >
      {label}{active ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );
}

function DeltaTd({ value, fmt, decimals = 0, bold }) {
  const n = Number(value) || 0;
  const color = n === 0 ? AM.textMuted : n < 0 ? AM.success : "#8a6d00";
  const sign = n > 0 ? "+" : "";
  const display = fmt === "currency"
    ? `${sign}${fmtCompactCurrency(n)}`
    : `${sign}${fmtNumber(decimals ? n.toFixed(decimals) : n)}`;
  return (
    <td style={{
      padding: "6px 10px", textAlign: "right",
      fontFamily: "'IBM Plex Mono', monospace",
      color, fontWeight: bold ? 700 : 600, fontSize: 11,
    }}>
      {display}
    </td>
  );
}

function sectionLabel() {
  return {
    fontSize: 10, fontWeight: 700, color: AM.textMuted,
    textTransform: "uppercase", letterSpacing: "0.7px",
  };
}

function ImpactPill({ icon, label, tone = "neutral" }) {
  const colors = {
    neutral: { bg: AM.borderLight, fg: AM.textSecondary },
    success: { bg: AM.successLight, fg: AM.success },
    warning: { bg: "#fef3d6", fg: "#8a6d00" },
    danger: { bg: AM.dangerLight, fg: AM.danger },
  }[tone];
  return (
    <span style={{
      background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 600,
      padding: "5px 10px", borderRadius: 14, display: "inline-flex",
      alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {icon}{label}
    </span>
  );
}

function ComparisonCard({ label, headcount, fte, cost, tone, isDelta }) {
  const accent = { neutral: AM.textSecondary, primary: AM.navy, success: AM.success, warning: "#8a6d00" }[tone];
  const sign = (n) => (isDelta && n > 0 ? "+" : "");
  return (
    <div style={{
      background: AM.white, border: `1px solid ${AM.border}`,
      borderRadius: 8, padding: "12px 14px", borderTop: `3px solid ${accent}`,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.8px", color: accent, marginBottom: 8,
      }}>
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
      <span style={{
        fontSize: 12, fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: bold ? 700 : 500, color: AM.textPrimary,
      }}>
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
    <span style={{
      background: c.bg, color: c.fg, padding: "1px 7px", borderRadius: 3,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase",
    }}>
      {c.label}
    </span>
  );
}

function Th({ children }) {
  return (
    <th style={{
      textAlign: "left", padding: "6px 10px", fontSize: 10, fontWeight: 700,
      color: AM.textMuted, textTransform: "uppercase", letterSpacing: "0.5px",
    }}>
      {children}
    </th>
  );
}

function Td({ children, mono, bold, right }) {
  return (
    <td style={{
      padding: "6px 10px", color: AM.textPrimary,
      fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit",
      fontWeight: bold ? 700 : 400,
      textAlign: right ? "right" : "left",
      verticalAlign: "middle",
    }}>
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
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function truncate(s) {
  if (s === null || s === undefined) return "—";
  const str = String(s);
  return str.length > 24 ? str.slice(0, 22) + "…" : str;
}
