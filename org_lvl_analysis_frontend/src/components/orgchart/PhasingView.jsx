/**
 * Feature 5 — Phasing View (Polished Redesign)
 *
 * Monthly bar+line chart of headcount/cost changes with effective dates,
 * plus a change-log table with bulk date-assignment.
 *
 * Chart:  incremental grouped bars (adds = green, removes = red)
 *         cumulative net delta line (blue) overlaid
 * Toggle: Headcount ↔ Cost Y-axis
 * Table:  all dated + undated changes, selectable for bulk date assignment
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import Plot from "react-plotly.js";
import { AM } from "./orgChartTheme";
import { dbGetPhasingView, dbBulkSetEffectiveDate } from "../../api/backend";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmtCurr = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};
const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return iso; }
};
const actionLabel = (a) => {
  const m = { add: "Add", clone: "Clone", flag_remove: "Remove", unflag_restore: "Restore", move: "Move", edit: "Edit" };
  return m[a] || a;
};
const ACTION_PALETTE = {
  add:            { bg: "#e3f5ec", text: "#1c7a51", dot: "#2e9e6a" },
  clone:          { bg: "#e0f2fe", text: "#0369a1", dot: "#0ea5e9" },
  flag_remove:    { bg: "#fde7e7", text: "#b91c1c", dot: "#d94f4f" },
  unflag_restore: { bg: "#e3f5ec", text: "#1c7a51", dot: "#2e9e6a" },
  move:           { bg: "#dbeafe", text: "#1d4ed8", dot: "#3b82f6" },
  edit:           { bg: "#fef3c7", text: "#92400e", dot: "#d97706" },
};
const getActionPalette = (a) => ACTION_PALETTE[a] || { bg: "#f1f5f9", text: "#64748b", dot: "#94a3b8" };

function formatTs(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}
function truncate(s) {
  if (s === null || s === undefined) return "—";
  const str = String(s);
  return str.length > 20 ? str.slice(0, 18) + "…" : str;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PhasingView({ scenarioId, changes = [], onPhasingLoaded }) {
  const [mode, setMode] = useState("hc");
  const [fyStartMonth, setFyStartMonth] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

  const load = useCallback(async () => {
    if (!scenarioId) return;
    setLoading(true);
    setError("");
    try {
      const resp = await dbGetPhasingView(scenarioId, fyStartMonth);
      setData(resp);
      onPhasingLoaded?.(resp);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load phasing data");
    } finally {
      setLoading(false);
    }
  }, [scenarioId, fyStartMonth, onPhasingLoaded]);

  useEffect(() => { load(); }, [load]);

  const monthly = data?.monthly || [];
  const summary = data?.summary || {};
  const chartBuckets = monthly.filter((b) => b.month !== "undated");
  const undatedBucket = monthly.find((b) => b.month === "undated");

  const labels = chartBuckets.map((b) => b.label);
  const addVals = chartBuckets.map((b) => mode === "hc" ? b.adds_count : b.cost_delta > 0 ? b.cost_delta : 0);
  const removeVals = chartBuckets.map((b) => mode === "hc" ? -b.removes_count : b.cost_delta < 0 ? b.cost_delta : 0);
  const cumVals = chartBuckets.map((b) => mode === "hc" ? b.cumulative_hc_delta : b.cumulative_cost_delta);

  const plotTraces = [
    {
      type: "bar",
      name: "Adds",
      x: labels,
      y: addVals,
      marker: {
        color: addVals.map(() => "rgba(46,158,106,0.75)"),
        line: { color: "rgba(46,158,106,0.2)", width: 1 },
      },
      hovertemplate: mode === "hc"
        ? "<b>%{x}</b><br>Adds: <b>%{y}</b><extra></extra>"
        : "<b>%{x}</b><br>Cost added: <b>$%{y:,.0f}</b><extra></extra>",
    },
    {
      type: "bar",
      name: "Removes",
      x: labels,
      y: removeVals,
      marker: {
        color: removeVals.map(() => "rgba(217,79,79,0.75)"),
        line: { color: "rgba(217,79,79,0.2)", width: 1 },
      },
      hovertemplate: mode === "hc"
        ? "<b>%{x}</b><br>Removes: <b>%{y}</b><extra></extra>"
        : "<b>%{x}</b><br>Cost removed: <b>$%{y:,.0f}</b><extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Cumulative net",
      x: labels,
      y: cumVals,
      yaxis: "y",
      line: { color: AM.blue, width: 2.5, shape: "spline", smoothing: 0.5 },
      marker: {
        color: AM.white,
        size: 8,
        line: { color: AM.blue, width: 2.5 },
      },
      hovertemplate: mode === "hc"
        ? "<b>%{x}</b><br>Cumulative Δ HC: <b>%{y}</b><extra></extra>"
        : "<b>%{x}</b><br>Cumulative Δ Cost: <b>$%{y:,.0f}</b><extra></extra>",
    },
  ];

  const yAxisTitle = mode === "hc" ? "Headcount Δ" : "Cost Δ ($)";

  const plotLayout = {
    autosize: true,
    height: 260,
    margin: { t: 16, r: 24, b: 56, l: 60 },
    barmode: "overlay",
    bargap: 0.35,
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { family: "Inter, system-ui, sans-serif", size: 11, color: AM.textSecondary },
    xaxis: {
      title: { text: "Effective Month", font: { size: 10, color: AM.textMuted }, standoff: 8 },
      tickfont: { size: 10, color: AM.textMuted },
      gridcolor: "rgba(0,0,0,0)",
      zeroline: false,
      showline: false,
      tickcolor: "transparent",
    },
    yaxis: {
      title: { text: yAxisTitle, font: { size: 10, color: AM.textMuted }, standoff: 8 },
      tickfont: { size: 10, color: AM.textMuted },
      gridcolor: "rgba(220,228,238,0.7)",
      gridwidth: 1,
      zeroline: true,
      zerolinecolor: AM.border,
      zerolinewidth: 1.5,
      showline: false,
      tickcolor: "transparent",
    },
    legend: {
      orientation: "h",
      x: 0,
      y: -0.3,
      font: { size: 11 },
      bgcolor: "transparent",
      itemclick: false,
      itemdoubleclick: false,
    },
    hoverlabel: {
      bgcolor: AM.navy,
      bordercolor: AM.navy,
      font: { color: AM.white, size: 12, family: "Inter, system-ui, sans-serif" },
      namelength: 0,
    },
    shapes: [
      {
        type: "line",
        xref: "paper",
        yref: "y",
        x0: 0, x1: 1,
        y0: 0, y1: 0,
        line: { color: AM.border, width: 1.5, dash: "dot" },
      },
    ],
  };

  const allChanges = useMemo(() => [...changes].reverse(), [changes]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === allChanges.length) setSelected(new Set());
    else setSelected(new Set(allChanges.map((c) => c.id)));
  };
  const applyBulkDate = async () => {
    if (!selected.size) return;
    setBulkSaving(true);
    setBulkMsg("");
    try {
      const res = await dbBulkSetEffectiveDate(scenarioId, [...selected], bulkDate || null);
      setBulkMsg(`Updated ${res.updated} change${res.updated !== 1 ? "s" : ""}`);
      setSelected(new Set());
      setBulkDate("");
      load();
    } catch (e) {
      setBulkMsg(e?.response?.data?.detail || "Failed to update dates");
    } finally {
      setBulkSaving(false);
    }
  };

  const hasDatedChanges = chartBuckets.length > 0;

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", color: AM.textPrimary }}>

      {/* ── Summary Cards ───────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <SummaryCard
          label="Full-Year Savings"
          value={fmtCurr(-summary.full_year_savings || 0)}
          tone="success"
          note="Annual run-rate once all changes take effect"
          icon="📈"
        />
        <SummaryCard
          label="In-Year Savings"
          value={fmtCurr(-summary.in_year_savings || 0)}
          tone="primary"
          note={`${summary.months_remaining_in_fy ?? "—"} months remaining in FY`}
          icon="📅"
        />
        {undatedBucket && (
          <SummaryCard
            label="Undated Changes"
            value={`${(undatedBucket.adds_count || 0) + (undatedBucket.removes_count || 0)}`}
            tone="warning"
            note="Assign effective dates below"
            icon="⚠️"
          />
        )}
      </div>

      {/* ── Controls ────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
        flexWrap: "wrap",
      }}>
        <span style={sectionLabelStyle}>View</span>
        <div style={{
          display: "inline-flex",
          background: AM.borderLight,
          borderRadius: 7,
          padding: 2,
          border: `1px solid ${AM.border}`,
        }}>
          <SegmentBtn active={mode === "hc"} onClick={() => setMode("hc")}>Headcount</SegmentBtn>
          <SegmentBtn active={mode === "cost"} onClick={() => setMode("cost")}>Cost</SegmentBtn>
        </div>
        <span style={{ ...sectionLabelStyle, marginLeft: 10 }}>FY Starts</span>
        <select
          value={fyStartMonth}
          onChange={(e) => setFyStartMonth(Number(e.target.value))}
          style={selectStyle}
        >
          {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        {loading && (
          <span style={{ fontSize: 11, color: AM.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={spinnerStyle} />Loading…
          </span>
        )}
        {error && <span style={{ fontSize: 11, color: AM.danger }}>{error}</span>}
      </div>

      {/* ── Chart ───────────────────────────────────────────────────── */}
      {hasDatedChanges ? (
        <div style={{
          border: `1px solid ${AM.border}`,
          borderRadius: 10,
          background: AM.white,
          padding: "14px 10px 6px",
          marginBottom: 16,
          boxShadow: "0 1px 4px rgba(1,36,74,0.06)",
        }}>
          <Plot
            data={plotTraces}
            layout={plotLayout}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%", height: 260 }}
            useResizeHandler
          />
        </div>
      ) : !loading && (
        <div style={{
          padding: "28px 0",
          textAlign: "center",
          fontSize: 13,
          color: AM.textMuted,
          fontStyle: "italic",
          background: AM.bg,
          borderRadius: 10,
          border: `1px dashed ${AM.border}`,
          marginBottom: 16,
        }}>
          No dated changes yet — assign effective dates below to see the phasing chart.
        </div>
      )}

      {/* ── Change Log ──────────────────────────────────────────────── */}
      <div>
        {/* Section header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 8, flexWrap: "wrap", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={sectionLabelStyle}>Change Log</span>
            <span style={sectionLabelStyle}>—</span>
            <span style={sectionLabelStyle}>Assign Effective Dates</span>
            {allChanges.length > 0 && (
              <span style={{
                background: AM.blueLight, color: AM.blue, fontSize: 10, fontWeight: 700,
                borderRadius: 20, padding: "1px 8px", letterSpacing: "0.3px",
              }}>
                {allChanges.length}
              </span>
            )}
          </div>
          {selected.size > 0 && (
            <BulkBar
              count={selected.size}
              bulkDate={bulkDate}
              setBulkDate={setBulkDate}
              bulkSaving={bulkSaving}
              bulkMsg={bulkMsg}
              applyBulkDate={applyBulkDate}
              clearDates={() => { setBulkDate(""); applyBulkDate(); }}
            />
          )}
        </div>

        {allChanges.length === 0 ? (
          <div style={{
            fontSize: 12, color: AM.textMuted, fontStyle: "italic",
            padding: "20px 0", textAlign: "center",
          }}>
            No changes yet.
          </div>
        ) : (
          <div style={{
            border: `1px solid ${AM.border}`,
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 1px 4px rgba(1,36,74,0.06)",
          }}>
            <div style={{ overflow: "auto", maxHeight: 260 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: `linear-gradient(to bottom, ${AM.borderLight}, ${AM.bg})` }}>
                    <Th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={selected.size === allChanges.length && allChanges.length > 0}
                        onChange={toggleAll}
                        style={checkboxStyle}
                      />
                    </Th>
                    <Th>Action</Th>
                    <Th>Employee</Th>
                    <Th>Detail</Th>
                    <Th>System Time</Th>
                    <Th accent>Effective Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {allChanges.map((c, i) => {
                    const isSelected = selected.has(c.id);
                    const isEven = i % 2 === 0;
                    return (
                      <tr
                        key={c.id}
                        style={{
                          borderTop: `1px solid ${AM.borderLight}`,
                          background: isSelected
                            ? `linear-gradient(to right, ${AM.blue}14, ${AM.blue}08)`
                            : isEven ? AM.white : AM.bg,
                          cursor: "pointer",
                          transition: "background 0.12s ease",
                        }}
                        onClick={() => toggleSelect(c.id)}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.background = AM.blueLight + "55";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isSelected
                            ? `linear-gradient(to right, ${AM.blue}14, ${AM.blue}08)`
                            : isEven ? AM.white : AM.bg;
                        }}
                      >
                        <Td onClick={(e) => e.stopPropagation()} style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(c.id)}
                            style={checkboxStyle}
                          />
                        </Td>
                        <Td>
                          <ActionBadge action={c.action} />
                        </Td>
                        <Td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 11, color: AM.textSecondary, fontWeight: 600 }}>
                          {c.emp_id}
                        </Td>
                        <Td style={{ color: AM.textSecondary, maxWidth: 160 }}>
                          {c.action === "move"
                            ? <span><MonoSpan>{c.old_mgr_id || "—"}</MonoSpan><ArrowSpan /><MonoSpan>{c.new_mgr_id || "—"}</MonoSpan></span>
                            : c.action === "edit"
                            ? `${c.field}: ${truncate(c.old_value)} → ${truncate(c.new_value)}`
                            : "—"}
                        </Td>
                        <Td style={{ color: AM.textMuted, whiteSpace: "nowrap" }}>{formatTs(c.timestamp)}</Td>
                        <Td>
                          {c.effective_date ? (
                            <span style={{
                              color: AM.navy, fontWeight: 600, fontSize: 11,
                              background: AM.blueLight, borderRadius: 4,
                              padding: "2px 7px", whiteSpace: "nowrap",
                            }}>
                              {fmtDate(c.effective_date)}
                            </span>
                          ) : (
                            <span style={{
                              fontStyle: "italic", color: AM.textMuted, fontSize: 11,
                              display: "inline-flex", alignItems: "center", gap: 4,
                            }}>
                              <span style={{
                                display: "inline-block", width: 6, height: 6,
                                borderRadius: "50%", background: "#f59e0b",
                              }} />
                              Undated
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{
              padding: "6px 14px", fontSize: 10.5, color: AM.textMuted,
              borderTop: `1px solid ${AM.borderLight}`,
              background: AM.bg,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ opacity: 0.6 }}>↑</span>
              Click rows to select, then assign effective dates with the toolbar.
            </div>
          </div>
        )}
      </div>

      {/* Inline CSS for spinner */}
      <style>{`
        @keyframes pv-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BulkBar — toolbar shown when rows are selected
// ---------------------------------------------------------------------------
function BulkBar({ count, bulkDate, setBulkDate, bulkSaving, bulkMsg, applyBulkDate, clearDates }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: AM.navy,
      borderRadius: 8,
      padding: "5px 12px",
      boxShadow: "0 2px 8px rgba(1,36,74,0.18)",
    }}>
      <span style={{ fontSize: 11, color: AM.white, fontWeight: 700, opacity: 0.9 }}>
        {count} selected
      </span>
      <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.2)" }} />
      <input
        type="date"
        value={bulkDate}
        onChange={(e) => setBulkDate(e.target.value)}
        style={{
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 5, padding: "3px 7px",
          fontSize: 11, color: AM.white,
          background: "rgba(255,255,255,0.12)",
          cursor: "pointer", outline: "none",
        }}
      />
      <button
        onClick={applyBulkDate}
        disabled={bulkSaving}
        style={{
          background: AM.blue, color: AM.white,
          border: "none", borderRadius: 5,
          padding: "4px 12px", fontSize: 11, fontWeight: 700,
          cursor: bulkSaving ? "not-allowed" : "pointer",
          opacity: bulkSaving ? 0.6 : 1,
          transition: "opacity 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        {bulkSaving ? "Saving…" : "Assign Date"}
      </button>
      <button
        onClick={clearDates}
        disabled={bulkSaving}
        title="Clear dates from selected"
        style={{
          background: "transparent", color: "rgba(255,255,255,0.75)",
          border: "1px solid rgba(255,255,255,0.25)", borderRadius: 5,
          padding: "3px 10px", fontSize: 11, fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Clear
      </button>
      {bulkMsg && (
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: bulkMsg.startsWith("Updated") ? "#6ee7b7" : "#fca5a5",
        }}>
          {bulkMsg}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function SummaryCard({ label, value, tone, note, icon }) {
  const palettes = {
    success: { accent: "#1c7a51", text: "#1c7a51", bg: "linear-gradient(135deg, #e3f5ec 0%, #d1fae5 100%)", border: "rgba(46,158,106,0.25)" },
    primary: { accent: AM.navy, text: AM.navy, bg: `linear-gradient(135deg, ${AM.blueLight} 0%, #c7ddf0 100%)`, border: "rgba(1,36,74,0.15)" },
    warning: { accent: "#92400e", text: "#78350f", bg: "linear-gradient(135deg, #fef3c7 0%, #fde68a55 100%)", border: "rgba(196,164,0,0.3)" },
  };
  const p = palettes[tone] || palettes.primary;
  return (
    <div style={{
      flex: "1 1 160px",
      background: p.bg,
      border: `1px solid ${p.border}`,
      borderTop: `3px solid ${p.accent}`,
      borderRadius: 8,
      padding: "12px 16px 10px",
      boxShadow: "0 1px 4px rgba(1,36,74,0.06)",
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.8px", color: p.accent, marginBottom: 6,
        display: "flex", alignItems: "center", gap: 5,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        color: p.text, lineHeight: 1, marginBottom: 5,
        letterSpacing: "-0.5px",
      }}>
        {value}
      </div>
      {note && (
        <div style={{ fontSize: 10.5, color: p.accent, opacity: 0.75 }}>{note}</div>
      )}
    </div>
  );
}

function SegmentBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? AM.navy : "transparent",
        color: active ? AM.white : AM.textSecondary,
        border: "none",
        borderRadius: 5,
        padding: "4px 14px",
        fontSize: 11.5,
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
        transition: "all 0.15s ease",
        letterSpacing: "0.1px",
      }}
    >
      {children}
    </button>
  );
}

function ActionBadge({ action }) {
  const p = getActionPalette(action);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: p.bg, color: p.text,
      padding: "2px 8px 2px 6px",
      borderRadius: 4,
      fontSize: 10.5, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.5px",
      whiteSpace: "nowrap",
    }}>
      <span style={{
        display: "inline-block", width: 5, height: 5,
        borderRadius: "50%", background: p.dot, flexShrink: 0,
      }} />
      {actionLabel(action)}
    </span>
  );
}

function Th({ children, style, accent }) {
  return (
    <th style={{
      textAlign: "left", padding: "8px 12px",
      fontSize: 10, fontWeight: 700, color: accent ? AM.navy : AM.textMuted,
      textTransform: "uppercase", letterSpacing: "0.6px",
      position: "sticky", top: 0, zIndex: 1,
      background: "inherit",
      borderBottom: `1px solid ${AM.border}`,
      whiteSpace: "nowrap",
      ...style,
    }}>
      {children}
    </th>
  );
}

