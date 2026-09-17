import React, { useEffect, useState } from "react";
import { dbListDatasets, dbGetDataset } from "../../api/backend";

const ACCENT_NAVY = "#01244a";
const ACCENT_GOLD = "#c5a84a";

function accentFor(dataset) {
  const promoted = dataset?.promoted_scenario_name;
  return promoted && promoted !== "Baseline" ? ACCENT_GOLD : ACCENT_NAVY;
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

const PAGE_SIZE = 4;

/**
 * Empty-state picker for the Org Chart: lets the user reopen a baseline that
 * was saved during a previous session (or by another teammate). Fetches all
 * datasets from /db/datasets and, when one is picked, calls back with
 * datasetId + its scenarios so the OrgChart can hydrate from SQLite.
 *
 * Renders the same card-style list as DataSourceSelector's "Saved Org Charts"
 * view so both entry points look consistent.
 */
export default function SavedDatasetPicker({ onPick, onUploadInstead }) {
  const [datasets, setDatasets] = useState(null);
  const [error, setError] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [listError, setListError] = useState(null);
  const [page, setPage] = useState(0);

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
  }, []);

  const pick = async (dataset) => {
    setLoadingId(dataset.id);
    setError(null);
    try {
      const resp = await dbGetDataset(dataset.id);
      const baseline = (resp.scenarios || []).find((s) => s.name === "Baseline")
        || (resp.scenarios || [])[0];
      onPick({
        dataset: resp.dataset,
        scenarios: resp.scenarios || [],
        activeScenarioId: baseline?.id ?? null,
      });
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load dataset.");
    } finally {
      setLoadingId(null);
    }
  };

  const listLoading = datasets === null;
  const hasDatasets = Array.isArray(datasets) && datasets.length > 0;
  const totalPages = hasDatasets ? Math.ceil(datasets.length / PAGE_SIZE) : 1;
  const pageDatasets = hasDatasets ? datasets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];

  return (
    <div className="flex items-center justify-center min-h-full bg-gray-50 p-6">
      <div className="w-full max-w-3xl space-y-4">
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">Saved Org Charts</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {listLoading
                ? "Loading saved org charts..."
                : hasDatasets
                  ? `${datasets.length} saved baseline${datasets.length === 1 ? "" : "s"} — select one to open`
                  : "No saved org charts yet"}
            </p>
          </div>
          {onUploadInstead && (
            <button
              onClick={onUploadInstead}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 rounded-lg text-sm font-medium shadow-sm transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload New File
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {listLoading ? (
          <PickerSkeleton />
        ) : listError ? (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              {listError}
            </div>
            <EmptyState onUploadClick={onUploadInstead} />
          </div>
        ) : !hasDatasets ? (
          <EmptyState onUploadClick={onUploadInstead} />
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {pageDatasets.map((d) => (
                  <DatasetRow
                    key={d.id}
                    dataset={d}
                    onOpen={() => pick(d)}
                    loading={loadingId === d.id}
                    disabled={loadingId !== null && loadingId !== d.id}
                  />
                ))}
              </ul>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-gray-500">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, datasets.length)} of {datasets.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    ‹ Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i)}
                      className={`w-7 h-7 text-xs font-medium rounded-md transition ${
                        i === page
                          ? "bg-[#01244a] text-white"
                          : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PickerSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <ul className="divide-y divide-gray-100">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex items-stretch animate-pulse">
            <div className="w-1 bg-gray-200" />
            <div className="flex-1 px-5 py-4 flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
              <div className="hidden md:block w-64 h-12 bg-gray-50 rounded" />
              <div className="w-24 h-9 bg-gray-100 rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ onUploadClick }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
      <div className="w-16 h-16 mx-auto rounded-full bg-am-50 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-am-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </div>
      <p className="text-lg font-semibold text-gray-800">No org charts saved yet</p>
      <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto">
        Upload your first Excel file to build a baseline. Once processed, you'll
        be able to open and edit it directly from here.
      </p>
      {onUploadClick && (
        <button
          onClick={onUploadClick}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-am-500 hover:bg-am-600 text-white rounded-lg text-sm font-medium shadow-sm transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Upload Data
        </button>
      )}
    </div>
  );
}

function DatasetRow({ dataset, onOpen, loading, disabled }) {
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
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#01244a] text-white"
                title={`Promoted scenario: ${promoted}`}
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
        </div>

        {/* Middle: monochrome mini tree (hidden below md) */}
        <div className="hidden md:block flex-shrink-0">
          <DatasetMiniTree preview={preview} />
        </div>

        {/* Right: Open button */}
        <div className="flex-shrink-0">
          <button
            onClick={onOpen}
            disabled={loading || disabled}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
              lockedBy
                ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                : "bg-[#01244a] text-white hover:bg-[#0a3366] shadow-sm hover:shadow"
            } ${loading || disabled ? "cursor-not-allowed opacity-70" : ""}`}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Opening...
              </>
            ) : (
              <>
                {lockedBy ? "Open (read-only)" : "Open"}
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

function Sep() {
  return <span className="text-gray-300" aria-hidden>·</span>;
}

/**
 * Compact monochrome org-tree snippet: a root box on top and up to four
 * child boxes below, connected by thin gray lines. Renders within ~280px wide.
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
            {/* horizontal connector */}
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
      className={`px-2 py-0.5 max-w-[68px] truncate text-[10px] leading-tight border border-gray-300 rounded-sm bg-white ${
        root ? "font-semibold text-[#01244a]" : "text-gray-700"
      }`}
      title={label}
    >
      {label}
    </div>
  );
}
