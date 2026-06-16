import React, { useEffect, useMemo, useState } from "react";
import { AM } from "./orgChartTheme";

/**
 * Modal for creating a brand-new employee under a chosen manager. Fields are
 * generated from the user's column mapping so the user only enters what's
 * relevant for their dataset.
 */
export default function OrgAddChildModal({
  open,
  parentRecord,
  empCol,
  mgrCol,
  jobTitleCol,
  fteCol,
  flcCol,
  countryCol,
  rateCardPropertyCols = [],
  onLookupRateCard,
  onClose,
  onSubmit,
}) {
  const [empId, setEmpId] = useState("");
  const [title, setTitle] = useState("");
  const [fte, setFte] = useState("1.0");
  const [flc, setFlc] = useState("");
  const [country, setCountry] = useState("");
  const [propValues, setPropValues] = useState({});
  const [rateCardDerived, setRateCardDerived] = useState(false);
  const [lookupNote, setLookupNote] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [error, setError] = useState("");

  const propertyCols = useMemo(
    () => (rateCardPropertyCols || []).filter((c) => c && c !== flcCol),
    [rateCardPropertyCols, flcCol]
  );

  useEffect(() => {
    if (!open) return;
    setEmpId("");
    setTitle("");
    setFte("1.0");
    setFlc("");
    setCountry("");
    setPropValues({});
    setRateCardDerived(false);
    setLookupNote("");
    setError("");
  }, [open]);

  useEffect(() => {
    if (!open || !propertyCols.length || !onLookupRateCard) return;
    const values = {};
    propertyCols.forEach((col) => {
      values[col] = propValues[col] ?? "";
    });
    const ready = propertyCols.every((col) => String(values[col] || "").trim());
    if (!ready) {
      setLookupNote("");
      return;
    }
    let cancelled = false;
    (async () => {
      const lookup = await onLookupRateCard(values);
      if (cancelled) return;
      if (lookup?.cost != null) {
        setFlc(String(Math.round(lookup.cost)));
        setRateCardDerived(true);
        setLookupNote(`Rate card (${String(lookup.quartile || "p50").toUpperCase()}) · ${lookup.composite_key}`);
      } else {
        setRateCardDerived(false);
        setLookupNote("No rate card match for this combination");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, propValues, propertyCols, onLookupRateCard]);

  if (!open) return null;

  const parentId = String(parentRecord.__emp_id ?? parentRecord[empCol] ?? "");
  const parentLevel = Number(parentRecord.Level) || 0;

  const reset = () => {
    setEmpId("");
    setTitle("");
    setFte("1.0");
    setFlc("");
    setCountry("");
    setPropValues({});
    setRateCardDerived(false);
    setLookupNote("");
    setEffectiveDate("");
    setError("");
  };

  const submit = () => {
    if (!empId.trim()) {
      setError("Employee ID is required");
      return;
    }
    const record = {
      [empCol]: empId.trim(),
      [mgrCol]: parentId,
      Level: parentLevel + 1,
    };
    if (jobTitleCol) record[jobTitleCol] = title || "(New role)";
    if (fteCol) record[fteCol] = Number(fte) || 0;
    if (flcCol) record[flcCol] = Number(flc) || 0;
    if (countryCol && country) record[countryCol] = country;
    propertyCols.forEach((col) => {
      if (propValues[col]) record[col] = propValues[col];
    });

    onSubmit({
      record,
      emp_id: empId.trim(),
      mgr_id: parentId,
      level: parentLevel + 1,
      fte: Number(fte) || 0,
      flc: Number(flc) || 0,
      rate_card_derived: rateCardDerived,
      effective_date: effectiveDate || null,
    });
    reset();
  };

  return (
    <div
      onClick={() => { reset(); onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(1,36,74,0.55)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: AM.white,
          width: 420,
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 30px 60px rgba(1,36,74,0.25)",
        }}
      >
        <div
          style={{
            background: AM.navy,
            color: AM.white,
            padding: "14px 18px",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14 }}>Add direct report</div>
          <div style={{ fontSize: 11, color: "#a8c0d8", marginTop: 2 }}>
            under {parentRecord[jobTitleCol] || parentId} ({parentId})
          </div>
        </div>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Employee ID *">
            <input value={empId} onChange={(e) => setEmpId(e.target.value)} style={inputStyle()} />
          </Field>
          {jobTitleCol && (
            <Field label="Job title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle()} />
            </Field>
          )}
          {propertyCols.map((col) => (
            <Field key={col} label={col}>
              <input
                value={propValues[col] ?? ""}
                onChange={(e) => {
                  setPropValues((prev) => ({ ...prev, [col]: e.target.value }));
                  setRateCardDerived(false);
                }}
                style={inputStyle()}
              />
            </Field>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {fteCol && (
              <Field label="FTE">
                <input
                  type="number"
                  step="0.1"
                  value={fte}
                  onChange={(e) => setFte(e.target.value)}
                  style={inputStyle()}
                />
              </Field>
            )}
            {flcCol && (
              <Field label="Cost (FLC)">
                <input
                  type="number"
                  step="1000"
                  value={flc}
                  onChange={(e) => {
                    setFlc(e.target.value);
                    setRateCardDerived(false);
                    setLookupNote("");
                  }}
                  style={inputStyle()}
                />
              </Field>
            )}
          </div>
          {rateCardDerived && (
            <div style={{ fontSize: 11, color: AM.success, fontWeight: 600 }}>Rate card derived</div>
          )}
          {lookupNote && !rateCardDerived && (
            <div style={{ fontSize: 11, color: AM.textMuted }}>{lookupNote}</div>
          )}
          {lookupNote && rateCardDerived && (
            <div style={{ fontSize: 11, color: AM.textSecondary }}>{lookupNote}</div>
          )}
          {countryCol && (
            <Field label="Country">
              <input value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle()} />
            </Field>
          )}
          <Field label="Effective date">
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              style={inputStyle()}
            />
          </Field>
          {error && (
            <div style={{ color: AM.danger, fontSize: 11, fontWeight: 600 }}>{error}</div>
          )}
        </div>
        <div style={{ padding: "12px 18px", display: "flex", gap: 8, borderTop: `1px solid ${AM.border}` }}>
          <button
            onClick={() => { reset(); onClose(); }}
            style={{ ...btn(), background: AM.borderLight, color: AM.textSecondary }}
          >
            Cancel
          </button>
          <button onClick={submit} style={{ ...btn(), background: AM.navy, color: AM.white, flex: 1 }}>
            Add report
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: AM.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

function inputStyle() {
  return {
    width: "100%",
    border: `1px solid ${AM.border}`,
    borderRadius: 6,
    padding: "7px 10px",
    fontSize: 12,
    outline: "none",
    fontFamily: "'IBM Plex Sans', sans-serif",
    boxSizing: "border-box",
  };
}

function btn() {
  return {
    border: "none",
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
