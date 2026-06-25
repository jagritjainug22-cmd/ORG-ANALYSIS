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
  navy: "#01244a", navyL: "#0a3366", blue: "#0085ca", blueL: "#dee7f0",
  gold: "#c5a84a", goldL: "#f3e9c4",
  white: "#ffffff", bg: "#f4f6f9", cardBg: "#ffffff",
  text: "#01244a", textSec: "#4a6a8a", textMuted: "#8a9ab4",
  border: "#dce4ee", borderL: "#e8eef5",
  danger: "#d94f4f", dangerL: "#fde7e7",
  success: "#2e9e6a", successL: "#e3f5ec",
  warn: "#d4a942", warnL: "#fff3cd",
  automation: "#3b82f6", ai: "#8b5cf6", stop_work: "#ef4444", bpo: "#f59e0b",
};

const LEVER_META = {
  automation: { label: "Automation", color: C.automation, bg: "#eff6ff" },
  ai:         { label: "AI / Augment", color: C.ai, bg: "#f5f3ff" },
  stop_work:  { label: "Stop Work",   color: C.stop_work, bg: "#fef2f2" },
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

function Btn({ children, onClick, variant = "primary", disabled, small, style }) {
  const base = {
    fontFamily: "inherit", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    border: "none", borderRadius: 6, transition: "all .15s",
    padding: small ? "5px 12px" : "8px 18px",
    fontSize: small ? 12 : 13,
    opacity: disabled ? 0.5 : 1,
    ...style,
  };
  const themes = {
    primary:  { background: C.navy, color: C.white },
    secondary:{ background: C.blueL, color: C.navy, border: `1px solid ${C.blue}` },
    danger:   { background: C.dangerL, color: C.danger, border: `1px solid ${C.danger}` },
    ghost:    { background: "transparent", color: C.textSec, border: `1px solid ${C.border}` },
    success:  { background: C.successL, color: C.success, border: `1px solid ${C.success}` },
  };
  return (
    <button style={{ ...base, ...themes[variant] }} onClick={disabled ? undefined : onClick}>
      {children}
    </button>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10, ...style }}>
      {children}
    </div>
  );
}

