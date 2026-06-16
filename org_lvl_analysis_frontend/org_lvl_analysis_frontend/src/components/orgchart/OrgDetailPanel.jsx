import React, { useState, useEffect } from "react";
import { AM } from "./orgChartTheme";
import { fmtCompactCurrency, fmtNumber } from "./orgChartLayout";

/**
 * Right-side detail panel: full record view + inline edit. Editable fields
 * are job title, management level, FTE, salary/cost, plus any user-mapped
 * column. Saving calls the parent-provided onSave callback, which is wired
 * up to db_service.edit_employee.
 */
export default function OrgDetailPanel({
  record,
  empCol,
  mgrCol,
  jobTitleCol,
  fteCol,
  flcCol,
  countryCol,
  editMode,
  onClose,
  onSave,
  onFlagToggle,
  onClone,
  existingEmpIds = [],
  autoStartClone = false,
  onAutoCloneConsumed,
  rateCardActive = false,
  onApplyRateCard,
  issues = null,
  records = [],
  onMoveEmployee,
  onEditEmployee,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [cloning, setCloning] = useState(false);
  const [cloneId, setCloneId] = useState("");
  const [cloneError, setCloneError] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  const empId = record ? String(record.__emp_id ?? record[empCol] ?? "") : "";

  useEffect(() => {
    setEditing(false);
    setDraft({});
    setCloning(false);
    setCloneId("");
    setCloneError("");
    setEffectiveDate("");
  }, [record?.__emp_id]);

  useEffect(() => {
    if (!autoStartClone || !record || !empId) return;
    setCloneId(makeCloneSuggestion(empId, existingEmpIds));
    setCloneError("");
    setCloning(true);
    setEditing(false);
    onAutoCloneConsumed?.();
  }, [autoStartClone, record?.__emp_id, empId, existingEmpIds, onAutoCloneConsumed]);

  if (!record) return null;

  const flagged = !!record.is_flagged_removed;

  const editableFields = [
    jobTitleCol && [jobTitleCol, "Job Title"],
    ["Management Level", "Management Level"],
    fteCol && [fteCol, "FTE"],
    flcCol && [flcCol, "Cost (FLC)"],
    countryCol && [countryCol, "Country"],
    ["Change Reason", "Change Reason"],
  ].filter(Boolean);

  const startEdit = () => {
    const next = {};
    editableFields.forEach(([f]) => {
      next[f] = record[f] ?? "";
    });
    setDraft(next);
    setEditing(true);
  };

  const save = () => {
    const updates = {};
    editableFields.forEach(([f]) => {
      if (draft[f] !== record[f]) updates[f] = draft[f];
    });
    if (Object.keys(updates).length) {
      onSave?.(empId, updates, effectiveDate || null);
    }
    setEditing(false);
    setEffectiveDate("");
  };

  const suggestCloneId = () => makeCloneSuggestion(empId, existingEmpIds);

  const startClone = () => {
    setCloneId(suggestCloneId());
    setCloneError("");
    setCloning(true);
    setEditing(false);
  };

  const submitClone = () => {
    const nextId = cloneId.trim();
    if (!nextId) {
      setCloneError("Employee ID is required");
      return;
    }
    if (existingEmpIds.map(String).includes(nextId)) {
      setCloneError("That employee ID already exists");
      return;
    }
    onClone?.(empId, nextId, effectiveDate || null);
    setCloning(false);
    setCloneId("");
    setCloneError("");
    setEffectiveDate("");
  };

  const allFields = Object.entries(record).filter(
    ([k]) => !k.startsWith("__") && !["is_flagged_removed", "is_added"].includes(k)
  );

  return (
    <aside
      style={{
        width: 340,
        background: AM.white,
        borderLeft: `1px solid ${AM.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        // Float over the canvas so it never squeezes the chart at narrow widths.
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        boxShadow: "-8px 0 24px rgba(11, 35, 75, 0.12)",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: `1px solid ${AM.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: AM.navy,
          color: AM.white,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.3px" }}>
          Employee Details
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: AM.white,
            fontSize: 20,
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
          }}
          aria-label="Close detail panel"
        >
          ×
        </button>
      </div>

      <div style={{ padding: 16, flex: 1, overflow: "auto" }}>
        <div
          style={{
            background: flagged ? AM.dangerLight : AM.borderLight,
            border: `1px solid ${flagged ? AM.danger : AM.border}`,
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: AM.navy }}>
            {record[jobTitleCol] || record["Job Title"] || empId}
          </div>
          <div
            style={{
              fontSize: 11,
              color: AM.textSecondary,
              marginTop: 4,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            ID: {empId}
          </div>
        </div>

        {/* Validation issues banner */}
        {issues && issues.length > 0 && (
          <ValidationIssueBanner
            issues={issues}
            record={record}
            empCol={empCol}
            mgrCol={mgrCol}
            records={records}
            onMoveEmployee={onMoveEmployee}
            onEditEmployee={onEditEmployee}
            onFlagToggle={onFlagToggle}
            empId={empId}
          />
        )}

        {editMode && (
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {!editing && !cloning ? (
              <>
                <button
                  onClick={startEdit}
                  disabled={flagged}
                  style={primaryBtn(flagged)}
                >
                  Edit fields
                </button>
                <button
                  onClick={startClone}
                  disabled={flagged}
                  style={ghostBtn(flagged)}
                >
                  Clone position
                </button>
                <button
                  onClick={() => { onFlagToggle?.(empId, !flagged, effectiveDate || null); setEffectiveDate(""); }}
                  style={flagged ? successBtn() : dangerBtn()}
                >
                  {flagged ? "Restore" : "Flag"}
                </button>
              </>
            ) : cloning ? (
              <>
                <button onClick={submitClone} style={primaryBtn(false)}>Create clone</button>
                <button
                  onClick={() => {
                    setCloning(false);
                    setCloneError("");
                  }}
                  style={ghostBtn()}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={save} style={primaryBtn(false)}>Save</button>
                <button onClick={() => setEditing(false)} style={ghostBtn()}>Cancel</button>
              </>
            )}
          </div>
        )}

        {cloning && (
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                color: AM.textSecondary,
                textTransform: "uppercase",
                letterSpacing: "0.6px",
                marginBottom: 4,
              }}
            >
              New employee ID
            </label>
            <input
              value={cloneId}
              onChange={(e) => {
                setCloneId(e.target.value);
                setCloneError("");
              }}
              style={{
                width: "100%",
                border: `1px solid ${cloneError ? AM.danger : AM.border}`,
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                outline: "none",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            />
            {cloneError && (
              <div style={{ fontSize: 11, color: AM.danger, marginTop: 6 }}>{cloneError}</div>
            )}
            <div style={{ fontSize: 11, color: AM.textMuted, marginTop: 8, lineHeight: 1.4 }}>
              Creates a copy under the same manager with the same role properties.
            </div>
          </div>
        )}

        {editMode && !editing && !cloning && (
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                color: AM.textSecondary,
                textTransform: "uppercase",
                letterSpacing: "0.6px",
                marginBottom: 4,
              }}
            >
              Effective Date
            </label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              placeholder="When does this change take effect?"
              style={{
                width: "100%",
                border: `1px solid ${AM.border}`,
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                outline: "none",
                fontFamily: "'IBM Plex Sans', sans-serif",
              }}
            />
          </div>
        )}

        {editMode && flcCol && rateCardActive && !editing && !cloning && (
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => onApplyRateCard?.(empId)}
              disabled={flagged}
              style={ghostBtn(flagged)}
            >
              Recalculate from rate card
            </button>
            {record.__rate_card_derived && (
              <div style={{ fontSize: 11, color: AM.success, marginTop: 6, fontWeight: 600 }}>
                Cost is rate-card derived
              </div>
            )}
          </div>
        )}

        {editing && (
          <div style={{ marginBottom: 16 }}>
            {editableFields.map(([f, label]) => (
              <div key={f} style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 10,
                    fontWeight: 600,
                    color: AM.textSecondary,
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    marginBottom: 4,
                  }}
                >
                  {label}
                </label>
                <input
                  value={draft[f] ?? ""}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, [f]: e.target.value }))
                  }
                  style={{
                    width: "100%",
                    border: `1px solid ${AM.border}`,
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 12,
                    outline: "none",
                    fontFamily: "'IBM Plex Sans', sans-serif",
                  }}
                />
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 600,
                  color: AM.textSecondary,
                  textTransform: "uppercase",
                  letterSpacing: "0.6px",
                  marginBottom: 4,
                }}
              >
                Effective Date
              </label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                style={{
                  width: "100%",
                  border: `1px solid ${AM.border}`,
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                  outline: "none",
                  fontFamily: "'IBM Plex Sans', sans-serif",
                }}
              />
            </div>
          </div>
        )}

        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: AM.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.8px",
            marginBottom: 8,
          }}
        >
          All fields
        </div>
        {allFields.map(([k, v]) => (
          <div
            key={k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "6px 0",
              borderBottom: `1px solid ${AM.borderLight}`,
            }}
          >
            <span style={{ fontSize: 11, color: AM.textMuted, flexShrink: 0 }}>{k}</span>
            <span
              style={{
                fontSize: 11,
                color: AM.textPrimary,
                fontFamily: "'IBM Plex Mono', monospace",
                textAlign: "right",
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={String(v ?? "")}
            >
              {formatVal(v)}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function makeCloneSuggestion(sourceId, existingEmpIds) {
  let candidate = `${sourceId}-copy`;
  let n = 2;
  const taken = new Set(existingEmpIds.map(String));
  while (taken.has(candidate)) {
    candidate = `${sourceId}-copy${n}`;
    n += 1;
  }
  return candidate;
}

function formatVal(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return fmtNumber(v);
  return String(v);
}

function primaryBtn(disabled) {
  return {
    flex: 1,
    background: disabled ? AM.borderLight : AM.navy,
    color: disabled ? AM.textMuted : AM.white,
    border: "none",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
function dangerBtn() {
  return {
    flex: 1,
    background: AM.danger,
    color: AM.white,
    border: "none",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
function successBtn() {
  return {
    flex: 1,
    background: AM.success,
    color: AM.white,
    border: "none",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
function ghostBtn(disabled = false) {
  return {
    flex: 1,
    background: disabled ? AM.borderLight : AM.borderLight,
    color: disabled ? AM.textMuted : AM.textSecondary,
    border: "none",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

/* --------------------------------------------------------------------------
 * Validation issue banner + contextual fix actions
 * -------------------------------------------------------------------------- */

const ISSUE_LABELS = {
  closed_manager_has_reports: "Closed manager has open reports",
  orphaned_position:          "Orphaned position",
  circular_reference:         "Circular reference",
  duplicate_id:               "Duplicate ID",
  self_report:                "Self-report",
  missing_change_reason:      "Missing Change Reason",
};

function ValidationIssueBanner({
  issues,
  record,
  empCol,
  mgrCol,
  records,
  onMoveEmployee,
  onEditEmployee,
  onFlagToggle,
  empId,
}) {
  const hasError = issues.some((i) => i.severity === "error");
  const bgColor  = hasError ? "#fef2f2" : "#fffbeb";
  const border   = hasError ? "#fca5a5" : "#fcd34d";
  const titleClr = hasError ? AM.danger : "#92400e";

  // Collect active manager options (non-flagged, non-self)
  const managerOptions = records
    ? records
        .filter((r) => {
          const rid = String(r.__emp_id ?? r[empCol] ?? "");
          return rid !== empId && !r.is_flagged_removed;
        })
        .map((r) => ({
          id: String(r.__emp_id ?? r[empCol] ?? ""),
          label: String(r["Job Title"] || r.__emp_id || r[empCol] || ""),
        }))
        .slice(0, 200)
    : [];

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 14,
        fontSize: 12,
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div style={{ fontWeight: 700, color: titleClr, marginBottom: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {issues.length} Validation Issue{issues.length !== 1 ? "s" : ""}
      </div>
      {issues.map((issue, i) => (
        <IssueFixRow
          key={i}
          issue={issue}
          empId={empId}
          record={record}
          empCol={empCol}
          mgrCol={mgrCol}
          managerOptions={managerOptions}
          onMoveEmployee={onMoveEmployee}
          onEditEmployee={onEditEmployee}
          onFlagToggle={onFlagToggle}
        />
      ))}
    </div>
  );
}

function IssueFixRow({
  issue,
  empId,
  record,
  empCol,
  mgrCol,
  managerOptions,
  onMoveEmployee,
  onEditEmployee,
  onFlagToggle,
}) {
  const [newReason, setNewReason] = useState("");
  const [newMgr, setNewMgr] = useState("");
  const [newId, setNewId] = useState("");
  const [saving, setSaving] = useState(false);

  const label = ISSUE_LABELS[issue.type] || issue.type;
  const isError = issue.severity === "error";
  const dotColor = isError ? AM.danger : "#d97706";

  const applyMgrChange = async (targetEmpId, newMgrId) => {
    if (!newMgrId || saving) return;
    setSaving(true);
    try {
      await onMoveEmployee?.(targetEmpId, newMgrId);
    } finally {
      setSaving(false);
      setNewMgr("");
    }
  };

  const applyReasonChange = async () => {
    if (!newReason.trim() || saving) return;
    setSaving(true);
    try {
      await onEditEmployee?.(empId, { "Change Reason": newReason.trim() });
    } finally {
      setSaving(false);
      setNewReason("");
    }
  };

  const applyIdChange = async () => {
    if (!newId.trim() || saving) return;
    setSaving(true);
    try {
      await onEditEmployee?.(empId, { [empCol]: newId.trim() });
    } finally {
      setSaving(false);
      setNewId("");
    }
  };

  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid rgba(0,0,0,0.07)` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 5 }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 11, color: AM.textPrimary }}>{label}</div>
          <div style={{ fontSize: 10, color: AM.textSecondary, marginTop: 1 }}>{issue.description}</div>
        </div>
      </div>

      {/* Fix actions per issue type */}
      {issue.type === "missing_change_reason" && (
        <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
          <input
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyReasonChange(); }}
            placeholder="e.g. Outsource, Redundancy…"
            style={miniInput()}
          />
          <button onClick={applyReasonChange} disabled={!newReason.trim() || saving} style={miniBtn(false)}>
            Save
          </button>
        </div>
      )}

      {(issue.type === "orphaned_position" || issue.type === "self_report" || issue.type === "circular_reference") && (
        <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
          <select
            value={newMgr}
            onChange={(e) => setNewMgr(e.target.value)}
            style={{ ...miniInput(), appearance: "none", paddingRight: 8 }}
          >
            <option value="">Move to manager…</option>
            {managerOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.id} — {o.label}</option>
            ))}
          </select>
          <button onClick={() => applyMgrChange(empId, newMgr)} disabled={!newMgr || saving} style={miniBtn(false)}>
            Apply
          </button>
        </div>
      )}

      {issue.type === "closed_manager_has_reports" && issue.relatedEmpIds?.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 10, color: AM.textMuted, marginBottom: 4 }}>
            Reassign {issue.relatedEmpIds.length} report{issue.relatedEmpIds.length !== 1 ? "s" : ""} to:
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            <select
              value={newMgr}
              onChange={(e) => setNewMgr(e.target.value)}
              style={{ ...miniInput(), appearance: "none", paddingRight: 8 }}
            >
              <option value="">Select new manager…</option>
              {managerOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.id} — {o.label}</option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (!newMgr || saving) return;
                setSaving(true);
                try {
                  for (const rid of issue.relatedEmpIds) {
                    await onMoveEmployee?.(rid, newMgr);
                  }
                } finally {
                  setSaving(false);
                  setNewMgr("");
                }
              }}
              disabled={!newMgr || saving}
              style={miniBtn(false)}
            >
              {saving ? "…" : "Reassign all"}
            </button>
          </div>
        </div>
      )}

      {issue.type === "duplicate_id" && (
        <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="New unique ID…"
            style={miniInput()}
            onKeyDown={(e) => { if (e.key === "Enter") applyIdChange(); }}
          />
          <button onClick={applyIdChange} disabled={!newId.trim() || saving} style={miniBtn(false)}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function miniInput() {
  return {
    flex: 1,
    border: `1px solid ${AM.border}`,
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 11,
    fontFamily: "'IBM Plex Sans', sans-serif",
    outline: "none",
    minWidth: 0,
    background: AM.white,
  };
}

function miniBtn(disabled) {
  return {
    background: disabled ? AM.borderLight : AM.navy,
    color: disabled ? AM.textMuted : AM.white,
    border: "none",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}
