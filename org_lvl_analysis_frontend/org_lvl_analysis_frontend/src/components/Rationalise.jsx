import React, { useState, useEffect, useMemo, useCallback } from "react";
import { rationalisePropose, rationaliseApply } from "../api/backend";
import MappingRegistry from "./MappingRegistry";
import ExportExcel from "./ExportExcel";
import Paginator from "./Paginator";

const RAT_PAGE_SIZE = 15;

const METHOD_BADGE = {
  exact:      { bg: "bg-green-100",  text: "text-green-700",  label: "Master" },
  fuzzy:      { bg: "bg-blue-100",   text: "text-blue-700",   label: "Fuzzy" },
  ai:         { bg: "bg-purple-100", text: "text-purple-700", label: "AI" },
  inferred:   { bg: "bg-orange-100", text: "text-orange-700", label: "Inferred" },
  cached:     { bg: "bg-cyan-100",   text: "text-cyan-700",   label: "Cached" },
  placeholder:{ bg: "bg-gray-100",   text: "text-gray-600",   label: "Placeholder" },
  original:   { bg: "bg-slate-100",  text: "text-slate-600",  label: "Original" },
  unresolved: { bg: "bg-red-100",    text: "text-red-700",    label: "Unresolved" },
};

function Badge({ method }) {
  const m = METHOD_BADGE[method] || METHOD_BADGE.unresolved;
  return <span className={`${m.bg} ${m.text} text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap`}>{m.label}</span>;
}

const METHOD_ORDER = ["exact", "fuzzy", "ai", "inferred", "cached", "unresolved", "placeholder"];
const METHOD_HEX = {
  exact:       "#01244a",
  fuzzy:       "#1e5a8a",
  ai:          "#2d7ab6",
  inferred:    "#4a9fd4",
  cached:      "#7ab8de",
  placeholder: "#bdd7ea",
  unresolved:  "#dc2626",
};

