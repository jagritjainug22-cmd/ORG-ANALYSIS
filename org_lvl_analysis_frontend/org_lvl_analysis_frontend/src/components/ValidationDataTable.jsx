import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Paginator from "./Paginator";

const PAGE_SIZE = 50;
const LARGE_THRESHOLD = 10000;
const MAX_VISIBLE_COLS = 10;

const FLAG_META = {
  FLAG_DUPLICATE_EMP_ID: {
    label: "Duplicate Employee ID",
    short: "Duplicate ID",
    rationale: "This Employee ID appears more than once in the dataset. Each employee must have a unique ID.",
    cell: "emp",
    color: "bg-red-100 text-red-800 border-red-200",
    rowBg: "bg-red-50/80",
  },
  FLAG_MISSING_MANAGER_ID: {
    label: "Missing Manager ID",
    short: "Missing Mgr",
    rationale: "Manager ID is blank. Every row except the top-of-org root should report to a manager.",
    cell: "mgr",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    rowBg: "bg-amber-50/80",
  },
  FLAG_MANAGER_ID_NOT_EMPLOYEE: {
    label: "Invalid Manager Reference",
    short: "Invalid Mgr",
    rationale: "Manager ID does not match any Employee ID in this file. The manager may be missing from the upload, or the ID is mistyped.",
    cell: "mgr",
    color: "bg-orange-100 text-orange-800 border-orange-200",
    rowBg: "bg-orange-50/70",
  },
  FLAG_CIRCULAR_REFERENCE: {
    label: "Circular Reporting Chain",
    short: "Circular",
    rationale: "This employee is part of a circular reporting chain (A reports to B who reports back to A). Fix the manager links to break the loop.",
    cell: "both",
    color: "bg-purple-100 text-purple-800 border-purple-200",
    rowBg: "bg-purple-50/70",
  },
};

function isFlagged(row, flag) {
  const v = row[flag];
  return v === true || v === 1 || v === "1";
}

function rowFlags(row) {
  return Object.keys(FLAG_META).filter((f) => isFlagged(row, f));
}

function hasAnyFlag(row) {
  return rowFlags(row).length > 0;
}

