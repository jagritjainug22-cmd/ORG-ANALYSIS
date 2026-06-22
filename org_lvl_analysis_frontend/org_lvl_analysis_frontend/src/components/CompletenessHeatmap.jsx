import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { dbGetCompletenessHeatmap } from "../api/backend";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isFilled(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  return s !== "" && s.toLowerCase() !== "nan" && s.toLowerCase() !== "none";
}

function defaultFields(columns, empCol, mgrCol) {
  return columns.filter((c) => {
    if (c === empCol || c === mgrCol) return false;
    if (c.startsWith("FLAG_")) return false;
    if (c.startsWith("__")) return false;
    if (["Chain", "Chain_reversed", "Last_Employee"].includes(c)) return false;
    return true;
  });
}

function suggestGroupCol(columns) {
  const prefs = [
    "Department", "Business Unit (Reporting line)", "Division (Reporting Line)",
    "Level", "Country", "Functional Area (Costed to)",
  ];
  for (const p of prefs) { if (columns.includes(p)) return p; }
  return columns[0] || "";
}

function pctColor(pct) {
  if (pct >= 95) return { bg: "rgba(16,185,129,0.10)", border: "#10b981", text: "#065f46" };
  if (pct >= 80) return { bg: "rgba(132,204,22,0.10)", border: "#84cc16", text: "#3f6212" };
  if (pct >= 60) return { bg: "rgba(245,158,11,0.12)", border: "#f59e0b", text: "#92400e" };
  if (pct >= 30) return { bg: "rgba(249,115,22,0.12)", border: "#f97316", text: "#9a3412" };
  return { bg: "rgba(239,68,68,0.12)", border: "#ef4444", text: "#991b1b" };
}

function pctBarColor(pct) {
  if (pct >= 95) return "#10b981";
  if (pct >= 80) return "#84cc16";
  if (pct >= 60) return "#f59e0b";
  if (pct >= 30) return "#f97316";
  return "#ef4444";
}

