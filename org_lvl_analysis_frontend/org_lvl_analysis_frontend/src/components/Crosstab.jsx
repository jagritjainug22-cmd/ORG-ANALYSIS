import React, { useState, useEffect } from "react";
import { crosstab } from "../api/backend";

/** Apply formula columns client-side before crosstab (mirrors formula_service.py) */
function applyFormulasToRecords(records, formulas) {
  if (!formulas?.length || !records?.length) return records;
  return records.map((record) => {
    const r = { ...record };
    formulas.forEach(({ col_name, expression }) => {
      if (!col_name || !expression) return;
      try {
        const cols = Object.keys(record).sort((a, b) => b.length - a.length);
        let expr = expression;
        const vals = {};
        cols.forEach((col) => {
          const safe = col.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "col_$1") || "col_x";
          vals[safe] = parseFloat(record[col]) || 0;
          expr = expr.split(col).join(safe);
        });
        expr = expr.replace(/\^/g, "**");
        if (/[^0-9a-zA-Z_\s+\-*/.()^]/.test(expr)) return;
        const fn = new Function(...Object.keys(vals), `"use strict"; return (${expr});`);
        const result = fn(...Object.values(vals));
        r[col_name] = isFinite(result) ? Math.round(result * 10000) / 10000 : null;
      } catch { /* skip bad formulas silently */ }
    });
    return r;
  });
}

