import React, { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { dbListFormulas, dbCreateFormula, dbDeleteFormula } from "../api/backend";

// ---------------------------------------------------------------------------
// Client-side evaluator — mirrors formula_service.py bracket syntax
// ---------------------------------------------------------------------------
const BRACKET_RE = /\[([^\]]+)\]/g;

function clientEvaluate(expression, record) {
  if (!expression || !record) return { value: null, error: null };
  try {
    // Phase 1: replace [Column Name] with safe identifiers
    const colMap = {};
    let counter = 0;
    let normalized = expression.replace(BRACKET_RE, (_, col) => {
      const safe = `__col${counter}__`;
      colMap[safe] = col.trim();
      counter++;
      return safe;
    });

    // Phase 2: replace remaining raw single-word column names (longest first)
    const allCols = Object.keys(record).sort((a, b) => b.length - a.length);
    const vals = {};
    allCols.forEach((col) => {
      const safe = col.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "col_$1") || "col_x";
      // Only replace if the column appears literally in the normalized string
      if (normalized.includes(col) && !(safe in colMap)) {
        colMap[safe] = col;
        normalized = normalized.split(col).join(safe);
      }
    });

    // Build value map
    Object.entries(colMap).forEach(([safe, col]) => {
      vals[safe] = parseFloat(record[col]) || 0;
    });

    // Replace ^ with ** for JS
    normalized = normalized.replace(/\^/g, "**");

    // Safety check: only allow math chars + our safe identifiers
    const safeExpr = normalized.replace(/__col\d+__|[a-zA-Z_][a-zA-Z0-9_]*/g, "1");
    if (/[^0-9\s+\-*/.()^]/.test(safeExpr)) {
      return { value: null, error: "Expression contains unsupported characters" };
    }

    const fn = new Function(...Object.keys(vals), `"use strict"; return (${normalized});`);
    const result = fn(...Object.values(vals));
    if (!isFinite(result)) return { value: null, error: "Result is not a finite number" };
    return { value: Math.round(result * 10000) / 10000, error: null };
  } catch (e) {
    return { value: null, error: friendlyError(expression, e.message) };
  }
}

function friendlyError(expression, msg) {
  if (!msg) return "Invalid expression";
  if (msg.includes("Invalid or unexpected token") || msg.includes("Unexpected token")) {
    return "Invalid syntax — check for mismatched brackets or unsupported characters";
  }
  if (msg.includes("is not defined")) {
    const m = msg.match(/(\S+) is not defined/);
    const token = m ? m[1] : "a value";
    // Suggest bracket wrapping if token looks like a partial column name
    return `"${token}" is not a recognized column. Use [ to pick columns by name.`;
  }
  if (msg.includes("unexpected end") || msg.includes("Unexpected end")) {
    return "Expression is incomplete — make sure every [ has a closing ]";
  }
  return "Invalid expression — check syntax and column names";
}

function clientValidate(expression, columns) {
  if (!expression?.trim()) return { valid: false, error: "Expression cannot be empty" };
  const dummy = {};
  columns.forEach((c) => { dummy[c] = 1; });
  const { value, error } = clientEvaluate(expression, dummy);
  if (error) return { valid: false, error };
  if (value === null) return { valid: false, error: "Could not evaluate expression" };
  return { valid: true, error: null };
}

// ---------------------------------------------------------------------------
// Export helper — applies formulas to all records and downloads as Excel
// ---------------------------------------------------------------------------
function exportWithFormulas(validatedDf, formulas, filename = "formula_export.xlsx") {
  if (!validatedDf?.length) return;
  const enriched = validatedDf.map((record) => {
    const r = { ...record };
    formulas.forEach(({ col_name, expression }) => {
      if (col_name && expression) {
        const { value } = clientEvaluate(expression, record);
        r[col_name] = value;
      }
    });
    return r;
  });
  const ws = XLSX.utils.json_to_sheet(enriched);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data + Formulas");
  XLSX.writeFile(wb, filename);
}

