/**
 * Feature 5 — Phasing View
 *
 * Displays a monthly bar+line chart of headcount/cost changes tagged with
 * effective dates, plus a change-log table with bulk date-assignment.
 *
 * Chart:  incremental grouped bars (adds = green, removes = red)
 *         cumulative net delta line (blue) overlaid
 * Toggle: Headcount ↔ Cost Y-axis
 * Table:  all dated + undated changes, selectable for bulk date assignment
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Plot from "react-plotly.js";
import { AM } from "./orgChartTheme";
import { fmtCompactCurrency, fmtNumber } from "./orgChartLayout";
import { dbGetPhasingView, dbBulkSetEffectiveDate } from "../../api/backend";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmt = (n) =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
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
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
};
const actionLabel = (a) => {
  const m = { add: "Add", clone: "Clone", flag_remove: "Remove", unflag_restore: "Restore", move: "Move", edit: "Edit" };
  return m[a] || a;
};
const actionColor = (a) => {
  const m = { add: AM.success, clone: "#0e7490", flag_remove: AM.danger, unflag_restore: AM.success, move: AM.blue, edit: "#8a6d00" };
  return m[a] || AM.textMuted;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PhasingView({ scenarioId, changes = [], onPhasingLoaded }) {
  const [mode, setMode] = useState("hc"); // "hc" | "cost"
  const [fyStartMonth, setFyStartMonth] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Bulk date assignment state
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

  // Separate dated buckets from undated for chart (skip "undated" bucket in chart)
  const chartBuckets = monthly.filter((b) => b.month !== "undated");
  const undatedBucket = monthly.find((b) => b.month === "undated");

  // Build Plotly traces
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
      marker: { color: AM.success + "cc" },
      hovertemplate: mode === "hc"
        ? "<b>%{x}</b><br>Adds: %{y}<extra></extra>"
        : "<b>%{x}</b><br>Cost added: $%{y:,.0f}<extra></extra>",
    },
    {
      type: "bar",
      name: "Removes",
      x: labels,
      y: removeVals,
      marker: { color: AM.danger + "cc" },
      hovertemplate: mode === "hc"
        ? "<b>%{x}</b><br>Removes: %{y}<extra></extra>"
        : "<b>%{x}</b><br>Cost removed: $%{y:,.0f}<extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Cumulative net",
      x: labels,
      y: cumVals,
      yaxis: "y",
      line: { color: AM.blue, width: 2 },
      marker: { color: AM.blue, size: 6 },
      hovertemplate: mode === "hc"
        ? "<b>%{x}</b><br>Cumulative Δ HC: %{y}<extra></extra>"
        : "<b>%{x}</b><br>Cumulative Δ Cost: $%{y:,.0f}<extra></extra>",
    },
  ];

  const yAxisTitle = mode === "hc" ? "Headcount Δ" : "Cost Δ ($)";

  const plotLayout = {
    autosize: true,
    height: 220,
    margin: { t: 10, r: 20, b: 50, l: 55 },
    barmode: "overlay",
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { family: "'IBM Plex Sans', system-ui, sans-serif", size: 11, color: AM.textPrimary },
    xaxis: {
      title: { text: "Effective Month", font: { size: 10 } },
      tickfont: { size: 10 },
      gridcolor: AM.borderLight,
      zeroline: false,
    },
    yaxis: {
      title: { text: yAxisTitle, font: { size: 10 } },
      tickfont: { size: 10 },
      gridcolor: AM.borderLight,
      zeroline: true,
      zerolinecolor: AM.border,
      zerolinewidth: 1.5,
    },
    legend: {
      orientation: "h",
      x: 0,
      y: -0.28,
      font: { size: 10 },
    },
    shapes: [
      {
        type: "line",
        xref: "paper",
        yref: "y",
        x0: 0, x1: 1,
        y0: 0, y1: 0,
        line: { color: AM.textMuted, width: 1, dash: "dot" },
      },
    ],
  };

  // Change log table data — merge changes from API with effective_date from phasing
  // We use the `changes` prop (from OrgImpactStrip) and enrich with effective dates
  const allChanges = useMemo(() => {
    // Flatten all change entries from phasing monthly data into a map by month
    // The `changes` prop already has IDs — use them directly
    return [...changes].reverse();
  }, [changes]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
    <div style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      {/* Summary row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <SummaryCard
          label="Full-Year Savings"
          value={fmtCurr(-summary.full_year_savings || 0)}
          tone="success"
          note="Annual run-rate once all changes take effect"
        />
        <SummaryCard
          label="In-Year Savings"
          value={fmtCurr(-summary.in_year_savings || 0)}
          tone="primary"
          note={`${summary.months_remaining_in_fy ?? "—"} months remaining in FY`}
        />
        {undatedBucket && (
          <SummaryCard
            label="Undated Changes"
            value={`${(undatedBucket.adds_count || 0) + (undatedBucket.removes_count || 0)}`}
            tone="warning"
            note="Assign effective dates below"
          />
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={labelStyle}>View</span>
        <ToggleBtn active={mode === "hc"} onClick={() => setMode("hc")}>Headcount</ToggleBtn>
        <ToggleBtn active={mode === "cost"} onClick={() => setMode("cost")}>Cost</ToggleBtn>
        <span style={{ ...labelStyle, marginLeft: 12 }}>FY starts</span>
        <select
          value={fyStartMonth}
          onChange={(e) => setFyStartMonth(Number(e.target.value))}
          style={selectStyle}
        >
          {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        {loading && <span style={{ fontSize: 11, color: AM.textMuted }}>Loading…</span>}
        {error && <span style={{ fontSize: 11, color: AM.danger }}>{error}</span>}
      </div>

      {/* Chart */}
      {hasDatedChanges ? (
        <div style={{ border: `1px solid ${AM.borderLight}`, borderRadius: 8, background: AM.white, padding: "12px 8px 4px", marginBottom: 14 }}>
          <Plot
            data={plotTraces}
            layout={plotLayout}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%", height: 220 }}
            useResizeHandler
          />
        </div>
      ) : !loading && (
        <div style={{ padding: "14px 0", fontSize: 12, color: AM.textMuted, fontStyle: "italic" }}>
          No dated changes yet. Assign effective dates to changes below to see the phasing chart.
        </div>
      )}

      {/* Change log table with bulk date assignment */}
      <div style={{ marginTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
          <span style={labelStyle}>Change Log — Assign Effective Dates</span>
          {selected.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: AM.navy, fontWeight: 600 }}>{selected.size} selected</span>
              <input
                type="date"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                style={inputStyle}
              />
              <button
                onClick={applyBulkDate}
                disabled={bulkSaving}
                style={{ ...btnStyle, background: AM.navy, color: AM.white }}
              >
                {bulkSaving ? "Saving…" : "Assign Date"}
              </button>
              <button
                onClick={() => { setBulkDate(""); applyBulkDate(); }}
                disabled={bulkSaving}
                title="Clear dates from selected"
                style={{ ...btnStyle, background: "transparent", color: AM.danger, border: `1px solid ${AM.danger}` }}
              >
                Clear
              </button>
              {bulkMsg && <span style={{ fontSize: 11, color: bulkMsg.startsWith("Updated") ? AM.success : AM.danger }}>{bulkMsg}</span>}
            </div>
          )}
        </div>

        {allChanges.length === 0 ? (
          <div style={{ fontSize: 12, color: AM.textMuted, fontStyle: "italic" }}>No changes yet.</div>
        ) : (
          <div style={{ border: `1px solid ${AM.borderLight}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ overflow: "auto", maxHeight: 240 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: AM.borderLight }}>
                    <th style={thStyle}>
                      <input
                        type="checkbox"
                        checked={selected.size === allChanges.length && allChanges.length > 0}
                        onChange={toggleAll}
                        style={{ cursor: "pointer" }}
                      />
                    </th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>Employee</th>
                    <th style={thStyle}>Detail</th>
                    <th style={thStyle}>System Time</th>
                    <th style={{ ...thStyle, color: AM.navy, fontWeight: 700 }}>Effective Date</th>
                  </tr>
                </thead>
                <tbody>
                  {allChanges.map((c) => (
                    <tr
                      key={c.id}
                      style={{
                        borderTop: `1px solid ${AM.borderLight}`,
                        background: selected.has(c.id) ? AM.blueLight + "60" : "transparent",
                        cursor: "pointer",
                      }}
                      onClick={() => toggleSelect(c.id)}
                    >
                      <td style={{ ...tdStyle, width: 32 }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          background: actionColor(c.action) + "22",
                          color: actionColor(c.action),
                          padding: "1px 6px",
                          borderRadius: 3,
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                        }}>
                          {actionLabel(c.action)}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "'IBM Plex Mono', monospace" }}>{c.emp_id}</td>
                      <td style={tdStyle}>
                        {c.action === "move"
                          ? `${c.old_mgr_id || "—"} → ${c.new_mgr_id || "—"}`
                          : c.action === "edit"
                          ? `${c.field}: ${truncate(c.old_value)} → ${truncate(c.new_value)}`
                          : "—"}
                      </td>
                      <td style={{ ...tdStyle, color: AM.textMuted }}>{formatTs(c.timestamp)}</td>
                      <td style={{ ...tdStyle, fontWeight: c.effective_date ? 600 : 400, color: c.effective_date ? AM.navy : AM.textMuted }}>
                        {c.effective_date ? fmtDate(c.effective_date) : <span style={{ fontStyle: "italic" }}>Undated</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "5px 10px", fontSize: 10, color: AM.textMuted, borderTop: `1px solid ${AM.borderLight}` }}>
              Click rows to select. Use the toolbar above to assign effective dates to selected changes.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function SummaryCard({ label, value, tone, note }) {
  const accent = tone === "success" ? AM.success : tone === "primary" ? AM.navy : "#8a6d00";
  const bg = tone === "success" ? AM.successLight : tone === "primary" ? AM.blueLight : "#fef3d6";
  return (
    <div style={{
      flex: "1 1 160px",
      background: bg,
      border: `1px solid ${accent}33`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 6,
      padding: "10px 14px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", color: accent, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: accent }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: accent + "aa", marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function ToggleBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? AM.navy : "transparent",
        color: active ? AM.white : AM.navy,
        border: `1px solid ${AM.border}`,
        borderRadius: 5,
        padding: "4px 12px",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const labelStyle = {
  fontSize: 10, fontWeight: 700, color: AM.textMuted,
  textTransform: "uppercase", letterSpacing: "0.7px",
};
const selectStyle = {
  border: `1px solid ${AM.border}`, borderRadius: 5,
  padding: "4px 8px", fontSize: 11, color: AM.navy,
  background: AM.white, cursor: "pointer",
};
const inputStyle = {
  border: `1px solid ${AM.border}`, borderRadius: 5,
  padding: "4px 8px", fontSize: 11, color: AM.navy,
  background: AM.white,
};
const btnStyle = {
  border: `1px solid ${AM.border}`, borderRadius: 5,
  padding: "4px 10px", fontSize: 11, fontWeight: 600,
  cursor: "pointer",
};
const thStyle = {
  textAlign: "left", padding: "6px 10px",
  fontSize: 10, fontWeight: 700, color: AM.textMuted,
  textTransform: "uppercase", letterSpacing: "0.5px",
  position: "sticky", top: 0, background: AM.borderLight,
};
const tdStyle = {
  padding: "6px 10px", color: AM.textPrimary,
  verticalAlign: "middle",
};

function formatTs(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ts; }
}

function truncate(s) {
  if (s === null || s === undefined) return "—";
  const str = String(s);
  return str.length > 20 ? str.slice(0, 18) + "…" : str;
}
