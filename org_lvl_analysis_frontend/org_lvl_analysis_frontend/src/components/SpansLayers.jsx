import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Plot from "react-plotly.js";
import { spansLayers, hierarchy as hierarchyBackend } from "../api/backend";
import * as XLSX from "xlsx";

const NAVY = "#01244A";
const BLUE_MID = "#5C8BB4";

function OpenInOrgChartButton({ empId, onJump }) {
  if (!empId || !onJump) return null;
  return (
    <button
      type="button"
      onClick={() => onJump(empId)}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-brand-600 hover:text-white hover:bg-brand-500 rounded-lg border border-brand-200 hover:border-brand-500 transition-all duration-150"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      Org Chart
    </button>
  );
}

function StatCard({ label, value, sub, icon }) {
  return (
    <div className="relative overflow-hidden bg-white/90 backdrop-blur-sm border border-brand-100 rounded-xl p-4 shadow-card hover:shadow-panel hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent pointer-events-none" />
      <div className="relative flex items-center gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{label}</p>
          <p className="text-xl font-extrabold text-[#01244a] mt-1.5 leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{value}</p>
        </div>
      </div>
      {sub && (
        <div className="relative mt-3.5 pt-2.5 border-t border-slate-100/60">
          <p className="text-[11px] text-slate-400 font-medium leading-normal">{sub}</p>
        </div>
      )}
    </div>
  );
}


