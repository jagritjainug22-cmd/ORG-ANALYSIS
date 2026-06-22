import React, { useState, useMemo, useCallback } from "react";
import { rationalisePropose, rationaliseApply } from "../api/backend";

const METHOD_BADGE = {
  exact:      { bg: "bg-green-100",  text: "text-green-700",  label: "Master" },
  fuzzy:      { bg: "bg-blue-100",   text: "text-blue-700",   label: "Fuzzy" },
  ai:         { bg: "bg-purple-100", text: "text-purple-700", label: "AI" },
  cached:     { bg: "bg-cyan-100",   text: "text-cyan-700",   label: "Cached" },
  unresolved: { bg: "bg-red-100",    text: "text-red-700",    label: "Unresolved" },
};

function Badge({ method }) {
  const m = METHOD_BADGE[method] || METHOD_BADGE.unresolved;
  return <span className={`${m.bg} ${m.text} text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap`}>{m.label}</span>;
}

function SummaryBar({ mappings }) {
  const counts = useMemo(() => {
    const c = { exact: 0, fuzzy: 0, ai: 0, cached: 0, unresolved: 0 };
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

function MappingTable({ mappings, overrides, setOverrides, accepted, setAccepted, showFuncCol = false }) {
  if (!mappings || mappings.length === 0) {
    return <p className="text-sm text-slate-400 italic py-6 text-center">No mappings to review</p>;
  }
  const toggleAccept = (idx) => setAccepted(prev => ({ ...prev, [idx]: prev[idx] === false ? true : false }));
  const setOverride = (idx, val) => setOverrides(prev => ({ ...prev, [idx]: val }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand-50 text-brand-700 text-xs uppercase tracking-wide">
            {showFuncCol && <th className="text-left px-3 py-2.5 font-semibold">Function</th>}
            <th className="text-left px-3 py-2.5 font-semibold">Input</th>
            <th className="text-left px-3 py-2.5 font-semibold">Proposed</th>
            <th className="text-left px-3 py-2.5 font-semibold w-24">Method</th>
            <th className="text-center px-3 py-2.5 font-semibold w-20">Accept</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {mappings.map((m, idx) => {
            const isAccepted = accepted[idx] !== false;
            const overrideVal = overrides[idx];
            return (
              <tr key={idx} className={`transition ${isAccepted ? "bg-white" : "bg-gray-50 opacity-60"}`}>
                {showFuncCol && <td className="px-3 py-2 text-slate-500 text-xs">{m.function}</td>}
                <td className="px-3 py-2 text-slate-700 font-medium">{m.input}</td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={overrideVal !== undefined ? overrideVal : m.resolved}
                    onChange={(e) => setOverride(idx, e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white hover:border-gray-300 transition"
                  />
                </td>
                <td className="px-3 py-2"><Badge method={m.method} /></td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => toggleAccept(idx)} className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
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
}) {
  const [activeTab, setActiveTab] = useState("functions");

  // Run state
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [rationalisationResult, setRationalisationResult] = useState(null);

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

  const hasRequiredCols = funcCol || subfuncCol || jobTitleCol;

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
    try {
      const res = await rationalisePropose(dfRecords, funcCol, subfuncCol, jobTitleCol);
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
      }
    } catch (err) {
      console.error("Apply error:", err);
      setApplyError(err.response?.data?.detail || "Failed to apply rationalisation");
    } finally {
      setApplying(false);
    }
  };

  // Empty state: no data loaded
  if (!dfRecords) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
        <p className="text-base font-medium">No Data Loaded</p>
        <p className="text-sm mt-1">Upload and prepare data first</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-brand-50 border border-brand-100 rounded-lg p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-brand-800" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Rationalise</h3>
            <p className="text-sm text-slate-500">Map your titles, functions, and subfunctions to standard categories. Review AI proposals, override where needed, then apply.</p>
          </div>
        </div>
      </div>

      {applied && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="font-medium">Rationalisation applied</span> — 6 new columns added to your dataset. Proceed to Hierarchy.
        </div>
      )}

      {/* Run button (before proposals are generated) */}
      {!rationalisationResult && !applied && (
        <div className="space-y-3">
          {!hasRequiredCols && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
              Select at least one of <span className="font-semibold">Function</span>, <span className="font-semibold">Sub-Function</span>, or <span className="font-semibold">Job Title</span> in the Column Configuration bar above.
            </div>
          )}
          <button
            onClick={handleRun}
            disabled={!hasRequiredCols || running}
            className="w-full py-3 bg-brand-500 text-white rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition shadow-sm flex items-center justify-center gap-2"
          >
            {running ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Running Rationalisation...
              </>
            ) : "Run Rationalisation"}
          </button>
        </div>
      )}

      {runError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{runError}</div>
      )}

      {/* Proposals table (after run completes) */}
      {rationalisationResult && !applied && (
        <>
          <div className="bg-white border border-brand-100 rounded-lg shadow-sm overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-brand-100">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
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

            {/* Summary bar */}
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <SummaryBar mappings={activeTab === "functions" ? funcMappings : activeTab === "subfunctions" ? subfuncMappings : titleMappings} />
              <button onClick={handleAcceptAll} className="text-xs text-brand-500 hover:text-brand-700 font-medium">Accept All</button>
            </div>

            {/* Table */}
            {activeTab === "functions" && (
              <MappingTable mappings={funcMappings} overrides={funcOverrides} setOverrides={setFuncOverrides} accepted={funcAccepted} setAccepted={setFuncAccepted} />
            )}
            {activeTab === "subfunctions" && (
              <MappingTable mappings={subfuncMappings} overrides={subfuncOverrides} setOverrides={setSubfuncOverrides} accepted={subfuncAccepted} setAccepted={setSubfuncAccepted} showFuncCol />
            )}
            {activeTab === "titles" && (
              <MappingTable mappings={titleMappings} overrides={titleOverrides} setOverrides={setTitleOverrides} accepted={titleAccepted} setAccepted={setTitleAccepted} showFuncCol />
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
        </>
      )}
    </div>
  );
}
