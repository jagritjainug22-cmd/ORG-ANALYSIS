import React, { useEffect, useState } from "react";
import { dbListDatasets, dbGetDataset, dbGetDatasetRecords } from "../api/backend";

const BRAND_500 = "#155bb2";
const ACCENT_GOLD = "#c5a84a";

function accentFor(dataset) {
  const promoted = dataset?.promoted_scenario_name;
  return promoted && promoted !== "Baseline" ? ACCENT_GOLD : BRAND_500;
}

function initialsOf(name) {
  const src = (name || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(iso) {
  if (!iso) return "—";
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
    const wk = Math.round(day / 7);
    if (wk < 5) return `${wk}w ago`;
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function fmtNumber(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString();
}

/**
 * DataSourceSelector wraps the Upload module slot. Users land on the upload
 * form immediately; saved baselines load in the background. A pill toggle
 * switches to the saved org-chart list when available.
 *
 * Selecting a saved dataset opens a scenario picker, then hydrates both
 * dfRecords (analytics pipeline) and the DB context (Org Chart).
 */
export default function DataSourceSelector({
  onDatasetPicked,
  setDfRecords,
  setValidatedDf,
  setColumns,
  setUploadedFileName,
  renderUploadSlot,
}) {
  const [view, setView] = useState("upload");
  const [datasets, setDatasets] = useState(null);
  const [listError, setListError] = useState(null);
  const [error, setError] = useState(null);

  // Scenario picker state: null | { dataset, scenarios }
  const [pickerState, setPickerState] = useState(null);
  const [loadingPickId, setLoadingPickId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    dbListDatasets(false, true)
      .then((data) => {
        if (cancelled) return;
        setListError(null);
        setDatasets(data?.datasets || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setListError(e?.response?.data?.detail || e?.message || "Failed to load saved org charts.");
        setDatasets([]);
      });
    return () => { cancelled = true; };
  }, [view === "picker"]);

  // Step 1: user clicks "Select" on a dataset card — fetch dataset details and open picker
  const handleSelectDataset = async (dataset) => {
    setLoadingPickId(dataset.id);
    setError(null);
    try {
      const resp = await dbGetDataset(dataset.id);
      const scs = resp.scenarios || [];
      setPickerState({ dataset: resp.dataset, scenarios: scs });
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load dataset.");
    } finally {
      setLoadingPickId(null);
    }
  };

  // Step 2: user confirms a scenario choice — load flat records and hydrate workspace
  const handleConfirmSelection = async (pickedScenarioId) => {
    if (!pickerState) return;
    const { dataset, scenarios } = pickerState;
    setLoadingPickId(dataset.id);
    setError(null);
    try {
      const data = await dbGetDatasetRecords(dataset.id, pickedScenarioId);
      const records = data.records || [];
      const columns = data.columns || (records.length > 0 ? Object.keys(records[0]) : []);

      // Hydrate the analytics pipeline (Validate, Hierarchy, Spans & Layers, Crosstab)
      setDfRecords?.(records);
      setValidatedDf?.(records);
      setColumns?.(columns);

      // Hydrate the DB context (Org Chart)
      onDatasetPicked?.({
        dataset,
        scenarios,
        activeScenarioId: pickedScenarioId,
        records,
        columns,
      });

      setPickerState(null);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load records.");
    } finally {
      setLoadingPickId(null);
    }
  };

  const listLoading = datasets === null;
  const hasDatasets = Array.isArray(datasets) && datasets.length > 0;
  const showToggle = listLoading || hasDatasets;

  return (
    <div className="space-y-5">
      {/* Scenario picker modal */}
      {pickerState && (
        <ScenarioPickerModal
          dataset={pickerState.dataset}
          scenarios={pickerState.scenarios}
          loading={loadingPickId === pickerState.dataset.id}
          onConfirm={handleConfirmSelection}
          onCancel={() => setPickerState(null)}
          error={error}
        />
      )}

      {/* View toggle pill */}
      {showToggle && (
        <div className="flex items-center justify-center">
          <div className="inline-flex bg-brand-50 rounded-lg p-1 border border-brand-100">
            <ToggleBtn
              active={view === "upload"}
              onClick={() => setView("upload")}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              }
              label="Upload New"
            />
            <ToggleBtn
              active={view === "picker"}
              onClick={() => setView("picker")}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              }
              label={
                listLoading
                  ? "Saved Org Charts"
                  : `Saved Org Charts (${datasets.length})`
              }
              loading={listLoading}
            />
          </div>
        </div>
      )}

      {!pickerState && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {view === "picker" ? (
        listLoading ? (
          <PickerSkeleton />
        ) : listError ? (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              {listError}
            </div>
            <EmptyState onUploadClick={() => setView("upload")} />
          </div>
        ) : !hasDatasets ? (
          <EmptyState onUploadClick={() => setView("upload")} />
        ) : (
          <div className="bg-white border border-brand-100 rounded-xl shadow-sm overflow-hidden" style={{ boxShadow: "0 1px 6px rgba(15, 46, 92, 0.06)" }}>
            <ul className="divide-y divide-brand-50">
              {datasets.map((d) => (
                <DatasetRow
                  key={d.id}
                  dataset={d}
                  onSelect={() => handleSelectDataset(d)}
                  loading={loadingPickId === d.id}
                  disabled={loadingPickId !== null && loadingPickId !== d.id}
                />
              ))}
            </ul>
          </div>
        )
      ) : renderUploadSlot ? (
        renderUploadSlot()
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario picker modal
// ---------------------------------------------------------------------------

function ScenarioPickerModal({ dataset, scenarios, loading, onConfirm, onCancel, error }) {
  // Build options: null = baseline, or scenario id for a named scenario
  const baselineScenario = scenarios.find((s) => s.name === "Baseline");
  const namedScenarios = scenarios.filter((s) => s.name !== "Baseline");

  // Default: promoted scenario or baseline
  const promotedScenario = scenarios.find((s) => s.is_promoted);
  const defaultId = promotedScenario?.id ?? baselineScenario?.id ?? scenarios[0]?.id ?? null;

  const [selectedId, setSelectedId] = useState(defaultId);

  const selectedLabel = selectedId == null
    ? "Baseline"
    : (scenarios.find((s) => s.id === selectedId)?.name ?? "Baseline");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-800/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-brand-100 w-full max-w-md mx-4">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-brand-50">
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ background: BRAND_500 }}
            >
              {initialsOf(dataset.name)}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-gray-900 truncate">{dataset.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{fmtNumber(dataset.row_count)} rows</p>
            </div>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition flex-shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Select a state to load</p>
            <p className="text-xs text-gray-400 mb-3">
              This dataset will become the active working dataset for all analysis modules.
            </p>

            <div className="space-y-2">
              {/* Baseline option */}
              {baselineScenario && (
                <ScenarioOption
                  id={baselineScenario.id}
                  label="Baseline"
                  description="Original uploaded state"
                  isDefault={!promotedScenario || baselineScenario.id === promotedScenario?.id}
                  isPromoted={!promotedScenario || baselineScenario.is_promoted}
                  selected={selectedId === baselineScenario.id}
                  onSelect={setSelectedId}
                />
              )}

              {/* Named scenarios */}
              {namedScenarios.map((sc) => (
                <ScenarioOption
                  key={sc.id}
                  id={sc.id}
                  label={sc.name}
                  description={sc.description || null}
                  isPromoted={!!sc.is_promoted}
                  selected={selectedId === sc.id}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
          >
            Cancel
          </button>
          <button
        onClick={() => onConfirm(selectedId)}
        disabled={loading || selectedId == null}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Load "{selectedLabel}"
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScenarioOption({ id, label, description, isPromoted, isDefault, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-lg border text-left transition ${
        selected
          ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200"
          : "border-gray-200 hover:border-brand-200 hover:bg-brand-50/30"
      }`}
    >
      {/* Radio indicator */}
      <div
        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
          selected ? "border-brand-500" : "border-gray-300"
        }`}
      >
        {selected && <div className="w-2 h-2 rounded-full bg-brand-500" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-sm font-semibold ${selected ? "text-brand-700" : "text-gray-800"}`}>
            {label}
          </span>
          {isPromoted && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-500 text-white">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Active
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{description}</p>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function ToggleBtn({ active, onClick, icon, label, loading }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
        active
          ? "bg-white text-brand-700 shadow-sm border border-brand-200"
          : "text-slate-500 hover:text-brand-700"
      }`}
    >
      {icon}
      {label}
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
    </button>
  );
}

function PickerSkeleton() {
  return (
    <div className="bg-white border border-brand-100 rounded-xl shadow-sm overflow-hidden">
      <ul className="divide-y divide-brand-50">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex items-stretch animate-pulse">
            <div className="w-1 bg-brand-200" />
            <div className="flex-1 px-5 py-4 flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-brand-100 rounded w-1/3" />
                <div className="h-3 bg-brand-50 rounded w-1/2" />
              </div>
              <div className="hidden md:block w-64 h-12 bg-brand-50 rounded" />
              <div className="w-24 h-9 bg-brand-100 rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ onUploadClick }) {
  return (
    <div className="bg-[#f8fbff] border border-brand-100 rounded-xl p-12 text-center" style={{ boxShadow: "0 1px 4px rgba(15, 46, 92, 0.06)" }}>
      <div className="w-16 h-16 mx-auto rounded-full bg-brand-100 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </div>
      <p className="text-lg font-semibold text-brand-800">No org charts saved yet</p>
      <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">
        Upload your first Excel file to build a baseline. Once processed, you'll
        be able to select and use it across all analysis modules.
      </p>
      <button
        onClick={onUploadClick}
        className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium shadow-sm transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        Upload Data
      </button>
    </div>
  );
}

function DatasetRow({ dataset, onSelect, loading, disabled }) {
  const accent = accentFor(dataset);
  const preview = dataset.preview;
  const promoted = dataset.promoted_scenario_name;
  const scenarioCount = dataset.scenario_count ?? 0;
  const lockedBy = dataset.locked_by;

  return (
    <li
      className={`group flex items-stretch transition-colors ${
        disabled ? "opacity-50" : "hover:bg-gray-50/70"
      }`}
    >
      {/* Accent strip */}
      <div className="w-1 flex-shrink-0" style={{ background: accent }} />

      <div className="flex-1 min-w-0 px-5 py-4 flex items-center gap-5">
        {/* Left: name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-gray-900 truncate" title={dataset.name}>
              {dataset.name}
            </span>
            <span className="text-[11px] text-gray-400 font-mono">#{dataset.id}</span>
            {promoted && promoted !== "Baseline" && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-500 text-white"
                title={`Active state: ${promoted}`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="max-w-[160px] truncate">Active: {promoted}</span>
              </span>
            )}
            {lockedBy && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                title={`Currently being edited by ${lockedBy}`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Locked by {lockedBy}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-gray-500 flex-wrap">
            <span className="font-medium text-gray-700">{fmtNumber(dataset.row_count)} rows</span>
            <Sep />
            <span>{fmtNumber(scenarioCount)} scenario{scenarioCount === 1 ? "" : "s"}</span>
            <Sep />
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-700 text-[8px] font-bold">
                {initialsOf(dataset.username)}
              </span>
              <span>uploaded by {dataset.username || "unknown"}</span>
            </span>
            <Sep />
            <span>{formatRelative(dataset.last_modified_at || dataset.upload_time)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <PipelineBadge label="Cleanup" ts={dataset.last_cleanup_at} />
            <PipelineBadge label="Validated" ts={dataset.last_validate_at} />
            <PipelineBadge label="Rationalised" ts={dataset.last_rationalise_at} />
          </div>
        </div>

        {/* Middle: monochrome mini tree (hidden below md) */}
        <div className="hidden md:block flex-shrink-0">
          <DatasetMiniTree preview={preview} />
        </div>

        {/* Right: Select button */}
        <div className="flex-shrink-0">
          <button
            onClick={onSelect}
            disabled={loading || disabled}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
              "bg-brand-500 text-white hover:bg-brand-600 shadow-sm hover:shadow"
            } ${loading || disabled ? "cursor-not-allowed opacity-70" : ""}`}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </>
            ) : (
              <>
                Select
                <svg
                  className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition-transform"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </li>
  );
}

function PipelineBadge({ label, ts }) {
  const ran = !!ts;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
        ran
          ? "bg-green-50 text-green-700 border border-green-200"
          : "bg-gray-50 text-gray-400 border border-gray-200"
      }`}
      title={ran ? `${label}: ${new Date(ts.endsWith("Z") ? ts : ts + "Z").toLocaleString()}` : `${label}: never run`}
    >
      {label}: {ran ? formatRelative(ts) : "never"}
    </span>
  );
}

function Sep() {
  return <span className="text-gray-300" aria-hidden>·</span>;
}

/**
 * Compact monochrome org-tree snippet.
 */
function DatasetMiniTree({ preview }) {
  if (!preview?.root) {
    return (
      <div className="w-[260px] text-center text-[11px] text-gray-300 italic">
        no structure
      </div>
    );
  }
  const children = (preview.children || []).slice(0, 4);
  const totalChildren = preview.total_children ?? children.length;
  const overflow = totalChildren - children.length;

  return (
    <div className="w-[260px] select-none">
      <div className="flex flex-col items-center">
        <MiniNode label={preview.root.label} root />
        {children.length > 0 && (
          <>
            <div className="w-px h-2.5 bg-gray-300" aria-hidden />
            <div className="relative w-full flex justify-center">
              <div
                className="absolute top-0 h-px bg-gray-300"
                style={{
                  left: `calc(${100 / (children.length * 2)}%)`,
                  right: `calc(${100 / (children.length * 2)}%)`,
                }}
              />
              <div className="flex w-full justify-around items-start pt-2.5">
                {children.map((c, idx) => (
                  <div key={c.emp_id || idx} className="flex flex-col items-center min-w-0">
                    <div className="w-px h-2.5 bg-gray-300 -mt-2.5" aria-hidden />
                    <MiniNode label={c.label} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {overflow > 0 && (
          <div className="mt-1.5 text-[10px] text-gray-400 italic">
            +{overflow} more direct report{overflow === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniNode({ label, root }) {
  return (
    <div
      className={`px-2 py-0.5 max-w-[68px] truncate text-[10px] leading-tight border rounded-sm bg-white ${
        root ? "font-semibold text-brand-700 border-brand-300" : "text-gray-700 border-gray-300"
      }`}
      title={label}
    >
      {label}
    </div>
  );
}
