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
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [cloning, setCloning] = useState(false);
  const [cloneId, setCloneId] = useState("");
  const [cloneError, setCloneError] = useState("");

  const empId = record ? String(record.__emp_id ?? record[empCol] ?? "") : "";

  useEffect(() => {
    setEditing(false);
    setDraft({});
    setCloning(false);
    setCloneId("");
    setCloneError("");
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
      onSave?.(empId, updates);
    }
    setEditing(false);
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
    onClone?.(empId, nextId);
    setCloning(false);
    setCloneId("");
    setCloneError("");
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
                  onClick={() => onFlagToggle?.(empId, !flagged)}
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