function RatSummaryCard({ funcMappings, subfuncMappings, titleMappings, funcAccepted, subfuncAccepted, titleAccepted, funcOverrides, subfuncOverrides, titleOverrides }) {
  const [showChanges, setShowChanges] = useState(false);

  const buildStats = (mappings, accepted, overrides) => {
    const total = mappings.length;
    const acceptedCount = mappings.filter((_, i) => accepted[i] !== false).length;
    const rejectedCount = total - acceptedCount;
    const methods = {};
    const changed = [];
    mappings.forEach((m, i) => {
      if (accepted[i] === false) return;
      const method = m.method;
      methods[method] = (methods[method] || 0) + 1;
      const final = overrides[i] !== undefined ? overrides[i] : m.resolved;
      if (final !== m.input) changed.push({ input: m.input, resolved: final, method, function: m.function });
    });
    return { total, acceptedCount, rejectedCount, methods, changed };
  };

  const funcStats    = buildStats(funcMappings,    funcAccepted,    funcOverrides);
  const subfuncStats = buildStats(subfuncMappings, subfuncAccepted, subfuncOverrides);
  const titleStats   = buildStats(titleMappings,   titleAccepted,   titleOverrides);
  const allChanged   = [...funcStats.changed, ...subfuncStats.changed, ...titleStats.changed];

  const CategoryPanel = ({ label, stats, isLast }) => {
    const methodsPresent = METHOD_ORDER.filter(m => stats.methods[m] > 0);
    const base = stats.acceptedCount || 1;
    return (
      <div className={`flex-1 min-w-0 px-5 py-3 ${!isLast ? "border-r border-brand-100" : ""}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-widest text-brand-400">{label}</span>
          <span className="text-xs text-brand-500 font-semibold">{stats.acceptedCount}/{stats.total}</span>
        </div>

        <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-brand-100/60">
          {methodsPresent.map(m => (
            <div
              key={m}
              style={{ width: `${(stats.methods[m] / base) * 100}%`, backgroundColor: METHOD_HEX[m] }}
              title={`${METHOD_BADGE[m]?.label}: ${stats.methods[m]}`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {methodsPresent.map(m => (
            <span key={m} className="text-xs text-slate-500">
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-0.5 align-middle" style={{ backgroundColor: METHOD_HEX[m] }} />
              {METHOD_BADGE[m]?.label} <span className="font-semibold text-slate-700">{stats.methods[m]}</span>
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white border border-brand-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-brand-600 px-5 py-2.5 flex items-center gap-2">
        <svg className="w-4 h-4 text-brand-200 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-semibold text-white">Rationalisation applied</span>
        <span className="text-brand-300 text-xs">— 6 new columns added to your dataset</span>
      </div>

      {/* 3-column stat panels */}
      <div className="flex divide-x divide-brand-100">
        <CategoryPanel label="Functions"    stats={funcStats}    isLast={false} />
        <CategoryPanel label="Subfunctions" stats={subfuncStats} isLast={false} />
        <CategoryPanel label="Titles"       stats={titleStats}   isLast />
      </div>

      {/* What Changed — collapsible */}
      {allChanged.length > 0 && (
        <div className="border-t border-brand-100">
          <button
            onClick={() => setShowChanges(v => !v)}
            className="w-full flex items-center justify-between px-5 py-2 text-xs font-semibold text-brand-600 hover:bg-brand-50/60 transition select-none"
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 4v8m0 0l4-4m-4 4l-4-4" />
              </svg>
              {allChanged.length} values standardised to taxonomy
            </span>
            <svg className={`w-4 h-4 text-brand-400 transition-transform duration-200 ${showChanges ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showChanges && (
            <div className="px-5 pb-3.5 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {allChanged.slice(0, 40).map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-brand-50 border border-brand-100 rounded-md px-2 py-0.5 text-xs">
                  <span className="text-slate-500 truncate max-w-[90px]">{c.input}</span>
                  <svg className="w-2.5 h-2.5 text-brand-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-brand-700 font-semibold truncate max-w-[90px]">{c.resolved}</span>
                </span>
              ))}
              {allChanged.length > 40 && (
                <span className="text-xs text-slate-400 self-center">+{allChanged.length - 40} more</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="bg-brand-50/60 border-t border-brand-100 px-5 py-2 flex items-center justify-end gap-1">
        <span className="text-xs text-brand-500 font-medium">Proceed to Hierarchy to build your org structure</span>
        <svg className="w-3 h-3 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}

function SummaryBar({ mappings }) {
  const counts = useMemo(() => {
    const c = { exact: 0, fuzzy: 0, ai: 0, inferred: 0, cached: 0, placeholder: 0, original: 0, unresolved: 0 };
    mappings.forEach(m => { c[m.method] = (c[m.method] || 0) + 1; });
    return c;
  }, [mappings]);
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-sm font-semibold text-brand-800">{mappings.length} items</span>
      {Object.entries(counts).map(([k, v]) => v > 0 && (
        <span key={k} className="flex items-center gap-1">
          <Badge method={k} />
          <span className="text-xs text-slate-500">{v}</span>
        </span>
      ))}
    </div>
  );
}

function MappingTable({
  mappings,
  allMappings,
  overrides,
  setOverrides,
  accepted,
  setAccepted,
  selected,
  setSelected,
  datalistId,
  showFuncCol = false
}) {
  const [page, setPage] = useState(1);
  const [flashedIdxs, setFlashedIdxs] = useState(new Set());

  // Reset to page 1 when the mapping list changes (tab switch or filter)
  const mappingKey = (mappings || []).map(m => m.originalIdx).join(",");
  useEffect(() => { setPage(1); }, [mappingKey]);

  const totalPages = Math.ceil((mappings || []).length / RAT_PAGE_SIZE);
  const paged = (mappings || []).slice((page - 1) * RAT_PAGE_SIZE, page * RAT_PAGE_SIZE);

  if (!mappings || mappings.length === 0) {
    return <p className="text-sm text-slate-400 italic py-6 text-center">No mappings to review</p>;
  }

  const toggleAccept = (idx) => setAccepted(prev => ({ ...prev, [idx]: prev[idx] === false ? true : false }));

  const handleOverrideChange = (m, val) => {
    // Clear flash when user manually edits again
    if (flashedIdxs.has(m.originalIdx)) {
      setFlashedIdxs(prev => { const next = new Set(prev); next.delete(m.originalIdx); return next; });
    }
    setOverrides(prev => ({ ...prev, [m.originalIdx]: val }));
  };

  // Apply a value to all sibling rows that still have a different current value
  const applyToSiblings = (m, val) => {
    const allSibs = (allMappings || mappings).filter(
      s => s.originalIdx !== m.originalIdx && s.resolved === m.resolved
    );
    const needsUpdate = allSibs.filter(s => {
      const sibVal = overrides[s.originalIdx] !== undefined ? overrides[s.originalIdx] : s.resolved;
      return sibVal !== val;
    });
    setOverrides(prev => {
      const next = { ...prev, [m.originalIdx]: val };
      needsUpdate.forEach(s => { next[s.originalIdx] = val; });
      return next;
    });
    // Flash self + all updated siblings
    const affected = new Set([m.originalIdx, ...needsUpdate.map(s => s.originalIdx)]);
    setFlashedIdxs(affected);
    setTimeout(() => setFlashedIdxs(new Set()), 1800);
  };

  const allSelected = paged.length > 0 && paged.every(m => !!selected[m.originalIdx]);
  const toggleSelectAll = () => {
    setSelected(prev => {
      const next = { ...prev };
      if (allSelected) {
        paged.forEach(m => { next[m.originalIdx] = false; });
      } else {
        paged.forEach(m => { next[m.originalIdx] = true; });
      }
      return next;
    });
  };

  return (
    <div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand-50 text-brand-700 text-xs uppercase tracking-wide">
            <th className="w-10 text-center px-3 py-2.5">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 h-4 w-4 cursor-pointer"
                title="Select all for Accept / Reject"
              />
            </th>
            {showFuncCol && <th className="text-left px-3 py-2.5 font-semibold">Function</th>}
            <th className="text-left px-3 py-2.5 font-semibold">Input</th>
            <th className="text-left px-3 py-2.5 font-semibold">Proposed</th>
            <th className="text-left px-3 py-2.5 font-semibold w-24">Method</th>
            <th className="text-center px-3 py-2.5 font-semibold w-20">Accept</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {paged.map((m) => {
            const isAccepted = accepted[m.originalIdx] !== false;
            const currentVal = overrides[m.originalIdx] !== undefined ? overrides[m.originalIdx] : m.resolved;
            const isDirty = overrides[m.originalIdx] !== undefined && overrides[m.originalIdx] !== m.resolved;
            const isSelected = !!selected[m.originalIdx];
            const isFlashed = flashedIdxs.has(m.originalIdx);

            // Siblings = other rows that the AI also proposed the same resolved value AND currently have a different value from this row
            const allSiblings = (allMappings || mappings).filter(
              s => s.originalIdx !== m.originalIdx && s.resolved === m.resolved
            );
            const siblingCount = allSiblings.length;
            // Only count siblings that still need to be updated (their current value ≠ currentVal)
            const siblingsOutOfSync = allSiblings.filter(s => {
              const sibVal = overrides[s.originalIdx] !== undefined ? overrides[s.originalIdx] : s.resolved;
              return sibVal !== currentVal;
            });
            const outOfSyncCount = siblingsOutOfSync.length;

            return (
              <tr
                key={m.originalIdx}
                className={`transition-colors duration-500 ${
                  isFlashed
                    ? "bg-brand-50"
                    : isDirty
                    ? "bg-amber-50/40"
                    : isAccepted
                    ? "bg-white"
                    : "bg-gray-50 opacity-60"
                }`}
              >
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => setSelected(prev => ({ ...prev, [m.originalIdx]: !prev[m.originalIdx] }))}
                    className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 h-4 w-4 cursor-pointer"
                    title="Select for Accept / Reject"
                  />
                </td>
                {showFuncCol && <td className="px-3 py-2 text-slate-500 text-xs">{m.function}</td>}
                <td className="px-3 py-2 text-slate-700 font-medium">{m.input}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      list={datalistId}
                      value={currentVal}
                      onChange={(e) => handleOverrideChange(m, e.target.value)}
                      className={`flex-1 border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white hover:border-gray-300 transition ${
                        isDirty ? "border-amber-400" : "border-gray-200"
                      }`}
                    />
                  {/* Badge: show how many share same proposed value (only when not dirty) */}
                  {siblingCount > 0 && !isDirty && (
                    <span className="flex-shrink-0 text-[10px] font-semibold text-slate-400 bg-gray-100 rounded-full px-1.5 py-0.5" title={`${siblingCount + 1} rows share this proposed value`}>
                      ×{siblingCount + 1}
                    </span>
                  )}
                  </div>
                  {/* Show apply link only when siblings still have a different current value */}
                  {isDirty && outOfSyncCount > 0 && !isFlashed && (
                    <button
                      onClick={() => applyToSiblings(m, currentVal)}
                      className="mt-1 text-[11px] text-brand-600 hover:text-brand-800 font-semibold flex items-center gap-1"
                      title={`Apply "${currentVal}" to ${outOfSyncCount} row${outOfSyncCount > 1 ? "s" : ""} still proposed as "${m.resolved}"`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Apply to {outOfSyncCount} other{outOfSyncCount > 1 ? "s" : ""} still showing "{m.resolved}"
                    </button>
                  )}
                  {isFlashed && (
                    <span className="mt-1 text-[11px] text-brand-500 flex items-center gap-1 font-medium">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      Updated
                    </span>
                  )}
                </td>
                <td className="px-3 py-2"><Badge method={m.method} /></td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => toggleAccept(m.originalIdx)} className={`w-7 h-7 rounded-full flex items-center justify-center mx-auto transition ${
                    isAccepted ? "bg-green-100 text-green-600 hover:bg-green-200" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                  }`}>
                    {isAccepted ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    )}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {totalPages > 1 && (
      <div className="px-4 border-t border-gray-100">
        <Paginator
          page={page}
          totalPages={totalPages}
          totalItems={mappings.length}
          pageSize={RAT_PAGE_SIZE}
          onChange={setPage}
        />
      </div>
    )}
    </div>
  );
}

export default function Rationalise({
  dfRecords,
  setDfRecords,
  setValidatedDf,
  funcCol,
  subfuncCol,
  jobTitleCol,
  columns,
  setColumns,
  datasetId = null,
  onApplySuccess,
}) {
  const [viewMode, setViewMode] = useState("run");
  const [activeTab, setActiveTab] = useState("functions");
  const [useLearnedAliases, setUseLearnedAliases] = useState(false);

  // Filter and Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [functionFilter, setFunctionFilter] = useState("all");

  // Selection states
  const [funcSelected, setFuncSelected] = useState({});
  const [subfuncSelected, setSubfuncSelected] = useState({});
  const [titleSelected, setTitleSelected] = useState({});

  // (bulk value input removed — overrides propagate via inline "Apply to N others" button)

  // Run state
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [rationalisationResult, setRationalisationResult] = useState(null);
  const [loaderStage, setLoaderStage] = useState(0);

  const LOADER_STAGES = [
    { at: 0,    msg: "Analysing dataset...",       sub: "Identifying unique values" },
    { at: 3000, msg: "Resolving functions...",     sub: "Mapping to master taxonomy" },
    { at: 8000, msg: "Standardising titles...",    sub: "Applying role hierarchy" },
    { at: 13000, msg: "Mapping subfunctions...",    sub: "Matching process areas" },
    { at: 18000, msg: "Inferring missing data...",  sub: "Filling gaps from titles" },
    { at: 25000, msg: "Finalising results...",      sub: "Almost there" },
  ];

  useEffect(() => {
    if (!running) { setLoaderStage(0); return; }
    const timers = LOADER_STAGES.slice(1).map((s, i) =>
      setTimeout(() => setLoaderStage(i + 1), s.at)
    );
    return () => timers.forEach(clearTimeout);
  }, [running]);

  // Apply state
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState(null);

  const funcMappings = rationalisationResult?.function_mappings || [];
  const subfuncMappings = rationalisationResult?.subfunction_mappings || [];
  const titleMappings = rationalisationResult?.title_mappings || [];

  const [funcOverrides, setFuncOverrides] = useState({});
  const [subfuncOverrides, setSubfuncOverrides] = useState({});
  const [titleOverrides, setTitleOverrides] = useState({});
  const [funcAccepted, setFuncAccepted] = useState({});
  const [subfuncAccepted, setSubfuncAccepted] = useState({});
  const [titleAccepted, setTitleAccepted] = useState({});

  const tabs = [
    { key: "functions", label: "Functions", count: funcMappings.length },
    { key: "subfunctions", label: "Subfunctions", count: subfuncMappings.length },
    { key: "titles", label: "Titles", count: titleMappings.length },
  ];

  const hasRequiredCols = !!funcCol;
  const hasSubfuncCol = !!subfuncCol;

  const handleRun = async () => {
    if (!dfRecords || !hasRequiredCols) return;
    setRunning(true);
    setRunError(null);
    setRationalisationResult(null);
    setApplied(false);
    setFuncOverrides({});
    setSubfuncOverrides({});
    setTitleOverrides({});
    setFuncAccepted({});
    setSubfuncAccepted({});
    setTitleAccepted({});
    setFuncSelected({});
    setSubfuncSelected({});
    setTitleSelected({});
    try {
      const res = await rationalisePropose(dfRecords, funcCol, subfuncCol, jobTitleCol, useLearnedAliases);
      setRationalisationResult(res);
    } catch (err) {
      console.error("Rationalise error:", err);
      setRunError(err.response?.data?.detail || "Rationalisation failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const buildApproved = useCallback((mappings, overrides, accepted, hasFunc = false) => {
    return mappings
      .map((m, idx) => {
        if (accepted[idx] === false) return null;
        const resolved = overrides[idx] !== undefined ? overrides[idx] : m.resolved;
        const entry = { input: m.input, resolved, method: m.method };
        if (hasFunc) entry.function = m.function;
        return entry;
      })
      .filter(Boolean);
  }, []);

  const handleAcceptAll = () => {
    const setter = activeTab === "functions" ? setFuncAccepted : activeTab === "subfunctions" ? setSubfuncAccepted : setTitleAccepted;
    const mappings = activeTab === "functions" ? funcMappings : activeTab === "subfunctions" ? subfuncMappings : titleMappings;
    const all = {};
    mappings.forEach((_, i) => { all[i] = true; });
    setter(all);
  };

  const totalAccepted = useMemo(() => {
    const count = (mappings, acc) => mappings.filter((_, i) => acc[i] !== false).length;
    return count(funcMappings, funcAccepted) + count(subfuncMappings, subfuncAccepted) + count(titleMappings, titleAccepted);
  }, [funcMappings, subfuncMappings, titleMappings, funcAccepted, subfuncAccepted, titleAccepted]);

  const totalMappings = funcMappings.length + subfuncMappings.length + titleMappings.length;

  const handleApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const body = {
        records: dfRecords,
        func_col: funcCol || null,
        subfunc_col: subfuncCol || null,
        title_col: jobTitleCol || null,
        approved_functions: buildApproved(funcMappings, funcOverrides, funcAccepted),
        approved_subfunctions: buildApproved(subfuncMappings, subfuncOverrides, subfuncAccepted, true),
        approved_titles: buildApproved(titleMappings, titleOverrides, titleAccepted, true),
        dataset_id: datasetId || null,
      };
      const res = await rationaliseApply(body);
      if (res?.records) {
        setDfRecords(res.records);
        setValidatedDf?.(res.records);
        setColumns(Object.keys(res.records[0] || {}));
        setApplied(true);
        onApplySuccess?.();
      }
    } catch (err) {
      console.error("Apply error:", err);
      setApplyError(err.response?.data?.detail || "Failed to apply rationalisation");
    } finally {
      setApplying(false);
    }
  };

  const handleTabChange = (tabKey) => {
    setActiveTab(tabKey);
    setFuncSelected({});
    setSubfuncSelected({});
    setTitleSelected({});
    setSearchQuery("");
    setMethodFilter("all");
    setFunctionFilter("all");
  };

  // Compute active mappings and suggestions based on tab selection
  const activeMappings = activeTab === "functions" ? funcMappings : activeTab === "subfunctions" ? subfuncMappings : titleMappings;
  const activeSelected = activeTab === "functions" ? funcSelected : activeTab === "subfunctions" ? subfuncSelected : titleSelected;

  // Extract filters dynamic lists
  const uniqueMethods = useMemo(() => {
    const methods = new Set();
    activeMappings.forEach(m => { if (m.method) methods.add(m.method); });
    return Array.from(methods).sort();
  }, [activeMappings]);

  const uniqueFunctions = useMemo(() => {
    const funcs = new Set();
    activeMappings.forEach(m => { if (m.function) funcs.add(m.function); });
    return Array.from(funcs).sort();
  }, [activeMappings]);

  const uniqueSuggestions = useMemo(() => {
    const vals = new Set();
    activeMappings.forEach(m => { if (m.resolved) vals.add(m.resolved); });
    return Array.from(vals).sort();
  }, [activeMappings]);

  // Apply filters
  const filteredMappings = useMemo(() => {
    const mapped = activeMappings.map((m, idx) => ({ ...m, originalIdx: idx }));
    return mapped.filter(m => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const inInput = String(m.input || "").toLowerCase().includes(query);
        const inResolved = String(m.resolved || "").toLowerCase().includes(query);
        const inFunction = String(m.function || "").toLowerCase().includes(query);
        if (!inInput && !inResolved && !inFunction) return false;
      }
      if (methodFilter !== "all" && m.method !== methodFilter) return false;
      if (functionFilter !== "all" && m.function !== functionFilter) return false;
      return true;
    });
  }, [activeMappings, searchQuery, methodFilter, functionFilter]);

  // Bulk actions operations
  const selectedOriginalIdxs = useMemo(() => {
    return filteredMappings.filter(m => activeSelected[m.originalIdx]).map(m => m.originalIdx);
  }, [filteredMappings, activeSelected]);

  const selectedCount = selectedOriginalIdxs.length;

  const handleBulkAcceptReject = (accept) => {
    const setAccepted = activeTab === "functions" ? setFuncAccepted : activeTab === "subfunctions" ? setSubfuncAccepted : setTitleAccepted;
    setAccepted(prev => {
      const next = { ...prev };
      selectedOriginalIdxs.forEach(idx => { next[idx] = accept; });
      return next;
    });
    const setSelected = activeTab === "functions" ? setFuncSelected : activeTab === "subfunctions" ? setSubfuncSelected : setTitleSelected;
    setSelected({});
  };

  // Empty state: no data loaded
  if (!dfRecords) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-5 shadow-lg">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
        </div>
        <p className="text-base font-semibold text-brand-700">No Data Loaded</p>
        <p className="text-sm mt-1 text-brand-400">Upload and prepare data first</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      {/* Header */}
      <div className="bg-brand-50 border border-brand-100 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-brand-800" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Rationalise</h3>
              <p className="text-sm text-slate-500">Map your titles, functions, and subfunctions to standard categories. Review AI proposals, override where needed, then apply.</p>
            </div>
          </div>
          <ExportExcel df={dfRecords} compact />
        </div>

        <div className="flex mt-4 p-1 bg-white/80 border border-brand-100 rounded-lg w-fit">
          <button
            onClick={() => setViewMode("run")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition ${
              viewMode === "run" ? "bg-brand-500 text-white shadow-sm" : "text-slate-600 hover:text-brand-700"
            }`}
          >
            Run Rationalisation
          </button>
          <button
            onClick={() => setViewMode("registry")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition ${
              viewMode === "registry" ? "bg-brand-500 text-white shadow-sm" : "text-slate-600 hover:text-brand-700"
            }`}
          >
            Mapping Registry
          </button>
        </div>
      </div>

      {viewMode === "registry" && <MappingRegistry />}

      {viewMode === "run" && (
      <>
      {applied && (
        <RatSummaryCard
          funcMappings={funcMappings}
          subfuncMappings={subfuncMappings}
          titleMappings={titleMappings}
          funcAccepted={funcAccepted}
          subfuncAccepted={subfuncAccepted}
          titleAccepted={titleAccepted}
          funcOverrides={funcOverrides}
          subfuncOverrides={subfuncOverrides}
          titleOverrides={titleOverrides}
        />
      )}

      {/* Shimmering progress card when running */}
      {running && (
        <div className="border border-brand-100 rounded-lg p-8 bg-white shadow-sm flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-brand-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div className="text-center" style={{ minHeight: 36 }}>
            <p className="text-sm font-semibold text-slate-800 transition-opacity duration-300">{LOADER_STAGES[loaderStage].msg}</p>
            <p className="text-xs text-slate-400 mt-1 transition-opacity duration-300">{LOADER_STAGES[loaderStage].sub}</p>
          </div>
          <div className="w-64 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full" style={{
              width: `${Math.min(100, 15 + loaderStage * 15)}%`,
              backgroundImage: "linear-gradient(90deg, #01244a 0%, #2563eb 50%, #01244a 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite",
              transition: "width 0.8s ease",
            }} />
          </div>
        </div>
      )}

      {/* Run button (before proposals are generated) */}
      {!rationalisationResult && !applied && !running && (
        <div className="space-y-3">
          {!hasRequiredCols && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
              Map <span className="font-semibold">Function</span> in the Column Configuration bar above, then click <span className="font-semibold">Save Config</span>.
              Subfunction and title rationalisation also require Function to be mapped.
            </div>
          )}
          {hasRequiredCols && !hasSubfuncCol && (
            <div className="bg-brand-50 border border-brand-100 rounded-lg px-4 py-3 text-sm text-brand-700">
              Function is mapped. Sub-Function is optional but recommended for subfunction rationalisation.
            </div>
          )}
          <label className="flex items-start gap-2.5 px-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useLearnedAliases}
              onChange={(e) => setUseLearnedAliases(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-600">
              Use previously learned mapping aliases
              <span className="block text-xs text-slate-400 mt-0.5">
                Off by default — uses only the base master taxonomy and AI, not auto_learned_taxonomy.json
              </span>
            </span>
          </label>
          <button
            onClick={handleRun}
            disabled={!hasRequiredCols}
            className="w-full py-3 bg-brand-500 text-white rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition shadow-sm"
          >
            Run Rationalisation
          </button>
        </div>
      )}

      {runError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{runError}</div>
      )}

      {/* Proposals table (after run completes) */}
      {rationalisationResult && !applied && !running && (
        <>
          <div className="bg-white border border-brand-100 rounded-lg shadow-sm overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-brand-100">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => handleTabChange(t.key)}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition border-b-2 ${
                    activeTab === t.key
                      ? "border-brand-500 text-brand-600 bg-brand-50/50"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-gray-50"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === t.key ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-500"
                  }`}>{t.count}</span>
                </button>
              ))}
            </div>

            {/* Filter controls */}
            <div className="px-4 py-3 bg-slate-50 border-b border-gray-100 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <input
                  type="text"
                  placeholder={`Search in ${activeTab}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Method:</span>
                <select
                  value={methodFilter}
                  onChange={(e) => setMethodFilter(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none"
                >
                  <option value="all">All Methods</option>
                  {uniqueMethods.map(m => (
                    <option key={m} value={m}>{METHOD_BADGE[m]?.label || m}</option>
                  ))}
                </select>
              </div>

              {(activeTab === "subfunctions" || activeTab === "titles") && uniqueFunctions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Function:</span>
                  <select
                    value={functionFilter}
                    onChange={(e) => setFunctionFilter(e.target.value)}
                    className="bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none max-w-[200px]"
                  >
                    <option value="all">All Functions</option>
                    {uniqueFunctions.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Summary bar */}
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <SummaryBar mappings={filteredMappings} />
              <button onClick={handleAcceptAll} className="text-xs text-brand-500 hover:text-brand-700 font-medium">Accept All</button>
            </div>

            {/* Datalist Suggestions */}
            <datalist id="suggestions-datalist">
              {uniqueSuggestions.map(val => (
                <option key={val} value={val} />
              ))}
            </datalist>

            {/* Table */}
            {activeTab === "functions" && (
              <MappingTable
                mappings={filteredMappings}
                allMappings={funcMappings.map((m, i) => ({ ...m, originalIdx: i }))}
                overrides={funcOverrides}
                setOverrides={setFuncOverrides}
                accepted={funcAccepted}
                setAccepted={setFuncAccepted}
                selected={funcSelected}
                setSelected={setFuncSelected}
                datalistId="suggestions-datalist"
              />
            )}
            {activeTab === "subfunctions" && (
              <MappingTable
                mappings={filteredMappings}
                allMappings={subfuncMappings.map((m, i) => ({ ...m, originalIdx: i }))}
                overrides={subfuncOverrides}
                setOverrides={setSubfuncOverrides}
                accepted={subfuncAccepted}
                setAccepted={setSubfuncAccepted}
                selected={subfuncSelected}
                setSelected={setSubfuncSelected}
                datalistId="suggestions-datalist"
                showFuncCol
              />
            )}
            {activeTab === "titles" && (
              <MappingTable
                mappings={filteredMappings}
                allMappings={titleMappings.map((m, i) => ({ ...m, originalIdx: i }))}
                overrides={titleOverrides}
                setOverrides={setTitleOverrides}
                accepted={titleAccepted}
                setAccepted={setTitleAccepted}
                selected={titleSelected}
                setSelected={setTitleSelected}
                datalistId="suggestions-datalist"
                showFuncCol
              />
            )}
          </div>

          {/* Apply bar */}
          <div className="flex items-center justify-between bg-white border border-brand-100 rounded-lg px-4 py-3 shadow-sm">
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-brand-700">{totalAccepted}</span> of {totalMappings} mappings accepted
            </p>
            <button
              onClick={handleApply}
              disabled={applying || totalAccepted === 0}
              className="px-6 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition shadow-sm"
            >
              {applying ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Applying...
                </span>
              ) : "Apply to Data"}
            </button>
          </div>

          {applyError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{applyError}</div>
          )}

          {/* Floating Bulk Action Bar — selection used for Accept / Reject only */}
          {selectedCount > 0 && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-[#01244a] border border-[#08304a] text-white rounded-xl px-5 py-3 shadow-2xl flex items-center gap-3 z-50 animate-bounceOnce select-none">
              <span className="text-xs font-semibold text-gray-200">
                {selectedCount} row{selectedCount > 1 ? "s" : ""} selected
              </span>
              <div className="w-px h-4 bg-white/20" />
              <button
                onClick={() => handleBulkAcceptReject(true)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded text-xs shadow-sm transition flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                Accept
              </button>
              <button
                onClick={() => handleBulkAcceptReject(false)}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded text-xs shadow-sm transition flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                Reject
              </button>
              <button
                onClick={() => { setFuncSelected({}); setSubfuncSelected({}); setTitleSelected({}); }}
                className="text-xs text-gray-400 hover:text-white transition ml-1"
              >
                Clear
              </button>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
