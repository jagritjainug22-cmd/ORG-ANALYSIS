import React, { useEffect, useMemo, useState } from "react";
import { AM } from "./orgChartTheme";

/**
 * Modal for creating a brand-new employee under a chosen manager.
 *
 * Rate card awareness:
 * - Fields that belong to the rate card property columns get a gold "● Rate card"
 *   pill in their label so the user knows those fields drive cost auto-fill.
 * - Dedicated fields (Job Title, Country) that happen to be rate card property
 *   cols are NOT duplicated — their values are injected into the lookup dict.
 * - The lookup fires only when ALL rate card property cols are filled.
 * - Cost (FLC) is placed at the bottom since it is derived from the other fields.
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
  const [lookingUp, setLookingUp] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [error, setError] = useState("");

  // Columns that have their own dedicated input (never rendered as dynamic fields)
  const dedicatedCols = useMemo(
    () => new Set([flcCol, jobTitleCol, countryCol, empCol, mgrCol].filter(Boolean)),
    [flcCol, jobTitleCol, countryCol, empCol, mgrCol]
  );

  // Dynamic property fields = rate card cols that don't have a dedicated input
  const propertyCols = useMemo(
    () => (rateCardPropertyCols || []).filter((c) => c && !dedicatedCols.has(c)),
    [rateCardPropertyCols, dedicatedCols]
  );

  // Which dedicated-field cols are also rate card property cols (need the gold pill)
  const rcSet = useMemo(() => new Set(rateCardPropertyCols || []), [rateCardPropertyCols]);
  const hasRateCard = rcSet.size > 0 && !!onLookupRateCard;

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
    setLookingUp(false);
    setError("");
  }, [open]);

  // FIX 1+2+3: Build complete values dict including dedicated fields, gate on
  // ALL rateCardPropertyCols, depend on title/country so re-fires when they change.
  useEffect(() => {
    if (!open || !hasRateCard) return;

    // Merge dynamic propValues with dedicated field values (when they're in the rate card)
    const allValues = { ...propValues };
    if (jobTitleCol && rcSet.has(jobTitleCol)) allValues[jobTitleCol] = title;
    if (countryCol  && rcSet.has(countryCol))  allValues[countryCol]  = country;

    // Gate: every rate card property col must be filled before firing
    const ready = rateCardPropertyCols.every(
      (col) => String(allValues[col] || "").trim() !== ""
    );

    if (!ready) {
      setLookupNote("");
      setLookingUp(false);
      return;
    }

    let cancelled = false;
    setLookingUp(true);
    setLookupNote("");
    (async () => {
      const lookup = await onLookupRateCard(allValues);
      if (cancelled) return;
      setLookingUp(false);
      if (lookup?.cost != null) {
        setFlc(String(Math.round(lookup.cost)));
        setRateCardDerived(true);
        setLookupNote(
          `Rate card (${String(lookup.quartile || "p50").toUpperCase()}) · ${lookup.composite_key}`
        );
      } else {
        setRateCardDerived(false);
        setLookupNote("No rate card match for this combination");
      }
    })();
    return () => { cancelled = true; };
  // FIX 3: title and country in deps so lookup re-fires when dedicated fields change
  }, [open, propValues, title, country, rateCardPropertyCols, jobTitleCol, countryCol, onLookupRateCard, hasRateCard, rcSet]);

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
    setLookingUp(false);
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
    if (fteCol)      record[fteCol]      = Number(fte) || 0;
    if (flcCol)      record[flcCol]      = Number(flc) || 0;
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
        position: "fixed", inset: 0, background: "rgba(1,36,74,0.55)",
        zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: AM.white, width: 420, borderRadius: 12,
          overflow: "hidden", boxShadow: "0 30px 60px rgba(1,36,74,0.25)",
          maxHeight: "92vh", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ background: AM.navy, color: AM.white, padding: "14px 18px", flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Add direct report</div>
          <div style={{ fontSize: 11, color: "#a8c0d8", marginTop: 2 }}>
            under {parentRecord[jobTitleCol] || parentId} ({parentId})
          </div>
          {/* FIX 5: Rate card hint in header */}
          {hasRateCard && (
            <div style={{
              marginTop: 8, padding: "5px 10px", borderRadius: 6,
              background: "rgba(197,168,74,0.18)", display: "flex",
              alignItems: "center", gap: 6,
            }}>
              <span style={{ fontSize: 10, color: AM.gold, fontWeight: 800 }}>●</span>
              <span style={{ fontSize: 10, color: "#f0dfa0", fontWeight: 600 }}>
                Rate card needs: {rateCardPropertyCols.join(", ")}
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1 }}>
          <Field label="Employee ID *">
            <input value={empId} onChange={(e) => setEmpId(e.target.value)} style={inputStyle()} />
          </Field>

          {/* FIX 5: Gold pill on Job Title if it's a rate card property */}
          {jobTitleCol && (
            <Field label="Job title" rcPill={rcSet.has(jobTitleCol) && hasRateCard}>
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); setRateCardDerived(false); }}
                style={inputStyle()}
              />
            </Field>
          )}

          {/* Dynamic property cols (not dedicated fields) — all get the gold pill */}
          {propertyCols.map((col) => (
            <Field key={col} label={col} rcPill={hasRateCard}>
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

          {/* FIX 4: Country BEFORE cost since cost is derived */}
          {/* FIX 5: Gold pill on Country if it's a rate card property */}
          {countryCol && (
            <Field label="Country" rcPill={rcSet.has(countryCol) && hasRateCard}>
              <input
                value={country}
                onChange={(e) => { setCountry(e.target.value); setRateCardDerived(false); }}
                style={inputStyle()}
              />
            </Field>
          )}

          {/* FIX 4: FTE + Cost at bottom — cost is derived output */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {fteCol && (
              <Field label="FTE">
                <input
                  type="number" step="0.1" value={fte}
                  onChange={(e) => setFte(e.target.value)}
                  style={inputStyle()}
                />
              </Field>
            )}
            {flcCol && (
              <Field label={lookingUp ? "Cost (FLC) — checking…" : "Cost (FLC)"}>
                <input
                  type="number" step="1000" value={flc}
                  disabled={lookingUp}
                  onChange={(e) => {
                    setFlc(e.target.value);
                    setRateCardDerived(false);
                    setLookupNote("");
                  }}
                  style={{
                    ...inputStyle(),
                    background: lookingUp ? AM.borderLight : rateCardDerived ? "rgba(0,160,80,0.05)" : AM.white,
                    color: lookingUp ? AM.textMuted : AM.textPrimary,
                    cursor: lookingUp ? "wait" : "auto",
                    border: rateCardDerived ? `1px solid ${AM.success}` : `1px solid ${AM.border}`,
                  }}
                />
              </Field>
            )}
          </div>

          {/* Lookup status */}
          {lookupNote && (
            <div style={{
              fontSize: 11, fontWeight: 600,
              color: rateCardDerived ? AM.success : AM.textMuted,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {rateCardDerived && <span>✓</span>}
              {lookupNote}
            </div>
          )}

          <Field label="Effective date">
            <input
              type="date" value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              style={inputStyle()}
            />
          </Field>

          {error && (
            <div style={{ color: AM.danger, fontSize: 11, fontWeight: 600 }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 18px", display: "flex", gap: 8, borderTop: `1px solid ${AM.border}`, flexShrink: 0 }}>
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

// FIX 5: Field accepts optional rcPill prop to show the gold rate card indicator
function Field({ label, children, rcPill }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: AM.textMuted,
        textTransform: "uppercase", letterSpacing: "0.6px",
        marginBottom: 4, display: "flex", alignItems: "center", gap: 6,
      }}>
        {label}
        {rcPill && (
          <span style={{
            fontSize: 9, fontWeight: 800,
            color: "#9a7a10",
            background: "rgba(197,168,74,0.18)",
            borderRadius: 8,
            padding: "1px 6px",
            letterSpacing: "0.04em",
            textTransform: "none",
            display: "inline-flex", alignItems: "center", gap: 3,
          }}>
            ● rate card
          </span>
        )}
      </div>
      {children}
    </label>
  );
}

function inputStyle() {
  return {
    width: "100%", border: `1px solid ${AM.border}`,
    borderRadius: 6, padding: "7px 10px", fontSize: 12,
    outline: "none", fontFamily: "'IBM Plex Sans', sans-serif",
    boxSizing: "border-box",
  };
}

function btn() {
  return {
    border: "none", borderRadius: 6, padding: "8px 14px",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
  };
}
