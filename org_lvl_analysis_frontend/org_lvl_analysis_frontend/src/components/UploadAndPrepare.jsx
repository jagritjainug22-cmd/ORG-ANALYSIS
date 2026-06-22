import React, { useState, useCallback } from "react";
import { cleanup as cleanupApi, validate as validateApi, filterErrors as filterErrorsApi } from "../api/backend";
import DataSourceSelector from "./DataSourceSelector";

function StatCard({ label, value, accent = false }) {
  return (
    <div className="bg-white rounded-lg border border-brand-100 px-4 py-3 shadow-sm">
      <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
      <p className={`text-xl font-bold ${accent ? "text-brand-500" : "text-brand-800"}`}>{value}</p>
    </div>
  );
}

function FlagRow({ label, count, checked, onChange }) {
  const hasIssues = count > 0;
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 border-l-4 ${hasIssues ? "border-amber-400 bg-amber-50/50" : "border-green-500 bg-green-50/30"}`}>
      <div className="flex items-center gap-2">
        {hasIssues ? (
          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        ) : (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        )}
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-semibold ${hasIssues ? "text-amber-700" : "text-green-700"}`}>{count}</span>
        {hasIssues && (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-500">
            <input type="checkbox" checked={checked} onChange={onChange} className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 h-3.5 w-3.5" />
            Remove
          </label>
        )}
      </div>
    </div>
  );
}

const FLAG_LABELS = {
  FLAG_DUPLICATE_EMP_ID: "Duplicate Employee IDs",
  FLAG_MISSING_MANAGER_ID: "Missing Manager References",
  FLAG_MANAGER_ID_NOT_EMPLOYEE: "Invalid Manager References",
  FLAG_CIRCULAR_REFERENCE: "Circular Reporting Chains",
};

/** Parse validate API response and count per-row flags. */
function parseValidationResponse(valRes) {
  const flaggedRecords = valRes?.df_with_flags || [];
  const flagCols = Object.keys(flaggedRecords[0] || {}).filter((k) => k.startsWith("FLAG_"));
  const flag_counts = {};
  flagCols.forEach((f) => {
    flag_counts[f] = flaggedRecords.filter(
      (r) => r[f] === true || r[f] === 1 || r[f] === "1"
    ).length;
  });
  return {
    flaggedRecords,
    flag_counts,
    duplicate_ids: valRes?.duplicate_ids || [],
    missing_manager_ids: valRes?.missing_manager_ids || [],
    invalid_manager_ids: valRes?.invalid_manager_ids || [],
    circular_reference_ids: valRes?.circular_reference_ids || [],
    top_manager: valRes?.top_manager ?? null,
  };
}

/** Assess whether hierarchy / spans analysis will produce meaningful results. */
function computeHierarchyReadiness(records, empCol, mgrCol, summary) {
  if (!records?.length || !empCol || !mgrCol) {
    return { status: "unknown", internalLinkCount: 0, managerCount: 0, messages: [] };
  }

  const empIds = new Set(
    records.map((r) => String(r[empCol] ?? "").trim()).filter(Boolean)
  );

  const internalLinkCount = records.filter((r) => {
    const mgr = String(r[mgrCol] ?? "").trim();
    return mgr && mgr !== "nan" && empIds.has(mgr);
  }).length;

  const managerCount = [...empIds].filter((id) =>
    records.some((r) => String(r[mgrCol] ?? "").trim() === id)
  ).length;

  const invalidIds = summary?.invalid_manager_ids || [];
  const rowCount = records.length;
  const messages = [];
  let status = "ready";

  if (internalLinkCount === 0 && rowCount > 0) {
    status = "blocked";
    messages.push(
      "No reporting links exist within this file — managers reference people outside the uploaded rows."
    );
    messages.push(
      "Hierarchy and Spans & Layers will show a flat org: everyone at Level 1, zero managers, zero span."
    );
    messages.push(
      "Upload the full census, or a complete subtree that includes manager rows."
    );
  } else if (invalidIds.length > 0 && internalLinkCount < rowCount * 0.5) {
    status = "warning";
    messages.push(
      `Only ${internalLinkCount} of ${rowCount} rows report to someone in this file — this looks like a partial census extract.`
    );
    messages.push(
      `${invalidIds.length} unique manager ID(s) are missing from the employee list.`
    );
  } else if (invalidIds.length > 0) {
    status = "warning";
    messages.push(
      `${invalidIds.length} manager ID(s) not found in the employee list (${summary.flag_counts?.FLAG_MANAGER_ID_NOT_EMPLOYEE ?? 0} rows affected).`
    );
  }

  if ((summary?.circular_reference_ids?.length ?? 0) > 0) {
    status = status === "ready" ? "warning" : status;
    messages.push(
      `${summary.circular_reference_ids.length} circular reporting chain(s) detected — resolve before Hierarchy.`
    );
  }

  if ((summary?.duplicate_ids?.length ?? 0) > 0) {
    status = status === "ready" ? "warning" : status;
    messages.push(`${summary.duplicate_ids.length} duplicate employee ID(s) found.`);
  }

  return {
    status,
    internalLinkCount,
    managerCount,
    invalidManagerIdCount: invalidIds.length,
    partialCensus: internalLinkCount === 0 && invalidIds.length > 0,
    topManager: summary?.top_manager ?? null,
    messages,
  };
}

