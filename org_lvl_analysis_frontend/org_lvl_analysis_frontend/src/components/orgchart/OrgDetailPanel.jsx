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
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});

  useEffect(() => {
    setEditing(false);
    setDraft({});
  }, [record?.__emp_id]);

  if (!record) return null;

  const empId = String(record.__emp_id ?? record[empCol] ?? "");
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
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {!editing ? (
              <>
                <button
                  onClick={startEdit}
                  disabled={flagged}
                  style={primaryBtn(flagged)}
                >
                  Edit fields
                </button>
                <button
                  onClick={() => onFlagToggle?.(empId, !flagged)}
                  style={flagged ? successBtn() : dangerBtn()}
                >
                  {flagged ? "Restore" : "Flag"}
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
function ghostBtn() {
  return {
    flex: 1,
    background: AM.borderLight,
    color: AM.textSecondary,
    border: "none",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
