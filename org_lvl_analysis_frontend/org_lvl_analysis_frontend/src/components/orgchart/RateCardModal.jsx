import React, { useEffect, useMemo, useState } from "react";
import { AM } from "./orgChartTheme";
import { fmtCompactCurrency, fmtNumber } from "./orgChartLayout";

/**
 * Create or preview a dataset rate card from baseline property combinations.
 */
export default function RateCardModal({
  open,
  onClose,
  datasetId,
  flcCol,
  columns = [],
  onCreated,
  dbPreviewRateCard,
  dbGenerateRateCard,
  dbPatchRateCardRow,
}) {
  const [name, setName] = useState("Modelling Rate Card");
  const [selectedProps, setSelectedProps] = useState([]);
  const [costCol, setCostCol] = useState(flcCol || "FLC");
  const [previewRows, setPreviewRows] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [manualEdits, setManualEdits] = useState({});

  useEffect(() => {
    if (!open) return;
    setName("Modelling Rate Card");
    setSelectedProps([]);
    setCostCol(flcCol || "FLC");
    setPreviewRows([]);
    setManualEdits({});
    setError("");
  }, [open, flcCol]);

  const availableColumns = useMemo(() => {
    const set = new Set(columns || []);
    if (flcCol) set.add(flcCol);
    ["Location", "Department", "Division", "Job Grade", "Job Title", "Level"].forEach((c) => set.add(c));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [columns, flcCol]);

  if (!open) return null;

  const toggleProp = (col) => {
    setSelectedProps((prev) => {
      if (prev.includes(col)) return prev.filter((c) => c !== col);
      if (prev.length >= 3) return prev;
      return [...prev, col];
    });
  };

  const runPreview = async () => {
    if (!selectedProps.length) {
      setError("Select at least one property column");
      return;
    }
    setPreviewing(true);
    setError("");
    try {
      const resp = await dbPreviewRateCard(datasetId, {
        property_cols: selectedProps,
        cost_col: costCol,
        min_sample: 3,
      });
      setPreviewRows(resp.rows || []);
      setManualEdits({});
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const displayRows = previewRows.map((row) => {
    const edit = manualEdits[row.composite_key];
    if (!edit) return row;
    return { ...row, p50: edit, is_available: true, is_manual_override: true };
  });

  const save = async () => {
    if (!name.trim()) {
      setError("Rate card name is required");
      return;
    }
    if (!selectedProps.length || !previewRows.length) {
      setError("Preview the rate card before saving");
      return;
    }
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
      const manualKeys = Object.entries(manualEdits);
      if (rateCardId && manualKeys.length) {
        await Promise.all(
          manualKeys.map(([composite_key, p50]) =>
            dbPatchRateCardRow?.(datasetId, rateCardId, {
              composite_key,
              p50: Number(p50),
              p25: Number(p50),
              p75: Number(p50),
              avg_cost: Number(p50),
            })
          )
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
        position: "fixed",
        inset: 0,
        background: "rgba(1,36,74,0.55)",
        zIndex: 60,
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
          width: "min(920px, 94vw)",
          maxHeight: "88vh",
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 30px 60px rgba(1,36,74,0.25)",
        }}
      >
        <div style={{ background: AM.navy, color: AM.white, padding: "14px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Create rate card</div>
          <div style={{ fontSize: 11, color: "#a8c0d8", marginTop: 2 }}>
            Auto-generate indicative costs from baseline data by property combination
          </div>
        </div>

        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <label style={labelStyle()}>
              Rate card name
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} />
            </label>
            <label style={labelStyle()}>
              Cost column
              <select value={costCol} onChange={(e) => setCostCol(e.target.value)} style={inputStyle()}>
                {availableColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={sectionTitle()}>Select properties (max 3)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {availableColumns.map((col) => {
                const active = selectedProps.includes(col);
                return (
                  <button
                    key={col}
                    type="button"
                    onClick={() => toggleProp(col)}
                    style={{
                      border: `1px solid ${active ? AM.navy : AM.border}`,
                      background: active ? AM.navy : AM.white,
                      color: active ? AM.white : AM.textSecondary,
                      borderRadius: 16,
                      padding: "4px 12px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {col}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button onClick={runPreview} disabled={previewing} style={btnPrimary(previewing)}>
              {previewing ? "Previewing…" : "Preview"}
            </button>
          </div>

          {displayRows.length > 0 && (
            <div style={{ border: `1px solid ${AM.border}`, borderRadius: 8, overflow: "auto", maxHeight: 320 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: AM.borderLight }}>
                    <Th>Composite</Th>
                    <Th right>P25</Th>
                    <Th right>P50</Th>
                    <Th right>P75</Th>
                    <Th right>Sample</Th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr key={row.composite_key} style={{ borderTop: `1px solid ${AM.borderLight}` }}>
                      <Td mono>{row.composite_key}</Td>
                      <Td right mono>{fmtCell(row.p25)}</Td>
                      <Td right mono>
                        {row.is_available ? (
                          fmtCell(row.p50)
                        ) : (
                          <input
                            type="number"
                            placeholder="Manual"
                            value={manualEdits[row.composite_key] ?? ""}
                            onChange={(e) =>
                              setManualEdits((prev) => ({
                                ...prev,
                                [row.composite_key]: e.target.value,
                              }))
                            }
                            style={{ ...inputStyle(), width: 110, padding: "4px 6px" }}
                          />
                        )}
                      </Td>
                      <Td right mono>{fmtCell(row.p75)}</Td>
                      <Td right mono>
                        {row.is_available ? row.sample_count : (
                          <span style={{ color: AM.warning, fontWeight: 700 }}>Not available</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && <div style={{ color: AM.danger, fontSize: 12, marginTop: 12, fontWeight: 600 }}>{error}</div>}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${AM.border}`, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnGhost()}>Cancel</button>
          <button onClick={save} disabled={saving} style={btnPrimary(saving)}>
            {saving ? "Creating…" : "Create rate card"}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtCell(v) {
  if (v == null || v === "") return "—";
  return fmtCompactCurrency(v);
}

function labelStyle() {
  return { display: "block", fontSize: 10, fontWeight: 700, color: AM.textMuted, textTransform: "uppercase", letterSpacing: "0.6px" };
}
function sectionTitle() {
  return { fontSize: 10, fontWeight: 700, color: AM.textMuted, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 };
}
function inputStyle() {
  return {
    width: "100%",
    marginTop: 4,
    border: `1px solid ${AM.border}`,
    borderRadius: 6,
    padding: "7px 10px",
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box",
  };
}
function btnPrimary(disabled) {
  return {
    background: disabled ? AM.borderLight : AM.navy,
    color: disabled ? AM.textMuted : AM.white,
    border: "none",
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
function btnGhost() {
  return {
    background: AM.borderLight,
    color: AM.textSecondary,
    border: "none",
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
function Th({ children, right }) {
  return (
    <th style={{ textAlign: right ? "right" : "left", padding: "8px 10px", fontSize: 10, fontWeight: 700, color: AM.textMuted, textTransform: "uppercase" }}>
      {children}
    </th>
  );
}
function Td({ children, right, mono }) {
  return (
    <td style={{ padding: "8px 10px", textAlign: right ? "right" : "left", fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit", color: AM.textPrimary }}>
      {children}
    </td>
  );
}