function Tag({ children, color, bg }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 20,
      fontSize: 11, fontWeight: 700, color: color || C.navy, background: bg || C.blueL,
    }}>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 14, height: 14, border: `2px solid ${C.border}`,
      borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.7s linear infinite",
    }} />
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
    <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
      {STEPS.map((s, i) => {
        const active = s.id === currentStep;
        const done = s.id < currentStep;
        return (
          <React.Fragment key={s.id}>
            <button
              onClick={() => done && onStepClick(s.id)}
              style={{
                flex: 1, padding: "12px 8px", border: "none", cursor: done ? "pointer" : "default",
                background: active ? C.navy : done ? C.blueL : C.bg,
                color: active ? C.white : done ? C.navy : C.textMuted,
                fontWeight: active || done ? 700 : 500, fontSize: 12, transition: "all .15s",
                borderBottom: active ? `3px solid ${C.gold}` : `3px solid transparent`,
              }}
            >
              <div style={{ fontSize: 10, marginBottom: 2, opacity: 0.75 }}>Step {s.id}</div>
              <div>{s.label}</div>
              <div style={{ fontSize: 10, marginTop: 2, opacity: 0.6 }}>{s.short}</div>
            </button>
            {i < STEPS.length - 1 && (
              <div style={{ width: 1, background: C.border, alignSelf: "stretch" }} />
            )}
          </React.Fragment>
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
        <Card style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: C.navy, marginBottom: 10, fontSize: 13 }}>
            Existing Analyses
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {existingConfigs.map(cfg => (
              <button key={cfg.id} onClick={() => onSelect(cfg)} style={{
                padding: "8px 14px", borderRadius: 6, border: `1px solid ${C.border}`,
                background: C.bg, cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.navy,
              }}>
                {cfg.name}
                <span style={{ marginLeft: 8, color: C.textMuted, fontWeight: 400 }}>
                  {cfg.role_grouping_col}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Create new */}
      <Card style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, color: C.navy, fontSize: 14, marginBottom: 16 }}>
          New Activity Analysis
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 4 }}>
              ANALYSIS NAME
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Finance Dept Automation Review"
              style={{
                width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`,
                borderRadius: 6, fontSize: 13, color: C.text, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 4 }}>
              ROLE GROUPING COLUMN
              <span style={{ marginLeft: 6, color: C.textMuted, fontWeight: 400 }}>
                (groups people into roles)
              </span>
            </label>
            <select
              value={roleCol}
              onChange={e => { setRoleCol(e.target.value); previewRoles(e.target.value); }}
              style={{
                width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`,
                borderRadius: 6, fontSize: 13, color: C.text, background: C.white,
                outline: "none", boxSizing: "border-box",
              }}
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

        {err && <div style={{ marginTop: 12, color: C.danger, fontSize: 12 }}>{err}</div>}

        <div style={{ marginTop: 16 }}>
          <Btn onClick={handleCreate} disabled={creating}>
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
    if (total >= 50) return { bg: C.warnL, color: C.warn };
    if (total > 0) return { bg: C.dangerL, color: C.danger };
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
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        {/* Activities panel */}
        <Card style={{ flex: "0 0 260px", padding: 16, maxHeight: 600, overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: C.navy, fontSize: 13 }}>
              Activities ({activities.length})
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="file" ref={actFileRef} accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) handleActUpload(e.target.files[0]); e.target.value = ""; }}
              />
              <Btn small variant="ghost" onClick={() => actFileRef.current?.click()}>
                {uploading === "activities" ? <Spinner /> : <UploadIcon />}
              </Btn>
              <Btn small variant="secondary" onClick={() => setEditingActs(!editingActs)}>
                {editingActs ? "Cancel" : "+ Add"}
              </Btn>
            </div>
          </div>

          {Object.entries(processGroups).map(([proc, acts]) => (
            <div key={proc} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", marginBottom: 4 }}>
                {proc}
              </div>
              {acts.map(act => (
                <div key={act.id} style={{
                  padding: "5px 8px", borderRadius: 4, background: C.bg,
                  marginBottom: 3, fontSize: 12, color: C.text,
                }}>
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
                    style={{ width: "100%", padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, boxSizing: "border-box", marginBottom: 4 }}
                  />
                  <input
                    placeholder="Process (optional)"
                    value={row.process_name}
                    onChange={e => setNewActRows(prev => prev.map((r, j) => j === i ? { ...r, process_name: e.target.value } : r))}
                    style={{ width: "100%", padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, boxSizing: "border-box" }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <Btn small variant="ghost" onClick={() => setNewActRows(p => [...p, { name: "", process_name: "" }])}>
                  + Row
                </Btn>
                <Btn small onClick={handleSaveActivities} disabled={saving}>
                  {saving ? "…" : "Save"}
                </Btn>
              </div>
            </div>
          )}

          <div style={{ marginTop: 12, padding: 10, background: C.blueL, borderRadius: 6, fontSize: 11, color: C.navy }}>
            <strong>Tip:</strong> Upload an Excel with columns: Activity, Process, Description
          </div>
        </Card>

        {/* Allocation matrix */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: C.navy, fontSize: 13 }}>
              Allocation Matrix <span style={{ color: C.textMuted, fontWeight: 400, fontSize: 12 }}>— % time per role</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="file" ref={allocFileRef} accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) handleAllocUpload(e.target.files[0]); e.target.value = ""; }}
              />
              <Btn small variant="ghost" onClick={() => allocFileRef.current?.click()}>
                {uploading === "allocs" ? <><Spinner /> Uploading…</> : <><UploadIcon /> Upload Matrix</>}
              </Btn>
            </div>
          </div>

          {activities.length === 0 ? (
            <Card style={{ padding: 32, textAlign: "center", color: C.textMuted }}>
              Add activities on the left to build the allocation matrix
            </Card>
          ) : roles.length === 0 ? (
            <Card style={{ padding: 32, textAlign: "center", color: C.textMuted }}>
              No roles found — check your dataset for the grouping column
            </Card>
          ) : (
            <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                <thead>
                  <tr style={{ background: C.navy, color: C.white }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: C.navy }}>
                      Role
                    </th>
                    {activities.map(act => (
                      <th key={act.id} style={{ padding: "8px 8px", textAlign: "center", fontWeight: 600, maxWidth: 90, minWidth: 70 }}>
                        <div style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={act.name}>
                          {act.name}
                        </div>
                        {act.process_name && (
                          <div style={{ fontSize: 9, opacity: 0.6 }}>{act.process_name}</div>
                        )}
                      </th>
                    ))}
                    <th style={{ padding: "8px 10px", textAlign: "center", fontWeight: 600, minWidth: 60 }}>Total %</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role, ri) => {
                    const total = totalForRole(role.role_value);
                    const cc = cellColor(total);
                    return (
                      <tr key={role.role_value} style={{ borderTop: `1px solid ${C.borderL}`, background: ri % 2 === 0 ? C.white : "#fafbfc" }}>
                        <td style={{ padding: "6px 12px", fontWeight: 600, color: C.text, whiteSpace: "nowrap", position: "sticky", left: 0, background: ri % 2 === 0 ? C.white : "#fafbfc", fontSize: 12 }}>
                          <div>{role.role_value}</div>
                          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>
                            {fmt(role.headcount)} people
                          </div>
                        </td>
                        {activities.map(act => (
                          <td key={act.id} style={{ padding: "4px 6px", textAlign: "center" }}>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={(allocs[role.role_value]?.[act.id] ?? "")}
                              onChange={e => handleCellChange(role.role_value, act.id, e.target.value)}
                              style={{
                                width: 52, padding: "4px 6px", border: `1px solid ${C.border}`,
                                borderRadius: 4, fontSize: 12, textAlign: "center",
                                color: C.text, background: (allocs[role.role_value]?.[act.id] > 0) ? C.blueL : C.white,
                              }}
                            />
                          </td>
                        ))}
                        <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, background: cc.bg, color: cc.color }}>
                          {total}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted }}>
            Enter % per cell (0–100). Aim for each row to sum to 100%.
            <span style={{ marginLeft: 12 }}>
              <span style={{ color: C.success }}>■</span> = 100%&nbsp;&nbsp;
              <span style={{ color: C.warn }}>■</span> = partial&nbsp;&nbsp;
              <span style={{ color: C.danger }}>■</span> = low
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
      <Card style={{ padding: 32, textAlign: "center", color: C.textMuted }}>
        No activities defined. Go back to Step 2 to add activities.
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: C.textSec }}>
          Apply reductions to activities. Each lever takes effect from its date.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="file" ref={fileRef} accept=".xlsx,.xls" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = ""; }}
          />
          <Btn small variant="ghost" onClick={() => fileRef.current?.click()}>
            {uploading ? <Spinner /> : <UploadIcon />} Upload Excel
          </Btn>
        </div>
      </div>

      {Object.entries(processGroups).map(([proc, acts]) => (
        <div key={proc} style={{ marginBottom: 20 }}>
          {proc !== "General" && (
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.borderL}` }}>
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
            const dotColor = totalSavingsPct >= 40 ? C.success : totalSavingsPct >= 20 ? C.warn : totalSavingsPct > 0 ? C.danger : C.textMuted;
            const pillBg = totalSavingsPct >= 40 ? C.successL : totalSavingsPct >= 20 ? C.warnL : C.dangerL;
            const pillColor = totalSavingsPct >= 40 ? C.success : totalSavingsPct >= 20 ? C.warn : C.danger;
            return (
              <Card key={act.id} style={{ padding: 14, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                    <div style={{ fontWeight: 700, color: C.navy, fontSize: 13 }}>{act.name}</div>
                    {act.process_name && (
                      <span style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic" }}>{act.process_name}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {leverParts.length > 0 && (
                      <span style={{ fontSize: 11, color: C.textSec }}>{leverParts.join(" · ")}</span>
                    )}
                    {totalSavingsPct > 0 && (
                      <Tag color={pillColor} bg={pillBg}>{totalSavingsPct}%</Tag>
                    )}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                  {Object.entries(LEVER_META).map(([lt, meta]) => {
                    const rows = actLevers[lt] || [];
                    return (
                      <div key={lt} style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>
                        <div style={{ background: meta.bg, padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                          <button onClick={() => addLeverRow(act.id, lt)} style={{
                            fontSize: 16, fontWeight: 700, color: meta.color, background: "none",
                            border: "none", cursor: "pointer", lineHeight: 1,
                          }}>+</button>
                        </div>
                        <div style={{ padding: "6px 8px" }}>
                          {(rows.length === 0 ? [{ lever_type: lt, reduction_pct: "", effective_date: "" }] : rows).map((row, idx) => (
                            <div key={idx} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                              <input
                                type="number" min="0" max="100" placeholder="0%"
                                value={row.reduction_pct === "" ? "" : row.reduction_pct}
                                onChange={e => updateLever(act.id, lt, "reduction_pct", e.target.value, idx)}
                                style={{ width: 52, padding: "4px 6px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, textAlign: "center" }}
                              />
                              <span style={{ fontSize: 11, color: C.textMuted }}>%</span>
                              <input
                                type="date"
                                value={row.effective_date || ""}
                                onChange={e => updateLever(act.id, lt, "effective_date", e.target.value, idx)}
                                style={{ flex: 1, padding: "4px 6px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11 }}
                              />
                              {rows.length > 0 && (
                                <button onClick={() => removeLeverRow(act.id, lt, idx)} style={{ color: C.danger, background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>×</button>
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
            style={{
              padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 6,
              fontSize: 12, color: C.text, background: C.white, outline: "none",
            }}
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
        <Card style={{ padding: 40, textAlign: "center", color: C.textMuted }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⟳</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Click "Refresh Model" to compute impact</div>
          <div style={{ fontSize: 12 }}>Make sure you've set up activities, allocations, and levers in steps 2 & 3</div>
        </Card>
      )}

      {impact && (
        <>
          {/* Summary metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
            {[
              { label: "Baseline FTE", value: fmt(impact.baseline_fte), unit: "FTE", accent: C.navy, accentBg: C.blueL, icon: "👥" },
              { label: "Total Savings (FTE)", value: fmt(impact.total_savings_fte), unit: "FTE", green: true, accent: C.success, accentBg: C.successL, icon: "✂" },
              { label: "Baseline Cost", value: fmtCurr(impact.baseline_cost), unit: "", accent: C.navy, accentBg: C.blueL, icon: "💰" },
              { label: "Total Savings", value: fmtCurr(impact.total_savings_cost), unit: "", green: true, accent: C.success, accentBg: C.successL, icon: "📉" },
            ].map(m => (
              <div key={m.label} style={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "16px 20px",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 1px 4px rgba(1,36,74,0.06)",
              }}>
                {/* Accent strip */}
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: 3,
                  background: m.accent,
                  borderRadius: "10px 10px 0 0",
                }} />
                <div style={{ fontSize: 9, fontWeight: 800, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{m.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: m.green ? C.success : C.navy, lineHeight: 1, letterSpacing: "-0.5px" }}>
                  {m.value}
                </div>
                {m.unit && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontWeight: 600 }}>{m.unit}</div>}
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{
            display: "flex", gap: 2, borderBottom: `2px solid ${C.border}`,
            marginBottom: 20, flexWrap: "wrap", background: "transparent",
          }}>
            {TABS.map(t => {
              const isActive = activeTab === t.id;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                  padding: "9px 16px",
                  border: "none",
                  background: isActive ? C.white : "transparent",
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? C.navy : C.textSec,
                  borderBottom: isActive ? `2px solid ${C.navy}` : "2px solid transparent",
                  borderRadius: "6px 6px 0 0",
                  cursor: "pointer",
                  marginBottom: -2,
                  display: "flex", alignItems: "center", gap: 6,
                  transition: "color 0.15s, background 0.15s",
                  outline: "none",
                }}>
                  {t.label}
                  {t.isNew && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
                      background: C.gold, color: C.white, letterSpacing: "0.05em",
                    }}>NEW</span>
                  )}
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
    <div style={{
      background: C.white,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(1,36,74,0.06)",
    }}>
      {/* Chart header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "14px 20px 0",
      }}>
        <div style={{
          width: 3, height: 20, borderRadius: 2,
          background: accentColor, flexShrink: 0,
        }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{title}</div>
        {lastSavingsIdx >= 0 && (
          <div style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 700,
            color: C.success, background: C.successL,
            padding: "2px 10px", borderRadius: 12,
          }}>
            {pctChanges[lastSavingsIdx] != null ? `${Math.abs(pctChanges.filter(v => v != null).reduce((s, v) => s + v, 0)).toFixed(1)}% total reduction` : ""}
          </div>
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
      <div style={{ overflowX: "auto", borderTop: `1px solid ${C.borderL}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ background: C.navy, color: C.white }}>
              <th style={{ padding: "6px 12px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 700, letterSpacing: "0.04em", fontSize: 9, textTransform: "uppercase" }}>Month</th>
              {displayMonths.map(m => (
                <th key={m} style={{ padding: "6px 8px", textAlign: "center", whiteSpace: "nowrap", fontWeight: 600, fontSize: 10 }}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: "#f7f9fc" }}>
              <td style={{ padding: "5px 12px", fontWeight: 700, color: C.textSec, fontSize: 10, whiteSpace: "nowrap" }}>Change</td>
              {changes.map((v, i) => (
                <td key={i} style={{
                  padding: "5px 8px", textAlign: "center", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 10,
                  color: v === null ? C.textMuted : v < 0 ? C.success : v > 0 ? C.danger : C.textMuted,
                  fontWeight: v !== null && v !== 0 ? 700 : 400,
                }}>
                  {v === null ? "—" : (v >= 0 ? "+" : "") + (yAxisPrefix ? `${yAxisPrefix}${Math.abs(v) >= 1_000_000 ? (v / 1_000_000).toFixed(1) + "M" : Math.abs(v) >= 1_000 ? (v / 1_000).toFixed(0) + "K" : v.toFixed(1)}` : v.toFixed(1))}
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ padding: "5px 12px", fontWeight: 700, color: C.textSec, fontSize: 10, whiteSpace: "nowrap" }}>Change %</td>
              {pctChanges.map((v, i) => (
                <td key={i} style={{
                  padding: "5px 8px", textAlign: "center", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 10,
                  color: v === null ? C.textMuted : v < 0 ? C.success : v > 0 ? C.danger : C.textMuted,
                  fontWeight: v !== null && v !== 0 ? 700 : 400,
                }}>
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
  if (total === 0) return <div style={{ color: C.textMuted, padding: 20 }}>No lever savings computed. Ensure levers have a reduction % and date.</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
        {Object.entries(LEVER_META).map(([lt, meta]) => {
          const sav = leverData[lt] || 0;
          const pct = total > 0 ? Math.round(sav / total * 100) : 0;
          return (
            <Card key={lt} style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: meta.color, marginBottom: 8 }}>{meta.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.navy }}>{fmtCurr(sav)}</div>
              <div style={{ marginTop: 8, background: C.borderL, borderRadius: 3, height: 6 }}>
                <div style={{ width: `${pct}%`, background: meta.color, height: 6, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{pct}% of total savings</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ActivityTab({ impact }) {
  const rows = impact.savings_by_process || [];
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.navy, color: C.white }}>
            <th style={{ padding: "8px 12px", textAlign: "left" }}>Activity</th>
            <th style={{ padding: "8px 12px", textAlign: "left" }}>Process</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Savings FTE</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Savings Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.activity_id} style={{ borderTop: `1px solid ${C.borderL}`, background: i % 2 === 0 ? C.white : "#fafbfc" }}>
              <td style={{ padding: "7px 12px", fontWeight: 600 }}>{r.activity}</td>
              <td style={{ padding: "7px 12px", color: C.textSec }}>{r.process || "—"}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "monospace" }}>{fmtPct(r.savings_fte)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: C.success, fontFamily: "monospace" }}>{fmtCurr(r.savings_cost)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: C.textMuted }}>No activity savings computed</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RoleTab({ impact }) {
  const rows = impact.savings_by_role || [];
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.navy, color: C.white }}>
            <th style={{ padding: "8px 12px", textAlign: "left" }}>Role</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Baseline FTE</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Baseline Cost</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Savings FTE</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>Savings Cost</th>
            <th style={{ padding: "8px 12px", textAlign: "right" }}>% Saved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.role_value} style={{ borderTop: `1px solid ${C.borderL}`, background: i % 2 === 0 ? C.white : "#fafbfc" }}>
              <td style={{ padding: "7px 12px", fontWeight: 600 }}>{r.role_value}</td>
              <td style={{ padding: "7px 12px", textAlign: "right" }}>{fmt(r.baseline_fte)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "monospace" }}>{fmtCurr(r.baseline_cost)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", color: C.success }}>{fmt(r.savings_fte)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: C.success, fontFamily: "monospace" }}>{fmtCurr(r.savings_cost)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right" }}>
                <Tag color={r.pct_saved > 10 ? C.success : C.textSec} bg={r.pct_saved > 10 ? C.successL : C.bg}>
                  {fmtPct(r.pct_saved)}
                </Tag>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: C.textMuted }}>No role savings computed</td></tr>
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
      <div style={{ marginBottom: 10 }}>
        <input
          placeholder="Filter by ID or role…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: "6px 12px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, width: 280 }}
        />
        <span style={{ marginLeft: 12, fontSize: 11, color: C.textMuted }}>{filtered.length} people</span>
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto", maxHeight: 400 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.navy, color: C.white }}>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Employee ID</th>
              <th style={{ padding: "8px 12px", textAlign: "left" }}>Role</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>Baseline Cost</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>Savings</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>% Saved</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r, i) => (
              <tr key={`${r.emp_id}-${i}`} style={{ borderTop: `1px solid ${C.borderL}`, background: i % 2 === 0 ? C.white : "#fafbfc" }}>
                <td style={{ padding: "6px 12px", fontFamily: "monospace", fontSize: 11 }}>{r.emp_id || "—"}</td>
                <td style={{ padding: "6px 12px", color: C.textSec }}>{r.role_value}</td>
                <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "monospace" }}>{fmtCurr(r.baseline_cost)}</td>
                <td style={{ padding: "6px 12px", textAlign: "right", fontWeight: 700, color: r.savings_cost > 0 ? C.success : C.textMuted, fontFamily: "monospace" }}>
                  {r.savings_cost > 0 ? fmtCurr(r.savings_cost) : "—"}
                </td>
                <td style={{ padding: "6px 12px", textAlign: "right" }}>
                  {r.pct_saved > 0 ? <Tag color={C.success} bg={C.successL}>{fmtPct(r.pct_saved)}</Tag> : "—"}
                </td>
              </tr>
            ))}
            {filtered.length > 200 && (
              <tr><td colSpan={5} style={{ padding: 12, textAlign: "center", color: C.textMuted, fontSize: 11 }}>
                Showing first 200 of {filtered.length} — export for full list
              </td></tr>
            )}
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: C.textMuted }}>No individual data</td></tr>
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
  const th = { padding: "8px 12px", fontWeight: 600 };
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.navy, color: C.white }}>
            <th style={{ ...th, textAlign: "left" }}>Function</th>
            <th style={{ ...th, textAlign: "right" }}>Baseline FTE</th>
            <th style={{ ...th, textAlign: "right" }}>Post-Impact FTE</th>
            <th style={{ ...th, textAlign: "right" }}>Delta FTE</th>
            <th style={{ ...th, textAlign: "right" }}>Baseline Cost</th>
            <th style={{ ...th, textAlign: "right" }}>Post-Impact Cost</th>
            <th style={{ ...th, textAlign: "right" }}>Delta Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: C.blueL, borderTop: `2px solid ${C.blue}` }}>
            <td style={{ padding: "8px 12px", fontWeight: 800, color: C.navy }}>Total</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>{totals.baseline_fte.toFixed(1)}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>{totals.post_impact_fte.toFixed(1)}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: C.success }}>{totals.delta_fte.toFixed(1)}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, fontFamily: "monospace" }}>{fmtCurr(totals.baseline_cost)}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, fontFamily: "monospace" }}>{fmtCurr(totals.post_impact_cost)}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: C.success, fontFamily: "monospace" }}>{fmtCurr(totals.delta_cost)}</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={r.function} style={{ borderTop: `1px solid ${C.borderL}`, background: i % 2 === 0 ? C.white : "#fafbfc" }}>
              <td style={{ padding: "7px 12px", fontWeight: 600 }}>{r.function}</td>
              <td style={{ padding: "7px 12px", textAlign: "right" }}>{r.baseline_fte.toFixed(1)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right" }}>{r.post_impact_fte.toFixed(1)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", color: r.delta_fte > 0 ? C.success : C.textMuted }}>{r.delta_fte.toFixed(1)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "monospace" }}>{fmtCurr(r.baseline_cost)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "monospace" }}>{fmtCurr(r.post_impact_cost)}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", color: r.delta_cost > 0 ? C.success : C.textMuted, fontFamily: "monospace" }}>{fmtCurr(r.delta_cost)}</td>
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
    <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
        <thead>
          <tr style={{ background: C.navy, color: C.white }}>
            <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 140, position: "sticky", left: 0, background: C.navy }}>Function</th>
            <th style={{ padding: "8px 12px", textAlign: "left", minWidth: 110 }}>Lever</th>
            {months.map(m => (
              <th key={m} style={{ padding: "8px 8px", textAlign: "right", minWidth: 68, whiteSpace: "nowrap" }}>{formatMonth(m)}</th>
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
                  style={{ background: "#edf1f7", cursor: "pointer", borderTop: `2px solid ${C.border}` }}
                  onClick={() => toggleFunc(func)}
                >
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: C.navy, position: "sticky", left: 0, background: "#edf1f7", whiteSpace: "nowrap" }}>
                    <span style={{ marginRight: 7, fontSize: 10, color: C.textSec }}>{isExpanded ? "▼" : "▶"}</span>
                    {func}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: C.textSec }}>Total</td>
                  {months.map(m => (
                    <td key={m} style={{ padding: "8px 8px", textAlign: "right", fontWeight: 700 }}>
                      {totalRow[m] != null ? valueFormatter(totalRow[m]) : "—"}
                    </td>
                  ))}
                </tr>
                {isExpanded && levers.map(lt => {
                  const leverRow = leverData[lt] || {};
                  const meta = LEVER_META[lt];
                  return (
                    <tr key={lt} style={{ borderTop: `1px solid ${C.borderL}`, background: C.white }}>
                      <td style={{ padding: "6px 12px 6px 30px", color: C.textMuted, position: "sticky", left: 0, background: C.white }} />
                      <td style={{ padding: "6px 12px", fontSize: 11 }}>
                        {meta && (
                          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: meta.color, marginRight: 6, verticalAlign: "middle" }} />
                        )}
                        <span style={{ color: meta ? meta.color : C.textSec }}>{meta?.label || lt}</span>
                      </td>
                      {months.map(m => (
                        <td key={m} style={{ padding: "6px 8px", textAlign: "right", color: C.textSec }}>
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
              <button onClick={() => { setActiveConfig(null); setRoles([]); setStep(1); }} style={{
                fontSize: 12, color: C.textMuted, background: "none", border: "none", cursor: "pointer",
              }}>
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
            <div style={{ background: C.white, borderRadius: 10, border: `1px solid ${C.border}` }}>
              <Step4Impact config={activeConfig} datasetId={datasetId} />
            </div>
          ) : (
            <div style={{ background: C.white, borderRadius: 10, border: `1px solid ${C.border}`, padding: 20 }}>
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
        <div style={{ background: C.white, borderRadius: 10, border: `1px solid ${C.border}`, padding: 20 }}>
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
