import React, { useState, useEffect, useCallback, useRef } from "react";
import { cleanup as cleanupApi, validate as validateApi, filterErrors as filterErrorsApi } from "../api/backend";
import DataSourceSelector from "./DataSourceSelector";
import ValidationDataTable from "./ValidationDataTable";

function StatCard({ label, value, accent = false, icon = null }) {
  return (
    <div className="relative overflow-hidden bg-white/90 backdrop-blur-sm border border-brand-100 rounded-xl p-4 shadow-card hover:shadow-panel hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between">
      <div className={`absolute inset-0 bg-gradient-to-br ${accent ? 'from-[#c5a84a]/5' : 'from-brand-500/5'} to-transparent pointer-events-none`} />
      <div className="relative flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{label}</p>
        {icon && (
          <span className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${accent ? "bg-[#c5a84a]/10 text-[#c5a84a]" : "bg-brand-500/10 text-brand-500"}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`relative text-xl font-extrabold leading-none ${accent ? "text-[#c5a84a]" : "text-[#01244a]"}`} style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{value}</p>
    </div>
  );
}

const StatIcons = {
  sheet: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  headerRow: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 6v12a1 1 0 001 1h14a1 1 0 001-1V6M4 6l1.5-2h13L20 6" />
    </svg>
  ),
  mergedCells: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l6 6" />
    </svg>
  ),
  floatIds: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 9h14M5 15h14M11 4L9 20m6-16l-2 16" />
    </svg>
  ),
};


function FlagRow({ label, count, checked, onChange }) {
  const hasIssues = count > 0;
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 border-l-4 ${hasIssues ? "border-amber-400 bg-amber-50/50" : "border-blue-400 bg-blue-50/30"}`}>
      <div className="flex items-center gap-2">
        {hasIssues ? (
          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        ) : (
          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        )}
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-semibold ${hasIssues ? "text-amber-700" : "text-blue-700"}`}>{count}</span>
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
      box: "bg-blue-50 border-blue-200",
      title: "text-blue-900",
      body: "text-blue-800",
      badge: "bg-blue-600 text-white",
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
    <div className={`border rounded-xl px-4 py-3 ${s.box}`}>
      <div className="flex items-start gap-3">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md shadow-sm ${s.badge} flex-shrink-0 mt-0.5`}>
          {s.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${s.title} mb-2`}>Analysis readiness</p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-white/70 border border-white/80 rounded-lg px-2 py-1.5 text-center shadow-sm">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Internal links</p>
              <p className="text-sm font-bold text-slate-800">{readiness.internalLinkCount}</p>
            </div>
            <div className="bg-white/70 border border-white/80 rounded-lg px-2 py-1.5 text-center shadow-sm">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Managers in file</p>
              <p className="text-sm font-bold text-slate-800">{readiness.managerCount}</p>
            </div>
            <div className="bg-white/70 border border-white/80 rounded-lg px-2 py-1.5 text-center shadow-sm">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">External mgr IDs</p>
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

