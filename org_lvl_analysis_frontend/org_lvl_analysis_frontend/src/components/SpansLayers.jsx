import React, { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { spansLayers } from "../api/backend";
import * as XLSX from "xlsx";

export default function SpansLayers({ validatedDf }) {
  const [result, setResult] = useState(null);
  const [threshold, setThreshold] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
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
        downloadMode
      );
      
      if (!downloadMode) {
        setResult(res);
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

  // Start with level 1 (remove level 0)
  const maxLevel = summary.length > 0 ? Math.max(...summary.map(r => r.Level)) : 1;
  const levels = summary.map(r => r.Level);
  const icCounts = summary.map(r => r.IC_Count);
  const mgrCounts = summary.map(r => r.Manager_Count);
  const totals = summary.map(r => r.Total_Employees);

  const maxVal = Math.max(...icCounts, ...mgrCounts, 1);
  const pad = maxVal * 0.2;

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg
              className="w-7 h-7 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              Spans & Layers Analysis
            </h3>
            <p className="text-sm text-gray-600">
              Visualize organizational structure by levels, analyze span of control, and identify management layers.
            </p>
          </div>
        </div>
      </div>

      {/* Dynamic Filter Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <svg
              className="w-5 h-5 text-purple-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            Column Filters (Optional)
          </h4>
          <button
            onClick={addFilter}
            style={{ backgroundColor: '#16a34a', color: 'white' }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:brightness-90"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            Add Filter
          </button>
        </div>

        <div className="space-y-4">
          {filters.map((filter, index) => (
            <div
              key={filter.id}
              className="border border-gray-300 rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-start gap-4">
                {/* Filter Label */}
                <div className="flex-shrink-0 w-16">
                  <div className="flex items-center justify-center w-12 h-12 bg-purple-600 text-white rounded-lg font-bold text-lg">
                    {getFilterLabel(index)}
                  </div>
                </div>

                {/* Filter Configuration */}
                <div className="flex-1 space-y-3">
                  {/* Column Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Column {getFilterLabel(index)}
                    </label>
                    <select
                      value={filter.column}
                      onChange={(e) => updateFilterColumn(filter.id, e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white"
                    >
                      <option value="">Select column...</option>
                      {availableColumns.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>

                  {filter.column && (
                    <>
                      {/* Filter Mode Buttons */}
                      <div className="flex gap-2">
                        {["No Filter", "Include", "Exclude"].map((mode) => (
                          <button
                            key={mode}
                            onClick={() => updateFilterMode(filter.id, mode)}
                            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                              filter.mode === mode
                                ? "bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md"
                                : "bg-white border-2 border-gray-300 text-gray-700 hover:border-purple-400 hover:text-purple-600"
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>

                      {/* Value Selection */}
                      {filter.mode !== "No Filter" && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Filter Values
                          </label>
                          <select
                            multiple
                            value={filter.values}
                            onChange={(e) => {
                              const selected = Array.from(e.target.selectedOptions, option => option.value);
                              updateFilterValues(filter.id, selected);
                            }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white min-h-[100px]"
                          >
                            {getUniqueValues(filter.column).map((val) => (
                              <option key={val} value={val}>{val}</option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            Hold Ctrl/Cmd to select multiple • {filter.values.length} selected
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Remove Button */}
                {filters.length > 1 && (
                  <button
                    onClick={() => removeFilter(filter.id)}
                    className="flex-shrink-0 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove filter"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredDf && filteredDf.length !== baseDf.length && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Filtered:</strong> {filteredDf.length.toLocaleString()} of {baseDf.length.toLocaleString()} rows
            </p>
          </div>
        )}
      </div>

      {/* Threshold Configuration */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-purple-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          Span Threshold Configuration
        </h4>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Span Threshold Value
            </label>
            <input
              type="number"
              step="0.1"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="Enter threshold (e.g., 5.0)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Set to 0 for no threshold filtering. Values above threshold are "high span", below are "low span".
            </p>
          </div>

          {threshold > 0 && result && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <svg
                    className="w-4 h-4 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 10l7-7m0 0l7 7m-7-7v18"
                    />
                  </svg>
                  <span className="text-xs font-medium text-gray-600">High Span</span>
                </div>
                <p className="text-2xl font-bold text-red-600">{result.high || 0}</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <svg
                    className="w-4 h-4 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 14l-7 7m0 0l-7-7m7 7V3"
                    />
                  </svg>
                  <span className="text-xs font-medium text-gray-600">Low Span</span>
                </div>
                <p className="text-2xl font-bold text-blue-600">{result.low || 0}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={() => runSpansLayers(false)}
          disabled={!canRun || loading}
          className="flex-1 px-6 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {loading ? (
            <>
              <svg
                className="animate-spin h-6 w-6 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span className="text-lg">Computing Analysis...</span>
            </>
          ) : (
            <>
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span className="text-lg">Run Spans & Layers Analysis</span>
            </>
          )}
        </button>

        {summary.length > 0 && (
          <button
            onClick={downloadSummary}
            disabled={loading}
            className="px-6 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>Download Summary</span>
          </button>
        )}

        {threshold > 0 && result && (
          <button
            onClick={handleDownload}
            disabled={loading}
            className="px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>Download with Threshold</span>
          </button>
        )}
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
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h4 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <svg
                className="w-5 h-5 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              Analysis Results
            </h4>
          </div>

          <div className="p-6">
            {/* Summary Table and Pyramid side by side */}
            <div className="grid grid-cols-12 gap-4">
              {/* Summary Table - Takes 4 columns */}
              <div className="col-span-4">
                <h5 className="text-base font-semibold text-gray-800 mb-3">Spans & Layers Summary</h5>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Level</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">IC</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Mgr</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Total</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Avg Span</th>
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

              {/* Pyramid Chart - Takes 8 columns */}
              <div className="col-span-8">
                <div className="overflow-auto" style={{ maxHeight: '600px' }}>
                  <Plot
                    data={[
                      {
                        y: levels,
                        x: icCounts.map((x) => -x),
                        type: "bar",
                        orientation: "h",
                        marker: { color: "#5C8BB4" },
                        showlegend: false,
                        hoverinfo: "skip",
                      },
                      {
                        y: levels,
                        x: mgrCounts.map((x) => -x),
                        type: "bar",
                        orientation: "h",
                        marker: { color: "#01244A" },
                        showlegend: false,
                        hoverinfo: "skip",
                      },
                      {
                        y: levels,
                        x: icCounts,
                        type: "bar",
                        orientation: "h",
                        name: "Individual Contributors",
                        marker: { color: "#5C8BB4" },
                        text: icCounts,
                        textposition: "inside",
                        textfont: { color: "white", size: 12 },
                      },
                      {
                        y: levels,
                        x: mgrCounts,
                        type: "bar",
                        orientation: "h",
                        name: "Managers",
                        marker: { color: "#01244A" },
                        text: mgrCounts,
                        textposition: "inside",
                        textfont: { color: "white", size: 12 },
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
                      width: 800,
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
                      toImageButtonOptions: {
                        format: 'png',
                        filename: `org_pyramid_${new Date().toISOString().split('T')[0]}`,
                        height: 80 + (summary.length * 41),
                        width: 800,
                        scale: 2
                      }
                    }}
                    style={{ width: "800px" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-900 mb-1">
              About Spans & Layers
            </p>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• <strong>Pyramid View:</strong> Visualizes organization structure with ICs (blue) and Managers (red)</li>
              <li>• <strong>Span of Control:</strong> Average number of direct reports per manager at each level</li>
              <li>• <strong>Dynamic Filters:</strong> Add multiple column filters to analyze specific segments</li>
              <li>• <strong>Filter Modes:</strong> Include or Exclude selected values, hold Ctrl/Cmd for multiple selections</li>
              <li>• <strong>Threshold Analysis:</strong> Identifies managers with high or low spans compared to threshold</li>
              <li>• <strong>Requirements:</strong> Data must include 'Span' and 'Level' columns (run Hierarchy first)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}