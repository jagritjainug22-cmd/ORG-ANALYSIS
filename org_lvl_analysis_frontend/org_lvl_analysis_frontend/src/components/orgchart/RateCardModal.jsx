import React, { useEffect, useMemo, useState } from "react";
import { AM } from "./orgChartTheme";
import { fmtCompactCurrency } from "./orgChartLayout";

/**
 * Create or preview a dataset rate card from baseline property combinations.
 *
 * - Only shows columns that actually exist in the dataset (from columnMeta).
 * - Columns are grouped: "Good for grouping" (dimensions) | "Measures / costs" | "Other".
 * - Each chip shows its unique value count so users know cardinality before selecting.
 * - Cost column is automatically excluded from the property picker.
 * - "Not available" rows keep their input visible at all times.
 */
export default function RateCardModal({
  open,
  onClose,
  datasetId,
  flcCol,
  columns = [],           // string[] — real dataset columns
  columnMeta = {},        // { [col]: { unique_count, sample_values, is_dimension, is_cost, is_id, is_flag } }
  onCreated,
  dbPreviewRateCard,
  dbGenerateRateCard,
  dbPatchRateCardRow,
}) {
  const [name, setName] = useState("Modelling Rate Card");
  const [selectedProps, setSelectedProps] = useState([]);
  const [costCol, setCostCol] = useState(flcCol || "");
  const [previewRows, setPreviewRows] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [manualEdits, setManualEdits] = useState({});

  useEffect(() => {
    if (!open) return;
    setName("Modelling Rate Card");
    setSelectedProps([]);
    setCostCol(flcCol || "");
    setPreviewRows([]);
    setManualEdits({});
    setError("");
  }, [open, flcCol]);

  // Derive cost column options — prefer cost/measure columns
  const costCols = useMemo(() => {
    const costFirst = columns.filter((c) => columnMeta[c]?.is_cost);
    const others = columns.filter((c) => !columnMeta[c]?.is_cost);
    return [...costFirst, ...others];
  }, [columns, columnMeta]);

  // Auto-select a sensible default cost column when data arrives
  useEffect(() => {
    if (!open || costCol || costCols.length === 0) return;
    const best = costCols.find((c) => columnMeta[c]?.is_cost) || costCols[0];
    if (best) setCostCol(best);
  }, [open, costCols, costCol, columnMeta]);

  // Grouped columns for the property picker
  const { dimensionCols, otherCols } = useMemo(() => {
    const dims = [];
    const rest = [];
    for (const col of columns) {
      if (col === costCol) continue; // never show the selected cost col as a property
      const meta = columnMeta[col] || {};
      if (meta.is_id || meta.is_flag) continue; // skip ID / FLAG_ columns entirely
      if (meta.is_dimension) dims.push(col);
      else rest.push(col);
    }
    return { dimensionCols: dims, otherCols: rest };
  }, [columns, columnMeta, costCol]);

  if (!open) return null;

  const toggleProp = (col) => {
    setSelectedProps((prev) => {
      if (prev.includes(col)) return prev.filter((c) => c !== col);
      if (prev.length >= 3) return prev;
      return [...prev, col];
    });
  };

  const autoSuggest = () => {
    // pick up to 3 dimension cols with highest (but not too high) cardinality
    const scored = dimensionCols
      .map((c) => ({ c, n: columnMeta[c]?.unique_count || 0 }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((x) => x.c);
    setSelectedProps(scored);
  };

  const runPreview = async () => {
    if (!selectedProps.length) {
      setError("Select at least one grouping property");
      return;
    }
    if (!costCol) {
      setError("Select a cost column");
      return;
    }
    setPreviewing(true);
    setError("");
    setManualEdits({});
    try {
      const resp = await dbPreviewRateCard(datasetId, {
        property_cols: selectedProps,
        cost_col: costCol,
        min_sample: 3,
      });
      setPreviewRows(resp.rows || []);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const availableCount = previewRows.filter((r) => r.is_available).length;
  const unavailableCount = previewRows.filter((r) => !r.is_available).length;
  const filledCount = Object.values(manualEdits).filter((v) => String(v).trim() !== "").length;

  const save = async () => {
    if (!name.trim()) { setError("Rate card name is required"); return; }
    if (!selectedProps.length || !previewRows.length) { setError("Preview the rate card before saving"); return; }
    setSaving(true);
    setError("");
    try {
      const resp = await dbGenerateRateCard(datasetId, {
        name: name.trim(),
        property_cols: selectedProps,
        cost_col: costCol,
        min_sample: 3,
      });
      const rateCardId = resp.rate_card?.id;
      const manualKeys = Object.entries(manualEdits).filter(([, v]) => String(v).trim() !== "");
      if (rateCardId && manualKeys.length) {
        await Promise.all(
          manualKeys.map(([composite_key, raw]) => {
            const val = Number(raw);
            return dbPatchRateCardRow?.(datasetId, rateCardId, {
              composite_key, p50: val, p25: val, p75: val, avg_cost: val,
            });
          })
        );
      }
      onCreated?.(resp.rate_card);
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to create rate card");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(1,36,74,0.55)",
        zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: AM.white, width: "min(980px, 96vw)", maxHeight: "92vh",
          borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 30px 60px rgba(1,36,74,0.25)",
        }}
      >
        {/* Header */}
        <div style={{ background: AM.navy, color: AM.white, padding: "14px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Create rate card</div>
          <div style={{ fontSize: 11, color: "#a8c0d8", marginTop: 2 }}>
            Auto-generate indicative costs from baseline data grouped by property combination
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Step 1 — Name + cost column */}
          <Section step="1" title="Name & cost measure">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label style={labelStyle()}>
                Rate card name
                <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} />
              </label>
              <label style={labelStyle()}>
                Cost column
                <div style={{ fontSize: 11, color: AM.textMuted, marginTop: 2, marginBottom: 4 }}>
                  The numeric field to average per group
                </div>
                <select value={costCol} onChange={(e) => { setCostCol(e.target.value); setPreviewRows([]); }} style={inputStyle()}>
                  {costCols.map((c) => (
                    <option key={c} value={c}>{c}{columnMeta[c]?.is_cost ? "  ✓ cost" : ""}</option>
                  ))}
                </select>
              </label>
            </div>
          </Section>

          {/* Step 2 — Property picker */}
          <Section step="2" title="Select grouping properties (max 3)">
            <div style={{ fontSize: 11, color: AM.textMuted, marginBottom: 12, lineHeight: 1.6 }}>
              Pick up to 3 columns that describe <strong>what kind of role</strong> a position is — e.g. Country, Grade, Division.
              The app will group baseline employees by every unique combination and compute P25/P50/P75.
              Only columns that exist in your dataset are shown.
            </div>

            {/* Auto-suggest */}
            {dimensionCols.length > 0 && (
              <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={autoSuggest}
                  style={{
                    border: `1px dashed ${AM.border}`,
                    background: "rgba(1,36,74,0.04)",
                    color: AM.navy,
                    borderRadius: 6,
                    padding: "5px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  ✦ Auto-suggest best 3
                </button>
                {selectedProps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setSelectedProps([]); setPreviewRows([]); }}
                    style={{
                      border: "none", background: "transparent",
                      color: AM.textMuted, fontSize: 11, cursor: "pointer", textDecoration: "underline",
                    }}
                  >
                    Clear
                  </button>
                )}
                {selectedProps.length > 0 && (
                  <span style={{ fontSize: 11, color: AM.textSecondary }}>
                    <strong>{selectedProps.join(" × ")}</strong>
                  </span>
                )}
              </div>
            )}

            {/* Dimension columns */}
            {dimensionCols.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={groupLabel("Good for grouping")}>
                  Recommended — categorical / low-cardinality
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {dimensionCols.map((col) => (
                    <ColChip
                      key={col}
                      col={col}
                      meta={columnMeta[col]}
                      active={selectedProps.includes(col)}
                      maxed={selectedProps.length >= 3 && !selectedProps.includes(col)}
                      onClick={() => { toggleProp(col); setPreviewRows([]); }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Other columns */}
            {otherCols.length > 0 && (
              <div>
                <div style={groupLabel("Other columns")}>
                  Other — high cardinality or text fields (use with care)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {otherCols.map((col) => (
                    <ColChip
                      key={col}
                      col={col}
                      meta={columnMeta[col]}
                      active={selectedProps.includes(col)}
                      maxed={selectedProps.length >= 3 && !selectedProps.includes(col)}
                      onClick={() => { toggleProp(col); setPreviewRows([]); }}
                      muted
                    />
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Preview button */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={runPreview}
              disabled={previewing || selectedProps.length === 0 || !costCol}
              style={btnPrimary(previewing || selectedProps.length === 0 || !costCol)}
            >
              {previewing ? "Previewing…" : `Preview combinations${selectedProps.length > 0 ? ` (${selectedProps.join(" × ")})` : ""}`}
            </button>
          </div>

          {/* Step 3 — Preview table */}
          {previewRows.length > 0 && (
            <Section step="3" title="Review & fill gaps">
              {/* Summary bar */}
              <div style={{
                display: "flex", gap: 20, marginBottom: 12, padding: "8px 12px",
                background: AM.borderLight, borderRadius: 8, fontSize: 11, alignItems: "center", flexWrap: "wrap",
              }}>
                <span><strong style={{ color: AM.navy }}>{previewRows.length}</strong> combinations</span>
                <span style={{ color: AM.success }}><strong>{availableCount}</strong> auto-computed</span>
                {unavailableCount > 0 && (
                  <span style={{ color: AM.warning }}>
                    <strong>{unavailableCount}</strong> need manual cost
                    {filledCount > 0 && <span style={{ color: AM.success }}> · {filledCount} filled</span>}
                  </span>
                )}
                <span style={{ marginLeft: "auto", color: AM.textMuted }}>
                  grouped by <em>{selectedProps.join(" × ")}</em> · cost = <em>{costCol}</em>
                </span>
              </div>

              <div style={{ border: `1px solid ${AM.border}`, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ overflow: "auto", maxHeight: 340 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: AM.navy, color: AM.white, position: "sticky", top: 0, zIndex: 1 }}>
                        <Th>Combination</Th>
                        <Th right>P25</Th>
                        <Th right light>P50 (default)</Th>
                        <Th right>P75</Th>
                        <Th right>Sample</Th>
                        <Th right>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => {
                        const isUnavailable = !row.is_available;
                        const editVal = manualEdits[row.composite_key] ?? "";
                        const hasManual = editVal.trim() !== "";

                        return (
                          <tr
                            key={row.composite_key}
                            style={{
                              borderTop: `1px solid ${AM.borderLight}`,
                              background: isUnavailable
                                ? hasManual ? "rgba(0,160,80,0.05)" : "rgba(255,170,0,0.04)"
                                : AM.white,
                            }}
                          >
                            <Td mono>
                              <span title={row.composite_key}>{row.composite_key}</span>
                            </Td>
                            <Td right mono muted={isUnavailable}>
                              {isUnavailable ? "—" : fmtCell(row.p25)}
                            </Td>
                            <Td right>
                              {isUnavailable ? (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Enter cost"
                                    value={editVal}
                                    onChange={(e) => {
                                      const raw = e.target.value.replace(/[^0-9.]/g, "");
                                      setManualEdits((prev) => ({ ...prev, [row.composite_key]: raw }));
                                    }}
                                    style={{
                                      width: 130, border: `1px solid ${hasManual ? AM.success : AM.warning}`,
                                      borderRadius: 5, padding: "5px 8px", fontSize: 12,
                                      fontFamily: "'IBM Plex Mono', monospace",
                                      outline: "none", textAlign: "right",
                                      background: hasManual ? "rgba(0,160,80,0.06)" : AM.white,
                                      color: AM.textPrimary,
                                    }}
                                  />
                                  {hasManual && (
                                    <span style={{ fontSize: 11, color: AM.success, fontWeight: 700, minWidth: 40 }}>
                                      {fmtCompactCurrency(Number(editVal))}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: AM.textPrimary }}>
                                  {fmtCell(row.p50)}
                                </span>
                              )}
                            </Td>
                            <Td right mono muted={isUnavailable}>
                              {isUnavailable ? "—" : fmtCell(row.p75)}
                            </Td>
                            <Td right>
                              <span style={{ color: isUnavailable ? AM.textMuted : AM.textSecondary }}>
                                {row.sample_count}
                              </span>
                            </Td>
                            <Td right>
                              {isUnavailable
                                ? hasManual
                                  ? <Badge color={AM.success}>✓ Manual</Badge>
                                  : <Badge color={AM.warning}>Needs input</Badge>
                                : <Badge color={AM.success} faint>Auto</Badge>
                              }
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {unavailableCount > 0 && (
                  <div style={{ padding: "8px 14px", background: AM.borderLight, fontSize: 11, color: AM.textMuted, borderTop: `1px solid ${AM.border}` }}>
                    <strong style={{ color: AM.warning }}>Needs input</strong> — fewer than 3 baseline people matched this combination.
                    Enter a cost manually, or leave blank to skip (those combinations will return "no match" when adding positions).
                  </div>
                )}
              </div>
            </Section>
          )}

          {error && (
            <div style={{ color: AM.danger, fontSize: 12, fontWeight: 600, padding: "8px 12px", background: "rgba(220,38,38,0.06)", borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${AM.border}`,
          display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center",
          background: AM.white,
        }}>
          {previewRows.length > 0 && unavailableCount > filledCount && (
            <span style={{ fontSize: 11, color: AM.textMuted, marginRight: "auto" }}>
              {unavailableCount - filledCount} combination{unavailableCount - filledCount !== 1 ? "s" : ""} without a cost will be skipped
            </span>
          )}
          <button onClick={onClose} style={btnGhost()}>Cancel</button>
          <button
            onClick={save}
            disabled={saving || previewRows.length === 0}
            style={btnPrimary(saving || previewRows.length === 0)}
          >
            {saving ? "Creating…" : `Create rate card${availableCount + filledCount > 0 ? ` (${availableCount + filledCount} rows)` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ step, title, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 20, height: 20, borderRadius: "50%", background: AM.navy,
          color: AM.white, fontSize: 11, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {step}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: AM.navy, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </div>
      </div>
      <div style={{ paddingLeft: 28 }}>{children}</div>
    </div>
  );
}

function ColChip({ col, meta, active, maxed, onClick, muted }) {
  const uniqueCount = meta?.unique_count;
  const sampleValues = meta?.sample_values || [];
  const tooltip = sampleValues.length
    ? `${uniqueCount} unique values: ${sampleValues.join(", ")}${uniqueCount > sampleValues.length ? "…" : ""}`
    : col;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={maxed}
      title={tooltip}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        border: `1px solid ${active ? AM.navy : muted ? AM.borderLight : AM.border}`,
        background: active ? AM.navy : muted ? AM.white : AM.white,
        color: active ? AM.white : maxed ? AM.textMuted : muted ? AM.textMuted : AM.textSecondary,
        borderRadius: 16,
        padding: "4px 10px 4px 10px",
        fontSize: 11,
        fontWeight: 600,
        cursor: maxed ? "not-allowed" : "pointer",
        opacity: maxed ? 0.55 : 1,
        transition: "all 0.1s",
      }}
    >
      {col}
      {uniqueCount != null && (
        <span style={{
          fontSize: 9, fontWeight: 700,
          background: active ? "rgba(255,255,255,0.2)" : "rgba(1,36,74,0.08)",
          color: active ? AM.white : AM.textMuted,
          borderRadius: 8, padding: "1px 5px", lineHeight: 1.4,
        }}>
          {uniqueCount}
        </span>
      )}
    </button>
  );
}

function Badge({ children, color, faint }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: faint ? AM.textMuted : color,
      background: faint ? "transparent" : `${color}18`,
      borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function fmtCell(v) {
  if (v == null || v === "") return "—";
  return fmtCompactCurrency(v);
}

function groupLabel(label) {
  return {
    fontSize: 9, fontWeight: 700, color: AM.textMuted, textTransform: "uppercase",
    letterSpacing: "0.7px", marginBottom: 6,
  };
}

function labelStyle() {
  return { display: "block", fontSize: 10, fontWeight: 700, color: AM.textMuted, textTransform: "uppercase", letterSpacing: "0.6px" };
}

function inputStyle() {
  return {
    width: "100%", marginTop: 4, border: `1px solid ${AM.border}`,
    borderRadius: 6, padding: "7px 10px", fontSize: 12, outline: "none",
    boxSizing: "border-box", fontFamily: "'IBM Plex Sans', sans-serif",
  };
}

function btnPrimary(disabled) {
  return {
    background: disabled ? AM.borderLight : AM.navy, color: disabled ? AM.textMuted : AM.white,
    border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function btnGhost() {
  return {
    background: AM.borderLight, color: AM.textSecondary, border: "none",
    borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  };
}

function Th({ children, right, light }) {
  return (
    <th style={{
      textAlign: right ? "right" : "left", padding: "9px 12px",
      fontSize: 10, fontWeight: 700,
      color: light ? "#c8daea" : "rgba(255,255,255,0.75)",
      textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
    }}>
      {children}
    </th>
  );
}

function Td({ children, right, mono, muted }) {
  return (
    <td style={{
      padding: "8px 12px", textAlign: right ? "right" : "left",
      fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit",
      color: muted ? AM.textMuted : AM.textPrimary, verticalAlign: "middle",
    }}>
      {children}
    </td>
  );
}