// ---------------------------------------------------------------------------
// Expression input with [ autocomplete
// ---------------------------------------------------------------------------
function ExpressionInput({ value, onChange, columns, placeholder, inputRef }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const dropdownRef = useRef(null);
  const lastBracketPos = useRef(-1);

  const filtered = columns
    .filter((c) => c.toLowerCase().includes(filterText.toLowerCase()))
    .slice(0, 50);

  const handleChange = (e) => {
    const v = e.target.value;
    const pos = e.target.selectionStart;
    onChange(v);

    // Detect if user just typed "["
    if (v[pos - 1] === "[") {
      lastBracketPos.current = pos - 1;
      setFilterText("");
      setHighlightIdx(0);
      setDropdownOpen(true);
      return;
    }

    // If dropdown is open, update the filter based on text after last "["
    if (dropdownOpen) {
      const textAfterBracket = v.slice(lastBracketPos.current + 1, pos);
      // If the user typed "]" or deleted past the "[", close
      if (textAfterBracket.includes("]") || pos <= lastBracketPos.current) {
        setDropdownOpen(false);
        return;
      }
      setFilterText(textAfterBracket);
      setHighlightIdx(0);
    }
  };

  const insertColumn = useCallback((col) => {
    if (!inputRef?.current) return;
    const el = inputRef.current;
    const pos = el.selectionStart;
    const before = value.slice(0, lastBracketPos.current);
    const after = value.slice(pos);
    const newVal = `${before}[${col}]${after}`;
    onChange(newVal);
    setDropdownOpen(false);
    setFilterText("");
    // Move cursor after the inserted reference
    requestAnimationFrame(() => {
      const newPos = before.length + col.length + 2; // "[" + col + "]"
      el.setSelectionRange(newPos, newPos);
      el.focus();
    });
  }, [value, onChange, inputRef]);

  const handleKeyDown = (e) => {
    if (!dropdownOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[highlightIdx]) {
      e.preventDefault();
      insertColumn(filtered[highlightIdx]);
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (!dropdownOpen) return;
    const el = dropdownRef.current?.children[highlightIdx];
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, dropdownOpen]);

  return (
    <div className="relative">
      <textarea
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
        placeholder={placeholder}
        rows={2}
        className="w-full font-mono text-sm rounded-xl border border-gray-300 focus:ring-2 focus:ring-am-500 focus:border-am-500 px-3.5 py-3 placeholder-gray-400 outline-none transition resize-none leading-relaxed"
      />

      {/* Autocomplete dropdown */}
      {dropdownOpen && filtered.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full max-h-52 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl">
          {/* Header hint */}
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2 sticky top-0">
            <svg className="w-3.5 h-3.5 text-am-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-xs text-gray-500">
              {filterText ? `Matching "${filterText}"` : "All columns"} — click or ↑↓ Enter
            </span>
          </div>
          <div ref={dropdownRef}>
            {filtered.map((col, i) => (
              <button
                key={col}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertColumn(col); }}
                className={`w-full text-left px-3.5 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                  i === highlightIdx
                    ? "bg-am-500 text-white"
                    : "text-gray-800 hover:bg-am-50 hover:text-am-700"
                }`}
              >
                <span className={`font-mono text-xs px-1.5 py-0.5 rounded shrink-0 ${
                  i === highlightIdx ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                }`}>
                  col
                </span>
                {col}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const CalcIcon = () => (
  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 7H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-2M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" />
  </svg>
);
const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);
const CheckIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
  </svg>
);
const ErrorCircle = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function FormulaEditor({
  datasetId,
  columns = [],
  validatedDf = [],
  formulas: externalFormulas,
  onFormulasChange,
}) {
  const [formulas, setFormulas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [globalError, setGlobalError] = useState(null);

  // Add-form state
  const [newColName, setNewColName] = useState("");
  const [newExpression, setNewExpression] = useState("");
  const [addError, setAddError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const exprInputRef = useRef(null);
  const isDbMode = Boolean(datasetId);
  const sampleRecord = validatedDf?.[0] || null;
  const availableColumns = columns.length > 0 ? columns : (sampleRecord ? Object.keys(sampleRecord) : []);

  // Live preview (re-evaluates on every expression change)
  const liveResult = newExpression.trim() && sampleRecord
    ? clientEvaluate(newExpression, sampleRecord)
    : { value: null, error: null };

  // Sync session-mode formulas
  useEffect(() => {
    if (!isDbMode && externalFormulas) setFormulas(externalFormulas);
  }, [externalFormulas, isDbMode]);

  // Fetch from DB
  useEffect(() => {
    if (!isDbMode) return;
    setLoading(true);
    setGlobalError(null);
    dbListFormulas(datasetId)
      .then((data) => {
        const list = data?.formulas || [];
        setFormulas(list);
        onFormulasChange?.(list);
      })
      .catch((e) => setGlobalError(e.response?.data?.detail || "Failed to load formulas"))
      .finally(() => setLoading(false));
  }, [datasetId, isDbMode]);

  const resetForm = () => {
    setNewColName("");
    setNewExpression("");
    setAddError(null);
    setShowAddForm(false);
  };

  const handleAdd = useCallback(async () => {
    const colTrimmed = newColName.trim();
    const exprTrimmed = newExpression.trim();
    if (!colTrimmed) { setAddError("Give your column a name, e.g. Cost_per_FTE"); return; }
    if (!exprTrimmed) { setAddError("Enter an expression, e.g. [Fully loaded cost] / [FTE]"); return; }

    const validation = clientValidate(exprTrimmed, availableColumns);
    if (!validation.valid) { setAddError(validation.error); return; }

    setSaving(true);
    setAddError(null);
    try {
      let updated;
      if (isDbMode) {
        const data = await dbCreateFormula(datasetId, colTrimmed, exprTrimmed);
        updated = [...formulas.filter((f) => f.col_name !== colTrimmed), data.formula];
      } else {
        updated = [
          ...formulas.filter((f) => f.col_name !== colTrimmed),
          { id: Date.now(), col_name: colTrimmed, expression: exprTrimmed },
        ];
      }
      setFormulas(updated);
      onFormulasChange?.(updated);
      resetForm();
    } catch (e) {
      setAddError(e.response?.data?.detail || "Failed to save formula");
    } finally {
      setSaving(false);
    }
  }, [newColName, newExpression, datasetId, formulas, isDbMode, availableColumns, onFormulasChange]);

  const handleDelete = useCallback(async (formula) => {
    try {
      if (isDbMode) await dbDeleteFormula(datasetId, formula.id);
      const updated = formulas.filter((f) => f.id !== formula.id);
      setFormulas(updated);
      onFormulasChange?.(updated);
    } catch (e) {
      setGlobalError(e.response?.data?.detail || "Failed to delete formula");
    }
  }, [datasetId, formulas, isDbMode, onFormulasChange]);

  const previewValue = (formula) => {
    if (!sampleRecord) return null;
    return clientEvaluate(formula.expression, sampleRecord).value;
  };

  // Show add form and focus expression field
  const openAddForm = () => {
    setShowAddForm(true);
    setTimeout(() => exprInputRef.current?.focus(), 50);
  };

  return (
    <div className="space-y-5 animate-fadeInUp">

      {/* ── Hero ── */}
      <div className="bg-am-50 border border-am-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-am-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
              <CalcIcon />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 tracking-tight">Formula Columns</h2>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                Define derived metrics — like{" "}
                <span className="font-mono text-xs bg-am-100 text-am-700 px-1.5 py-0.5 rounded">[Fully loaded cost] / [FTE]</span>
                {" "}— and they appear everywhere: Hierarchy, Crosstab, and the Org Chart detail panel.
              </p>
            </div>
          </div>

          {/* Export button */}
          {formulas.length > 0 && validatedDf?.length > 0 && (
            <button
              onClick={() => exportWithFormulas(validatedDf, formulas)}
              className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-all duration-150"
            >
              <DownloadIcon />
              Export Excel
            </button>
          )}
        </div>
      </div>

      {/* ── Session-mode banner ── */}
      {!isDbMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-amber-800 leading-relaxed">
            <span className="font-semibold">Session-only mode.</span>{" "}
            Formulas will be lost when you refresh. Run <span className="font-semibold">Hierarchy</span>{" "}
            to save this dataset as a baseline — formulas will then persist automatically.
          </p>
        </div>
      )}

      {/* ── Formula list ── */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-14 gap-3">
            <div className="w-5 h-5 border-2 border-am-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-500">Loading formulas…</span>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="grid grid-cols-[2fr_3fr_1fr_auto] gap-0 bg-gray-50 border-b border-gray-200">
              {["Column Name", "Expression", "Preview (row 1)", ""].map((h, i) => (
                <div key={i} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {h}
                </div>
              ))}
            </div>

            {/* Rows */}
            {formulas.length === 0 && !showAddForm ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
                <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 7H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-2M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M9 7h6" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">No formula columns yet</p>
                  <p className="text-xs text-gray-400 mt-0.5">Click "New Formula" to get started</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {formulas.map((formula) => {
                  const pv = previewValue(formula);
                  return (
                    <div
                      key={formula.id}
                      className="grid grid-cols-[2fr_3fr_1fr_auto] gap-0 items-center hover:bg-gray-50 transition-colors group"
                    >
                      <div className="px-4 py-3.5">
                        <span className="text-sm font-semibold text-gray-900">{formula.col_name}</span>
                      </div>
                      <div className="px-4 py-3.5">
                        <span className="font-mono text-xs px-2.5 py-1.5 bg-am-50 text-am-700 border border-am-200 rounded-lg leading-relaxed break-all">
                          {formula.expression}
                        </span>
                      </div>
                      <div className="px-4 py-3.5">
                        {pv !== null ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full">
                            <CheckIcon />
                            {pv.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">
                            {sampleRecord ? "— error" : "no data"}
                          </span>
                        )}
                      </div>
                      <div className="px-3 py-3.5">
                        <button
                          onClick={() => handleDelete(formula)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete formula"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Add formula form ── */}
            {showAddForm && (
              <div className="border-t border-gray-200 bg-gray-50/60 p-5 space-y-4">
                <p className="text-sm font-semibold text-gray-700">New formula</p>

                {/* Column name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Column Name
                  </label>
                  <input
                    type="text"
                    value={newColName}
                    onChange={(e) => { setNewColName(e.target.value); setAddError(null); }}
                    placeholder="e.g.  Cost_per_FTE"
                    className="w-full font-semibold text-sm rounded-xl border border-gray-300 focus:ring-2 focus:ring-am-500 focus:border-am-500 px-3.5 py-2.5 placeholder-gray-400 outline-none transition"
                  />
                </div>

                {/* Expression + autocomplete */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Expression
                    </label>
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-[10px] font-mono font-semibold text-gray-600">[</kbd>
                      to insert a column
                    </span>
                  </div>
                  <ExpressionInput
                    value={newExpression}
                    onChange={(v) => { setNewExpression(v); setAddError(null); }}
                    columns={availableColumns}
                    placeholder={"e.g.  [Fully loaded cost] / [FTE]"}
                    inputRef={exprInputRef}
                  />

                  {/* Live preview strip */}
                  {newExpression.trim() && sampleRecord && (
                    <div className="mt-2">
                      {liveResult.value !== null ? (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-400">Preview (row 1):</span>
                          <span className="inline-flex items-center gap-1 font-semibold px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full">
                            <CheckIcon />
                            {liveResult.value.toLocaleString()}
                          </span>
                        </div>
                      ) : liveResult.error ? (
                        <div className="flex items-start gap-1.5 text-xs text-red-600">
                          <ErrorCircle />
                          <span>{liveResult.error}</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Form error */}
                {addError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3.5 py-3">
                    <ErrorCircle />
                    <p className="text-xs text-red-700 leading-relaxed">{addError}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={handleAdd}
                    disabled={saving || !newColName.trim() || !newExpression.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-am-500 hover:bg-am-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-sm transition-all duration-150"
                  >
                    {saving ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                    Add Formula
                  </button>
                  <button
                    onClick={resetForm}
                    className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Footer: New Formula button ── */}
            {!showAddForm && (
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/40">
                <button
                  onClick={openAddForm}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-am-600 hover:text-am-700 hover:bg-am-50 border border-am-200 hover:border-am-300 rounded-xl transition-all duration-150"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Formula
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Global error */}
      {globalError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {globalError}
        </div>
      )}

      {/* ── How-to tip card ── */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-blue-900 mb-2.5">How to write expressions</p>
        <ul className="text-xs text-blue-700 space-y-2 leading-relaxed">
          <li className="flex items-start gap-2">
            <kbd className="mt-0.5 px-1.5 py-0.5 bg-white border border-blue-200 rounded text-[10px] font-mono font-semibold text-blue-600 shrink-0">[</kbd>
            <span>Type <strong>[</strong> to open the column picker — start typing to filter, click or press Enter to insert</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded shrink-0">ops</span>
            <span>Operators: <span className="font-mono bg-blue-100 px-1 rounded">+</span> <span className="font-mono bg-blue-100 px-1 rounded">-</span> <span className="font-mono bg-blue-100 px-1 rounded">*</span> <span className="font-mono bg-blue-100 px-1 rounded">/</span> <span className="font-mono bg-blue-100 px-1 rounded">^</span> (power) and parentheses</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded shrink-0">eg.</span>
            <span>
              <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded">[Fully loaded cost] / [FTE]</span>
              {" "}· {" "}
              <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded">([Basic Pay] + [Add ons]) * 12</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded shrink-0">∞</span>
            <span>Division by zero is handled automatically — it returns 0 instead of an error</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
