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
  onIgnoreIssue,
  cycleGroups = [],
  records = [],
  onMoveEmployee,
  onEditEmployee,
  formulas = [],
  mutationState = null,
}) {
  const [editingKey, setEditingKey] = useState(null);
  const [inlineDraft, setInlineDraft] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneId, setCloneId] = useState("");
  const [cloneError, setCloneError] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  const empId = record ? String(record.__emp_id ?? record[empCol] ?? "") : "";

  useEffect(() => {
    setEditingKey(null);
    setInlineDraft("");
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
    setEditingKey(null);
    onAutoCloneConsumed?.();
  }, [autoStartClone, record?.__emp_id, empId, existingEmpIds, onAutoCloneConsumed]);

  if (!record) return null;

  const flagged = !!record.is_flagged_removed;

  const canInlineEdit = editMode && !flagged && !cloning;

  const startInlineEdit = (key, value) => {
    if (!canInlineEdit) return;
    setEditingKey(key);
    setInlineDraft(value == null ? "" : String(value));
  };

  const cancelInlineEdit = () => {
    setEditingKey(null);
    setInlineDraft("");
  };

  const saveInlineEdit = (key) => {
    const newVal = inlineDraft;
    const oldVal = record[key];
    if (String(newVal ?? "") === String(oldVal ?? "")) {
      cancelInlineEdit();
      return;
    }
    if (mgrCol && key === mgrCol) {
      onMoveEmployee?.(empId, newVal.trim() || null);
    } else {
      onSave?.(empId, { [key]: newVal }, effectiveDate || null);
    }
    cancelInlineEdit();
  };

  const suggestCloneId = () => makeCloneSuggestion(empId, existingEmpIds);

  const startClone = () => {
    setCloneId(suggestCloneId());
    setCloneError("");
    setCloning(true);
    setEditingKey(null);
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

  const jobTitle = record[jobTitleCol] || record["Job Title"] || empId;
  const initials = getInitials(jobTitle);
  const fteVal = fteCol ? Number(record[fteCol] || 0) : null;
  const costVal = flcCol ? Number(record[flcCol] || 0) : null;
  const countryVal = countryCol ? record[countryCol] : null;
  const mgmtLevel = record["Management Level"] || record["managementLevel"] || null;

  const pills = [];
  if (flagged) pills.push({ label: "Flagged", bg: AM.danger, color: "#fff" });
  if (mutationState?.added) pills.push({ label: mutationState?.cloned ? "Cloned" : "Added", bg: AM.success, color: "#fff" });
  else if (mutationState?.cloned) pills.push({ label: "Cloned", bg: AM.success, color: "#fff" });
  if (mutationState?.moved) pills.push({ label: "Moved", bg: "#2563eb", color: "#fff" });
  if (mutationState?.edited) pills.push({ label: "Edited", bg: "#d97706", color: "#fff" });

  return (
    <aside
      style={{
        width: 360,
        background: "#f8fafd",
        borderLeft: `1px solid ${AM.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        fontFamily: "Inter, system-ui, sans-serif",
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        boxShadow: "-4px 0 32px rgba(11, 35, 75, 0.10)",
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          padding: "0 16px",
          height: 46,
          borderBottom: `1px solid ${AM.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: AM.white,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: AM.gold,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 12, color: AM.navy, letterSpacing: "0.3px", textTransform: "uppercase" }}>
            Employee Details
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: `1px solid ${AM.border}`,
            color: AM.textSecondary,
            fontSize: 16,
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
            width: 28,
            height: 28,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Close detail panel"
          onMouseEnter={(e) => { e.currentTarget.style.background = AM.borderLight; e.currentTarget.style.color = AM.navy; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = AM.textSecondary; }}
        >
          ×
        </button>
      </div>

      {/* ── Hero card ── */}
      <div
        style={{
          background: flagged
            ? `linear-gradient(135deg, #8b0000 0%, ${AM.danger} 100%)`
            : `linear-gradient(135deg, ${AM.navy} 0%, ${AM.navyLight} 100%)`,
          padding: "20px 20px 18px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          {/* Avatar */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "rgba(197,168,74,0.22)",
              border: "1.5px solid rgba(197,168,74,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              color: AM.gold,
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "-0.5px",
            }}
          >
            {initials}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: AM.white,
                lineHeight: 1.35,
                marginBottom: 5,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {jobTitle}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.55)",
                  fontWeight: 400,
                }}
              >
                ID
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.85)",
                  fontWeight: 600,
                  letterSpacing: "0.3px",
                }}
              >
                {empId}
              </span>
              {mgmtLevel && (
                <>
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 9 }}>·</span>
                  <span
                    style={{
                      fontSize: 10,
                      color: AM.gold,
                      fontWeight: 600,
                      letterSpacing: "0.2px",
                    }}
                  >
                    {mgmtLevel}
                  </span>
                </>
              )}
            </div>

            {pills.length > 0 && (
              <div style={{ display: "flex", gap: 5, marginTop: 10, flexWrap: "wrap" }}>
                {pills.map(({ label, bg, color }) => (
                  <span
                    key={label}
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.6px",
                      textTransform: "uppercase",
                      background: bg,
                      color,
                      padding: "3px 8px",
                      borderRadius: 4,
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* KPI strip */}
        {(costVal != null || fteVal != null || countryVal) && (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 16,
            }}
          >
            {costVal != null && costVal > 0 && (
              <KpiChip
                label="Cost"
                value={fmtCompactCurrency(costVal)}
                accent={AM.gold}
              />
            )}
            {fteVal != null && (
              <KpiChip
                label="FTE"
                value={fmtNumber(fteVal)}
                accent="rgba(255,255,255,0.7)"
              />
            )}
            {countryVal && (
              <KpiChip
                label="Country"
                value={String(countryVal)}
                accent="rgba(255,255,255,0.7)"
              />
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ padding: "14px 16px", flex: 1, overflow: "auto" }}>

        {/* Validation issues banner */}
        {issues && issues.length > 0 && (
          <ValidationIssueBanner
            issues={issues}
            record={record}
            empCol={empCol}
            mgrCol={mgrCol}
            jobTitleCol={jobTitleCol}
            cycleGroups={cycleGroups}
            records={records}
            onMoveEmployee={onMoveEmployee}
            onEditEmployee={onEditEmployee}
            onFlagToggle={onFlagToggle}
            onIgnoreIssue={onIgnoreIssue}
            empId={empId}
          />
        )}

        {/* Edit mode action buttons */}
        {editMode && (
          <div style={{ marginBottom: 14 }}>
            {!cloning ? (
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <button onClick={startClone} disabled={flagged} style={ghostBtn(flagged)}>
                  Clone
                </button>
                <button
                  onClick={() => { onFlagToggle?.(empId, !flagged, effectiveDate || null); setEffectiveDate(""); }}
                  style={flagged ? successBtn() : dangerBtn()}
                >
                  {flagged ? "Restore" : "Flag"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={submitClone} style={primaryBtn(false)}>Create clone</button>
                <button onClick={() => { setCloning(false); setCloneError(""); }} style={ghostBtn()}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {/* Clone new ID input */}
        {cloning && (
          <div
            style={{
              marginBottom: 16,
              background: AM.white,
              border: `1px solid ${AM.border}`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <label style={fieldLabelStyle}>New employee ID</label>
            <input
              value={cloneId}
              onChange={(e) => { setCloneId(e.target.value); setCloneError(""); }}
              style={{
                ...inputStyle,
                borderColor: cloneError ? AM.danger : AM.border,
                fontFamily: "Inter, system-ui, sans-serif",
              }}
            />
            {cloneError && (
              <div style={{ fontSize: 11, color: AM.danger, marginTop: 5 }}>{cloneError}</div>
            )}
            <div style={{ fontSize: 11, color: AM.textMuted, marginTop: 8, lineHeight: 1.5 }}>
              Creates a copy under the same manager with identical role properties.
            </div>
          </div>
        )}

        {/* Effective date (edit mode) */}
        {editMode && !cloning && (
          <div style={{ marginBottom: 12 }}>
            <label style={fieldLabelStyle}>Effective Date</label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              style={{ ...inputStyle, fontFamily: "Inter, system-ui, sans-serif" }}
            />
          </div>
        )}

        {/* Rate card button */}
        {editMode && flcCol && rateCardActive && !cloning && (
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => onApplyRateCard?.(empId)} disabled={flagged} style={ghostBtn(flagged)}>
              Recalculate from rate card
            </button>
            {record.__rate_card_derived && (
              <div style={{ fontSize: 11, color: AM.success, marginTop: 6, fontWeight: 600 }}>
                Cost is rate-card derived
              </div>
            )}
          </div>
        )}

        {/* All fields table */}
        <div
          style={{
            background: AM.white,
            border: `1px solid ${AM.border}`,
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: `1px solid ${AM.borderLight}`,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: AM.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.8px",
              }}
            >
              All fields
            </span>
            <span
              style={{
                fontSize: 10,
                color: AM.textMuted,
                background: AM.borderLight,
                padding: "1px 6px",
                borderRadius: 10,
                fontWeight: 500,
              }}
            >
              {allFields.length}
            </span>
            {canInlineEdit && (
              <span style={{ fontSize: 10, color: AM.textMuted, marginLeft: "auto" }}>
                Click a value to edit
              </span>
            )}
          </div>

          {allFields.map(([k, v], idx) => {
            // The employee ID column is the primary key that drives the entire hierarchy
            // (reporting chains, drag-and-drop targets, etc.). Changing it would silently
            // break those references, so we treat it as permanently read-only here.
            const isIdField = k === empCol;
            const fieldEditable = canInlineEdit && !isIdField;

            return (
              <div
                key={k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 14px",
                  borderBottom: idx < allFields.length - 1 ? `1px solid ${AM.borderLight}` : "none",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f4f7fb"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    color: AM.textMuted,
                    flexShrink: 0,
                    fontWeight: 400,
                    maxWidth: 120,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  title={k}
                >
                  {k}
                  {isIdField && (
                    <span
                      title="Employee ID cannot be changed"
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: AM.textMuted,
                        background: AM.borderLight,
                        border: `1px solid ${AM.border}`,
                        borderRadius: 3,
                        padding: "1px 4px",
                        letterSpacing: "0.4px",
                        lineHeight: 1.4,
                        flexShrink: 0,
                      }}
                    >
                      ID
                    </span>
                  )}
                </span>
                {editingKey === k ? (
                  <input
                    autoFocus
                    value={inlineDraft}
                    onChange={(e) => setInlineDraft(e.target.value)}
                    onBlur={() => saveInlineEdit(k)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveInlineEdit(k);
                      if (e.key === "Escape") cancelInlineEdit();
                    }}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      maxWidth: 190,
                      padding: "4px 8px",
                      fontSize: 12,
                      fontFamily: "Inter, system-ui, sans-serif",
                      textAlign: "right",
                    }}
                  />
                ) : (
                  <span
                    onClick={() => fieldEditable && startInlineEdit(k, v)}
                    style={{
                      fontSize: 12,
                      color: AM.textPrimary,
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontWeight: 500,
                      textAlign: "right",
                      maxWidth: 190,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: fieldEditable ? "pointer" : "default",
                      borderRadius: 4,
                      padding: fieldEditable ? "2px 4px" : 0,
                    }}
                    title={fieldEditable ? `Click to edit: ${String(v ?? "")}` : String(v ?? "")}
                    onMouseEnter={(e) => {
                      if (fieldEditable) e.currentTarget.style.background = AM.borderLight;
                    }}
                    onMouseLeave={(e) => {
                      if (fieldEditable) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {formatVal(v)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Calculated columns (formula-derived) */}
        {formulas.length > 0 && record && (() => {
          const evalFormula = (expression, rec) => {
            try {
              const cols = Object.keys(rec).sort((a, b) => b.length - a.length);
              let expr = expression;
              const vals = {};
              cols.forEach((col) => {
                const safe = col.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "col_$1") || "col_x";
                vals[safe] = parseFloat(rec[col]) || 0;
                expr = expr.split(col).join(safe);
              });
              expr = expr.replace(/\^/g, "**");
              if (/[^0-9a-zA-Z_\s+\-*/.()^]/.test(expr)) return null;
              const fn = new Function(...Object.keys(vals), `"use strict"; return (${expr});`);
              const result = fn(...Object.values(vals));
              return isFinite(result) ? Math.round(result * 10000) / 10000 : null;
            } catch { return null; }
          };

          return (
            <div
              style={{
                marginTop: 10,
                background: "rgba(13,107,95,0.04)",
                border: "1px solid rgba(13,107,95,0.15)",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid rgba(13,107,95,0.12)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#0D6B5F",
                    textTransform: "uppercase",
                    letterSpacing: "0.8px",
                  }}
                >
                  Calculated
                </span>
              </div>

              {formulas.map((formula, idx) => {
                const val = evalFormula(formula.expression, record);
                return (
                  <div
                    key={formula.id || formula.col_name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 14px",
                      borderBottom: idx < formulas.length - 1 ? "1px solid rgba(13,107,95,0.08)" : "none",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "#0a5549",
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {formula.col_name}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: val !== null ? "#0D6B5F" : AM.textMuted,
                        fontFamily: "Inter, system-ui, sans-serif",
                        fontWeight: 600,
                        textAlign: "right",
                      }}
                    >
                      {val !== null ? val.toLocaleString() : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Bottom padding */}
        <div style={{ height: 16 }} />
      </div>
    </aside>
  );
}

/* ── KPI chip ── */
function KpiChip({ label, value, accent }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "rgba(255,255,255,0.09)",
        border: "1px solid rgba(255,255,255,0.13)",
        borderRadius: 8,
        padding: "8px 10px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: accent,
          fontFamily: "Inter, system-ui, sans-serif",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "rgba(255,255,255,0.45)",
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function getInitials(title) {
  const words = String(title || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]?.toUpperCase() ?? "?";
  return (words[0][0] + words[1][0]).toUpperCase();
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

/* ── Shared style objects ── */
const fieldLabelStyle = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: AM.textSecondary,
  textTransform: "uppercase",
  letterSpacing: "0.6px",
  marginBottom: 4,
  fontFamily: "Inter, system-ui, sans-serif",
};

const inputStyle = {
  width: "100%",
  border: `1px solid ${AM.border}`,
  borderRadius: 7,
  padding: "7px 10px",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
  color: AM.textPrimary,
  background: AM.white,
};

function primaryBtn(disabled) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    background: disabled ? AM.borderLight : AM.navy,
    color: disabled ? AM.textMuted : AM.white,
    border: "none",
    borderRadius: 7,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "Inter, system-ui, sans-serif",
  };
}
function dangerBtn() {
  return {
    flex: 1,
    background: "#fff0f0",
    color: AM.danger,
    border: `1px solid ${AM.danger}`,
    borderRadius: 7,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "Inter, system-ui, sans-serif",
  };
}
function successBtn() {
  return {
    flex: 1,
    background: AM.successLight,
    color: AM.success,
    border: `1px solid ${AM.success}`,
    borderRadius: 7,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "Inter, system-ui, sans-serif",
  };
}
function ghostBtn(disabled = false) {
  return {
    flex: 1,
    background: disabled ? AM.borderLight : AM.white,
    color: disabled ? AM.textMuted : AM.textSecondary,
    border: `1px solid ${AM.border}`,
    borderRadius: 7,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "Inter, system-ui, sans-serif",
  };
}

/* ── Shared style objects ── */

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
  jobTitleCol,
  cycleGroups = [],
  records,
  onMoveEmployee,
  onEditEmployee,
  onFlagToggle,
  onIgnoreIssue,
  empId,
}) {
  const hasError = issues.some((i) => i.severity === "error");
  const bgColor  = hasError ? "#fef2f2" : "#fffbeb";
  const border   = hasError ? "#fca5a5" : "#fcd34d";
  const titleClr = hasError ? AM.danger : "#92400e";

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

  const labelMap = new Map();
  if (records) {
    for (const r of records) {
      const eid = String(r.__emp_id ?? r[empCol] ?? "");
      if (!eid) continue;
      const title = (jobTitleCol && r[jobTitleCol]) ? String(r[jobTitleCol]).trim() : "";
      labelMap.set(eid, title || eid);
    }
  }

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${border}`,
        borderRadius: 9,
        padding: "10px 12px",
        marginBottom: 12,
        fontSize: 12,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: titleClr, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {issues.length} Validation Issue{issues.length !== 1 ? "s" : ""}
        </span>
        {onIgnoreIssue && (
          <button
            onClick={() => issues.forEach((issue) => onIgnoreIssue(issue))}
            title="Hide all validation issues on this position (data isn't changed)"
            style={{
              background: "none", border: `1px solid ${border}`, borderRadius: 6,
              color: titleClr, cursor: "pointer",
              fontSize: 9, fontWeight: 700, padding: "2px 7px", lineHeight: 1.4,
              textTransform: "uppercase", letterSpacing: "0.3px",
            }}
          >
            Ignore all
          </button>
        )}
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
          cycleGroups={cycleGroups}
          labelMap={labelMap}
          onMoveEmployee={onMoveEmployee}
          onEditEmployee={onEditEmployee}
          onFlagToggle={onFlagToggle}
          onIgnoreIssue={onIgnoreIssue}
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
  cycleGroups = [],
  labelMap = new Map(),
  onMoveEmployee,
  onEditEmployee,
  onFlagToggle,
  onIgnoreIssue,
}) {
  const [newReason, setNewReason] = useState("");
  const [newMgr, setNewMgr] = useState("");
  const [newId, setNewId] = useState("");
  const [saving, setSaving] = useState(false);
  const [mgrQuery, setMgrQuery] = useState("");
  const [mgrDropOpen, setMgrDropOpen] = useState(false);

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
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: AM.textPrimary, fontFamily: "Inter, system-ui, sans-serif" }}>{label}</div>
          <div style={{ fontSize: 10, color: AM.textSecondary, marginTop: 1, fontFamily: "Inter, system-ui, sans-serif" }}>{issue.description}</div>
        </div>
        {onIgnoreIssue && (
          <button
            onClick={() => onIgnoreIssue(issue)}
            title="Ignore this issue"
            style={{
              flexShrink: 0,
              background: "none", border: `1px solid ${AM.border}`, borderRadius: 6,
              color: AM.textMuted, cursor: "pointer",
              fontSize: 9, fontWeight: 700, padding: "2px 6px", lineHeight: 1.4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = AM.textPrimary; e.currentTarget.style.borderColor = AM.textMuted; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = AM.textMuted; e.currentTarget.style.borderColor = AM.border; }}
          >
            Ignore
          </button>
        )}
      </div>

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

      {issue.type === "circular_reference" && (() => {
        const myGroup = cycleGroups.find((g) => g.includes(empId));
        const filteredMgrs = managerOptions.filter((o) => {
          if (!mgrQuery.trim()) return true;
          const q = mgrQuery.toLowerCase();
          return o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q);
        }).slice(0, 8);
        return (
          <div style={{ marginTop: 6 }}>
            {myGroup && myGroup.length > 0 && (
              <div style={{
                background: "#fff1f1", border: "1px dashed #fca5a5",
                borderRadius: 6, padding: "8px 10px", marginBottom: 8,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: AM.danger, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Cycle chain
                </div>
                {myGroup.map((id, idx) => (
                  <div key={id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{
                        fontSize: 10, fontWeight: id === empId ? 800 : 600,
                        color: id === empId ? AM.danger : AM.navy,
                        background: id === empId ? "#fee2e2" : "transparent",
                        borderRadius: 4, padding: id === empId ? "1px 5px" : "0",
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}>
                        {labelMap.get(id) || id}
                      </span>
                      <span style={{ fontSize: 9, color: AM.textMuted, fontFamily: "Inter, system-ui, sans-serif" }}>
                        {id}
                      </span>
                      {id === empId && (
                        <span style={{ fontSize: 9, color: AM.danger, fontWeight: 700 }}>← you</span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: AM.danger, opacity: 0.6, paddingLeft: 4, margin: "1px 0" }}>
                      {idx < myGroup.length - 1 ? "↓ reports to" : "↓ reports to (back to start ↑)"}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 10, color: AM.textSecondary, marginBottom: 4, fontFamily: "Inter, system-ui, sans-serif" }}>
              Reassign <strong>this position</strong>'s manager to break the cycle:
            </div>
            <div style={{ position: "relative", display: "flex", gap: 5 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  value={mgrQuery}
                  onChange={(e) => { setMgrQuery(e.target.value); setMgrDropOpen(true); }}
                  onFocus={() => setMgrDropOpen(true)}
                  onBlur={() => setTimeout(() => setMgrDropOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setMgrDropOpen(false); }
                    if (e.key === "Enter" && filteredMgrs.length === 1) { applyMgrChange(empId, filteredMgrs[0].id); setMgrQuery(""); setMgrDropOpen(false); }
                  }}
                  placeholder="Search by name or ID…"
                  style={miniInput()}
                />
                {mgrDropOpen && filteredMgrs.length > 0 && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 4px)", left: 0,
                    right: 0, background: "#fff",
                    border: `1px solid ${AM.border}`, borderRadius: 8,
                    boxShadow: "0 4px 16px rgba(1,36,74,0.15)", zIndex: 500, overflow: "hidden",
                  }}>
                    {filteredMgrs.map((o) => (
                      <button key={o.id}
                        onMouseDown={() => { applyMgrChange(empId, o.id); setMgrQuery(""); setMgrDropOpen(false); }}
                        style={{
                          display: "block", width: "100%", padding: "6px 10px",
                          textAlign: "left", background: "none", border: "none",
                          borderBottom: `1px solid ${AM.borderLight}`,
                          cursor: "pointer", fontSize: 11,
                          fontFamily: "Inter, system-ui, sans-serif",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = AM.borderLight)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                      >
                        <span style={{ fontWeight: 600, color: AM.navy }}>{o.label}</span>
                        <span style={{ marginLeft: 5, fontSize: 9, color: AM.textMuted }}>{o.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {(issue.type === "orphaned_position" || issue.type === "self_report") && (
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
          <div style={{ fontSize: 10, color: AM.textMuted, marginBottom: 4, fontFamily: "Inter, system-ui, sans-serif" }}>
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
    fontFamily: "Inter, system-ui, sans-serif",
    outline: "none",
    minWidth: 0,
    background: AM.white,
    color: AM.textPrimary,
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
    fontFamily: "Inter, system-ui, sans-serif",
  };
}