export default function SpansLayers({
  validatedDf,
  setValidatedDf,
  empCol = "",
  mgrCol = "",
  fteCol = "",
  flcCol = "",
  jobTitleCol = "",
  datasetId = null,
  onJumpToOrgChart,
}) {
  const [result, setResult] = useState(null);
  const [threshold, setThreshold] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [analysisTab, setAnalysisTab] = useState("micro");
  const enrichingRef = useRef(false);
  
  // Dynamic filter states
  const [filters, setFilters] = useState([
    { id: 1, column: "", mode: "No Filter", values: [] },
    { id: 2, column: "", mode: "No Filter", values: [] }
  ]);
  const [nextId, setNextId] = useState(3);
  const [filteredDf, setFilteredDf] = useState(null);

  // Safety check
  const baseDf = Array.isArray(validatedDf) ? validatedDf : [];

  const canRun =
    baseDf.length > 0 &&
    baseDf[0]?.hasOwnProperty("Span") &&
    baseDf[0]?.hasOwnProperty("Level");

  const needsEnrichment =
    baseDf.length > 0 &&
    empCol &&
    mgrCol &&
    (!baseDf[0]?.hasOwnProperty("Span") || !baseDf[0]?.hasOwnProperty("Level"));

  const getDisplayName = useCallback((row) => {
    if (!row) return "";
    if (jobTitleCol && row[jobTitleCol]) return String(row[jobTitleCol]);
    for (const c of ["Name", "Employee Name", "Full Name"]) {
      if (row[c]) return String(row[c]);
    }
    return empCol ? String(row[empCol] ?? "") : "";
  }, [empCol, jobTitleCol]);

  // Auto-enrich Span + Level via hierarchy when missing
  useEffect(() => {
    if (!needsEnrichment || enrichingRef.current) return;
    const run = async () => {
      enrichingRef.current = true;
      setEnriching(true);
      setError(null);
      try {
        const res = await hierarchyBackend(
          validatedDf, empCol, mgrCol, flcCol || null, fteCol || null,
          false, jobTitleCol || null, datasetId || null
        );
        if (res?.df && setValidatedDf) setValidatedDf(res.df);
      } catch (err) {
        console.error("Auto-enrichment failed:", err);
        setError("Could not compute Span/Level automatically. Run Hierarchy first.");
      } finally {
        setEnriching(false);
        enrichingRef.current = false;
      }
    };
    run();
  }, [needsEnrichment, validatedDf, empCol, mgrCol, flcCol, fteCol, jobTitleCol, datasetId, setValidatedDf]);

  // Get available columns for filtering
  const availableColumns = baseDf.length > 0 ? Object.keys(baseDf[0]) : [];

  const addFilter = () => {
    setFilters([...filters, { id: nextId, column: "", mode: "No Filter", values: [] }]);
    setNextId(nextId + 1);
  };

  const removeFilter = (id) => {
    if (filters.length > 1) {
      setFilters(filters.filter(f => f.id !== id));
    }
  };

  const updateFilterColumn = (id, column) => {
    setFilters(filters.map(f => 
      f.id === id ? { ...f, column, values: [] } : f
    ));
  };

  const updateFilterMode = (id, mode) => {
    setFilters(filters.map(f => 
      f.id === id ? { ...f, mode, values: mode === "No Filter" ? [] : f.values } : f
    ));
  };

  const updateFilterValues = (id, values) => {
    setFilters(filters.map(f => 
      f.id === id ? { ...f, values } : f
    ));
  };

  const getFilterLabel = (index) => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (index < 26) return letters[index];
    return letters[Math.floor(index / 26) - 1] + letters[index % 26];
  };

  // Get unique values for a column
  const getUniqueValues = (colName) => {
    if (!colName || !baseDf.length) return [];
    const values = [...new Set(baseDf.map(row => row[colName]).filter(v => v != null))];
    
    // Sort numerically if column is "Level", otherwise sort as strings
    if (colName === "Level") {
      return values.sort((a, b) => Number(a) - Number(b));
    }
    return values.sort();
  };

  // Apply filters to dataframe
  useEffect(() => {
    if (!baseDf.length) {
      setFilteredDf(null);
      return;
    }

    let filtered = [...baseDf];

    // Apply all active filters
    filters.forEach(filter => {
      if (filter.column && filter.mode !== "No Filter" && filter.values.length > 0) {
        if (filter.mode === "Include") {
          filtered = filtered.filter(row => {
            const value = row[filter.column];
            // Handle numeric comparison for Level column
            if (filter.column === "Level") {
              return filter.values.map(v => Number(v)).includes(Number(value));
            }
            return filter.values.includes(value);
          });
        } else if (filter.mode === "Exclude") {
          filtered = filtered.filter(row => {
            const value = row[filter.column];
            // Handle numeric comparison for Level column
            if (filter.column === "Level") {
              return !filter.values.map(v => Number(v)).includes(Number(value));
            }
            return !filter.values.includes(value);
          });
        }
      }
    });

    setFilteredDf(filtered);
  }, [baseDf, filters]);

  // Run backend analysis
  const runSpansLayers = async (downloadMode = false) => {
    const dataToAnalyze = filteredDf && filteredDf.length > 0 ? filteredDf : baseDf;
    
    if (!dataToAnalyze.length || !dataToAnalyze[0]?.hasOwnProperty("Span")) {
      setError("Data must have 'Span' and 'Level' columns. Please run Hierarchy first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await spansLayers(
        dataToAnalyze,
        threshold || 0,
        downloadMode,
        empCol || null,
        mgrCol || null,
        fteCol || null
      );
      
      if (!downloadMode) {
        setResult(res);
        setSelectedLayer(null);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Failed to compute Spans & Layers. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (threshold <= 0) {
      setError("Please set a threshold value greater than 0 to download marked data.");
      return;
    }
    runSpansLayers(true);
  };

  // Download summary as Excel
  const downloadSummary = () => {
    if (!result || !result.summary || result.summary.length === 0) {
      setError("No summary data available to download.");
      return;
    }

    try {
      const ws = XLSX.utils.json_to_sheet(result.summary);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Spans & Layers Summary");
      XLSX.writeFile(wb, `spans_layers_summary_${new Date().toISOString().split('T')[0]}.xlsx`);
      console.log("✅ Summary downloaded successfully");
    } catch (err) {
      console.error("❌ Failed to download summary:", err);
      setError("Failed to download summary.");
    }
  };

  // Summary data
  const summary = result?.summary || [];
  const insights = result?.insights;

  const layerEmployees = useMemo(() => {
    if (selectedLayer == null || !result?.df?.length) return [];
    const lvl = Number(selectedLayer);
    return result.df
      .filter((r) => Number(r.Level) === lvl)
      .map((r) => ({
        emp_id: empCol ? String(r[empCol]) : "",
        name: getDisplayName(r),
        span: Number(r.Span || 0),
        is_manager: Number(r.Span || 0) > 0,
      }));
  }, [selectedLayer, result, empCol, getDisplayName]);

  const handlePlotClick = (event) => {
    const pt = event?.points?.[0];
    if (!pt) return;
    const layer = pt.y;
    setSelectedLayer(layer);
  };

  const barColor = (level, base) =>
    selectedLayer != null && Number(level) === Number(selectedLayer) ? NAVY : base;

  // Start with level 1 (remove level 0)
  const maxLevel = summary.length > 0 ? Math.max(...summary.map(r => r.Level)) : 1;
  const levels = summary.map(r => r.Level);
  const icCounts = summary.map(r => r.IC_Count);
  const mgrCounts = summary.map(r => r.Manager_Count);
  const totals = summary.map(r => r.Total_Employees);

  const maxVal = Math.max(...icCounts, ...mgrCounts, 1);
  const pad = maxVal * 0.2;

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      {/* Header - compact */}
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-bold text-gray-900">Spans & Layers Analysis</h3>
          <p className="text-xs text-gray-500">Visualize organizational structure by levels, analyze span of control, and identify management layers.</p>
        </div>
      </div>

      {/* Auto-enrichment banner */}
      {enriching && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <p className="text-xs text-brand-700 font-medium">Computing hierarchy levels and spans…</p>
        </div>
      )}

      {/* Filters - inline row */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </h4>
          <button
            onClick={addFilter}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map((filter, index) => (
            <div key={filter.id} className="flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50">
              <span className="flex items-center justify-center w-6 h-6 bg-brand-500 text-white rounded text-xs font-bold flex-shrink-0">
                {getFilterLabel(index)}
              </span>
              <select
                value={filter.column}
                onChange={(e) => updateFilterColumn(filter.id, e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-brand-500 outline-none bg-white min-w-[120px]"
              >
                <option value="">Column...</option>
                {availableColumns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              {filter.column && (
                <>
                  <div className="flex border border-gray-300 rounded overflow-hidden">
                    {["No Filter", "Include", "Exclude"].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateFilterMode(filter.id, mode)}
                        className={`px-2 py-1 text-[10px] font-medium transition ${
                          filter.mode === mode
                            ? "bg-brand-500 text-white"
                            : "bg-white text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        {mode === "No Filter" ? "Off" : mode}
                      </button>
                    ))}
                  </div>
                  {filter.mode !== "No Filter" && (
                    <select
                      multiple
                      value={filter.values}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, option => option.value);
                        updateFilterValues(filter.id, selected);
                      }}
                      className="border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-brand-500 outline-none bg-white min-w-[100px] max-h-[60px]"
                    >
                      {getUniqueValues(filter.column).map((val) => (
                        <option key={val} value={val}>{val}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {filters.length > 1 && (
                <button onClick={() => removeFilter(filter.id)} className="p-0.5 text-red-500 hover:text-red-700" title="Remove">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>

        {filteredDf && filteredDf.length !== baseDf.length && (
          <p className="text-xs text-blue-700 mt-2">
            <strong>Filtered:</strong> {filteredDf.length.toLocaleString()} of {baseDf.length.toLocaleString()} rows
          </p>
        )}
      </div>

      {/* Threshold + Action Buttons - all in one row */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Span Threshold</label>
            <input
              type="number"
              step="0.1"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500 outline-none"
            />
          </div>

          {threshold > 0 && result && (
            <>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 border border-red-200 rounded-md">
                <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                <span className="text-xs text-gray-600">High</span>
                <span className="text-sm font-bold text-red-600">{result.high || 0}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-md">
                <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span className="text-xs text-gray-600">Low</span>
                <span className="text-sm font-bold text-blue-600">{result.low || 0}</span>
              </div>
            </>
          )}

          <div className="flex-1" />

          <button
            onClick={() => runSpansLayers(false)}
            disabled={!canRun || loading}
            className="px-4 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-md text-sm font-semibold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Computing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Run Analysis
              </>
            )}
          </button>

          {summary.length > 0 && (
            <button
              onClick={downloadSummary}
              disabled={loading}
              className="px-3 py-1.5 bg-white border border-brand-500 text-brand-600 hover:bg-brand-50 rounded-md text-sm font-medium transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Summary
            </button>
          )}

          {threshold > 0 && result && (
            <button
              onClick={handleDownload}
              disabled={loading}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Threshold
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-fadeIn">
          <svg
            className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="font-medium text-red-900">Analysis Failed</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Results Section */}
      {summary.length > 0 && (
        <>
          {/* Summary stat strip */}
          {insights && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="1:1 Managers"
                value={insights.one_to_one_count ?? 0}
                sub="Micro-teams (span = 1)"
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                }
              />
              <StatCard
                label="FTE Opportunity"
                value={threshold > 0 ? (insights.fte_opportunity ?? 0) : "—"}
                sub={threshold > 0 ? `Below target span (${threshold})` : "Set threshold to compute"}
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                }
              />
              <StatCard
                label="Thin Layers"
                value={insights.thin_layer_count ?? 0}
                sub="Consecutive 1:1 chains"
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                }
              />
              <StatCard
                label="Avg Span"
                value={insights.avg_span ?? "—"}
                sub="Managers only"
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                }
              />
            </div>
          )}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Analysis Results
            </h4>
          </div>

          <div className="p-4">
            {/* Summary Table and Pyramid side by side */}
            <div className="grid grid-cols-12 gap-4">
              {/* Summary Table - Takes 3 columns */}
              <div className="col-span-3">
                <h5 className="text-xs font-semibold text-gray-700 mb-2">Summary</h5>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-[#01244a] text-white">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold">Level</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">IC</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Mgr</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Total</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Avg Span</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {summary.map((r) => (
                        <tr key={r.Level} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-900">{r.Level}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{r.IC_Count || "-"}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{r.Manager_Count || "-"}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{r.Total_Employees || "-"}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{r.Avg_Span || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pyramid Chart - Takes 9 columns */}
              <div className="col-span-9">
                <p className="text-xs text-gray-400 mb-2">Click a layer bar to drill down into employees</p>
                <div className="overflow-auto" style={{ maxHeight: "600px", width: "100%" }}>
                  <Plot
                    onClick={handlePlotClick}
                    data={[
                      {
                        y: levels,
                        x: icCounts.map((x) => -x),
                        type: "bar",
                        orientation: "h",
                        marker: { color: levels.map((l) => barColor(l, BLUE_MID)) },
                        showlegend: false,
                        hoverinfo: "skip",
                      },
                      {
                        y: levels,
                        x: mgrCounts.map((x) => -x),
                        type: "bar",
                        orientation: "h",
                        marker: { color: levels.map((l) => barColor(l, NAVY)) },
                        showlegend: false,
                        hoverinfo: "skip",
                      },
                      {
                        y: levels,
                        x: icCounts,
                        type: "bar",
                        orientation: "h",
                        name: "Individual Contributors",
                        marker: { color: levels.map((l) => barColor(l, BLUE_MID)) },
                        text: icCounts,
                        textposition: "inside",
                        textfont: { color: "white", size: 12 },
                        hovertemplate: "<b>Layer %{y}</b><br>%{x} ICs<br><i>Click to drill down</i><extra></extra>",
                      },
                      {
                        y: levels,
                        x: mgrCounts,
                        type: "bar",
                        orientation: "h",
                        name: "Managers",
                        marker: { color: levels.map((l) => barColor(l, NAVY)) },
                        text: mgrCounts,
                        textposition: "inside",
                        textfont: { color: "white", size: 12 },
                        hovertemplate: "<b>Layer %{y}</b><br>%{x} managers<br><i>Click to drill down</i><extra></extra>",
                      },
                      {
                        y: levels,
                        x: new Array(levels.length).fill(0),
                        type: "bar",
                        orientation: "h",
                        text: totals,
                        textposition: "outside",
                        marker: { color: "rgba(0,0,0,0)" },
                        showlegend: false,
                        textfont: {
                          size: 14,
                          family: "Arial Black",
                          color: "black",
                        },
                        hoverinfo: "skip",
                      },
                    ]}
                    layout={{
                      height: 80 + (summary.length * 41),
                      barmode: "relative",
                      bargap: 0.1,
                      bargroupgap: 0.05,
                      plot_bgcolor: "white",
                      paper_bgcolor: "white",
                      yaxis: {
                        autorange: "reversed",
                        range: [0, maxLevel],
                        tickvals: levels,
                        ticktext: levels.map(l => String(l)),
                        tickfont: { size: 12 },
                        fixedrange: false,
                        title: "",
                      },
                      xaxis: {
                        range: [-(maxVal + pad), maxVal + pad],
                        title: "Employee Count",
                        zeroline: true,
                        fixedrange: false,
                        showticklabels: false,
                      },
                      margin: { l: 10, r: 10, t: 50, b: 20 },
                      showlegend: true,
                      legend: {
                        orientation: "h",
                        yanchor: "bottom",
                        y: -0.15,
                        xanchor: "center",
                        x: 0.5,
                      },
                    }}
                    config={{ 
                      displayModeBar: true,
                      displaylogo: false,
                      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
                      scrollZoom: true,
                      responsive: true,
                      toImageButtonOptions: {
                        format: 'png',
                        filename: `org_pyramid_${new Date().toISOString().split('T')[0]}`,
                        height: 80 + (summary.length * 41),
                        scale: 2
                      }
                    }}
                    style={{ width: "100%" }}
                    useResizeHandler
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

          {/* Layer drill-down */}
          {selectedLayer != null && layerEmployees.length > 0 && (
            <div className="mt-4 rounded-xl border border-gray-200 overflow-hidden shadow-sm transition-all duration-300 animate-fadeInUp">
              <div className="bg-[#01244a] text-white px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-bold">L{selectedLayer}</span>
                  <p className="text-sm font-semibold">Layer {selectedLayer} — {layerEmployees.length} employees</p>
                </div>
                <button type="button" onClick={() => setSelectedLayer(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors" title="Close">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-sm">
                  <thead className="bg-[#01244a] text-white sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold">Employee</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold">ID</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold">Span</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold">Role</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {layerEmployees.map((row) => (
                      <tr key={row.emp_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900">{row.name || row.emp_id}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{row.emp_id}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{row.span}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${row.is_manager ? "bg-[#01244a]/10 text-[#01244a]" : "bg-blue-50 text-blue-700"}`}>
                            {row.is_manager ? "Manager" : "IC"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <OpenInOrgChartButton empId={row.emp_id} onJump={onJumpToOrgChart} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Analysis tabs */}
          {insights && (
            <div className="mt-4">
              <div className="border-b border-gray-200 flex gap-0">
                {[
                  { id: "micro", label: "Micro-Teams", count: insights.one_to_one_count },
                  { id: "below", label: "Below Target", count: insights.below_target_count },
                  { id: "thin", label: "Thin Layers", count: insights.thin_layer_count },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAnalysisTab(tab.id)}
                    className={`px-5 py-3 text-sm font-medium transition-colors ${
                      analysisTab === tab.id
                        ? "border-b-2 border-brand-500 text-brand-600 font-semibold bg-white"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="bg-white border border-gray-200 border-t-0 rounded-b-xl p-5 shadow-sm">
                {analysisTab === "micro" && (
                  <>
                    <div className="mb-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full text-xs font-semibold text-red-700">
                        {insights.one_to_one_count} manager{insights.one_to_one_count !== 1 ? "s" : ""} with exactly 1 direct report
                      </span>
                    </div>
                    {insights.one_to_one_managers?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#01244a] text-white">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold">Manager</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold">ID</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold">Level</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold">Span</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {insights.one_to_one_managers.map((m) => (
                              <tr key={m.emp_id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium">{m.name}</td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-500">{m.emp_id}</td>
                                <td className="px-3 py-2 text-right">{m.level}</td>
                                <td className="px-3 py-2 text-right text-red-600 font-semibold">{m.span}</td>
                                <td className="px-3 py-2 text-right"><OpenInOrgChartButton empId={m.emp_id} onJump={onJumpToOrgChart} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No 1:1 managers detected.</p>
                    )}
                  </>
                )}
                {analysisTab === "below" && (
                  <>
                    <div className="mb-4">
                      {threshold > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-xs font-semibold text-amber-700">
                          {insights.below_target_count} manager{insights.below_target_count !== 1 ? "s" : ""} below target span of {threshold} · FTE opportunity: {insights.fte_opportunity}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500">Set a span threshold above 0 to identify below-target managers.</span>
                      )}
                    </div>
                    {threshold > 0 && insights.below_target?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#01244a] text-white">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold">Manager</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Current Span</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Target</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Gap</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">FTE</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {insights.below_target.map((m) => (
                              <tr key={m.emp_id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium">{m.name}</td>
                                <td className="px-3 py-2 text-right text-amber-600 font-semibold">{m.current_span}</td>
                                <td className="px-3 py-2 text-right">{m.target_span}</td>
                                <td className="px-3 py-2 text-right text-red-600">{m.gap}</td>
                                <td className="px-3 py-2 text-right">{m.fte}</td>
                                <td className="px-3 py-2 text-right"><OpenInOrgChartButton empId={m.emp_id} onJump={onJumpToOrgChart} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : threshold > 0 ? (
                      <p className="text-sm text-gray-500">All managers meet the target span.</p>
                    ) : null}
                  </>
                )}
                {analysisTab === "thin" && (
                  <>
                    <div className="mb-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full text-xs font-semibold text-red-700">
                        {insights.thin_layer_count} consecutive 1:1 management chain{insights.thin_layer_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {insights.thin_layers?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#01244a] text-white">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold">Manager</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold">Report</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Level</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {insights.thin_layers.map((t, i) => (
                              <tr key={`${t.emp_id}-${i}`} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium">{t.name}</td>
                                <td className="px-3 py-2 text-gray-600">{t.report_name} <span className="font-mono text-xs text-gray-400">({t.report_id})</span></td>
                                <td className="px-3 py-2 text-right">{t.level}</td>
                                <td className="px-3 py-2 text-right">
                                  <OpenInOrgChartButton empId={t.emp_id} onJump={onJumpToOrgChart} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No thin-layer chains detected.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Info Box */}
      <details className="bg-blue-50 border border-blue-200 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-blue-900 cursor-pointer flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          About Spans & Layers
        </summary>
        <ul className="px-3 pb-2 text-[11px] text-blue-700 space-y-0.5 columns-2">
          <li>• <strong>Pyramid:</strong> ICs (blue) vs Managers (navy)</li>
          <li>• <strong>Span:</strong> Avg direct reports per manager</li>
          <li>• <strong>Filters:</strong> Add column filters for segments</li>
          <li>• <strong>Threshold:</strong> High/low span detection</li>
          <li>• <strong>Insights:</strong> Micro-teams, thin layers</li>
          <li>• <strong>Org Chart:</strong> Click to jump & fix</li>
        </ul>
      </details>
    </div>
  );
}