export default function Crosstab({ df, fteCol, flcCol, formulas = [], datasetId = null }) {
  const [colX, setColX] = useState("");
  const [colY, setColY] = useState("");
  const [rows, setRows] = useState([]);
  const [multiHeaders, setMultiHeaders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Others grouping state
  const [enableOthersGrouping, setEnableOthersGrouping] = useState(false);
  const [colXThreshold, setColXThreshold] = useState(5);
  const [colYThreshold, setColYThreshold] = useState(5);
  const [thresholdMetric, setThresholdMetric] = useState("Count");
  const [previewData, setPreviewData] = useState(null);
  const [excludedCategories, setExcludedCategories] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  // Apply formula columns so derived columns appear in selectors & backend call
  const enrichedDf = applyFormulasToRecords(df || [], formulas);
  const columns = enrichedDf?.length ? Object.keys(enrichedDf[0]) : [];
  const canRun = enrichedDf?.length > 0;

  // Available threshold metrics
  const thresholdMetrics = ["Count", "FTEs", "FLC", "Avg_FTE_cost"];

  // Reset excluded categories when grouping is disabled
  useEffect(() => {
    if (!enableOthersGrouping) {
      setExcludedCategories([]);
      setPreviewData(null);
      setShowPreview(false);
    }
  }, [enableOthersGrouping]);

  // Helper function to format values based on column type
  const formatValue = (value, columnKey) => {
    if (value === null || value === undefined) return "-";
    
    // Check if this is an FTE column (including in multiindex)
    if (columnKey.includes("FTEs") || columnKey === "FTEs") {
      return Math.round(value).toLocaleString();
    }
    
    // Check if this is FLC or Avg_FTE_cost - format in millions or thousands
    if (columnKey.includes("FLC") || columnKey.includes("Avg_FTE") || 
        columnKey === "FLC" || columnKey === "Avg_FTE_cost") {
      const numValue = Number(value);
      
      // If >= 1 million, show in millions with 1 decimal place
      if (Math.abs(numValue) >= 1000000) {
        const millions = numValue / 1000000;
        return `$${millions.toFixed(1)}M`;
      }
      // If >= 1 thousand, show in thousands with 1 decimal place
      else if (Math.abs(numValue) >= 1000) {
        const thousands = numValue / 1000;
        return `$${thousands.toFixed(1)}K`;
      }
      // Otherwise show the full number with 1 decimal place
      else {
        return `$${numValue.toFixed(1)}`;
      }
    }
    
    return value;
  };

  const fetchPreview = async () => {
    if (!df?.length || (!colX && !colY)) {
      setError("Please select at least one dimension to preview grouping.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await crosstab(
        enrichedDf, 
        colX || null, 
        colY || null, 
        fteCol || null, 
        flcCol || null, 
        false,
        colX ? colXThreshold : null,
        colY ? colYThreshold : null,
        thresholdMetric,
        [],
        true
      );
      
      if (res.preview_data) {
        setPreviewData(res.preview_data);
        setShowPreview(true);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Failed to fetch preview.");
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    if (!enrichedDf?.length) {
      setError("No data available. Please upload and validate data first.");
      return;
    }
    
    setLoading(true);
    setRows([]);
    setMultiHeaders([]);
    setError(null);

    try {
      // Only pass others grouping params if enabled
      const res = enableOthersGrouping 
        ? await crosstab(
            enrichedDf, 
            colX || null, 
            colY || null, 
            fteCol || null, 
            flcCol || null, 
            false,
            colX ? colXThreshold : null,
            colY ? colYThreshold : null,
            thresholdMetric,
            excludedCategories,
            false
          )
        : await crosstab(
            enrichedDf, 
            colX || null, 
            colY || null, 
            fteCol || null, 
            flcCol || null, 
            false
          );
      
      if (res.is_multiindex) {
        const grouped = {};
        res.columns.forEach((c) => {
          if (!grouped[c.x]) grouped[c.x] = [];
          // Shorten metrics for display
          let metricLabel = c.metric;
          if (metricLabel === "Avg_FTE_cost") metricLabel = "Avg_FTE";
          grouped[c.x].push(metricLabel);
        });
        setMultiHeaders(grouped);

        const output = res.crosstab.map((row, i) => {
          const obj = { Index: res.index[i] };
          res.columns.forEach((c, j) => {
            obj[`${c.x} | ${c.metric}`] = row[j];
          });
          return obj;
        });
        setRows(output);
      } else {
        setMultiHeaders([]);
        const output = res.crosstab.map((row, i) => {
          const obj = { Index: res.index[i] };
          res.columns.forEach((c, j) => {
            obj[c.name] = row[j];
          });
          return obj;
        });
        setRows(output);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Failed to generate crosstab. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = async () => {
    try {
      if (enableOthersGrouping) {
        await crosstab(
          enrichedDf, 
          colX || null, 
          colY || null, 
          fteCol || null, 
          flcCol || null, 
          true,
          colX ? colXThreshold : null,
          colY ? colYThreshold : null,
          thresholdMetric,
          excludedCategories,
          false
        );
      } else {
        await crosstab(
          enrichedDf, 
          colX || null, 
          colY || null, 
          fteCol || null, 
          flcCol || null, 
          true
        );
      }
    } catch (err) {
      console.error(err);
      setError("Failed to export Excel file.");
    }
  };

  const toggleExcludeCategory = (category, dimension) => {
    const key = `${dimension}:${category}`;
    setExcludedCategories(prev => 
      prev.includes(key) 
        ? prev.filter(c => c !== key)
        : [...prev, key]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
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
                d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900 mb-1">
              Crosstab Analysis
            </h3>
            <p className="text-xs text-gray-500">
              Generate pivot tables to analyze your data by different dimensions with optional FTE and FLC metrics.
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-brand-500"
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
          Dimension Selection
        </h4>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Column X (Rows)
            </label>
            <select
              value={colX}
              onChange={(e) => setColX(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all bg-white hover:border-gray-400"
            >
              <option value="">Select column...</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              This will be displayed as rows in the crosstab
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Column Y (Columns)
            </label>
            <select
              value={colY}
              onChange={(e) => setColY(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all bg-white hover:border-gray-400"
            >
              <option value="">Select column...</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              This will be displayed as columns in the crosstab
            </p>
          </div>
        </div>

        {(fteCol || flcCol) && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Metrics enabled:</strong>
              {fteCol && " FTE calculations"}
              {fteCol && flcCol && " and"}
              {flcCol && " FLC calculations"}
            </p>
          </div>
        )}
      </div>

      {/* Others Grouping Section */}
      <div className="bg-white border border-gray-200 rounded-md p-4">
        <div className="flex items-center gap-3 mb-3">
          <input
            type="checkbox"
            id="enableOthers"
            checked={enableOthersGrouping}
            onChange={(e) => setEnableOthersGrouping(e.target.checked)}
            className="w-5 h-5 text-brand-500 border-gray-300 rounded focus:ring-2 focus:ring-brand-500"
          />
          <label htmlFor="enableOthers" className="text-sm font-semibold text-gray-800 flex items-center gap-2 cursor-pointer">
            <svg className="w-5 h-5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Enable "Others" Grouping
          </label>
        </div>

        {enableOthersGrouping && (
          <div className="space-y-4 pt-3 border-t border-gray-200">
            {/* Threshold Metric Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Threshold Metric</label>
              <select
                value={thresholdMetric}
                onChange={(e) => setThresholdMetric(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all bg-white hover:border-gray-400"
              >
                {thresholdMetrics.map((metric) => (
                  <option key={metric} value={metric}>{metric}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Categories below the threshold percentage of this metric will be grouped as "Others"</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Column X Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Column X Threshold (%)
                  {!colX && <span className="text-gray-400 ml-1">(Column X not selected)</span>}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={colXThreshold}
                  onChange={(e) => setColXThreshold(parseFloat(e.target.value) || 0)}
                  disabled={!colX}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">Group categories with less than this % as "Others"</p>
              </div>

              {/* Column Y Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Column Y Threshold (%)
                  {!colY && <span className="text-gray-400 ml-1">(Column Y not selected)</span>}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={colYThreshold}
                  onChange={(e) => setColYThreshold(parseFloat(e.target.value) || 0)}
                  disabled={!colY}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">Group categories with less than this % as "Others"</p>
              </div>
            </div>

            {/* Preview Button */}
            <button
              onClick={fetchPreview}
              disabled={loading || (!colX && !colY)}
              className="w-full px-3 py-2 bg-brand-100 hover:bg-brand-200 text-brand-700 rounded-md font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
                  Preview Categories to be Grouped
            </button>

            {/* Preview Results */}
            {showPreview && previewData && (
              <div className="mt-3 p-3 bg-brand-50 border border-brand-200 rounded-md">
                <h5 className="font-semibold text-gray-800 mb-2">Categories to be grouped as "Others":</h5>
                
                {previewData.colX_categories && previewData.colX_categories.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Column X (Rows):</p>
                    <div className="space-y-2">
                      {previewData.colX_categories
                        .filter(cat => cat.percentage < colXThreshold)
                        .map((cat, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!excludedCategories.includes(`colX:${cat.name}`)}
                              onChange={() => toggleExcludeCategory(cat.name, 'colX')}
                              className="w-4 h-4 text-brand-500 border-gray-300 rounded focus:ring-2 focus:ring-brand-500"
                            />
                            <span className="text-gray-700">
                              {cat.name} ({cat.percentage.toFixed(1)}% - {thresholdMetric}: {cat.metric_value.toLocaleString()})
                            </span>
                          </div>
                        ))}
                      {previewData.colX_categories.filter(cat => cat.percentage < colXThreshold).length === 0 && (
                        <p className="text-sm text-gray-500 italic">No categories below threshold</p>
                      )}
                    </div>
                  </div>
                )}

                {previewData.colY_categories && previewData.colY_categories.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Column Y (Columns):</p>
                    <div className="space-y-2">
                      {previewData.colY_categories
                        .filter(cat => cat.percentage < colYThreshold)
                        .map((cat, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!excludedCategories.includes(`colY:${cat.name}`)}
                              onChange={() => toggleExcludeCategory(cat.name, 'colY')}
                              className="w-4 h-4 text-brand-500 border-gray-300 rounded focus:ring-2 focus:ring-brand-500"
                            />
                            <span className="text-gray-700">
                              {cat.name} ({cat.percentage.toFixed(1)}% - {thresholdMetric}: {cat.metric_value.toLocaleString()})
                            </span>
                          </div>
                        ))}
                      {previewData.colY_categories.filter(cat => cat.percentage < colYThreshold).length === 0 && (
                        <p className="text-sm text-gray-500 italic">No categories below threshold</p>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-600 mt-3 italic">
                  Uncheck categories you want to keep separate (not group as "Others")
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={generate}
          disabled={!canRun || loading}
          className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-md font-semibold shadow-sm hover:shadow-md transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
        >
          {loading ? (
            <>
              <svg
                className="animate-spin h-5 w-5 text-white"
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
              <span className="text-sm">Generating...</span>
            </>
          ) : (
            <>
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
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span className="text-sm">Generate Crosstab</span>
            </>
          )}
        </button>

        {rows.length > 0 && (
          <button
            onClick={exportExcel}
            disabled={loading}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-md font-semibold shadow-sm hover:shadow-md transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
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
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>Export to Excel</span>
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
        {rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-[#01244a] px-4 py-2 border-b border-[#01244a]">
            <h4 className="text-base font-semibold text-white flex items-center gap-2">
                <svg
                className="w-5 h-5 text-brand-500"
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
              Crosstab Results
            </h4>
          </div>

          <div className="overflow-auto max-h-[600px]">
              <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-[#01244a] text-white">
                {Object.keys(multiHeaders).length > 0 && (
                  <>
                    {/* Top-level X headers */}
                    <tr className="border-b-2 border-[#0b2f4a]">
                      <th className="border-r border-[#083145] px-3 py-2 font-bold text-left text-sm sticky left-0 z-20 shadow-sm" rowSpan={2}>
                        Index
                      </th>
                      {Object.entries(multiHeaders).map(([top, metrics]) => (
                        <th
                          key={top}
                          className="border-r border-[#083145] px-3 py-2 text-center font-bold text-white text-sm"
                          colSpan={metrics.length}
                        >
                          {top}
                        </th>
                      ))}
                    </tr>
                    {/* Metrics */}
                    <tr className="border-b-2 border-[#0b2f4a]">
                      {Object.values(multiHeaders)
                        .flat()
                        .map((metric, i) => (
                          <th
                            key={i}
                            className="border-r border-[#083145] px-3 py-2 text-center text-sm font-semibold text-white whitespace-nowrap"
                          >
                            {metric}
                          </th>
                        ))}
                    </tr>
                  </>
                )}
                {Object.keys(multiHeaders).length === 0 && (
                  <tr className="border-b-2 border-[#0b2f4a]">
                    {Object.keys(rows[0]).map((k, idx) => (
                      <th
                        key={k}
                        className={`border-r border-[#083145] px-3 py-2 font-bold text-white text-sm ${
                          idx === 0
                            ? "text-left sticky left-0 bg-[#01244a] z-20 shadow-sm"
                            : "text-center bg-[#01244a]"
                        }`}
                      >
                        {k}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={`border-b border-gray-200 ${
                      r.Index === "TOTAL"
                        ? "font-bold bg-blue-50 border-t-2 border-b-2 border-gray-400"
                        : r.Index === "Others"
                        ? "font-semibold bg-yellow-50"
                        : i % 2 === 0
                        ? "bg-white"
                        : "bg-gray-50"
                    } hover:bg-blue-50 transition-colors`}
                  >
                    {Object.entries(r).map(([k, v], j) => (
                        <td
                        key={j}
                        className={`border-r border-gray-200 px-3 py-2 text-sm ${
                          j === 0
                            ? "font-semibold text-white text-left sticky left-0 bg-inherit z-10 shadow-sm"
                            : "text-center text-gray-700 tabular-nums"
                        }`}
                      >
                        {j === 0 ? (v ?? "-") : formatValue(v, k)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    
      {/* Info Box */}
      <details className="bg-blue-50 border border-blue-200 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-blue-900 cursor-pointer flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          About Crosstab Analysis
        </summary>
        <ul className="px-3 pb-2 text-[11px] text-blue-700 space-y-0.5 columns-2">
          <li>• <strong>Column X:</strong> Creates rows in the crosstab table</li>
          <li>• <strong>Column Y:</strong> Creates columns in the crosstab table</li>
          <li>• <strong>Metrics:</strong> Automatically calculates counts, sums, and averages</li>
          <li>• <strong>FTE/FLC:</strong> If columns are configured, additional cost metrics are included</li>
          <li>• <strong>"Others" Grouping:</strong> Combine minority categories below a threshold into a single "Others" row/column</li>
          <li>• <strong>Export:</strong> Download the full crosstab as an Excel file</li>
        </ul>
      </details>
    </div>
  );
}