function HierarchyReadinessPanel({ readiness }) {
  if (!readiness || readiness.status === "unknown") return null;

  const styles = {
    ready: {
      box: "bg-green-50 border-green-200",
      title: "text-green-900",
      body: "text-green-800",
      badge: "bg-green-600 text-white",
      label: "Hierarchy ready",
    },
    warning: {
      box: "bg-amber-50 border-amber-200",
      title: "text-amber-900",
      body: "text-amber-800",
      badge: "bg-amber-500 text-white",
      label: "Proceed with caution",
    },
    blocked: {
      box: "bg-red-50 border-red-200",
      title: "text-red-900",
      body: "text-red-800",
      badge: "bg-red-600 text-white",
      label: "Hierarchy not ready",
    },
  };
  const s = styles[readiness.status] || styles.warning;

  return (
    <div className={`border rounded-lg px-4 py-3 ${s.box}`}>
      <div className="flex items-start gap-3">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${s.badge} flex-shrink-0 mt-0.5`}>
          {s.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${s.title} mb-2`}>Analysis readiness</p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-white/60 rounded px-2 py-1.5 text-center">
              <p className="text-[10px] text-slate-500 uppercase">Internal links</p>
              <p className="text-sm font-bold text-slate-800">{readiness.internalLinkCount}</p>
            </div>
            <div className="bg-white/60 rounded px-2 py-1.5 text-center">
              <p className="text-[10px] text-slate-500 uppercase">Managers in file</p>
              <p className="text-sm font-bold text-slate-800">{readiness.managerCount}</p>
            </div>
            <div className="bg-white/60 rounded px-2 py-1.5 text-center">
              <p className="text-[10px] text-slate-500 uppercase">External mgr IDs</p>
              <p className="text-sm font-bold text-slate-800">{readiness.invalidManagerIdCount}</p>
            </div>
          </div>
          {readiness.topManager && (
            <p className={`text-xs ${s.body} mb-1`}>
              Detected top manager (root): <span className="font-semibold">{readiness.topManager}</span>
            </p>
          )}
          <ul className={`text-xs ${s.body} space-y-1 list-disc list-inside`}>
            {readiness.messages.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

const MAPPING_LABELS = {
  employee_id: "Employee",
  manager_id: "Manager",
  fte: "FTE",
  flc: "FLC",
  country: "Country",
  job_title: "Job Title",
  function: "Function",
  subfunction: "Sub-Function",
  grade: "Grade",
  division: "Division",
  entity: "Entity",
  start_date: "Start Date",
  basic_pay: "Basic Pay",
  contract_type: "Contract",
  status: "Status",
};

const PRIMARY_BTN = "bg-am-500 text-white hover:bg-am-600 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition shadow-sm";

export default function UploadAndPrepare({
  onSmartUpload,
  uploading,
  uploadStep,
  preprocessingSummary,
  dfRecords,
  validatedDf,
  setValidatedDf,
  setDfRecords,
  setColumns,
  empCol,
  mgrCol,
  countryCol,
  columns,
  uploadedFileName,
  setUploadedFileName,
  onDatasetPicked,
  columnMappings,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // Phase 2: cleanup + validate state
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState(null);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [pipelineComplete, setPipelineComplete] = useState(false);

  // Filter state
  const [filterFlags, setFilterFlags] = useState({});
  const [filtering, setFiltering] = useState(false);
  const [filterApplied, setFilterApplied] = useState(false);

  const fileUploaded = !uploading && dfRecords && preprocessingSummary;

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
      setUploadError("Please upload a valid Excel file (.xlsx, .xls, .xlsm)");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("File size exceeds 50MB limit");
      return;
    }
    setUploadError(null);
    setCleanupResult(null);
    setValidationResult(null);
    setPipelineComplete(false);
    setFilterApplied(false);
    setFilterFlags({});
    setPipelineError(null);
    onSmartUpload(file);
  }, [onSmartUpload]);

  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]); };
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  // Phase 2: Run cleanup + validate with user-confirmed columns
  const handleRunPipeline = async () => {
    if (!dfRecords) return;
    setPipelineRunning(true);
    setPipelineError(null);
    setCleanupResult(null);
    setValidationResult(null);
    setFilterApplied(false);
    setFilterFlags({});
    try {
      let workingDf = dfRecords;

      // Cleanup
      const cleanRes = await cleanupApi(workingDf, true, countryCol || null);
      setCleanupResult({ removed: cleanRes.removed });
      if (cleanRes.df) {
        workingDf = cleanRes.df;
        setDfRecords(workingDf);
        setColumns(Object.keys(workingDf[0] || {}));
      }

      // Validate
      if (empCol && mgrCol) {
        const valRes = await validateApi(workingDf, empCol, mgrCol);
        const parsed = parseValidationResponse(valRes);
        const readiness = computeHierarchyReadiness(
          parsed.flaggedRecords,
          empCol,
          mgrCol,
          parsed
        );
        setValidationResult({ ...parsed, readiness });
        if (parsed.flaggedRecords.length) {
          setValidatedDf(parsed.flaggedRecords);
        }
      }

      setPipelineComplete(true);
    } catch (err) {
      console.error("Pipeline error:", err);
      setPipelineError(err.response?.data?.detail || "Pipeline failed. Check your column selections and try again.");
    } finally {
      setPipelineRunning(false);
    }
  };

  const flagCounts = validationResult?.flag_counts || {};
  const totalFlagged = Object.values(flagCounts).reduce((s, c) => s + c, 0);
  const readiness = validationResult?.readiness;
  const hasValidationIssues = totalFlagged > 0;
  const selectedRemoveCount = Object.entries(filterFlags).reduce((s, [k, v]) => s + (v ? (flagCounts[k] || 0) : 0), 0);

  const handleApplyFilters = async () => {
    if (!empCol || !mgrCol) return;
    setFiltering(true);
    try {
      const res = await filterErrorsApi(
        validatedDf || dfRecords, empCol, mgrCol,
        !!filterFlags.FLAG_DUPLICATE_EMP_ID,
        !!filterFlags.FLAG_MISSING_MANAGER_ID,
        !!filterFlags.FLAG_MANAGER_ID_NOT_EMPLOYEE,
        !!filterFlags.FLAG_CIRCULAR_REFERENCE,
      );
      if (res?.df) { setValidatedDf(res.df); setFilterApplied(true); }
    } catch (err) { console.error("Filter error:", err); }
    finally { setFiltering(false); }
  };

  const pre = preprocessingSummary || {};
  const canRunPipeline = fileUploaded && empCol && mgrCol;
  const mappedEntries = columnMappings
    ? Object.entries(columnMappings).filter(([, m]) => m?.source_column)
    : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-brand-50 border border-brand-100 rounded-lg p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-am-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-brand-800" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Upload & Prepare</h3>
            <p className="text-sm text-slate-500">Upload your Excel file. Columns will be auto-mapped — review them in the config bar above, then run cleanup & validation.</p>
          </div>
        </div>
      </div>

      {/* ─── Phase 1: DataSourceSelector (upload zone + saved org charts) ─── */}
      {!fileUploaded && (
        <>
          {/* Loading state (while smart-uploading) */}
          {uploading && (
            <div className="border-2 border-dashed border-brand-200 rounded-xl p-10 bg-brand-50/30">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-brand-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                </div>
                <p className="text-sm font-semibold text-brand-700">
                  {uploadStep === "map" ? "Mapping columns..." : "Reading file..."}
                </p>
                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{
                    width: uploadStep === "map" ? "70%" : "30%",
                    backgroundImage: "linear-gradient(90deg, #155bb2 0%, #74a9e7 50%, #155bb2 100%)",
                    backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", transition: "width 0.5s",
                  }} />
                </div>
              </div>
            </div>
          )}

          {/* DataSourceSelector: toggle between Upload New (drag-drop) and Saved Org Charts */}
          {!uploading && (
            <DataSourceSelector
              onDatasetPicked={onDatasetPicked}
              setDfRecords={setDfRecords}
              setValidatedDf={setValidatedDf}
              setColumns={setColumns}
              setUploadedFileName={setUploadedFileName}
              renderUploadSlot={() => (
                <div
                  onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                  className={`relative border-2 border-dashed rounded-xl p-10 transition-all duration-200 cursor-pointer ${
                    isDragging ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-[#f8fbff] hover:border-brand-400 hover:bg-brand-50"
                  }`}
                  style={{ boxShadow: "0 1px 4px rgba(15, 46, 92, 0.06)" }}
                >
                  <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mb-3">
                      <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    </div>
                    <h4 className="text-lg font-semibold text-brand-800 mb-1">Upload Your Excel File</h4>
                    <p className="text-sm text-slate-500 mb-4">Drag and drop your file here, or click to browse</p>
                    <label htmlFor="smart-file-upload" className={`px-5 py-2.5 rounded-lg font-medium text-sm cursor-pointer ${PRIMARY_BTN}`}>
                      Browse Files
                    </label>
                    <input id="smart-file-upload" type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
                    <p className="text-xs text-slate-400 mt-3">Supports .xlsx, .xls, .xlsm — Max 50MB</p>
                  </div>
                </div>
              )}
            />
          )}
        </>
      )}

      {uploadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{uploadError}</div>
      )}

      {/* ─── After file is uploaded: preprocessing summary + run pipeline button ─── */}
      {fileUploaded && (
        <div className="space-y-4 animate-fadeInUp">
          {/* File info + re-upload */}
          <div className="flex items-center justify-between bg-white border border-brand-100 rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{uploadedFileName || "File uploaded"}</p>
                <p className="text-xs text-slate-400">{dfRecords.length} rows · {columns?.length || 0} columns</p>
              </div>
            </div>
            <label htmlFor="smart-file-reupload" className="text-xs text-brand-500 hover:text-brand-700 font-medium cursor-pointer">
              Upload different file
              <input id="smart-file-reupload" type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
            </label>
          </div>

          {/* Preprocessing summary */}
          <div>
            <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Preprocessing</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Sheet used" value={pre.sheet_used || "—"} />
              <StatCard label="Header row" value={pre.header_row_detected ?? "1"} />
              <StatCard label="Merged cells fixed" value={pre.merged_cells_resolved ?? 0} accent={pre.merged_cells_resolved > 0} />
              <StatCard label="Float IDs fixed" value={pre.float_ids_fixed ?? 0} accent={pre.float_ids_fixed > 0} />
            </div>
          </div>

          {/* Auto-mapped columns summary */}
          {mappedEntries.length > 0 && !pipelineComplete && (
            <div>
              <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
                Auto-mapped columns
              </h4>
              <div className="bg-white border border-brand-100 rounded-lg overflow-hidden shadow-sm">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 divide-x divide-y divide-brand-50">
                  {mappedEntries.map(([key, m]) => (
                    <div key={key} className="px-3 py-2.5">
                      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{MAPPING_LABELS[key] || key}</p>
                      <p className="text-sm font-semibold text-brand-800 truncate" title={m.source_column}>{m.source_column}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Column mapping notice */}
          {!pipelineComplete && !pipelineRunning && (
            <div className="bg-brand-50 border border-brand-100 rounded-lg px-4 py-3">
              <p className="text-sm text-brand-700">
                <span className="font-semibold">Columns have been auto-mapped</span> — review them in the Column Configuration bar above (green dots = high confidence).
                Override any incorrect mappings, then click the button below.
              </p>
            </div>
          )}

          {/* Run Pipeline button (Phase 2 trigger) */}
          {!pipelineComplete && (
            <button
              onClick={handleRunPipeline}
              disabled={!canRunPipeline || pipelineRunning}
              className={`w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${PRIMARY_BTN}`}
            >
              {pipelineRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Running Cleanup & Validation...
                </>
              ) : !empCol || !mgrCol ? (
                "Select Employee & Manager columns to continue"
              ) : (
                "Run Cleanup & Validate"
              )}
            </button>
          )}

          {pipelineError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{pipelineError}</div>
          )}

          {/* ─── Phase 2 results: Cleanup + Validation ─── */}
          {pipelineComplete && (
            <div className="space-y-4 animate-fadeInUp">
              {/* Cleanup */}
              <div>
                <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Cleanup</h4>
                <div className="bg-white border border-brand-100 rounded-lg px-4 py-3 shadow-sm flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <span className="text-sm text-slate-700">
                    {cleanupResult?.removed ? `${cleanupResult.removed} exclusion rows removed` : "No exclusion rows found"}
                  </span>
                </div>
              </div>

              {/* Validation */}
              {validationResult && (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
                      Validation
                      {!hasValidationIssues && (
                        <span className="ml-2 text-green-600 normal-case">— All clear</span>
                      )}
                      {hasValidationIssues && (
                        <span className="ml-2 text-amber-600 normal-case">
                          — {totalFlagged} flagged row{totalFlagged !== 1 ? "s" : ""}
                        </span>
                      )}
                    </h4>
                    <div className="bg-white border border-brand-100 rounded-lg overflow-hidden shadow-sm divide-y divide-gray-100">
                      {Object.entries(flagCounts).filter(([, count]) => count > 0).map(([flag, count]) => (
                        <FlagRow
                          key={flag}
                          label={FLAG_LABELS[flag] || flag.replace("FLAG_", "").replace(/_/g, " ")}
                          count={count}
                          checked={!!filterFlags[flag]}
                          onChange={() => setFilterFlags(prev => ({ ...prev, [flag]: !prev[flag] }))}
                        />
                      ))}
                      {!hasValidationIssues && (
                        <div className="px-4 py-3 text-sm text-green-600 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          No validation issues found
                        </div>
                      )}
                    </div>

                    {/* Sample invalid manager IDs */}
                    {validationResult.invalid_manager_ids?.length > 0 && (
                      <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                        <p className="text-xs font-semibold text-amber-900 mb-1.5">
                          Sample external manager IDs ({validationResult.invalid_manager_ids.length} unique)
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {validationResult.invalid_manager_ids.slice(0, 8).map((id) => (
                            <span key={id} className="px-2 py-0.5 bg-white border border-amber-200 text-amber-800 text-xs font-mono rounded">
                              {id}
                            </span>
                          ))}
                          {validationResult.invalid_manager_ids.length > 8 && (
                            <span className="px-2 py-0.5 text-amber-600 text-xs">
                              +{validationResult.invalid_manager_ids.length - 8} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {totalFlagged > 0 && !filterApplied && (
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-slate-400">
                          {selectedRemoveCount > 0
                            ? `${selectedRemoveCount} flagged row${selectedRemoveCount !== 1 ? "s" : ""} will be removed`
                            : "Select error types above to filter them out (optional)"}
                        </p>
                        <button
                          onClick={handleApplyFilters}
                          disabled={selectedRemoveCount === 0 || filtering}
                          className={`px-4 py-1.5 rounded-lg text-sm font-medium ${PRIMARY_BTN}`}
                        >
                          {filtering ? "Filtering..." : "Apply Filters"}
                        </button>
                      </div>
                    )}
                    {filterApplied && (
                      <div className="mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Filters applied — {(validatedDf || dfRecords)?.length} rows remaining
                      </div>
                    )}
                  </div>

                  {/* Hierarchy readiness */}
                  <HierarchyReadinessPanel readiness={readiness} />
                </div>
              )}

              {/* Footer — status depends on validation + readiness */}
              {readiness?.status === "blocked" ? (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 flex items-start gap-2">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span>
                    <span className="font-semibold">Hierarchy analysis will not work correctly</span> with this extract.
                    You can still proceed to <span className="font-semibold">Rationalise</span> for title/function cleanup,
                    but upload a complete census before running Hierarchy or Spans &amp; Layers.
                  </span>
                </div>
              ) : readiness?.status === "warning" || hasValidationIssues ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span>
                    <span className="font-semibold">Data prepared with warnings.</span> Review validation above, then proceed to{" "}
                    <span className="font-semibold">Rationalise</span> or fix issues before Hierarchy analysis.
                  </span>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>
                    <span className="font-semibold">Data ready.</span> Proceed to{" "}
                    <span className="font-semibold">Rationalise</span> to standardise titles, functions, and subfunctions.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