function Td({ children, style, onClick }) {
  return (
    <td
      onClick={onClick}
      style={{ padding: "7px 12px", verticalAlign: "middle", ...style }}
    >
      {children}
    </td>
  );
}

function MonoSpan({ children }) {
  return (
    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 10.5, color: AM.textSecondary }}>
      {children}
    </span>
  );
}

function ArrowSpan() {
  return (
    <span style={{ color: AM.blue, fontWeight: 700, margin: "0 4px", fontSize: 11 }}>→</span>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const sectionLabelStyle = {
  fontSize: 10, fontWeight: 700, color: AM.textMuted,
  textTransform: "uppercase", letterSpacing: "0.7px",
};

const selectStyle = {
  border: `1px solid ${AM.border}`,
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11.5,
  color: AM.navy,
  background: AM.white,
  cursor: "pointer",
  outline: "none",
  fontFamily: "Inter, system-ui, sans-serif",
  fontWeight: 600,
};

const checkboxStyle = {
  cursor: "pointer",
  accentColor: AM.navy,
  width: 13, height: 13,
};

const spinnerStyle = {
  display: "inline-block",
  width: 10, height: 10,
  border: `2px solid ${AM.border}`,
  borderTopColor: AM.blue,
  borderRadius: "50%",
  animation: "pv-spin 0.7s linear infinite",
};
