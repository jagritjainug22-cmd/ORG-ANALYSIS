import React, { useState, useEffect, useMemo, useCallback } from "react";
import { getLearnedTaxonomy, patchLearnedMapping } from "../api/backend";
import Paginator from "./Paginator";

const PAGE_SIZE = 20;

const TYPE_LABELS = {
  function: "Function",
  subfunction: "Subfunction",
  title: "Title",
};

const TYPE_COLORS = {
  function: "bg-brand-100 text-brand-700",
  subfunction: "bg-indigo-100 text-indigo-700",
  title: "bg-violet-100 text-violet-700",
};

export default function MappingRegistry() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const [typeFilter, setTypeFilter] = useState("all");
  const [funcFilter, setFuncFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showDisabled, setShowDisabled] = useState(true);
  const [page, setPage] = useState(1);

  const [edits, setEdits] = useState({});
  const [applyMatching, setApplyMatching] = useState({});

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLearnedTaxonomy();
      setEntries(data);
      setEdits({});
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load mapping registry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const functions = useMemo(() => {
    const set = new Set();
    entries.forEach(e => { if (e.function) set.add(e.function); });
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = entries.filter(e => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (funcFilter !== "all" && e.function !== funcFilter) return false;
      if (!showDisabled && e.disabled) return false;
      if (q && !e.input.toLowerCase().includes(q) && !e.resolved.toLowerCase().includes(q)) return false;
      return true;
    });
    // Reset to page 1 whenever filters change (we do this as a side-effect via useEffect below)
    return result;
  }, [entries, typeFilter, funcFilter, search, showDisabled]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [typeFilter, funcFilter, search, showDisabled]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const matchingCount = useCallback((entry) => {
    return entries.filter(e =>
      !e.disabled && e.type === entry.type && e.input === entry.input &&
      (entry.type === "function" || e.function === entry.function)
    ).length;
  }, [entries]);

  const handleSave = async (entry) => {
    const newResolved = edits[entry.id] ?? entry.resolved;
    if (newResolved === entry.resolved) return;
    setSavingId(entry.id);
    setError(null);
    try {
      const result = await patchLearnedMapping({
        entry_id: entry.id,
        resolved: newResolved,
        apply_to_matching: !!applyMatching[entry.id],
      });
      setEntries(result.entries || []);
      setEdits(prev => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to save mapping");
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleDisabled = async (entry) => {
    setSavingId(entry.id);
    setError(null);
    try {
      const result = await patchLearnedMapping({
        entry_id: entry.id,
        disabled: !entry.disabled,
      });
      setEntries(result.entries || []);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to update mapping");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (entry) => {
    if (!window.confirm(`Delete mapping "${entry.input}" → "${entry.resolved}"?`)) return;
    setSavingId(entry.id);
    setError(null);
    try {
      const result = await patchLearnedMapping({ entry_id: entry.id, delete: true });
      setEntries(result.entries || []);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to delete mapping");
    } finally {
      setSavingId(null);
    }
  };

  const bulkUpdateFiltered = async () => {
    const target = filtered.find(e => edits[e.id] !== undefined && edits[e.id] !== e.resolved);
    if (!target) {
      setError("Edit at least one resolved value in the filtered list first.");
      return;
    }
    const newResolved = edits[target.id];
    setSavingId("bulk");
    setError(null);
    try {
      await patchLearnedMapping({
        entry_id: target.id,
        resolved: newResolved,
        apply_to_matching: true,
      });
      await loadEntries();
    } catch (err) {
      setError(err.response?.data?.detail || "Bulk update failed");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading learned mappings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-brand-50/60 border border-brand-100 rounded-lg p-4">
        <p className="text-sm text-slate-600">
          Manage global learned aliases saved after rationalisation runs. Disabled mappings are ignored during propose (when &ldquo;Use previously learned mapping aliases&rdquo; is checked).
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Type</label>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-1 focus:ring-brand-500 outline-none min-w-[130px]"
          >
            <option value="all">All types</option>
            <option value="function">Function</option>
            <option value="subfunction">Subfunction</option>
            <option value="title">Title</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Function</label>
          <select
            value={funcFilter}
            onChange={e => setFuncFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-1 focus:ring-brand-500 outline-none min-w-[160px]"
          >
            <option value="all">All functions</option>
            {functions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by input or resolved..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={e => setShowDisabled(e.target.checked)}
            className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          <span className="text-sm text-slate-600">Show disabled</span>
        </label>
        <button
          onClick={loadEntries}
          className="px-3 py-2 text-sm text-brand-600 hover:text-brand-800 font-medium"
        >
          Refresh
        </button>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span><span className="font-semibold text-brand-700">{filtered.length}</span> of {entries.length} mappings</span>
        {filtered.length > 0 && Object.keys(edits).some(id => filtered.some(e => e.id === id)) && (
          <button
            onClick={bulkUpdateFiltered}
            disabled={savingId === "bulk"}
            className="text-xs px-3 py-1.5 bg-brand-500 text-white rounded-md hover:bg-brand-600 disabled:opacity-50 transition"
          >
            Save & apply to all matching inputs
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-10">No mappings match your filters</p>
      ) : (
        <div className="bg-white border border-brand-100 rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-brand-50 text-brand-700 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2.5 font-semibold w-28">Type</th>
                  <th className="text-left px-3 py-2.5 font-semibold w-36">Function</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Input</th>
                  <th className="text-left px-3 py-2.5 font-semibold min-w-[200px]">Resolved</th>
                  <th className="text-center px-3 py-2.5 font-semibold w-20">Status</th>
                  <th className="text-right px-3 py-2.5 font-semibold w-44">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.map(entry => {
                  const edited = edits[entry.id] ?? entry.resolved;
                  const isDirty = edited !== entry.resolved;
                  const matchN = matchingCount(entry);
                  return (
                    <tr key={entry.id} className={entry.disabled ? "bg-gray-50 opacity-70" : "bg-white hover:bg-brand-50/30 transition"}>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[entry.type]}`}>
                          {TYPE_LABELS[entry.type]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{entry.function || "—"}</td>
                      <td className="px-3 py-2 font-medium text-slate-700">{entry.input}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={edited}
                          disabled={entry.disabled}
                          onChange={e => setEdits(prev => ({ ...prev, [entry.id]: e.target.value }))}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-gray-100"
                        />
                        {isDirty && matchN > 1 && (
                          <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!applyMatching[entry.id]}
                              onChange={e => setApplyMatching(prev => ({ ...prev, [entry.id]: e.target.checked }))}
                              className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 scale-90"
                            />
                            <span className="text-[11px] text-slate-400">Apply to {matchN} with same input</span>
                          </label>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          entry.disabled ? "bg-gray-200 text-gray-500" : "bg-green-100 text-green-700"
                        }`}>
                          {entry.disabled ? "Off" : "Active"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {isDirty && (
                            <button
                              onClick={() => handleSave(entry)}
                              disabled={savingId === entry.id}
                              className="px-2 py-1 text-xs font-semibold text-white bg-brand-500 rounded hover:bg-brand-600 disabled:opacity-50"
                            >
                              Save
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleDisabled(entry)}
                            disabled={savingId === entry.id}
                            className="px-2 py-1 text-xs font-medium text-slate-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                            title={entry.disabled ? "Re-enable" : "Disable"}
                          >
                            {entry.disabled ? "Enable" : "Disable"}
                          </button>
                          <button
                            onClick={() => handleDelete(entry)}
                            disabled={savingId === entry.id}
                            className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 border-t border-gray-100">
            <Paginator
              page={page}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