function MiniDonut({ pct, size = 36 }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  const color = pct >= 90 ? "#10b981" : pct >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={3} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

const PAGE_SIZE_BARS = 10;
const PAGE_SIZE_TABLE = 10;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function CompletenessHeatmap({ dfRecords = [], columns = [], empCol = "", mgrCol = "" }) {
  const allColumns = columns?.length ? columns : dfRecords?.length ? Object.keys(dfRecords[0]) : [];

  const [selectedFields, setSelectedFields] = useState([]);
  const [groupCol, setGroupCol] = useState("");
  const [showConfigure, setShowConfigure] = useState(false);
  const [fieldFilter, setFieldFilter] = useState("");
  const [showBlankGroup, setShowBlankGroup] = useState(false);
  const [view, setView] = useState("bars");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [drillDown, setDrillDown] = useState(null);

  // Pagination
  const [barsPage, setBarsPage] = useState(0);
  const [tablePage, setTablePage] = useState(0);

  // Refs for scroll-to navigation
  const chartRef = useRef(null);
  const drillDownRef = useRef(null);

  useEffect(() => {
    if (!allColumns.length) return;
    setSelectedFields((prev) => prev.length ? prev : defaultFields(allColumns, empCol, mgrCol));
    setGroupCol((prev) => prev || suggestGroupCol(allColumns));
  }, [allColumns.join("|"), empCol, mgrCol]);

  // Reset pagination when view or result changes
  useEffect(() => { setBarsPage(0); setTablePage(0); }, [view, result]);

  const filteredFieldOptions = allColumns.filter((c) =>
    c.toLowerCase().includes(fieldFilter.toLowerCase())
  );

  const toggleField = (f) =>
    setSelectedFields((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);

  const runAnalysis = useCallback(async () => {
    if (!dfRecords?.length) { setError("No data loaded."); return; }
    if (!selectedFields.length) { setError("Select at least one field."); return; }
    if (!groupCol) { setError("Select a group-by column."); return; }
    setLoading(true); setError(null); setDrillDown(null);
    try {
      const data = await dbGetCompletenessHeatmap(dfRecords, selectedFields, groupCol);
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.detail || "Analysis failed."); setResult(null);
    } finally { setLoading(false); }
  }, [dfRecords, selectedFields, groupCol]);

  const { fieldStats, groups, matrixLookup } = useMemo(() => {
    if (!result?.matrix?.length) return { fieldStats: [], groups: [], matrixLookup: {} };
    const { fields, groups: rawGroups, matrix } = result;
    const filteredGroups = showBlankGroup ? rawGroups : rawGroups.filter((g) => g !== "(blank)");
    const lookup = {};
    matrix.forEach((c) => { lookup[`${c.field}||${c.group}`] = c; });
    const stats = fields.map((field) => {
      let total = 0, filled = 0;
      filteredGroups.forEach((g) => {
        const cell = lookup[`${field}||${g}`];
        if (cell) { total += cell.total; filled += cell.filled; }
      });
      const pct = total ? Math.round(1000 * filled / total) / 10 : 100;
      const gapsIn = filteredGroups.filter((g) => {
        const cell = lookup[`${field}||${g}`];
        return cell && cell.pct_complete < 100;
      });
      return { field, pct, total, filled, missing: total - filled, gapsIn };
    });
    stats.sort((a, b) => a.pct - b.pct);
    return { fieldStats: stats, groups: filteredGroups, matrixLookup: lookup };
  }, [result, showBlankGroup]);

  const summary = result?.summary;
  const overallPct = summary?.overall_pct ?? 0;

  // Paginated slices
  const barsPageCount = Math.ceil(fieldStats.length / PAGE_SIZE_BARS);
  const tablePageCount = Math.ceil(fieldStats.length / PAGE_SIZE_TABLE);
  const visibleBars = fieldStats.slice(barsPage * PAGE_SIZE_BARS, (barsPage + 1) * PAGE_SIZE_BARS);
  const visibleTableRows = fieldStats.slice(tablePage * PAGE_SIZE_TABLE, (tablePage + 1) * PAGE_SIZE_TABLE);

  const handleCellClick = (field, group) => {
    const cell = matrixLookup[`${field}||${group}`];
    if (!cell || cell.missing === 0) return;
    const rows = dfRecords.filter((row) => {
      const gVal = isFilled(row[groupCol]) ? String(row[groupCol]).trim() : "(blank)";
      return gVal === group && !isFilled(row[field]);
    });
    setDrillDown({ field, group, rows, missing: cell.missing });
    // Scroll to drill-down after state update
    requestAnimationFrame(() => {
      drillDownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const scrollToChart = () => {
    chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const drillCols = drillDown
    ? [empCol, groupCol, drillDown.field, ...allColumns.filter((c) => c !== empCol && c !== groupCol && c !== drillDown.field).slice(0, 3)]
    : [];

  // Pagination controls component
  const Pagination = ({ page, pageCount, onPage, onPrev, onNext, total, pageSize }) => (
    pageCount <= 1 ? null : (
      <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50">
        <span className="text-xs text-gray-500">
          Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total} fields
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button" onClick={onPrev} disabled={page === 0}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
            {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i} type="button" onClick={() => onPage(i)}
              className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${i === page ? "bg-brand-500 text-white" : "text-gray-500 hover:bg-gray-200"}`}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button" onClick={onNext} disabled={page >= pageCount - 1}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    )
  );

  return (
    <div className="space-y-4 animate-fadeInUp">

      {/* ─── Controls ─── */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 font-medium">
              Fields: <span className="font-bold text-gray-900">{selectedFields.length}</span> of {allColumns.length}
            </span>
            <button
              type="button"
              onClick={() => setShowConfigure(!showConfigure)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${showConfigure ? "bg-brand-500 text-white border-brand-500" : "text-brand-600 border-brand-200 hover:bg-brand-50"}`}
            >
              {showConfigure ? "Done" : "Configure"}
            </button>
          </div>
          <span className="h-5 w-px bg-gray-200" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Group by</span>
            <select
              value={groupCol}
              onChange={(e) => setGroupCol(e.target.value)}
              className="text-sm font-medium rounded-lg border border-gray-300 focus:ring-2 focus:ring-brand-500 px-2.5 py-1.5 bg-white outline-none"
            >
              {allColumns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <span className="h-5 w-px bg-gray-200" />
          {result && (
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox" checked={showBlankGroup}
                onChange={(e) => setShowBlankGroup(e.target.checked)}
                className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 w-3.5 h-3.5"
              />
              Show "(blank)" group
            </label>
          )}
          <button
            onClick={runAnalysis}
            disabled={loading || !dfRecords?.length}
            className="ml-auto px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-sm transition-all inline-flex items-center gap-2"
          >
            {loading && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Analyze
          </button>
        </div>

        {showConfigure && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <input
              type="text" value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)}
              placeholder="Search fields…"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none mb-3"
            />
            <div className="flex gap-3 mb-3">
              <button type="button" onClick={() => setSelectedFields(defaultFields(allColumns, empCol, mgrCol))} className="text-xs text-brand-600 hover:underline font-medium">Select all</button>
              <button type="button" onClick={() => setSelectedFields([])} className="text-xs text-gray-500 hover:underline">Clear</button>
            </div>
            <div className="max-h-48 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1">
              {filteredFieldOptions.map((col) => (
                <label key={col} className="flex items-center gap-2 text-sm text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selectedFields.includes(col)} onChange={() => toggleField(col)} className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 w-3.5 h-3.5" />
                  <span className="truncate">{col}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Summary strip ─── */}
      {summary && (
        <div className="flex items-center gap-4 px-5 py-3 bg-white border border-gray-200 rounded-xl shadow-sm">
          <MiniDonut pct={overallPct} />
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold ${overallPct >= 90 ? "text-brand-600" : overallPct >= 70 ? "text-amber-600" : "text-red-600"}`}>
              {overallPct}%
            </span>
            <span className="text-sm text-gray-500">complete</span>
          </div>
          <span className="h-5 w-px bg-gray-200" />
          <span className="text-sm text-gray-500">{summary.fields_count} fields</span>
          <span className="text-sm text-gray-500">·</span>
          <span className="text-sm text-gray-500">{groups.length} groups</span>
          {fieldStats.filter((f) => f.pct < 100).length > 0 && (
            <>
              <span className="text-sm text-gray-500">·</span>
              <span className="text-sm font-semibold text-red-600">
                {fieldStats.filter((f) => f.pct < 100).length} field{fieldStats.filter((f) => f.pct < 100).length !== 1 ? "s" : ""} with gaps
              </span>
            </>
          )}
          <div className="ml-auto flex gap-0.5 p-0.5 bg-gray-100 rounded-lg">
            <button type="button" onClick={() => setView("bars")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${view === "bars" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>Fields</button>
            <button type="button" onClick={() => setView("table")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${view === "table" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>Heatmap</button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* ─── FIELDS VIEW ─── */}
      {result && view === "bars" && (
        <div ref={chartRef} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Field completeness — sorted worst first</p>
            <p className="text-xs text-gray-400">Click a row to drill into groups</p>
          </div>
          <div className="divide-y divide-gray-50">
            {visibleBars.map(({ field, pct, missing, gapsIn }) => {
              const barColor = pctBarColor(pct);
              const isComplete = pct >= 100;
              return (
                <div
                  key={field}
                  onClick={() => { setView("table"); setBarsPage(0); }}
                  className={`flex items-center gap-4 px-4 py-2.5 cursor-pointer transition-colors ${isComplete ? "opacity-60 hover:opacity-80" : "hover:bg-gray-50"}`}
                >
                  <span className="text-sm font-medium text-gray-800 w-48 truncate shrink-0" title={field}>{field}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: barColor }} />
                  </div>
                  <span className={`text-sm font-bold w-14 text-right ${pct >= 95 ? "text-brand-600" : pct >= 70 ? "text-amber-600" : "text-red-600"}`}>{pct}%</span>
                  {gapsIn.length > 0 ? (
                    <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full font-medium w-24 text-center shrink-0">{missing} missing</span>
                  ) : (
                    <span className="text-xs text-gray-400 w-24 text-center shrink-0">—</span>
                  )}
                </div>
              );
            })}
          </div>
          <Pagination
            page={barsPage} pageCount={barsPageCount} total={fieldStats.length} pageSize={PAGE_SIZE_BARS}
            onPage={(i) => setBarsPage(i)}
            onPrev={() => setBarsPage((p) => Math.max(0, p - 1))}
            onNext={() => setBarsPage((p) => Math.min(barsPageCount - 1, p + 1))}
          />
        </div>
      )}

      {/* ─── HEATMAP TABLE ─── */}
      {result && view === "table" && groups.length > 0 && (
        <div ref={chartRef} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Group × Field completeness</p>
            <p className="text-xs text-gray-400">Click a red/amber cell to see missing rows below</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#01244a] text-white">
                <tr className="border-b border-[#0b2f4a]">
                  <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-[#01244a] z-20 min-w-[160px]">Field</th>
                  {groups.map((g) => (
                    <th key={g} className="px-2 py-2 font-semibold text-center whitespace-nowrap min-w-[80px]">
                      {g.length > 18 ? `${g.slice(0, 16)}…` : g}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-bold text-center bg-[#01244a] min-w-[60px]">All</th>
                </tr>
              </thead>
              <tbody>
                {visibleTableRows.map(({ field, pct: overallFieldPct }) => (
                  <tr key={field} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-medium text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-100">{field}</td>
                    {groups.map((g) => {
                      const cell = matrixLookup[`${field}||${g}`];
                      const p = cell?.pct_complete ?? 100;
                      const colors = pctColor(p);
                      const hasMissing = cell && cell.missing > 0;
                      return (
                        <td key={g} onClick={() => hasMissing && handleCellClick(field, g)} className={`px-2 py-2 text-center ${hasMissing ? "cursor-pointer" : ""}`}>
                          <div
                            className="inline-flex items-center justify-center min-w-[52px] px-2 py-1 rounded-md font-bold text-[11px] transition-transform hover:scale-105"
                            style={{ backgroundColor: colors.bg, borderLeft: `3px solid ${colors.border}`, color: colors.text }}
                          >
                            {Math.round(p)}%
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center bg-gray-50/60">
                      <span className={`font-bold text-[11px] ${overallFieldPct >= 95 ? "text-brand-600" : overallFieldPct >= 70 ? "text-amber-600" : "text-red-600"}`}>
                        {overallFieldPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={tablePage} pageCount={tablePageCount} total={fieldStats.length} pageSize={PAGE_SIZE_TABLE}
            onPage={(i) => setTablePage(i)}
            onPrev={() => setTablePage((p) => Math.max(0, p - 1))}
            onNext={() => setTablePage((p) => Math.min(tablePageCount - 1, p + 1))}
          />
        </div>
      )}

      {/* ─── Drill-down ─── */}
      {drillDown && (
        <div ref={drillDownRef} className="rounded-xl border border-brand-200 overflow-hidden shadow-sm animate-fadeInUp">
          <div className="flex items-center justify-between px-5 py-3 bg-brand-500 text-white">
            <p className="text-sm font-semibold">
              {drillDown.missing} row{drillDown.missing !== 1 ? "s" : ""} missing{" "}
              <span className="font-mono opacity-80">{drillDown.field}</span>{" "}in{" "}
              <span className="font-mono opacity-80">{drillDown.group}</span>
            </p>
            <div className="flex items-center gap-2">
              {/* Back-to-top button */}
              <button
                type="button"
                onClick={scrollToChart}
                title="Back to chart"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                Back to chart
              </button>
              <button onClick={() => setDrillDown(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors" title="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  {drillCols.filter(Boolean).map((col) => (
                    <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {drillDown.rows.slice(0, 150).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {drillCols.filter(Boolean).map((col) => (
                      <td key={col} className={`px-3 py-2 whitespace-nowrap ${col === empCol ? "font-mono text-xs text-gray-600" : "text-gray-900"} ${col === drillDown.field ? "bg-red-50 text-red-400 italic" : ""}`}>
                        {col === drillDown.field ? "(empty)" : (row[col] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {drillDown.rows.length > 150 && (
              <p className="text-xs text-gray-500 px-4 py-2 bg-gray-50 border-t">
                Showing first 150 of {drillDown.rows.length} rows
              </p>
            )}
          </div>
        </div>
      )}

      {!result && !loading && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm font-medium text-blue-900 mb-1">Data Quality Heatmap</p>
          <p className="text-xs text-blue-700 leading-relaxed">
            Identify which fields are missing values — and where those gaps occur. Click <strong>Analyze</strong> to generate the completeness matrix.
          </p>
        </div>
      )}
    </div>
  );
}