function formatCell(val) {
  if (val == null || val === "") return "—";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/**
 * Paginated dataset preview with validation error highlighting,
 * prev/next error navigation, rationale panel, and inline edit
 * for Employee ID / Manager ID cells.
 */
export default function ValidationDataTable({
  records,
  empCol,
  mgrCol,
  onRecordsChange,
  onRevalidate,
  revalidating = false,
}) {
  const [viewMode, setViewMode] = useState("errors"); // "errors" | "all"
  const [page, setPage] = useState(1);
  const [selectedGlobalIdx, setSelectedGlobalIdx] = useState(null);
  const [errorCursor, setErrorCursor] = useState(0);
  const [editing, setEditing] = useState(null); // { globalIdx, field }
  const [editValue, setEditValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const rowRefs = useRef({});

  const allRecords = records || [];
  const isLarge = allRecords.length > LARGE_THRESHOLD;

  const errorIndices = useMemo(() => {
    const idxs = [];
    allRecords.forEach((r, i) => {
      if (hasAnyFlag(r)) idxs.push(i);
    });
    return idxs;
  }, [allRecords]);

  // Initialise navigation when the table mounts / key remounts (fresh validation)
  useEffect(() => {
    if (errorIndices.length > 0) {
      setViewMode("errors");
      setSelectedGlobalIdx(errorIndices[0]);
    } else {
      setViewMode("all");
      setSelectedGlobalIdx(null);
    }
    setPage(1);
    setErrorCursor(0);
    setDirty(false);
    setEditing(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — remount via parent key

  const displayIndices = useMemo(() => {
    if (viewMode === "errors") return errorIndices;
    return allRecords.map((_, i) => i);
  }, [viewMode, errorIndices, allRecords]);

  const totalPages = Math.max(1, Math.ceil(displayIndices.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = displayIndices.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const displayCols = useMemo(() => {
    if (!allRecords.length) return [];
    const keys = Object.keys(allRecords[0] || {}).filter((k) => !k.startsWith("FLAG_") && k !== "Span");
    const priority = [empCol, mgrCol].filter(Boolean);
    const preferred = ["Name", "Employee Name", "Full Name", "Job Title", "Position Title", "Function", "Department", "Country", "Level"];
    const rest = keys.filter((k) => !priority.includes(k));
    const preferredPresent = preferred.filter((k) => rest.includes(k));
    const others = rest.filter((k) => !preferredPresent.includes(k));
    const ordered = [...priority, ...preferredPresent, ...others];
    return ordered.slice(0, MAX_VISIBLE_COLS);
  }, [allRecords, empCol, mgrCol]);

  const goToError = useCallback(
    (cursor) => {
      if (!errorIndices.length) return;
      const wrapped = ((cursor % errorIndices.length) + errorIndices.length) % errorIndices.length;
      const globalIdx = errorIndices[wrapped];
      setErrorCursor(wrapped);
      setSelectedGlobalIdx(globalIdx);

      // Switch to errors view so the row is visible in the filtered list
      setViewMode("errors");
      const posInDisplay = errorIndices.indexOf(globalIdx);
      const targetPage = Math.floor(posInDisplay / PAGE_SIZE) + 1;
      setPage(targetPage);

      requestAnimationFrame(() => {
        rowRefs.current[globalIdx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    },
    [errorIndices]
  );

  const startEdit = (globalIdx, field, currentVal) => {
    setEditing({ globalIdx, field });
    setEditValue(currentVal == null ? "" : String(currentVal));
  };

  const commitEdit = () => {
    if (!editing || !onRecordsChange) {
      setEditing(null);
      return;
    }
    const { globalIdx, field } = editing;
    const col = field === "emp" ? empCol : mgrCol;
    if (!col) {
      setEditing(null);
      return;
    }
    const next = allRecords.map((r, i) =>
      i === globalIdx ? { ...r, [col]: editValue } : r
    );
    onRecordsChange(next);
    setDirty(true);
    setEditing(null);
  };

  const cancelEdit = () => setEditing(null);

  if (!allRecords.length) {
    return (
      <div className="bg-white border border-brand-100 rounded-lg px-4 py-6 text-center text-sm text-slate-400">
        No records to preview
      </div>
    );
  }

  const selectedRow = selectedGlobalIdx != null ? allRecords[selectedGlobalIdx] : null;
  const selectedFlags = selectedRow ? rowFlags(selectedRow) : [];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => { setViewMode("errors"); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                viewMode === "errors"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              Errors only ({errorIndices.length.toLocaleString()})
            </button>
            <button
              type="button"
              onClick={() => { setViewMode("all"); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                viewMode === "all"
                  ? "bg-brand-500 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              All rows ({allRecords.length.toLocaleString()})
            </button>
          </div>

          {errorIndices.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goToError(errorCursor - 1)}
                className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 transition-all duration-150"
                title="Previous error"
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-500 font-medium px-1.5 tabular-nums">
                {errorCursor + 1} / {errorIndices.length}
              </span>
              <button
                type="button"
                onClick={() => goToError(errorCursor + 1)}
                className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 transition-all duration-150"
                title="Next error"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {dirty && onRevalidate && (
            <button
              type="button"
              onClick={onRevalidate}
              disabled={revalidating}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 text-white hover:bg-brand-600 hover:shadow-md disabled:opacity-50 shadow-sm transition-all duration-150"
            >
              {revalidating ? "Re-validating…" : "Re-validate after edits"}
            </button>
          )}
          <span className="text-[11px] text-slate-600 font-medium hidden sm:inline">
            Click a row for details · Double-click ID cells to edit
          </span>
        </div>
      </div>

      {isLarge && viewMode === "all" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          Large dataset ({allRecords.length.toLocaleString()} rows). Showing paginated preview —
          switch to <span className="font-semibold">Errors only</span> to navigate flagged rows quickly.
        </div>
      )}

      {/* Full-width table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="min-w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-100">
                <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 w-12 border-b border-r border-slate-300">#</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-700 w-32 border-b border-r border-slate-300">Issues</th>
                {displayCols.map((col, colIdx) => (
                  <th
                    key={col}
                    className={`px-3 py-2.5 text-left text-xs font-bold text-slate-800 whitespace-nowrap border-b border-slate-300 ${
                      colIdx < displayCols.length - 1 ? "border-r border-slate-300" : ""
                    }`}
                  >
                    {col}
                    {(col === empCol || col === mgrCol) && (
                      <span className="ml-1.5 text-[9px] font-bold text-brand-600 uppercase tracking-wide">
                        {col === empCol ? "emp" : "mgr"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((globalIdx, rowIdx) => {
                const row = allRecords[globalIdx];
                const flags = rowFlags(row);
                const isSelected = selectedGlobalIdx === globalIdx;
                const primaryFlag = flags[0];
                const rowTint = primaryFlag ? FLAG_META[primaryFlag].rowBg : (rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/60");
                const highlightEmp = flags.some((f) => FLAG_META[f].cell === "emp" || FLAG_META[f].cell === "both");
                const highlightMgr = flags.some((f) => FLAG_META[f].cell === "mgr" || FLAG_META[f].cell === "both");
                const colCount = displayCols.length + 2;

                // Selection border painted per-cell so it sits above ID highlight backgrounds.
                const selStyle = (cellIndex) => {
                  if (!isSelected) return undefined;
                  const topBot = "inset 0 2px 0 0 #2563EB, inset 0 -2px 0 0 #2563EB";
                  if (cellIndex === 0) {
                    return { boxShadow: `inset 2px 0 0 0 #2563EB, ${topBot}` };
                  }
                  if (cellIndex === colCount - 1) {
                    return { boxShadow: `inset -2px 0 0 0 #2563EB, ${topBot}` };
                  }
                  return { boxShadow: topBot };
                };

                return (
                  <tr
                    key={globalIdx}
                    ref={(el) => { rowRefs.current[globalIdx] = el; }}
                    onClick={() => {
                      setSelectedGlobalIdx(globalIdx);
                      const ei = errorIndices.indexOf(globalIdx);
                      if (ei >= 0) setErrorCursor(ei);
                    }}
                    className={`group cursor-pointer transition-colors duration-150 ${rowTint} ${
                      isSelected ? "bg-brand-50" : "hover:bg-brand-50/70"
                    }`}
                  >
                    <td
                      style={selStyle(0)}
                      className={`px-3 py-2.5 text-slate-700 font-semibold tabular-nums border-b border-r border-slate-200 relative z-[1] ${
                        isSelected ? "bg-brand-50" : ""
                      }`}
                    >
                      {globalIdx + 1}
                    </td>
                    <td
                      style={selStyle(1)}
                      className={`px-3 py-2.5 border-b border-r border-slate-200 relative z-[1] ${
                        isSelected ? "bg-brand-50" : ""
                      }`}
                    >
                      <div className="flex flex-wrap gap-1">
                        {flags.length === 0 && (
                          <span className="text-slate-500 font-medium">—</span>
                        )}
                        {flags.map((f) => (
                          <span
                            key={f}
                            className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-bold ${FLAG_META[f].color}`}
                            title={FLAG_META[f].label}
                          >
                            {FLAG_META[f].short}
                          </span>
                        ))}
                      </div>
                    </td>
                    {displayCols.map((col, colIdx) => {
                      const isEmp = col === empCol;
                      const isMgr = col === mgrCol;
                      const editable = isEmp || isMgr;
                      const isEditingThis =
                        editing?.globalIdx === globalIdx &&
                        editing?.field === (isEmp ? "emp" : isMgr ? "mgr" : null);
                      const cellHot =
                        (isEmp && highlightEmp) || (isMgr && highlightMgr);
                      const isLast = colIdx === displayCols.length - 1;
                      const cellIndex = colIdx + 2;

                      return (
                        <td
                          key={col}
                          style={selStyle(cellIndex)}
                          className={`px-3 py-2.5 whitespace-nowrap max-w-[220px] truncate border-b border-slate-200 relative z-[1] font-medium ${
                            !isLast ? "border-r border-slate-200" : ""
                          } ${
                            cellHot
                              ? "font-bold text-amber-950 bg-amber-100/90"
                              : "text-slate-800"
                          } ${isSelected && !cellHot ? "bg-brand-50" : ""} ${
                            editable && !isSelected ? "hover:bg-brand-50/80" : ""
                          }`}
                          onDoubleClick={(e) => {
                            if (!editable) return;
                            e.stopPropagation();
                            startEdit(globalIdx, isEmp ? "emp" : "mgr", row[col]);
                          }}
                          title={editable ? `${formatCell(row[col])} (double-click to edit)` : formatCell(row[col])}
                        >
                          {isEditingThis ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full min-w-[120px] border-2 border-brand-500 rounded-md px-2 py-1 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/40 bg-white shadow-sm"
                            />
                          ) : (
                            formatCell(row[col])
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {pageSlice.length === 0 && (
                <tr>
                  <td colSpan={displayCols.length + 2} className="px-4 py-10 text-center text-slate-600 font-medium border-b border-slate-200">
                    {viewMode === "errors" ? "No flagged rows" : "No rows"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-3 bg-slate-50/50">
          <Paginator
            page={safePage}
            totalPages={totalPages}
            onChange={setPage}
            totalItems={displayIndices.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      </div>

      {/* Error detail — stacked below table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 transition-shadow duration-200 hover:shadow-md">
        <h5 className="text-[11px] font-bold text-brand-700 uppercase tracking-wider mb-2.5">
          Error detail
        </h5>
        {!selectedRow || selectedFlags.length === 0 ? (
          <p className="text-sm text-slate-600 font-medium leading-relaxed">
            {errorIndices.length === 0
              ? "No validation issues. Dataset looks clean."
              : "Select a flagged row (or use Prev / Next) to see why it was flagged and which cells to fix."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <p className="text-slate-700 font-medium">
                Row <span className="font-bold text-slate-900">{selectedGlobalIdx + 1}</span>
              </p>
              {empCol && (
                <p className="text-slate-800 font-medium">
                  <span className="text-slate-600">{empCol}:</span>{" "}
                  <span className="font-mono font-bold text-slate-900">{formatCell(selectedRow[empCol])}</span>
                </p>
              )}
              {mgrCol && (
                <p className="text-slate-800 font-medium">
                  <span className="text-slate-600">{mgrCol}:</span>{" "}
                  <span className="font-mono font-bold text-slate-900">{formatCell(selectedRow[mgrCol])}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedFlags.map((f) => (
                <div key={f} className={`rounded-lg border px-3 py-2.5 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-sm ${FLAG_META[f].color}`}>
                  <p className="text-xs font-bold mb-0.5">{FLAG_META[f].label}</p>
                  <p className="text-[11px] leading-snug opacity-90">{FLAG_META[f].rationale}</p>
                  <p className="text-[10px] mt-1.5 opacity-75">
                    {FLAG_META[f].cell === "emp" && `Fix: edit the ${empCol || "Employee ID"} cell`}
                    {FLAG_META[f].cell === "mgr" && `Fix: edit the ${mgrCol || "Manager ID"} cell`}
                    {FLAG_META[f].cell === "both" && `Fix: edit ${empCol || "Employee"} / ${mgrCol || "Manager"} links`}
                  </p>
                </div>
              ))}
            </div>

            {(empCol || mgrCol) && (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Double-click the highlighted ID cell in the table to edit in place, then click{" "}
                <span className="font-semibold text-slate-500">Re-validate after edits</span>.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
