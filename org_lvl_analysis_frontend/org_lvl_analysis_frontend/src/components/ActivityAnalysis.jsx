/**
 * Feature 4 — Activity Analysis
 * 4-step wizard: Setup → Activities & Allocations → Savings Levers → Impact Report
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Plot from "react-plotly.js";
import {
  activityListConfigs, activityCreateConfig, activityGetConfig,
  activityGetRoles, activityUpsertActivities, activityUploadActivities,
  activityGetAllocations, activityUpsertAllocations, activityUploadAllocations,
  activityGetLevers, activityUpsertLevers, activityDeleteLever, activityUploadLevers,
  activityCompute, activityExportImpact,
  dbGetDatasetColumns,
} from "../api/backend";

// ---------------------------------------------------------------------------
// Design tokens (A&M palette)
// ---------------------------------------------------------------------------
const C = {
  navy: "#01244a", navyL: "#0a3f86", blue: "#155bb2", blueL: "#e8eef5",
  gold: "#c5a84a", goldL: "#fffbeb",
  white: "#ffffff", bg: "#f8fbff", cardBg: "#ffffff",
  text: "#0f172a", textSec: "#64748b", textMuted: "#94a3b8",
  border: "#dce4ee", borderL: "#e8eef5",
  danger: "#ec3f4f", dangerL: "#fef2f2",
  success: "#16b867", successL: "#ecfdf5",
  warn: "#ed8f12", warnL: "#fffbeb",
  automation: "#0a3f86", ai: "#8b5cf6", stop_work: "#f97316", bpo: "#c5a84a",
};

const LEVER_META = {
  automation: { label: "Automation", color: C.automation, bg: "#e8eef5" },
  ai:         { label: "AI / Augment", color: C.ai, bg: "#f5f3ff" },
  stop_work:  { label: "Stop Work",   color: C.stop_work, bg: "#fdf6f0" },
  bpo:        { label: "BPO / Outsource", color: C.bpo, bg: "#fffbeb" },
};


const STEPS = [
  { id: 1, label: "Setup", short: "People → Roles" },
  { id: 2, label: "Activities & Allocation", short: "Map time %" },
  { id: 3, label: "Savings Levers", short: "Apply reductions" },
  { id: 4, label: "Impact Report", short: "View savings" },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const fmtPct = (n) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);
const fmtCurr = (n) => {
  if (n == null) return "—";
  const v = Math.abs(n);
  if (v >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Number(n).toFixed(0)}`;
};

function Btn({ children, onClick, variant = "primary", disabled, small, className = "", style }) {
  const themes = {
    primary:   "bg-[#0a3f86] text-white hover:bg-[#0f2e5c] shadow-sm focus:ring-2 focus:ring-[#155bb2]/20",
    secondary: "bg-[#eaf3ff] text-[#0a3f86] border border-[#dbeafe] hover:bg-[#dbeafe] shadow-sm",
    danger:    "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100/70",
    ghost:     "bg-transparent text-slate-600 border border-slate-200 hover:bg-slate-50",
    success:   "bg-[#ecfdf5] text-[#16b867] border border-[rgba(22,184,103,0.3)] hover:bg-[#ecfdf5]/80",
  };
  const sizeClass = small ? "px-2.5 py-1 text-xs" : "px-4.5 py-2 text-xs sm:text-sm";
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`font-semibold rounded-lg transition-all duration-200 ${themes[variant] || themes.primary} ${sizeClass} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:-translate-y-0.5 active:translate-y-0"} ${className}`}
      style={style}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "", style }) {
  return (
    <div
      className={`bg-white/90 backdrop-blur-sm border border-[#dce4ee] rounded-xl shadow-[0_1px_4px_rgba(15,46,92,0.06)] transition-all duration-300 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

function Tag({ children, color, bg, className = "", style }) {
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold ${className}`}
      style={{
        color: color || "#0a3f86",
        background: bg || "#eaf3ff",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 border-2 border-slate-200 border-t-[#155bb2] rounded-full animate-spin" />
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );
}

function StatusPill({ status }) {
  const map = {
    complete: { label: "100%", bg: C.successL, color: C.success },
    partial:  { label: "~", bg: C.warnL, color: C.warn },
    low:      { label: "Low", bg: C.dangerL, color: C.danger },
    empty:    { label: "Empty", bg: "#f3f4f6", color: C.textMuted },
  };
  const s = map[status] || map.empty;
  return <Tag color={s.color} bg={s.bg}>{s.label}</Tag>;
}

// ---------------------------------------------------------------------------
// Step Stepper Header
// ---------------------------------------------------------------------------
function StepHeader({ currentStep, onStepClick }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {STEPS.map((s, i) => {
        const active = s.id === currentStep;
        const done = s.id < currentStep;
        return (
          <button
            key={s.id}
            disabled={!done}
            onClick={() => done && onStepClick(s.id)}
            className={`relative p-3.5 rounded-xl border text-left transition-all duration-300 flex flex-col justify-between h-20 ${
              active
                ? "bg-[#01244a] border-[#01244a] text-white shadow-md shadow-brand-900/10"
                : done
                ? "bg-brand-50/70 border-brand-100 hover:bg-brand-100/50 hover:border-brand-200 text-brand-800 cursor-pointer"
                : "bg-white border-slate-100 text-slate-400 cursor-not-allowed"
            }`}
          >
            {active && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#c5a84a] rounded-b-xl" />
            )}
            <div className="flex items-center justify-between w-full">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${active ? "text-brand-200" : "text-brand-400"}`}>
                Step {s.id}
              </span>
              {done && (
                <span className="w-4 h-4 rounded-full bg-brand-500 text-white flex items-center justify-center text-[10px] font-bold">
                  ✓
                </span>
              )}
            </div>
            <div>
              <div className="font-extrabold text-xs sm:text-sm tracking-tight leading-tight" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{s.label}</div>
              <div className={`text-[9px] mt-0.5 leading-none ${active ? "text-brand-100" : "text-slate-400"}`} style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{s.short}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Step 1 — Setup
// ---------------------------------------------------------------------------
function Step1Setup({ datasetId, onCreated, existingConfigs, onSelect }) {
  const [columnMeta, setColumnMeta] = useState({});
  const [columns, setColumns] = useState([]);
  const [name, setName] = useState("");
  const [roleCol, setRoleCol] = useState("");
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!datasetId) return;
    dbGetDatasetColumns(datasetId)
      .then(r => {
        setColumns(r.columns || []);
        setColumnMeta(r.column_meta || {});
      })
      .catch(e => {
        setErr(`Could not load columns: ${e?.response?.data?.detail || e.message}`);
      });
  }, [datasetId]);

  // Show all columns; label recommended ones (dimensions / low-cardinality).
  // Never hide columns — user may want to group by any field.
  const dimCols = useMemo(() => {
    const meta = columnMeta || {};
    const hasMeta = Object.keys(meta).length > 0;
    if (!hasMeta) return columns; // no metadata yet — show everything
    // Sort: recommended (dimension / unique_count < 50) first, then rest
    const recommended = columns.filter(c => meta[c]?.is_dimension || (meta[c]?.unique_count != null && meta[c].unique_count < 50));
    const others = columns.filter(c => !recommended.includes(c));
    return [...recommended, ...others];
  }, [columns, columnMeta]);

  const previewRoles = useCallback(async (col) => {
    if (!col || !datasetId) return;
    setRolesLoading(true);
    setErr("");
    try {
      // We need a configId to call the roles endpoint, but we don't have one yet.
      // Use a temporary approach: call with a dummy config. We show preview inline after creation.
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  }, [datasetId]);

  const handleCreate = async () => {
    if (!name.trim() || !roleCol) { setErr("Enter a name and select a grouping column."); return; }
    setCreating(true); setErr("");
    try {
      const res = await activityCreateConfig({ dataset_id: datasetId, name: name.trim(), role_grouping_col: roleCol });
      // Immediately fetch roles for preview
      const rolesRes = await activityGetRoles(res.config.id);
      onCreated(res.config, rolesRes.roles || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to create config");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Existing configs */}
      {existingConfigs.length > 0 && (
        <Card className="p-5 mb-5">
          <div className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-3.5" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
            Existing Analyses
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {existingConfigs.map(cfg => (
              <button
                key={cfg.id}
                onClick={() => onSelect(cfg)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-brand-100 bg-brand-50/40 text-xs font-semibold text-brand-800 hover:bg-brand-100/60 hover:border-brand-200 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer shadow-sm"
              >
                <span>{cfg.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-brand-100 text-[10px] text-brand-700 font-semibold">
                  {cfg.role_grouping_col}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Create new */}
      <Card className="p-6">
        <div className="text-sm font-bold text-brand-800 mb-4" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
          New Activity Analysis
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
              Analysis Name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Finance Dept Automation Review"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs bg-white transition-all shadow-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
              Role Grouping Column <span className="text-[9px] text-slate-400 font-normal normal-case">(groups people into roles)</span>
            </label>
            <select
              value={roleCol}
              onChange={e => { setRoleCol(e.target.value); previewRoles(e.target.value); }}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs bg-white transition-all shadow-sm"
            >
              <option value="">— select a column —</option>
              {(() => {
                const meta = columnMeta || {};
                const hasMeta = Object.keys(meta).length > 0;
                if (!hasMeta) {
                  return dimCols.map(c => <option key={c} value={c}>{c}</option>);
                }
                const recommended = dimCols.filter(c => meta[c]?.is_dimension || (meta[c]?.unique_count != null && meta[c].unique_count < 50));
                const others = dimCols.filter(c => !recommended.includes(c));
                return (
                  <>
                    {recommended.length > 0 && <option disabled>── Recommended ──</option>}
                    {recommended.map(c => (
                      <option key={c} value={c}>
                        {c}{meta[c]?.unique_count ? ` (${meta[c].unique_count} values)` : ""}
                      </option>
                    ))}
                    {others.length > 0 && <option disabled>── Other columns ──</option>}
                    {others.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </>
                );
              })()}
            </select>
          </div>
        </div>

        {err && <div className="mt-3 text-red-600 text-xs font-semibold">{err}</div>}

        <div style={{ marginTop: 20 }}>
          <Btn
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating…" : "Create & Continue →"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Step 2 — Activities & Allocation Matrix
// ---------------------------------------------------------------------------
function Step2Activities({ config, roles, onNext }) {
  const [activities, setActivities] = useState(config.activities || []);
  const [allocs, setAllocs] = useState({});  // role_value → {activity_id → time_pct (0-100)}
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [editingActs, setEditingActs] = useState(false);
  const [newActRows, setNewActRows] = useState([{ name: "", process_name: "" }]);
  const [err, setErr] = useState("");
  const actFileRef = useRef();
  const allocFileRef = useRef();

  useEffect(() => {
    if (!config.id) return;
    activityGetAllocations(config.id)
      .then(res => {
        // res = { matrix: { activities, matrix: [...] }, completeness: [...] }
        const matrixData = res.matrix || {};
        const mat = matrixData.matrix || [];
        const newAllocs = {};
        for (const row of mat) {
          newAllocs[row.role_value] = {};
          for (const [actId, pct] of Object.entries(row.allocations || {})) {
            newAllocs[row.role_value][actId] = Math.round(pct * 100);
          }
        }
        setAllocs(newAllocs);
        // Also update activities from response if available
        if (matrixData.activities?.length > 0) setActivities(matrixData.activities);
      })
      .catch(() => {});
    setActivities(config.activities || []);
  }, [config.id]);

  const totalForRole = (rv) => {
    const row = allocs[rv] || {};
    return Object.values(row).reduce((s, v) => s + (Number(v) || 0), 0);
  };

  const cellColor = (total) => {
    if (total >= 98 && total <= 102) return { bg: C.successL, color: C.success };
    if (total > 0) return { bg: C.blueL, color: C.navy };
    return { bg: "transparent", color: C.textMuted };
  };


  const handleCellChange = (rv, actId, val) => {
    const num = val === "" ? "" : Math.max(0, Math.min(200, Number(val) || 0));
    setAllocs(prev => ({
      ...prev,
      [rv]: { ...(prev[rv] || {}), [actId]: num },
    }));
  };

  const handleSaveActivities = async () => {
    setSaving(true); setErr("");
    try {
      const rows = newActRows.filter(r => r.name.trim());
      if (rows.length === 0) { setEditingActs(false); setSaving(false); return; }
      const combined = [...activities, ...rows.map((r, i) => ({ ...r, sort_order: activities.length + i }))];
      const res = await activityUpsertActivities(config.id, combined);
      setActivities(res.activities || []);
      setNewActRows([{ name: "", process_name: "" }]);
      setEditingActs(false);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAllocs = async () => {
    setSaving(true); setErr("");
    try {
      const flat = [];
      for (const [rv, actMap] of Object.entries(allocs)) {
        for (const [actId, pct] of Object.entries(actMap)) {
          if (pct > 0) flat.push({ role_value: rv, activity_id: Number(actId), time_pct: Number(pct) / 100 });
        }
      }
      await activityUpsertAllocations(config.id, flat);
      onNext();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleActUpload = async (file) => {
    setUploading("activities"); setErr("");
    try {
      const res = await activityUploadActivities(config.id, file);
      setActivities(res.activities || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setUploading(null);
    }
  };

  const handleAllocUpload = async (file) => {
    setUploading("allocs"); setErr("");
    try {
      const res = await activityUploadAllocations(config.id, file);
      // res = { matrix: { activities, matrix: [...] }, count }
      const matrixData = res.matrix || {};
      const mat = matrixData.matrix || [];
      const newAllocs = {};
      for (const row of mat) {
        newAllocs[row.role_value] = {};
        for (const [actId, pct] of Object.entries(row.allocations || {})) {
          newAllocs[row.role_value][actId] = Math.round(pct * 100);
        }
      }
      setAllocs(newAllocs);
      if (matrixData.activities?.length > 0) setActivities(matrixData.activities);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setUploading(null);
    }
  };

  const processGroups = useMemo(() => {
    const groups = {};
    for (const act of activities) {
      const p = act.process_name || "General";
      if (!groups[p]) groups[p] = [];
      groups[p].push(act);
    }
    return groups;
  }, [activities]);

  return (
    <div>
      <div className="flex gap-5 flex-wrap mb-5">
        {/* Activities panel */}
        <Card className="flex-[0_0_280px] p-5 max-h-[600px] overflow-auto">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="text-xs font-bold text-brand-800 uppercase tracking-wider font-display">
              Activities ({activities.length})
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="file" ref={actFileRef} accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) handleActUpload(e.target.files[0]); e.target.value = ""; }}
              />
              <button
                onClick={() => actFileRef.current?.click()}
                className="w-8 h-8 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-600 flex items-center justify-center transition cursor-pointer"
                title="Upload activities"
              >
                {uploading === "activities" ? <Spinner /> : <UploadIcon />}
              </button>
              <Btn small variant="secondary" onClick={() => setEditingActs(!editingActs)}>
                {editingActs ? "Cancel" : "+ Add"}
              </Btn>
            </div>
          </div>

          {Object.entries(processGroups).map(([proc, acts]) => (
            <div key={proc} style={{ marginBottom: 14 }}>
              <div className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2 font-display">
                {proc}
              </div>
              {acts.map(act => (
                <div key={act.id} className="px-3 py-2 rounded-lg bg-brand-50/40 border border-brand-100/30 text-xs text-slate-800 mb-1.5 font-medium transition hover:bg-brand-50/70">
                  {act.name}
                </div>
              ))}
            </div>
          ))}

          {editingActs && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              {newActRows.map((row, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <input
                    placeholder="Activity name *"
                    value={row.name}
                    onChange={e => setNewActRows(prev => prev.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs bg-white transition mb-1.5"
                  />
                  <input
                    placeholder="Process (optional)"
                    value={row.process_name}
                    onChange={e => setNewActRows(prev => prev.map((r, j) => j === i ? { ...r, process_name: e.target.value } : r))}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs bg-white transition"
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <Btn small variant="ghost" onClick={() => setNewActRows(p => [...p, { name: "", process_name: "" }])}>
                  + Row
                </Btn>
                <Btn small onClick={handleSaveActivities} disabled={saving}>
                  {saving ? "…" : "Save"}
                </Btn>
              </div>
            </div>
          )}

          <div className="mt-4 p-3 bg-brand-50/20 border border-brand-100/40 rounded-lg text-[10px] text-brand-600 leading-normal">
            <strong>Tip:</strong> Upload an Excel with columns: <span className="font-mono font-bold">Activity</span>, <span className="font-mono font-bold">Process</span>, <span className="font-mono font-bold">Description</span>.
          </div>
        </Card>

        {/* Allocation matrix */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="text-xs font-bold text-brand-800 uppercase tracking-wider font-display">
              Allocation Matrix <span className="text-[11px] text-slate-400 font-normal lowercase tracking-normal font-sans">— % time per role</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="file" ref={allocFileRef} accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) handleAllocUpload(e.target.files[0]); e.target.value = ""; }}
              />
              <button
                onClick={() => allocFileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-200 text-brand-700 bg-white hover:bg-brand-50 transition cursor-pointer shadow-sm"
              >
                {uploading === "allocs" ? <><Spinner /> Uploading…</> : <><UploadIcon /> Upload Matrix</>}
              </button>
            </div>
          </div>

          {activities.length === 0 ? (
            <Card className="p-10 text-center text-slate-400">
              Add activities on the left to build the allocation matrix
            </Card>
          ) : roles.length === 0 ? (
            <Card className="p-10 text-center text-slate-400">
              No roles found — check your dataset for the grouping column
            </Card>
          ) : (
            <div className="overflow-x-auto border border-[#dce4ee] rounded-xl shadow-card bg-white">
              <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                <thead>
                  <tr style={{ background: C.blueL, color: C.navy, borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em", whiteSpace: "nowrap", position: "sticky", left: 0, background: C.blueL }}>
                      Role
                    </th>
                    {activities.map(act => (
                      <th key={act.id} style={{ padding: "10px 8px", textAlign: "center", fontWeight: 700, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em", maxWidth: 95, minWidth: 75 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={act.name}>
                          {act.name}
                        </div>
                        {act.process_name && (
                          <div style={{ fontSize: 8, opacity: 0.6, textTransform: "lowercase", fontWeight: 500 }} className="italic">{act.process_name}</div>
                        )}
                      </th>
                    ))}
                    <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em", minWidth: 65 }}>Total %</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role, ri) => {
                     const total = totalForRole(role.role_value);
                     const cc = cellColor(total);
                     const rowBg = ri % 2 === 0 ? C.white : "rgba(232, 238, 245, 0.15)";
                     return (
                       <tr key={role.role_value} style={{ borderTop: `1px solid ${C.borderL}`, background: rowBg }}>
                         <td style={{ padding: "8px 14px", fontWeight: 600, color: C.text, whiteSpace: "nowrap", position: "sticky", left: 0, background: rowBg, borderRight: `1px solid ${C.borderL}`, fontSize: 12 }}>
                           <div>{role.role_value}</div>
                           <div style={{ fontSize: 10, color: C.textSec, fontWeight: 400 }}>
                             {fmt(role.headcount)} people
                           </div>
                         </td>
                         {activities.map(act => {
                           const hasVal = allocs[role.role_value]?.[act.id] > 0;
                           return (
                             <td key={act.id} style={{ padding: "5px 6px", textAlign: "center" }}>
                               <input
                                 type="number"
                                 min="0"
                                 max="100"
                                 value={(allocs[role.role_value]?.[act.id] ?? "")}
                                 onChange={e => handleCellChange(role.role_value, act.id, e.target.value)}
                                 className={`w-12 px-1.5 py-1 border rounded-md text-xs text-center focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all ${
                                   hasVal ? "bg-[#eaf3ff] text-[#0a3f86] border-[#74a9e7] font-bold" : "bg-white border-slate-200 text-slate-800"
                                 }`}
                               />
                             </td>
                           );
                         })}
                         <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, background: cc.bg, color: cc.color }}>
                           {total}%
                         </td>
                       </tr>
                     );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: C.textSec, display: "flex", alignItems: "center", gap: 16 }}>
            <span>Enter % per cell (0–100). Aim for each row to sum to 100%.</span>
            <span style={{ display: "flex", gap: 8 }}>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200/50">
                ■ 100%
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-brand-50 text-brand-800 border border-brand-200/50">
                ■ partial
              </span>
            </span>
          </div>
        </div>
      </div>


      {err && <div style={{ color: C.danger, fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={handleSaveAllocs} disabled={saving || activities.length === 0}>
          {saving ? "Saving…" : "Save & Continue →"}
        </Btn>
        <Btn variant="ghost" onClick={onNext}>Skip for now</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Savings Levers
// ---------------------------------------------------------------------------
function Step3Levers({ config, onNext }) {
  const [activities, setActivities] = useState(config.activities || []);
  const [levers, setLevers] = useState([]);
  const [pendingLevers, setPendingLevers] = useState({});  // actId → [{lever_type, reduction_pct, effective_date}]
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef();

  useEffect(() => {
    if (!config.id) return;
    activityGetLevers(config.id)
      .then(res => {
        const lvrs = res.levers || [];
        setLevers(lvrs);
        // Build pendingLevers from existing
        const pending = {};
        for (const lv of lvrs) {
          const aid = lv.activity_id;
          if (!pending[aid]) pending[aid] = {};
          if (!pending[aid][lv.lever_type]) pending[aid][lv.lever_type] = [];
          pending[aid][lv.lever_type].push({ ...lv, reduction_pct: Math.round(lv.reduction_pct * 100) });
        }
        setPendingLevers(pending);
      })
      .catch(() => {});
  }, [config.id]);

  const updateLever = (actId, leverType, field, value, idx = 0) => {
    setPendingLevers(prev => {
      const actMap = { ...(prev[actId] || {}) };
      const rows = [...(actMap[leverType] || [{ lever_type: leverType, reduction_pct: "", effective_date: "" }])];
      rows[idx] = { ...rows[idx], [field]: value };
      actMap[leverType] = rows;
      return { ...prev, [actId]: actMap };
    });
  };

  const addLeverRow = (actId, leverType) => {
    setPendingLevers(prev => {
      const actMap = { ...(prev[actId] || {}) };
      const rows = [...(actMap[leverType] || [])];
      rows.push({ lever_type: leverType, reduction_pct: "", effective_date: "" });
      actMap[leverType] = rows;
      return { ...prev, [actId]: actMap };
    });
  };

  const removeLeverRow = (actId, leverType, idx) => {
    setPendingLevers(prev => {
      const actMap = { ...(prev[actId] || {}) };
      const rows = [...(actMap[leverType] || [])];
      rows.splice(idx, 1);
      actMap[leverType] = rows;
      return { ...prev, [actId]: actMap };
    });
  };

  const handleSave = async () => {
    setSaving(true); setErr("");
    try {
      const flat = [];
      for (const [actId, leverMap] of Object.entries(pendingLevers)) {
        for (const [lt, rows] of Object.entries(leverMap)) {
          for (const row of rows) {
            const pct = Number(row.reduction_pct || 0);
            const eff = row.effective_date || "";
            if (pct > 0 && eff) {
              flat.push({
                activity_id: Number(actId),
                lever_type: lt,
                reduction_pct: pct / 100,
                effective_date: eff,
              });
            }
          }
        }
      }
      await activityUpsertLevers(config.id, flat);
      onNext();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file) => {
    setUploading(true); setErr("");
    try {
      const res = await activityUploadLevers(config.id, file);
      setLevers(res.levers || []);
      const pending = {};
      for (const lv of res.levers || []) {
        const aid = lv.activity_id;
        if (!pending[aid]) pending[aid] = {};
        if (!pending[aid][lv.lever_type]) pending[aid][lv.lever_type] = [];
        pending[aid][lv.lever_type].push({ ...lv, reduction_pct: Math.round(lv.reduction_pct * 100) });
      }
      setPendingLevers(pending);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setUploading(false);
    }
  };

  const processGroups = useMemo(() => {
    const groups = {};
    for (const act of activities) {
      const p = act.process_name || "General";
      if (!groups[p]) groups[p] = [];
      groups[p].push(act);
    }
    return groups;
  }, [activities]);

  if (activities.length === 0) {
    return (
      <Card className="p-10 text-center text-slate-400">
        No activities defined. Go back to Step 2 to add activities.
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div className="text-xs text-slate-500">
          Apply savings reductions to activities. Each lever takes effect from its date.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="file" ref={fileRef} accept=".xlsx,.xls" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = ""; }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-200 text-brand-700 bg-white hover:bg-brand-50 transition cursor-pointer shadow-sm"
          >
            {uploading ? <Spinner /> : <UploadIcon />} Upload Excel
          </button>
        </div>
      </div>

      {Object.entries(processGroups).map(([proc, acts]) => (
        <div key={proc} style={{ marginBottom: 24 }}>
          {proc !== "General" && (
            <div className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-3 pb-1 border-b border-brand-100/50 font-display">
              {proc}
            </div>
          )}
          {acts.map(act => {
            const actLevers = pendingLevers[act.id] || {};
            // Build savings summary
            const leverParts = [];
            let totalSavingsPct = 0;
            for (const [lt, rows] of Object.entries(actLevers)) {
              const pct = rows.reduce((s, r) => s + (Number(r.reduction_pct) || 0), 0);
              if (pct > 0) {
                leverParts.push(`${LEVER_META[lt]?.label || lt} ${pct}%`);
                totalSavingsPct += pct;
              }
            }
            const activeSavings = totalSavingsPct > 0;
            const dotColor = activeSavings ? C.blue : C.textMuted;
            const pillBg = activeSavings ? "bg-brand-50 text-brand-800 border-brand-200/50" : "bg-slate-50 text-slate-500 border-slate-100";
            return (
              <Card key={act.id} className="p-[18px] mb-3.5 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent pointer-events-none" />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                    <div className="text-sm font-extrabold text-[#01244a]" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{act.name}</div>
                    {act.process_name && (
                      <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-display">{act.process_name}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {leverParts.length > 0 && (
                      <span className="text-xs text-slate-500 font-medium">{leverParts.join(" · ")}</span>
                    )}
                    {totalSavingsPct > 0 && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${pillBg}`}>
                        {totalSavingsPct}% Saved
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {Object.entries(LEVER_META).map(([lt, meta]) => {
                    const rows = actLevers[lt] || [];
                    return (
                      <div key={lt} className="border border-[#dce4ee] rounded-lg overflow-hidden bg-white/80 shadow-sm transition-all hover:border-[#74a9e7]/30">
                        <div style={{ background: meta.bg, padding: "7px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.borderL}` }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: meta.color, fontFamily: "Manrope, Inter, sans-serif" }}>{meta.label}</span>
                          <button onClick={() => addLeverRow(act.id, lt)} style={{
                            fontSize: 16, fontWeight: 700, color: meta.color, background: "none",
                            border: "none", cursor: "pointer", lineHeight: 1,
                          }} className="hover:scale-110 transition-transform">+</button>
                        </div>
                        <div style={{ padding: "8px 10px" }} className="space-y-1.5">
                          {(rows.length === 0 ? [{ lever_type: lt, reduction_pct: "", effective_date: "" }] : rows).map((row, idx) => (
                            <div key={idx} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <input
                                type="number" min="0" max="100" placeholder="0%"
                                value={row.reduction_pct === "" ? "" : row.reduction_pct}
                                onChange={e => updateLever(act.id, lt, "reduction_pct", e.target.value, idx)}
                                className="w-11 px-1 py-1 border border-slate-200 rounded-md text-xs text-center focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all"
                              />
                              <span style={{ fontSize: 10, color: C.textMuted }}>%</span>
                              <input
                                type="date"
                                value={row.effective_date || ""}
                                onChange={e => updateLever(act.id, lt, "effective_date", e.target.value, idx)}
                                className="flex-1 px-1.5 py-0.5 border border-slate-200 rounded-md text-[10px] focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-slate-700 transition-all"
                              />
                              {rows.length > 0 && (
                                <button
                                  onClick={() => removeLeverRow(act.id, lt, idx)}
                                  className="text-red-500 hover:text-red-700 cursor-pointer font-bold px-1 transition-colors"
                                  style={{ background: "none", border: "none", fontSize: 13 }}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      ))}

      <div style={{ marginTop: 8, padding: 12, background: C.blueL, borderRadius: 6, fontSize: 11, color: C.navy, marginBottom: 16 }}>
        <strong>Template columns:</strong> Activity, Lever Type (automation / ai / stop_work / bpo), Reduction %, Effective Date
      </div>

      {err && <div style={{ color: C.danger, fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save & Compute →"}
        </Btn>
        <Btn variant="ghost" onClick={onNext}>Skip & Compute</Btn>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Step 4 — Impact Report
// ---------------------------------------------------------------------------
function Step4Impact({ config, datasetId }) {
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState("");
  const [activeTab, setActiveTab] = useState("trend");
  const [functionCol, setFunctionCol] = useState("");
  const [availableColumns, setAvailableColumns] = useState([]);

  // Load dataset columns for the Group by dropdown
  useEffect(() => {
    const dsId = datasetId || config?.dataset_id;
    if (!dsId) return;
    dbGetDatasetColumns(dsId)
      .then(r => setAvailableColumns(r.columns || []))
      .catch(() => {});
  }, [datasetId, config?.dataset_id]);

  const handleCompute = async () => {
    setLoading(true); setErr("");
    try {
      const params = functionCol ? { function_col: functionCol } : {};
      const res = await activityCompute(config.id, params);
      setImpact(res.impact);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Computation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await activityExportImpact(config.id, config.name);
    } catch (e) {
      setErr("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const hasFunctionData = impact?.function_breakdown?.length > 0;
  const TABS = [
    { id: "trend", label: "FTE & Cost Trend" },
    { id: "lever", label: "By Lever" },
    { id: "activity", label: "By Activity" },
    { id: "role", label: "By Role" },
    ...(hasFunctionData ? [
      { id: "by_function", label: "By Function", isNew: true },
      { id: "fte_by_function", label: "FTE by Function", isNew: true },
      { id: "cost_by_function", label: "Cost by Function", isNew: true },
    ] : []),
    { id: "individual", label: "Individuals" },
  ];

  return (
    <div style={{ padding: "20px 24px", fontFamily: "'Inter', 'Segoe UI', sans-serif", color: C.text }}>
      {/* Action bar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <Btn onClick={handleCompute} disabled={loading}>
          {loading ? <><Spinner /> Computing…</> : "⟳ Refresh Model"}
        </Btn>
        {/* Group by dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: C.textSec, fontWeight: 600 }}>Group by:</span>
          <select
            value={functionCol}
            onChange={e => setFunctionCol(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition shadow-sm"
          >
            <option value="">— None —</option>
            {availableColumns.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {functionCol && (
            <span style={{ fontSize: 11, color: C.textMuted }}>
              (re-run Refresh to apply)
            </span>
          )}
        </div>
        {impact && (
          <Btn variant="success" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "↓ Export to Excel"}
          </Btn>
        )}
      </div>

      {err && <div style={{ color: C.danger, fontSize: 12, marginBottom: 12 }}>{err}</div>}

      {!impact && !loading && (
        <Card className="p-10 text-center text-slate-400">
          <div style={{ fontSize: 48, marginBottom: 12 }}>⟳</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Click "Refresh Model" to compute impact</div>
          <div style={{ fontSize: 12 }}>Make sure you've set up activities, allocations, and levers in steps 2 & 3</div>
        </Card>
      )}

      {impact && (
        <>
          {/* Summary metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Baseline FTE", value: fmt(impact.baseline_fte), unit: "FTE", green: false, accent: C.navy, gradient: "from-brand-500/5 to-transparent" },
              { label: "Total Savings (FTE)", value: fmt(impact.total_savings_fte), unit: "FTE", green: true, accent: C.success, gradient: "from-green-500/5 to-transparent" },
              { label: "Baseline Cost", value: fmtCurr(impact.baseline_cost), unit: "", green: false, accent: C.navy, gradient: "from-brand-500/5 to-transparent" },
              { label: "Total Savings", value: fmtCurr(impact.total_savings_cost), unit: "", green: true, accent: C.success, gradient: "from-green-500/5 to-transparent" },
            ].map(m => (
              <div key={m.label} className="relative overflow-hidden bg-white/90 backdrop-blur-sm border border-brand-100 rounded-xl p-4 shadow-card hover:shadow-panel hover:-translate-y-0.5 transition-all duration-300">
                <div className={`absolute inset-0 bg-gradient-to-br ${m.gradient} pointer-events-none`} />
                <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3.5, background: m.accent }} />
                <div className="pl-2">
                  <div className="text-[10px] font-bold text-brand-400 uppercase tracking-wider leading-none mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{m.label}</div>
                  <div className="text-2xl font-extrabold leading-none mt-1.5" style={{ fontFamily: "Manrope, Inter, sans-serif", color: m.green ? C.success : C.navy }}>{m.value}</div>
                  {m.unit && <div className="text-[10px] text-slate-400 font-bold tracking-wider mt-1.5 uppercase">{m.unit}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap gap-1.5 border-b border-brand-100 mb-6 bg-slate-50/50 p-1 rounded-xl">
            {TABS.map(t => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer outline-none border-none ${
                    isActive
                      ? "bg-white text-[#01244a] shadow-sm border border-brand-100"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/50"
                  }`}
                  style={{ fontFamily: "Manrope, Inter, sans-serif" }}
                >
                  <span className="flex items-center gap-1.5">
                    {t.label}
                    {t.isNew && (
                      <span className="px-1.5 py-0.5 text-[8px] font-extrabold text-white bg-[#c5a84a] rounded tracking-wider">
                        NEW
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {activeTab === "trend" && <TrendTab impact={impact} />}
          {activeTab === "lever" && <LeverTab impact={impact} />}
          {activeTab === "activity" && <ActivityTab impact={impact} />}
          {activeTab === "role" && <RoleTab impact={impact} />}
          {activeTab === "by_function" && <FunctionTab impact={impact} />}
          {activeTab === "fte_by_function" && <FteByFunctionTab impact={impact} />}
          {activeTab === "cost_by_function" && <CostByFunctionTab impact={impact} />}
          {activeTab === "individual" && <IndividualTab impact={impact} />}
        </>
      )}
    </div>
  );
}

function TrendChart({ title, accentColor, accentBg, values, displayMonths, changes, pctChanges, hoverTemplate, textFormatter, yAxisFmt, yAxisPrefix }) {
  const plotConfig = { displayModeBar: false, responsive: true };
  const layout = {
    height: 260,
    margin: { t: 20, b: 40, l: 62, r: 24 },
    xaxis: {
      tickfont: { size: 10, family: "'Inter', 'Segoe UI', sans-serif", color: C.textSec },
      showgrid: false,
      tickangle: -30,
      linecolor: C.border,
      linewidth: 1,
    },
    yaxis: {
      tickfont: { size: 10, family: "'Inter', 'Segoe UI', sans-serif", color: C.textSec },
      showgrid: true,
      gridcolor: C.borderL,
      gridwidth: 1,
      tickformat: yAxisFmt,
      tickprefix: yAxisPrefix || "",
      zeroline: false,
    },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    showlegend: false,
  };

  const savingsMask = changes.map(v => v !== null && v < 0);
  const lastSavingsIdx = savingsMask.reduce((last, v, i) => v ? i : last, -1);

  return (
    <div className="relative overflow-hidden bg-white/90 backdrop-blur-sm border border-brand-100 rounded-xl shadow-card p-5 transition hover:shadow-panel duration-300">
      {/* Chart header */}
      <div className="flex items-center gap-3.5 mb-4">
        <div style={{ width: 3.5, height: 20, borderRadius: 2, background: accentColor }} />
        <div className="text-sm font-extrabold text-brand-800" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{title}</div>
        {lastSavingsIdx >= 0 && (
          <span className="ml-auto text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200/50">
            {pctChanges[lastSavingsIdx] != null ? `${Math.abs(pctChanges.filter(v => v != null).reduce((s, v) => s + v, 0)).toFixed(1)}% total reduction` : ""}
          </span>
        )}
      </div>

      {/* Plot */}
      <div style={{ padding: "0 8px" }}>
        <Plot
          data={[
            {
              x: displayMonths, y: values,
              type: "scatter", mode: "lines+markers+text",
              line: { color: accentColor, width: 2.5, shape: "spline", smoothing: 0.4 },
              marker: { color: accentColor, size: 7, line: { color: C.white, width: 1.5 } },
              fill: "tozeroy",
              fillcolor: accentBg,
              text: values.map(textFormatter),
              textposition: "top center",
              textfont: { size: 9, family: "'Inter', 'Segoe UI', sans-serif", color: C.navy },
              hovertemplate: hoverTemplate,
            }
          ]}
          layout={layout}
          config={plotConfig}
          style={{ width: "100%" }}
        />
      </div>

      {/* Data table */}
      <div className="overflow-x-auto border border-brand-100 rounded-lg shadow-sm mt-4 bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ background: C.blueL, color: C.navy, borderBottom: `1px solid ${C.border}` }}>
              <th className="px-3.5 py-2 font-bold uppercase tracking-wider text-[10px] text-brand-700">Month</th>
              {displayMonths.map(m => (
                <th key={m} className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px] text-brand-700">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: "#f8fbff" }} className="border-b border-brand-100/30">
              <td className="px-3.5 py-2 font-bold text-slate-700 text-[11px]">Change</td>
              {changes.map((v, i) => (
                <td key={i} className={`px-3 py-2 text-right font-mono text-[11px] font-semibold ${v < 0 ? 'text-green-600' : v > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                  {v === null ? "—" : (v >= 0 ? "+" : "") + (yAxisPrefix ? `${yAxisPrefix}${Math.abs(v) >= 1_000_000 ? (v / 1_000_000).toFixed(1) + "M" : Math.abs(v) >= 1_000 ? (v / 1_000).toFixed(0) + "K" : v.toFixed(1)}` : v.toFixed(1))}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3.5 py-2 font-bold text-slate-700 text-[11px]">Change %</td>
              {pctChanges.map((v, i) => (
                <td key={i} className={`px-3 py-2 text-right font-mono text-[11px] font-semibold ${v < 0 ? 'text-green-600' : v > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                  {v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


function TrendTab({ impact }) {
  const months = impact.months || [];
  if (months.length === 0) return <div style={{ color: C.textMuted, padding: 20 }}>No time data</div>;

  const fteValues  = months.map(m => impact.fte_trend[m]  || 0);
  const costValues = months.map(m => impact.cost_trend[m] || 0);

  const formatMonth = (m) => {
    const [y, mo] = m.split("-");
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[parseInt(mo) - 1]} ${String(y).slice(2)}`;
  };
  const displayMonths = months.map(formatMonth);

  const fteChanges    = fteValues.map((v, i)  => i === 0 ? null : v - fteValues[i - 1]);
  const ftePctChanges = fteValues.map((v, i)  => i === 0 ? null : fteValues[i - 1]  ? ((v - fteValues[i - 1])  / fteValues[i - 1])  * 100 : 0);
  const costChanges    = costValues.map((v, i) => i === 0 ? null : v - costValues[i - 1]);
  const costPctChanges = costValues.map((v, i) => i === 0 ? null : costValues[i - 1] ? ((v - costValues[i - 1]) / costValues[i - 1]) * 100 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <TrendChart
        title="FTE Remaining Over Time"
        accentColor={C.gold}
        accentBg="rgba(197,168,74,0.08)"
        values={fteValues}
        displayMonths={displayMonths}
        changes={fteChanges}
        pctChanges={ftePctChanges}
        hoverTemplate="%{x}: %{y:.1f} FTE<extra></extra>"
        textFormatter={v => v.toFixed(1)}
        yAxisFmt=","
        yAxisPrefix=""
      />
      <TrendChart
        title="Cost Remaining Over Time"
        accentColor={C.blue}
        accentBg="rgba(0,133,202,0.07)"
        values={costValues}
        displayMonths={displayMonths}
        changes={costChanges}
        pctChanges={costPctChanges}
        hoverTemplate="%{x}: $%{y:,.0f}<extra></extra>"
        textFormatter={v => {
          if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
          if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
          return `$${v.toFixed(0)}`;
        }}
        yAxisFmt=".2s"
        yAxisPrefix="$"
      />
    </div>
  );
}

function LeverTab({ impact }) {
  const leverData = impact.savings_by_lever || {};
  const total = Object.values(leverData).reduce((s, v) => s + v, 0);
  if (total === 0) {
    return (
      <div className="text-sm text-slate-500 p-6 text-center border border-brand-100 rounded-xl bg-white">
        No lever savings computed. Ensure levers have a reduction % and date.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {Object.entries(LEVER_META).map(([lt, meta]) => {
          const sav = leverData[lt] || 0;
          const pct = total > 0 ? Math.round(sav / total * 100) : 0;
          return (
            <div key={lt} className="relative overflow-hidden bg-white/90 backdrop-blur-sm border border-brand-100 rounded-xl p-4 shadow-card hover:shadow-panel hover:-translate-y-0.5 transition-all duration-300">
              <div style={{ absolute: "inset-0", background: `linear-gradient(135deg, ${meta.color}08 0%, transparent 100%)`, pointerEvents: "none" }} />
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: meta.color, fontFamily: "Manrope, Inter, sans-serif" }}>{meta.label}</div>
              <div className="text-xl font-extrabold text-[#01244a] leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{fmtCurr(sav)}</div>
              <div style={{ marginTop: 10, background: C.borderL, borderRadius: 4, height: 5 }}>
                <div style={{ width: `${pct}%`, background: meta.color, height: 5, borderRadius: 4 }} />
              </div>
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-2">{pct}% of total savings</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityTab({ impact }) {
  const rows = impact.savings_by_process || [];
  return (
    <div className="overflow-x-auto border border-[#dce4ee] rounded-xl shadow-card bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-[#dce4ee]" style={{ background: "#eaf3ff", color: "#01244a" }}>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700">Activity</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700">Process</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Savings FTE</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Savings Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.activity_id} className={`border-b border-[#dce4ee]/50 hover:bg-[#eaf3ff]/15 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
              <td className="px-4 py-2.5 font-bold text-slate-800">{r.activity}</td>
              <td className="px-4 py-2.5 text-slate-500 font-medium">{r.process || "—"}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-700 font-semibold">{fmtPct(r.savings_fte)}</td>
              <td className="px-4 py-2.5 text-right font-bold text-[#16b867] font-mono">{fmtCurr(r.savings_cost)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-slate-400 font-medium bg-white">
                No activity savings computed
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RoleTab({ impact }) {
  const rows = impact.savings_by_role || [];
  return (
    <div className="overflow-x-auto border border-[#dce4ee] rounded-xl shadow-card bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-[#dce4ee]" style={{ background: "#eaf3ff", color: "#01244a" }}>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700">Role</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Baseline FTE</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Baseline Cost</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Savings FTE</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Savings Cost</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">% Saved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.role_value} className={`border-b border-[#dce4ee]/50 hover:bg-[#eaf3ff]/15 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
              <td className="px-4 py-2.5 font-bold text-slate-800">{r.role_value}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-600 font-semibold">{fmt(r.baseline_fte)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-600">{fmtCurr(r.baseline_cost)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-[#16b867] font-semibold">{fmt(r.savings_fte)}</td>
              <td className="px-4 py-2.5 text-right font-bold text-[#16b867] font-mono">{fmtCurr(r.savings_cost)}</td>
              <td className="px-4 py-2.5 text-right">
                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${r.pct_saved > 10 ? 'bg-green-50 text-green-700 border border-green-200/50' : 'bg-brand-50 text-brand-800 border border-brand-100'}`}>
                  {fmtPct(r.pct_saved)}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-medium bg-white">
                No role savings computed
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}


function IndividualTab({ impact }) {
  const [filter, setFilter] = useState("");
  const rows = impact.individual_savings || [];
  const filtered = filter ? rows.filter(r => r.emp_id?.toLowerCase().includes(filter.toLowerCase()) || r.role_value?.toLowerCase().includes(filter.toLowerCase())) : rows;

  return (
    <div>
      <div style={{ marginBottom: 14 }} className="flex items-center gap-3">
        <input
          placeholder="Filter by ID or role…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="px-3.5 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs bg-white transition shadow-sm w-72"
        />
        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{filtered.length} people</span>
      </div>
      <div className="overflow-x-auto border border-[#dce4ee] rounded-xl shadow-card bg-white max-h-[400px] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#dce4ee]" style={{ background: "#eaf3ff", color: "#01244a" }}>
              <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700">Employee ID</th>
              <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700">Role</th>
              <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Baseline Cost</th>
              <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Savings</th>
              <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">% Saved</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r, i) => (
              <tr key={`${r.emp_id}-${i}`} className={`border-b border-[#dce4ee]/50 hover:bg-[#eaf3ff]/15 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-slate-800">{r.emp_id || "—"}</td>
                <td className="px-4 py-2.5 text-slate-500 font-medium">{r.role_value}</td>
                <td className="px-4 py-2.5 text-right font-mono text-slate-600">{fmtCurr(r.baseline_cost)}</td>
                <td className={`px-4 py-2.5 text-right font-bold font-mono ${r.savings_cost > 0 ? "text-[#16b867]" : "text-slate-400"}`}>
                  {r.savings_cost > 0 ? fmtCurr(r.savings_cost) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.pct_saved > 0 ? (
                    <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-700 border border-green-200/50">
                      {fmtPct(r.pct_saved)}
                    </span>
                  ) : "—"}
                </td>
              </tr>
            ))}
            {filtered.length > 200 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-center text-slate-400 font-medium bg-slate-50/20 text-xs">
                  Showing first 200 of {filtered.length} — export for full list
                </td>
              </tr>
            )}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400 font-medium bg-white">
                  No individual data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// By Function tabs (aggregate + cross-tabs)
// ---------------------------------------------------------------------------

function FunctionTab({ impact }) {
  const rows = impact.function_breakdown || [];
  if (rows.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
        No function data. Select a "Group by" column above and click "Refresh Model".
      </div>
    );
  }
  const totals = rows.reduce(
    (acc, r) => ({
      baseline_fte: acc.baseline_fte + r.baseline_fte,
      post_impact_fte: acc.post_impact_fte + r.post_impact_fte,
      delta_fte: acc.delta_fte + r.delta_fte,
      baseline_cost: acc.baseline_cost + r.baseline_cost,
      post_impact_cost: acc.post_impact_cost + r.post_impact_cost,
      delta_cost: acc.delta_cost + r.delta_cost,
    }),
    { baseline_fte: 0, post_impact_fte: 0, delta_fte: 0, baseline_cost: 0, post_impact_cost: 0, delta_cost: 0 }
  );
  return (
    <div className="overflow-x-auto border border-[#dce4ee] rounded-xl shadow-card bg-white">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr className="border-b border-[#dce4ee]" style={{ background: "#eaf3ff", color: "#01244a" }}>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-left">Function</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Baseline FTE</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Post-Impact FTE</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Delta FTE</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Baseline Cost</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Post-Impact Cost</th>
            <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-brand-700 text-right">Delta Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#dce4ee]" style={{ background: "rgba(21, 91, 178, 0.05)", borderTop: "2px solid #155bb2" }}>
            <td className="px-4 py-2.5 font-extrabold text-[#01244a]">Total</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-800">{totals.baseline_fte.toFixed(1)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-800">{totals.post_impact_fte.toFixed(1)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-[#16b867]">{totals.delta_fte.toFixed(1)}</td>
            <td className="px-4 py-2.5 text-right font-bold font-mono text-slate-800">{fmtCurr(totals.baseline_cost)}</td>
            <td className="px-4 py-2.5 text-right font-bold font-mono text-slate-800">{fmtCurr(totals.post_impact_cost)}</td>
            <td className="px-4 py-2.5 text-right font-bold font-mono text-[#16b867]">{fmtCurr(totals.delta_cost)}</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={r.function} className={`border-b border-[#dce4ee]/50 hover:bg-[#eaf3ff]/15 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
              <td className="px-4 py-2.5 font-bold text-slate-800">{r.function}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-600 font-semibold">{r.baseline_fte.toFixed(1)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-600">{r.post_impact_fte.toFixed(1)}</td>
              <td className={`px-4 py-2.5 text-right font-mono font-semibold ${r.delta_fte > 0 ? "text-[#16b867]" : "text-slate-400"}`}>{r.delta_fte.toFixed(1)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-600">{fmtCurr(r.baseline_cost)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-slate-600">{fmtCurr(r.post_impact_cost)}</td>
              <td className={`px-4 py-2.5 text-right font-mono font-semibold ${r.delta_cost > 0 ? "text-[#16b867]" : "text-slate-400"}`}>{fmtCurr(r.delta_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function _CrossTabByFunction({ funcData, months, valueFormatter }) {
  const [expandedFuncs, setExpandedFuncs] = useState(new Set());
  const funcs = Object.keys(funcData || {}).sort();
  if (funcs.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
        No data. Select a "Group by" column and re-run Refresh Model.
      </div>
    );
  }

  const formatMonth = m => {
    const [y, mo] = m.split("-");
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[parseInt(mo) - 1]} ${y.slice(2)}`;
  };

  const toggleFunc = (func) => {
    setExpandedFuncs(prev => {
      const next = new Set(prev);
      if (next.has(func)) next.delete(func); else next.add(func);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto border border-[#dce4ee] rounded-xl shadow-card bg-white">
      <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
        <thead>
          <tr className="border-b border-[#dce4ee]" style={{ background: "#eaf3ff", color: "#01244a" }}>
            <th style={{ padding: "10px 14px", textAlign: "left", minWidth: 140, position: "sticky", left: 0, background: "#eaf3ff" }} className="font-bold uppercase tracking-wider text-[10px] text-brand-700 font-display">Function</th>
            <th style={{ padding: "10px 14px", textAlign: "left", minWidth: 110 }} className="font-bold uppercase tracking-wider text-[10px] text-brand-700 font-display">Lever</th>
            {months.map(m => (
              <th key={m} style={{ padding: "10px 8px", textAlign: "right", minWidth: 68, whiteSpace: "nowrap" }} className="font-bold uppercase tracking-wider text-[10px] text-brand-700">{formatMonth(m)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {funcs.map(func => {
            const isExpanded = expandedFuncs.has(func);
            const leverData = funcData[func] || {};
            const totalRow = leverData["Total"] || {};
            const levers = Object.keys(leverData).filter(lt => lt !== "Total").sort();

            return (
              <React.Fragment key={func}>
                <tr
                  style={{ background: "#f1f5f9", cursor: "pointer", borderTop: "2px solid #dce4ee" }}
                  className="hover:bg-slate-100 transition-colors"
                  onClick={() => toggleFunc(func)}
                >
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: C.navy, position: "sticky", left: 0, background: "#f1f5f9", whiteSpace: "nowrap" }} className="font-display">
                    <span style={{ marginRight: 7, fontSize: 10, color: C.textSec }}>{isExpanded ? "▼" : "▶"}</span>
                    {func}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: C.textSec }} className="font-display">Total</td>
                  {months.map(m => (
                    <td key={m} style={{ padding: "8px 8px", textAlign: "right", fontWeight: 700 }} className="font-mono">
                      {totalRow[m] != null ? valueFormatter(totalRow[m]) : "—"}
                    </td>
                  ))}
                </tr>
                {isExpanded && levers.map(lt => {
                  const leverRow = leverData[lt] || {};
                  const meta = LEVER_META[lt];
                  return (
                    <tr key={lt} style={{ borderTop: `1px solid ${C.borderL}`, background: C.white }} className="hover:bg-slate-50/50 transition-colors">
                      <td style={{ padding: "6px 12px 6px 30px", color: C.textMuted, position: "sticky", left: 0, background: C.white }} />
                      <td style={{ padding: "6px 12px", fontSize: 11 }}>
                        {meta && (
                          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: meta.color, marginRight: 6, verticalAlign: "middle" }} />
                        )}
                        <span style={{ color: meta ? meta.color : C.textSec, fontWeight: 600 }}>{meta?.label || lt}</span>
                      </td>
                      {months.map(m => (
                        <td key={m} style={{ padding: "6px 8px", textAlign: "right", color: C.textSec }} className="font-mono">
                          {leverRow[m] != null ? valueFormatter(leverRow[m]) : "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FteByFunctionTab({ impact }) {
  const months = impact.months || [];
  return (
    <_CrossTabByFunction
      funcData={impact.fte_by_function_lever_month}
      months={months}
      valueFormatter={v => v.toFixed(1)}
    />
  );
}

function CostByFunctionTab({ impact }) {
  const months = impact.months || [];
  return (
    <_CrossTabByFunction
      funcData={impact.cost_by_function_lever_month}
      months={months}
      valueFormatter={v => fmtCurr(v)}
    />
  );
}

// ---------------------------------------------------------------------------
// Main ActivityAnalysis component
// ---------------------------------------------------------------------------
export default function ActivityAnalysis({ datasetId }) {
  const [step, setStep] = useState(1);
  const [configs, setConfigs] = useState([]);
  const [activeConfig, setActiveConfig] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!datasetId) { setLoading(false); return; }
    activityListConfigs(datasetId)
      .then(res => setConfigs(res.configs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [datasetId]);

  const handleConfigCreated = (cfg, rolesList) => {
    setActiveConfig(cfg);
    setRoles(rolesList);
    setConfigs(prev => [cfg, ...prev.filter(c => c.id !== cfg.id)]);
    setStep(2);
  };

  const handleSelectExisting = async (cfg) => {
    setActiveConfig(null);
    setLoading(true);
    try {
      const [fullCfg, rolesRes] = await Promise.all([
        activityGetConfig(cfg.id),
        activityGetRoles(cfg.id),
      ]);
      setActiveConfig(fullCfg.config);
      setRoles(rolesRes.roles || []);
      setStep(2);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!datasetId) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: C.textMuted }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>No dataset loaded</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>
          Go to <strong>Upload</strong> and pick a saved dataset from the dropdown, or save a new one via Hierarchy first.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 10, color: C.textSec }}>
        <Spinner /> Loading…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif", color: C.text, background: C.bg, minHeight: "100%", padding: "24px 28px" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: C.navy, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" fill="none" stroke={C.gold} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.navy }}>Activity Analysis</h2>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>Model cost takeout from automation, AI, and process change</div>
          </div>
          {activeConfig && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <Tag>{activeConfig.name}</Tag>
              <button
                onClick={() => { setActiveConfig(null); setRoles([]); setStep(1); }}
                className="text-xs text-slate-500 hover:text-slate-800 transition-colors font-semibold cursor-pointer border-none bg-transparent"
              >
                ← Back to configs
              </button>
            </div>
          )}
        </div>
      </div>

      {err && (
        <div style={{ padding: "10px 14px", background: C.dangerL, color: C.danger, borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
          {err}
        </div>
      )}

      {activeConfig ? (
        <>
          <StepHeader currentStep={step} onStepClick={setStep} />

          {step === 4 ? (
            /* Step 4 gets a white card with its own internal padding */
            <div className="bg-white border border-[#dce4ee] rounded-xl shadow-card">
              <Step4Impact config={activeConfig} datasetId={datasetId} />
            </div>
          ) : (
            <div className="bg-white border border-[#dce4ee] rounded-xl shadow-card p-5">
              {step === 1 && (
                <Step1Setup
                  datasetId={datasetId}
                  existingConfigs={[]}
                  onCreated={handleConfigCreated}
                  onSelect={handleSelectExisting}
                />
              )}
              {step === 2 && (
                <Step2Activities
                  config={activeConfig}
                  roles={roles}
                  onNext={() => setStep(3)}
                />
              )}
              {step === 3 && (
                <Step3Levers
                  config={activeConfig}
                  onNext={() => setStep(4)}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <div className="bg-white border border-[#dce4ee] rounded-xl shadow-card p-5">
          <Step1Setup
            datasetId={datasetId}
            existingConfigs={configs}
            onCreated={handleConfigCreated}
            onSelect={handleSelectExisting}
          />
        </div>
      )}
    </div>
  );
}