const CONFIDENCE_STYLES = {
  high:   { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  medium: { dot: "bg-amber-400",   badge: "bg-amber-50 text-amber-700 border-amber-200" },
  low:    { dot: "bg-red-400",     badge: "bg-red-50 text-red-700 border-red-200" },
};

function MappingResultBanner({ requiresAttention, summary, fallbackMessage, readiness, onDismiss }) {
  const unmappedCore = summary?.unmapped_core || readiness?.summary?.unmapped_core || [];
  const unmappedRationalise = summary?.unmapped_rationalise || readiness?.summary?.unmapped_rationalise || [];
  const unmappedRecommended = summary?.unmapped_recommended || readiness?.summary?.unmapped_recommended || [];
  const aiMapped    = summary?.ai_mapped || [];
  const explanation = summary?.ai_explanation || null;

  const level = readiness?.level;
  const isBlocked = level === "blocked";
  const isPartial = level === "partial";
  const bannerStyle = isBlocked
    ? "bg-red-50 border-red-200 text-red-800"
    : isPartial || requiresAttention
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-emerald-50 border-emerald-200 text-emerald-800";

  const hasTieredSummary = unmappedCore.length > 0 || unmappedRationalise.length > 0 || unmappedRecommended.length > 0;
  const hasSummary = hasTieredSummary || aiMapped.length > 0 || explanation;

  const headerLabel = isBlocked
    ? "Core columns missing"
    : isPartial
      ? "Core mapped — Rationalise needs Function"
      : requiresAttention
        ? "Column mapping needs attention"
        : "Column mapping complete";

  const StatusIcon = isBlocked ? (
    <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : isPartial || requiresAttention ? (
    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );

  if (!hasSummary && !readiness) {
    return (
      <div className={`relative p-3.5 rounded-lg border flex items-start gap-3 animate-fadeIn ${bannerStyle}`}>
        <div className="mt-0.5 flex-shrink-0">{StatusIcon}</div>
        <p className="text-xs flex-1 leading-relaxed">{fallbackMessage}</p>
        <button type="button" onClick={onDismiss} className="flex-shrink-0 text-current opacity-40 hover:opacity-70 ml-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`relative rounded-lg border animate-fadeIn ${bannerStyle}`}>
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${
        isBlocked ? "border-red-200" : isPartial || requiresAttention ? "border-amber-200" : "border-emerald-200"
      }`}>
        <div className="flex items-center gap-2">
          {StatusIcon}
          <span className={`text-xs font-semibold ${
            isBlocked ? "text-red-900" : isPartial || requiresAttention ? "text-amber-900" : "text-emerald-900"
          }`}>
            {headerLabel}
          </span>
        </div>
        <button type="button" onClick={onDismiss} className="opacity-40 hover:opacity-70">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        <p className="text-xs leading-relaxed">{fallbackMessage || readiness?.message}</p>

        {unmappedCore.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-red-600 bg-red-100 border border-red-200 rounded px-1.5 py-0.5 flex-shrink-0 mt-0.5">
              Core
            </span>
            <div className="flex flex-wrap gap-1.5">
              {unmappedCore.map((f) => (
                <span key={f.label || f.target_id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-red-200 text-red-700 text-xs rounded font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  {f.label || f.target_id} not mapped
                </span>
              ))}
            </div>
          </div>
        )}

        {unmappedRationalise.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5 flex-shrink-0 mt-0.5">
              Rationalise
            </span>
            <div className="flex flex-wrap gap-1.5">
              {unmappedRationalise.map((f) => (
                <span key={f.label} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-amber-200 text-amber-800 text-xs rounded font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  {f.label} not mapped
                </span>
              ))}
            </div>
          </div>
        )}

        {unmappedRecommended.length > 0 && unmappedRationalise.length === 0 && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-brand-600 bg-brand-50 border border-brand-200 rounded px-1.5 py-0.5 flex-shrink-0 mt-0.5">
              Recommended
            </span>
            <div className="flex flex-wrap gap-1.5">
              {unmappedRecommended.map((f) => (
                <span key={f.label} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-brand-100 text-brand-700 text-xs rounded font-medium">
                  {f.label} not mapped
                </span>
              ))}
            </div>
          </div>
        )}

        {aiMapped.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5 flex-shrink-0 mt-0.5">
              AI mapped
            </span>
            <div className="flex flex-wrap gap-1.5">
              {aiMapped.map((f) => {
                const styles = CONFIDENCE_STYLES[f.confidence] || CONFIDENCE_STYLES.medium;
                return (
                  <span key={f.target_id} className={`inline-flex items-center gap-1 px-2 py-0.5 bg-white border text-xs rounded font-medium ${styles.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${styles.dot}`} />
                    {f.label} → {f.source_column}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* AI explanation */}
        {explanation && (
          <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-200/80 pt-2">
            {explanation}
          </p>
        )}
      </div>
    </div>
  );
}

const PRIMARY_BTN = "bg-brand-500 text-white hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition shadow-sm";

function formatRelative(iso) {
  if (!iso) return "never";
  try {
    const then = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
    const now = new Date();
    const diffMs = now - then;
    const sec = Math.max(0, Math.round(diffMs / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return day === 1 ? "yesterday" : `${day}d ago`;
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function PageHeader({ title, subtitle, icon }) {
  return (
    <div className="bg-brand-50 border border-brand-100 rounded-lg p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-lg font-bold text-brand-800" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{title}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

const HEADER_ICONS = {
  upload: (
    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  ),
  saved: (
    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
  prepare: (
    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
};

function PipelineStatusBadge({ label, ts }) {
  const ran = !!ts;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
        ran
          ? "bg-blue-50 text-blue-700 border border-blue-200"
          : "bg-slate-50 text-slate-400 border border-slate-200"
      }`}
      title={ran ? `${label}: ${new Date(ts.endsWith("Z") ? ts : ts + "Z").toLocaleString()}` : `${label}: never run`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ran ? "bg-blue-500" : "bg-slate-300"}`} />
      {label}: {ran ? formatRelative(ts) : "never"}
    </span>
  );
}

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
  datasetId = null,
  columnMappingMessage = null,
  columnMappingRequiresAttention = false,
  columnMappingSummary = null,
  columnReadiness = null,
  onPipelineComplete,
  onDatasetStatsChange,
  dataSource = null,
  pipelineStatus = { cleanup: null, validate: null, rationalise: null },
  activeDatasetLabel = null,
  activeScenarioId = null,
  scenarios = [],
  datasetSwitching = false,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [mappingBannerDismissed, setMappingBannerDismissed] = useState(false);
  const [sourceView, setSourceView] = useState("upload");

  useEffect(() => {
    setMappingBannerDismissed(false);
  }, [columnMappingMessage, columnReadiness?.level]);
  const [showSourcePicker, setShowSourcePicker] = useState(
    () => !(Array.isArray(dfRecords) && dfRecords.length > 0 && dataSource)
  );

  // Upload loader stage text
  const [mapSubStep, setMapSubStep] = useState(0);
  const UPLOAD_STAGES = [
    { step: "read", msg: "Reading file...",      sub: "Detecting sheets and headers" },
    { step: "map",  msg: "Mapping columns...",   sub: "AI is matching columns" },
    { step: "map2", msg: "Almost ready...",      sub: "Finalising configuration" },
  ];
  useEffect(() => {
    if (uploadStep === "map") {
      setMapSubStep(1);
      const t = setTimeout(() => setMapSubStep(2), 3000);
      return () => clearTimeout(t);
    } else if (uploadStep === "read") {
      setMapSubStep(0);
    }
  }, [uploadStep]);

  // Cleanup/validate loader stage text
  const [pipelineStage, setPipelineStage] = useState(0);
  const PIPELINE_STAGES = [
    { msg: "Running cleanup...",      sub: "Removing duplicates and anomalies" },
    { msg: "Validating hierarchy...", sub: "Checking manager-employee links" },
    { msg: "Generating report...",    sub: "Summarising data quality" },
  ];

  // Phase 2: cleanup + validate state
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState(null);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [pipelineComplete, setPipelineComplete] = useState(false);

  useEffect(() => {
    if (!pipelineRunning) { setPipelineStage(0); return; }
    const t1 = setTimeout(() => setPipelineStage(1), 4000);
    const t2 = setTimeout(() => setPipelineStage(2), 10000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [pipelineRunning]);

  // Filter state
  const [filterFlags, setFilterFlags] = useState({});
  const [filtering, setFiltering] = useState(false);
  const [filterApplied, setFilterApplied] = useState(false);
  const [revalidating, setRevalidating] = useState(false);

  // Row-count stats surfaced to the Export & Stats panel: how many rows we
  // started with, how many have been removed by filtering so far, and how
  // many remain. Reset whenever a fresh pipeline run starts.
  const [rowStats, setRowStats] = useState(null);
  const pushRowStats = useCallback((next) => {
    setRowStats(next);
    onDatasetStatsChange?.(next);
  }, [onDatasetStatsChange]);

  // Toast shown after a filter/re-validate pass so it's obvious the working
  // dataset (and anything exported from it) has changed row count.
  const [rowToast, setRowToast] = useState(null);
  const rowToastTimerRef = useRef(null);
  const showRowToast = useCallback((message, tone = "success") => {
    if (rowToastTimerRef.current) clearTimeout(rowToastTimerRef.current);
    setRowToast({ message, tone });
    rowToastTimerRef.current = setTimeout(() => setRowToast(null), 4500);
  }, []);
  useEffect(() => () => { if (rowToastTimerRef.current) clearTimeout(rowToastTimerRef.current); }, []);

  const hasWorkingData = !uploading && Array.isArray(dfRecords) && dfRecords.length > 0;
  const showPreparePanel = hasWorkingData && !showSourcePicker;
  const isSavedSource = dataSource === "saved";
  const isUploadSource = dataSource === "upload";
  const scenarioName = scenarios.find((s) => s.id === activeScenarioId)?.name || "Baseline";
  const hadPriorPipeline = !!(pipelineStatus?.cleanup || pipelineStatus?.validate);

  // When a new dataset loads, show prepare panel
  const datasetKeyRef = useRef(null);
  useEffect(() => {
    if (!hasWorkingData || !dataSource) return;
    setShowSourcePicker(false);
    const key = `${datasetId ?? "mem"}:${dataSource}`;
    if (datasetKeyRef.current !== null && datasetKeyRef.current !== key) {
      setPipelineComplete(false);
      setCleanupResult(null);
      setValidationResult(null);
      setFilterApplied(false);
      setFilterFlags({});
      setPipelineError(null);
      setMappingBannerDismissed(false);
      pushRowStats(null);
    }
    datasetKeyRef.current = key;
  }, [hasWorkingData, dataSource, datasetId, pushRowStats]);

  const handleSwitchDataset = () => {
    setShowSourcePicker(true);
    setSourceView(isSavedSource ? "picker" : "upload");
    setPipelineComplete(false);
    setCleanupResult(null);
    setValidationResult(null);
    setFilterApplied(false);
    setFilterFlags({});
    setPipelineError(null);
    pushRowStats(null);
  };

  const headerConfig = showPreparePanel
    ? {
        title: "Prepare Dataset",
        subtitle: isSavedSource
          ? "Review column mappings in the config bar above, then re-run cleanup & validation before analysis."
          : "Review column mappings in the config bar above, then run cleanup & validation.",
        icon: HEADER_ICONS.prepare,
      }
    : sourceView === "picker"
      ? {
          title: "Saved Org Charts",
          subtitle: "Select a dataset to load into your workspace. You can review mappings and run cleanup & validation after loading.",
          icon: HEADER_ICONS.saved,
        }
      : {
          title: "Upload & Prepare",
          subtitle: "Upload your Excel file. Columns will be auto-mapped — review them in the config bar above, then run cleanup & validation.",
          icon: HEADER_ICONS.upload,
        };

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
    setMappingBannerDismissed(false);
    pushRowStats(null);
    onSmartUpload(file);
  }, [onSmartUpload, pushRowStats]);

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
      const uploadedCount = workingDf.length;

      // Cleanup
      const cleanRes = await cleanupApi(workingDf, true, countryCol || null, datasetId || null);
      setCleanupResult({ removed: cleanRes.removed });
      if (cleanRes.df) {
        workingDf = cleanRes.df;
        setDfRecords(workingDf);
        setColumns(Object.keys(workingDf[0] || {}));
      }

      // Validate
      if (empCol && mgrCol) {
        const valRes = await validateApi(workingDf, empCol, mgrCol, null, false, datasetId || null);
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

      // Baseline row-count stats for the Export & Stats panel — reset on every fresh run
      pushRowStats({
        uploadedRows: uploadedCount,
        exclusionsRemoved: cleanRes.removed || 0,
        baselineRows: workingDf.length,
        currentRows: workingDf.length,
        filterRemovedTotal: 0,
        lastFilterRemoved: 0,
        newIssuesAfterFilter: 0,
      });

      setPipelineComplete(true);
      onPipelineComplete?.();
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
      if (!res?.df) return;
      const removedThisPass = res.removed_count ?? ((res.original_count ?? 0) - (res.filtered_count ?? res.df.length));

      // Re-validate so error cards, readiness, and preview match remaining rows
      const cleaned = res.df;
      const valRes = await validateApi(cleaned, empCol, mgrCol, null, false, datasetId || null);
      const parsed = parseValidationResponse(valRes);
      const next = parsed.flaggedRecords.length ? parsed.flaggedRecords : cleaned;
      const readiness = computeHierarchyReadiness(next, empCol, mgrCol, parsed);
      setValidationResult({ ...parsed, readiness });
      setValidatedDf(next);
      setDfRecords?.(next);
      setColumns?.(Object.keys(next[0] || {}).filter((k) => !k.startsWith("FLAG_")));
      setFilterApplied(true);
      setFilterFlags({});

      // Re-validating after removing rows can surface *new* flags: if a removed
      // row's employee ID was used as someone else's manager reference, those
      // remaining rows now point at a manager that no longer exists.
      const totalFlaggedAfter = Object.values(parsed.flag_counts || {}).reduce((s, c) => s + c, 0);
      const base = rowStats || { uploadedRows: cleaned.length, exclusionsRemoved: 0, baselineRows: cleaned.length };
      pushRowStats({
        ...base,
        currentRows: cleaned.length,
        filterRemovedTotal: (base.filterRemovedTotal || 0) + removedThisPass,
        lastFilterRemoved: removedThisPass,
        newIssuesAfterFilter: totalFlaggedAfter,
      });

      showRowToast(
        `Excel updated — ${cleaned.length.toLocaleString()} row${cleaned.length !== 1 ? "s" : ""} remaining after removing ${removedThisPass.toLocaleString()} flagged row${removedThisPass !== 1 ? "s" : ""}.`,
        totalFlaggedAfter > 0 ? "warning" : "success"
      );
    } catch (err) {
      console.error("Filter error:", err);
      showRowToast("Filter failed — the working dataset was not changed.", "error");
    }
    finally { setFiltering(false); }
  };

  const handleValidationRecordsChange = useCallback((nextRecords) => {
    setValidatedDf(nextRecords);
    setDfRecords?.(nextRecords);
    setColumns?.(Object.keys(nextRecords[0] || {}).filter((k) => !k.startsWith("FLAG_")));
  }, [setValidatedDf, setDfRecords, setColumns]);

  const handleRevalidate = useCallback(async () => {
    if (!empCol || !mgrCol) return;
    const source = validatedDf || dfRecords;
    if (!source?.length) return;
    setRevalidating(true);
    try {
      // Strip prior FLAG_ columns before re-running validation
      const cleaned = source.map((row) => {
        const next = { ...row };
        Object.keys(next).forEach((k) => {
          if (k.startsWith("FLAG_")) delete next[k];
        });
        return next;
      });
      const valRes = await validateApi(cleaned, empCol, mgrCol, null, false, datasetId || null);
      const parsed = parseValidationResponse(valRes);
      const readiness = computeHierarchyReadiness(
        parsed.flaggedRecords,
        empCol,
        mgrCol,
        parsed
      );
      setValidationResult({ ...parsed, readiness });
      const next = parsed.flaggedRecords.length ? parsed.flaggedRecords : cleaned;
      setValidatedDf(next);
      setDfRecords?.(next);
      setFilterApplied(false);
      setFilterFlags({});

      const totalFlaggedAfter = Object.values(parsed.flag_counts || {}).reduce((s, c) => s + c, 0);
      if (rowStats) {
        pushRowStats({
          ...rowStats,
          currentRows: cleaned.length,
          newIssuesAfterFilter: totalFlaggedAfter,
        });
      }

      showRowToast(
        totalFlaggedAfter > 0
          ? `Re-validated ${cleaned.length.toLocaleString()} rows — ${totalFlaggedAfter.toLocaleString()} still flagged.`
          : `Re-validated ${cleaned.length.toLocaleString()} rows — no issues found.`,
        totalFlaggedAfter > 0 ? "warning" : "success"
      );
    } catch (err) {
      console.error("Re-validate error:", err);
      setPipelineError(err.response?.data?.detail || "Re-validation failed.");
      showRowToast("Re-validation failed.", "error");
    } finally {
      setRevalidating(false);
    }
  }, [empCol, mgrCol, validatedDf, dfRecords, datasetId, setValidatedDf, setDfRecords, rowStats, pushRowStats]);

  const tableRecords = (validatedDf?.length
    ? validatedDf
    : (validationResult?.flaggedRecords || dfRecords || []));
  // Bump when validation is freshly run so the table resets navigation
  const validationTableKey = `${validationResult?.flaggedRecords?.length ?? 0}:${totalFlagged}:${filterApplied}`;

  const pre = preprocessingSummary || {};
  const canRunPipeline = hasWorkingData && empCol && mgrCol;
  const mappedEntries = columnMappings
    ? Object.entries(columnMappings).filter(([, m]) => m?.source_column)
    : [];

  const displayMappedEntries = isSavedSource && mappedEntries.length === 0
    ? [
        ["employee_id", empCol],
        ["manager_id", mgrCol],
        ["country", countryCol],
      ].filter(([, col]) => col).map(([key, col]) => [key, { source_column: col }])
    : mappedEntries;

  const pipelineButtonLabel = pipelineRunning
    ? null
    : !empCol || !mgrCol
      ? "Select Employee & Manager columns to continue"
      : isSavedSource && hadPriorPipeline
        ? "Re-run Cleanup & Validate"
        : "Run Cleanup & Validate";

  return (
    <div className="space-y-5">
      <PageHeader {...headerConfig} />

      {/* Column mapping summary banner — shown in prepare view */}
      {showPreparePanel && columnMappingMessage && !mappingBannerDismissed && (
        <MappingResultBanner
          requiresAttention={columnMappingRequiresAttention}
          summary={columnMappingSummary}
          fallbackMessage={columnMappingMessage}
          readiness={columnReadiness}
          onDismiss={() => setMappingBannerDismissed(true)}
        />
      )}

      {/* ─── Source picker: upload zone + saved org charts ─── */}
      {!showPreparePanel && (
        <>
          {hasWorkingData && dataSource && (
            <button
              type="button"
              onClick={() => setShowSourcePicker(false)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-800 transition -mt-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to prepare
            </button>
          )}

          {/* Loading state (while smart-uploading) */}
          {uploading && (
            <div className="border-2 border-dashed border-brand-200 rounded-xl p-10 bg-brand-50/30">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-brand-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                </div>
                <p className="text-sm font-semibold text-brand-700 transition-opacity duration-300">
                  {UPLOAD_STAGES[mapSubStep].msg}
                </p>
                <p className="text-xs text-slate-400 mt-0.5 transition-opacity duration-300">{UPLOAD_STAGES[mapSubStep].sub}</p>
                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden mt-2">
                  <div className="h-full bg-brand-500 rounded-full" style={{
                    width: `${[30, 65, 90][mapSubStep]}%`,
                    backgroundImage: "linear-gradient(90deg, #0a3f86 0%, #74a9e7 50%, #0a3f86 100%)",
                    backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", transition: "width 0.5s",
                  }} />
                </div>
              </div>
            </div>
          )}

          {/* DataSourceSelector: toggle between Upload New (drag-drop) and Saved Org Charts */}
          {!uploading && !datasetSwitching && (
            <DataSourceSelector
              view={sourceView}
              onViewChange={setSourceView}
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

          {datasetSwitching && (
            <div className="border-2 border-dashed border-brand-200 rounded-xl p-10 bg-brand-50/30">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-brand-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-brand-700">Loading dataset…</p>
                <p className="text-xs text-slate-400">Fetching records and column mappings</p>
              </div>
            </div>
          )}
        </>
      )}

      {uploadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{uploadError}</div>
      )}

      {/* ─── Prepare panel (upload or saved dataset loaded) ─── */}
      {showPreparePanel && (
        <div className="space-y-4 animate-fadeInUp">
          {/* Switch dataset link */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleSwitchDataset}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-800 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Switch dataset
            </button>
            {isSavedSource && datasetId && (
              <span className="text-[10px] font-mono text-slate-400">Dataset #{datasetId}</span>
            )}
          </div>

          {/* Dataset / file info card */}
          <div className="flex items-center justify-between bg-white border border-brand-100 rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isSavedSource ? "bg-brand-100" : "bg-blue-100"}`}>
                {isSavedSource ? (
                  <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {isSavedSource ? (activeDatasetLabel || "Saved dataset") : (uploadedFileName || "File uploaded")}
                </p>
                <p className="text-xs text-slate-400">
                  {dfRecords.length.toLocaleString()} rows · {columns?.length || 0} columns
                  {isSavedSource && ` · ${scenarioName}`}
                </p>
              </div>
            </div>
            {isUploadSource && (
              <label htmlFor="smart-file-reupload" className="text-xs text-brand-500 hover:text-brand-700 font-medium cursor-pointer flex-shrink-0 ml-3">
                Upload different file
                <input id="smart-file-reupload" type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
              </label>
            )}
          </div>

          {/* Saved: prior pipeline status */}
          {isSavedSource && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider font-display">Last run</span>
              <PipelineStatusBadge label="Cleanup" ts={pipelineStatus?.cleanup} />
              <PipelineStatusBadge label="Validated" ts={pipelineStatus?.validate} />
            </div>
          )}

          {/* Upload: preprocessing summary */}
          {isUploadSource && preprocessingSummary && (
            <div>
              <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Preprocessing</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Sheet used" value={pre.sheet_used || "—"} icon={StatIcons.sheet} />
                <StatCard label="Header row" value={pre.header_row_detected ?? "1"} icon={StatIcons.headerRow} />
                <StatCard label="Merged cells fixed" value={pre.merged_cells_resolved ?? 0} accent={pre.merged_cells_resolved > 0} icon={StatIcons.mergedCells} />
                <StatCard label="Float IDs fixed" value={pre.float_ids_fixed ?? 0} accent={pre.float_ids_fixed > 0} icon={StatIcons.floatIds} />
              </div>
            </div>
          )}

          {/* Auto-mapped columns summary (upload flow, before pipeline) */}
          {isUploadSource && mappedEntries.length > 0 && !pipelineComplete && (
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

          {/* Saved: mapped columns from DB */}
          {isSavedSource && displayMappedEntries.length > 0 && !pipelineComplete && (
            <div>
              <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
                Column mappings
              </h4>
              <div className="bg-white border border-brand-100 rounded-lg overflow-hidden shadow-sm">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 divide-x divide-y divide-brand-50">
                  {displayMappedEntries.map(([key, m]) => (
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
                {isSavedSource ? (
                  <>
                    <span className="font-semibold">Review column mappings</span> in the Column Configuration bar above, then click <span className="font-semibold">Save Config</span> to update readiness.
                    {hadPriorPipeline ? " Re-run cleanup & validation to refresh results." : " Run cleanup & validation before proceeding to analysis."}
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Columns have been auto-mapped</span> — review them in the Column Configuration bar above (green dots = high confidence).
                    Override any incorrect mappings, then click the button below.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Run Pipeline button */}
          {!pipelineComplete && (
            <button
              onClick={handleRunPipeline}
              disabled={!canRunPipeline || pipelineRunning}
              className={`w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${PRIMARY_BTN}`}
            >
              {pipelineRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  {PIPELINE_STAGES[pipelineStage].msg} <span className="text-xs font-normal opacity-70 ml-1">{PIPELINE_STAGES[pipelineStage].sub}</span>
                </>
              ) : (
                pipelineButtonLabel
              )}
            </button>
          )}

          {pipelineComplete && isSavedSource && (
            <button
              type="button"
              onClick={() => {
                setPipelineComplete(false);
                setCleanupResult(null);
                setValidationResult(null);
                setFilterApplied(false);
                setFilterFlags({});
              }}
              className="text-xs font-semibold text-brand-600 hover:text-brand-800 transition"
            >
              ← Run again
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
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <span className="text-sm text-slate-700">
                    {cleanupResult?.removed ? `${cleanupResult.removed} exclusion rows removed` : "No exclusion rows found"}
                  </span>
                </div>
              </div>

              {/* Validation — summary + dataset preview side by side */}
              {validationResult && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-brand-400 uppercase tracking-wide" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
                    Validation
                    {!hasValidationIssues && (
                      <span className="ml-2 text-blue-600 normal-case">— All clear</span>
                    )}
                    {hasValidationIssues && (
                      <span className="ml-2 text-amber-600 normal-case">
                        — {totalFlagged} flagged row{totalFlagged !== 1 ? "s" : ""}
                      </span>
                    )}
                  </h4>

                  <div className="space-y-4">
                    {/* Error type summary + filter actions */}
                    <div className="space-y-3">
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
                          <div className="px-4 py-3 text-sm text-blue-600 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            No validation issues found
                          </div>
                        )}
                      </div>

                      {/* Sample invalid manager IDs */}
                      {validationResult.invalid_manager_ids?.length > 0 && (
                        <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
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

                      {filterApplied && (
                        <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex items-center gap-2">
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          <span>
                            Filters applied — removed {rowStats?.lastFilterRemoved ?? 0} row{(rowStats?.lastFilterRemoved ?? 0) !== 1 ? "s" : ""},{" "}
                            {(validatedDf || dfRecords)?.length?.toLocaleString()} remaining
                          </span>
                        </div>
                      )}

                      {/* Explain new issues that surfaced as a side-effect of removing rows */}
                      {filterApplied && totalFlagged > 0 && (
                        <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
                          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          <span>
                            <strong>{totalFlagged} new issue{totalFlagged !== 1 ? "s" : ""} appeared after filtering.</strong>{" "}
                            This happens when a row you just removed was itself used as someone
                            else's manager ID — their direct reports are still valid employees,
                            but now point to a manager that no longer exists in the file. Select
                            an error type below and click <strong>Apply Filters</strong> again to
                            resolve them, or fix them manually in the table below.
                          </span>
                        </div>
                      )}

                      {/* Always available while there are flagged rows — including new ones
                          revealed by a previous filter pass, not just the first pass. */}
                      {totalFlagged > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-slate-400">
                            {selectedRemoveCount > 0
                              ? `${selectedRemoveCount} flagged row${selectedRemoveCount !== 1 ? "s" : ""} will be removed`
                              : "Select error types to remove, or fix them in the table below"}
                          </p>
                          <button
                            onClick={handleApplyFilters}
                            disabled={selectedRemoveCount === 0 || filtering}
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium ${PRIMARY_BTN}`}
                          >
                            {filtering ? "Filtering..." : "Apply Filters (remove selected)"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Dataset preview — directly under filter actions so it is not missed */}
                    <div>
                      <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2">
                        Dataset preview
                      </p>
                      <ValidationDataTable
                        key={validationTableKey}
                        records={tableRecords}
                        empCol={empCol}
                        mgrCol={mgrCol}
                        onRecordsChange={handleValidationRecordsChange}
                        onRevalidate={handleRevalidate}
                        revalidating={revalidating}
                      />
                    </div>

                    <HierarchyReadinessPanel readiness={readiness} />
                  </div>
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
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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

      {/* Toast: confirms the working dataset (and its Excel export) changed */}
      {rowToast && (
        <div
          className="fixed bottom-6 right-6 z-[300] max-w-sm animate-fadeInUp"
          role="status"
        >
          <div className={`flex items-start gap-3 rounded-lg shadow-xl border px-4 py-3 ${
            rowToast.tone === "error"
              ? "bg-red-50 border-red-200 text-red-800"
              : rowToast.tone === "warning"
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}>
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {rowToast.tone === "error" ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
              ) : rowToast.tone === "warning" ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
            <p className="text-sm font-medium flex-1">{rowToast.message}</p>
            <button
              onClick={() => setRowToast(null)}
              className="flex-shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
