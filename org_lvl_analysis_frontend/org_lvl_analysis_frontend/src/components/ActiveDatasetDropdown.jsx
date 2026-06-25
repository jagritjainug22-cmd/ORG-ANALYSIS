/**
 * ActiveDatasetDropdown
 *
 * Header pill that shows the currently active dataset + scenario.
 * Clicking it opens a popover with the cached list of saved datasets.
 * Selecting one opens the scenario picker, then triggers a full workspace
 * switch via onActivateDataset.
 *
 * Props:
 *   label          – string shown on the pill, e.g. "Legacy — Q2 Scenario"
 *   savedDatasets  – array from ProjectWorkspace cache (or null while loading)
 *   onActivateDataset(dataset, scenarioId) – async callback to load records
 *   hasUnsavedChanges – bool, if true shows a confirmation step first
 */
import React, { useState, useRef, useEffect } from "react";
import { dbGetDataset } from "../api/backend";

const NAVY = "#01244a";
const GOLD = "#c5a84a";

function fmtRows(n) {
  if (n == null) return "";
  const num = Number(n);
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k rows`;
  return `${num} rows`;
}

function initialsOf(name) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ActiveDatasetDropdown({
  label,
  savedDatasets,
  activeDatasetId,
  onActivateDataset,
  hasUnsavedChanges,
}) {
  const [open, setOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState(null); // { dataset }
  const [scenarioPicker, setScenarioPicker] = useState(null); // { dataset, scenarios }
  const [loadingPickId, setLoadingPickId] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleDatasetClick = async (dataset) => {
    if (loadingPickId) return;
    if (hasUnsavedChanges && dataset.id !== activeDatasetId) {
      setConfirmPending({ dataset });
      return;
    }
    await openScenarioPicker(dataset);
  };

  const openScenarioPicker = async (dataset) => {
    setLoadingPickId(dataset.id);
    setSwitchError(null);
    try {
      const resp = await dbGetDataset(dataset.id);
      setScenarioPicker({ dataset: resp.dataset, scenarios: resp.scenarios || [] });
      setOpen(false);
    } catch (e) {
      setSwitchError(e?.response?.data?.detail || e?.message || "Failed to load dataset.");
    } finally {
      setLoadingPickId(null);
    }
  };

  const handleConfirmSwitch = () => {
    const ds = confirmPending.dataset;
    setConfirmPending(null);
    openScenarioPicker(ds);
  };

  const handleScenarioConfirm = async (scenarioId) => {
    if (!scenarioPicker) return;
    const { dataset, scenarios } = scenarioPicker;
    setSwitching(true);
    setSwitchError(null);
    try {
      await onActivateDataset(dataset, scenarios, scenarioId);
      setScenarioPicker(null);
    } catch (e) {
      setSwitchError(e?.response?.data?.detail || e?.message || "Failed to switch dataset.");
      setSwitching(false);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      {/* Full-screen switching loader */}
      {switching && <SwitchingOverlay />}

      {/* Unsaved changes confirmation */}
      {confirmPending && (
        <UnsavedConfirmDialog
          datasetName={confirmPending.dataset.name}
          onCancel={() => setConfirmPending(null)}
          onConfirm={handleConfirmSwitch}
        />
      )}

      {/* Scenario picker modal */}
      {scenarioPicker && (
        <ScenarioPickerModal
          dataset={scenarioPicker.dataset}
          scenarios={scenarioPicker.scenarios}
          onConfirm={handleScenarioConfirm}
          onCancel={() => setScenarioPicker(null)}
          error={switchError}
        />
      )}

      {/* Pill + dropdown */}
      <div className="relative flex items-center gap-1.5" ref={ref}>
        <svg className="w-3 h-3 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <button
          onClick={() => setOpen((v) => !v)}
          className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
              open
                ? "bg-brand-800 text-white border-brand-800 shadow-sm"
                : "bg-brand-800/8 text-white border-brand-800/20 hover:bg-brand-800/14 hover:border-brand-800/35"
          } max-w-[260px]`}
          title={label}
        >
          <svg className={`w-3 h-3 flex-shrink-0 text-white`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
          <span className="truncate max-w-[160px] text-white">{label}</span>
          {activeDatasetId && (
            <span className="font-mono text-[9px] text-white/50 flex-shrink-0 tabular-nums leading-none border border-white/20 rounded px-1 py-0.5 hidden sm:inline">
              #{activeDatasetId.slice(0, 8)}
            </span>
          )}
          <svg
            className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown popover */}
        {open && (
          <div className="absolute top-full left-0 mt-2 w-[320px] bg-white border border-gray-200 rounded-2xl shadow-2xl z-50 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Switch Dataset</span>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {switchError && (
              <div className="mx-3 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {switchError}
              </div>
            )}

            {/* Dataset list */}
            <div className="max-h-[340px] overflow-y-auto">
              {savedDatasets === null ? (
                <div className="py-8 flex flex-col items-center gap-2 text-gray-400">
                  <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-xs">Loading saved datasets…</span>
                </div>
              ) : savedDatasets.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">
                  No saved datasets in this project.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 py-1">
                  {savedDatasets.map((d) => {
                    const isActive = d.id === activeDatasetId;
                    const isLoading = loadingPickId === d.id;
                    const promoted = d.promoted_scenario_name;
                    return (
                      <li key={d.id}>
                        <button
                          onClick={() => handleDatasetClick(d)}
                          disabled={isLoading || (loadingPickId !== null && !isLoading)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                            isActive
                              ? "bg-brand-800/6"
                              : "hover:bg-gray-50"
                          } ${(loadingPickId !== null && !isLoading) ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                          {/* Avatar */}
                          <div
                            className="w-7 h-7 rounded-md flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                            style={{ background: isActive ? "#0b2b4a" : "#64748b" }}
                          >
                            {isLoading ? (
                              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : initialsOf(d.name)}
                          </div>

                          {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                              <span className={`text-sm font-semibold truncate ${isActive ? "text-[#01244a]" : "text-gray-800"}`}>
                                {d.name}
                              </span>
                              {isActive && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-brand-800 text-white flex-shrink-0">
                                  <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-gray-400">{fmtRows(d.row_count)}</span>
                              {promoted && promoted !== "Baseline" && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span className="text-[11px] text-[#c5a84a] font-medium truncate max-w-[100px]">{promoted}</span>
                                </>
                              )}
                              <span className="text-gray-300">·</span>
                              <span className="text-[11px] text-gray-400">{d.scenario_count ?? 0} scenario{d.scenario_count === 1 ? "" : "s"}</span>
                            </div>
                          </div>

                          {/* Arrow */}
                          {!isLoading && !isActive && (
                            <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer — upload new */}
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-[11px] text-gray-400 text-center">
                To upload a new dataset, go to{" "}
                <button
                  onClick={() => setOpen(false)}
                  className="text-[#01244a] font-semibold hover:underline"
                >
                  Data Source
                </button>
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Switching full-screen overlay
// ---------------------------------------------------------------------------

function SwitchingOverlay() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#01244a]/70 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 min-w-[240px]">
        {/* Animated rings */}
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-4 border-gray-100" />
          <div className="absolute inset-0 rounded-full border-4 border-t-[#01244a] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
          <div className="absolute inset-2 rounded-full border-2 border-t-[#c5a84a] border-r-transparent border-b-transparent border-l-transparent animate-spin" style={{ animationDirection: "reverse", animationDuration: "0.7s" }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-5 h-5 text-[#01244a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-900">Loading Dataset</p>
          <p className="text-xs text-gray-500 mt-0.5">Fetching records into workspace…</p>
        </div>
        {/* Animated bar */}
        <div className="w-36 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#01244a] to-[#c5a84a] rounded-full animate-pulse"
            style={{ width: "60%", animation: "loadbar 1.4s ease-in-out infinite" }}
          />
        </div>
      </div>
      <style>{`
        @keyframes loadbar {
          0%   { width: 15%; margin-left: 0%; }
          50%  { width: 50%; margin-left: 25%; }
          100% { width: 15%; margin-left: 80%; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unsaved changes confirmation
// ---------------------------------------------------------------------------

function UnsavedConfirmDialog({ datasetName, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm mx-4 p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Switch to "{datasetName}"?</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Your current scenario has unpromoted changes.{" "}
              <span className="font-semibold text-gray-700">All changes are already auto-saved</span>{" "}
              and won't be lost — you can return to this dataset any time.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
          >
            Stay Here
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#01244a] hover:bg-[#0a3366] text-white rounded-lg transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Switch Dataset
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario picker modal
// ---------------------------------------------------------------------------

function ScenarioPickerModal({ dataset, scenarios, onConfirm, onCancel, error }) {
  const baselineScenario = scenarios.find((s) => s.name === "Baseline");
  const namedScenarios = scenarios.filter((s) => s.name !== "Baseline");
  const promotedScenario = scenarios.find((s) => s.is_promoted);
  const defaultId = promotedScenario?.id ?? baselineScenario?.id ?? scenarios[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState(defaultId);
  const [loading, setLoading] = useState(false);

  const selectedLabel = scenarios.find((s) => s.id === selectedId)?.name ?? "Baseline";

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm(selectedId);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md mx-4">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: NAVY }}>
              {initialsOf(dataset.name)}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900 truncate">{dataset.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-400">{fmtRows(dataset.row_count)}</span>
                {dataset.id && (
                  <span className="font-mono text-[9px] text-gray-400 tabular-nums border border-gray-200 rounded px-1 py-0.5">
                    #{dataset.id.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select state to load</p>
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>
          )}
          <div className="space-y-2">
            {[baselineScenario, ...namedScenarios].filter(Boolean).map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setSelectedId(sc.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition ${
                  selectedId === sc.id
                    ? "border-[#01244a] bg-[#01244a]/5 ring-1 ring-[#01244a]/20"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selectedId === sc.id ? "border-[#01244a]" : "border-gray-300"}`}>
                  {selectedId === sc.id && <div className="w-2 h-2 rounded-full bg-[#01244a]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-sm font-semibold ${selectedId === sc.id ? "text-[#01244a]" : "text-gray-800"}`}>
                      {sc.name}
                    </span>
                    {sc.is_promoted && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#01244a] text-white">
                        <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Active
                      </span>
                    )}
                    {sc.id && (
                      <span className="font-mono text-[9px] text-gray-400 tabular-nums border border-gray-200 rounded px-1 py-0.5 ml-auto flex-shrink-0">
                        #{sc.id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  {sc.description && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sc.description}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between">
          <button onClick={onCancel} className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || selectedId == null}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#01244a] hover:bg-[#0a3366] text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-60"
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Load "{selectedLabel}"
          </button>
        </div>
      </div>
    </div>
  );
}
