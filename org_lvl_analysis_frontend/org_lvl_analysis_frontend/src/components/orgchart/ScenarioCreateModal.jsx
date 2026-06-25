import React, { useState } from "react";
import { AM } from "./orgChartTheme";
import RateCardModal from "./RateCardModal";

/**
 * Two-step new scenario flow: name/fork, then optional rate card attachment.
 */
export default function ScenarioCreateModal({
  open,
  onClose,
  onConfirm,
  datasetId,
  flcCol,
  columns,
  columnMeta = {},
  rateCards = [],
  dbPreviewRateCard,
  dbGenerateRateCard,
  dbPatchRateCardRow,
  onRateCardCreated,
}) {
  const [name, setName] = useState("");
  const [forkFromActive, setForkFromActive] = useState(true);
  const [useRateCard, setUseRateCard] = useState(false);
  const [rateCardId, setRateCardId] = useState("");
  const [quartile, setQuartile] = useState("p50");
  const [createRateCardOpen, setCreateRateCardOpen] = useState(false);

  if (!open) return null;

  const reset = () => {
    setName("");
    setForkFromActive(true);
    setUseRateCard(false);
    setRateCardId("");
    setQuartile("p50");
  };

  const submit = () => {
    if (!name.trim()) return;
    onConfirm?.({
      name: name.trim(),
      forkFromActive,
      rateCardId: useRateCard && rateCardId ? Number(rateCardId) : null,
      rateCardQuartile: quartile,
    });
    reset();
    onClose?.();
  };

  return (
    <>
      <div
        onClick={() => { reset(); onClose?.(); }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(1,36,74,0.55)",
          zIndex: 55,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: AM.white,
            width: 480,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 30px 60px rgba(1,36,74,0.25)",
          }}
        >
          <div style={{ background: AM.navy, color: AM.white, padding: "14px 18px" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>New scenario</div>
            <div style={{ fontSize: 11, color: "#a8c0d8", marginTop: 2 }}>Set default cost values (optional)</div>
          </div>

          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={labelStyle()}>
              Scenario name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} />
            </label>

            <label style={{ fontSize: 11, color: AM.textSecondary, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={forkFromActive} onChange={(e) => setForkFromActive(e.target.checked)} />
              Fork from active scenario (otherwise copy baseline)
            </label>

            <div style={{ borderTop: `1px solid ${AM.borderLight}`, paddingTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: AM.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="radio" checked={!useRateCard} onChange={() => setUseRateCard(false)} />
                Skip for now
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: AM.textPrimary, display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input type="radio" checked={useRateCard} onChange={() => setUseRateCard(true)} />
                Use a rate card
              </label>
            </div>

            {useRateCard && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 8 }}>
                <label style={labelStyle()}>
                  Rate card
                  <select value={rateCardId} onChange={(e) => setRateCardId(e.target.value)} style={inputStyle()}>
                    <option value="">Select rate card…</option>
                    {rateCards.map((rc) => (
                      <option key={rc.id} value={rc.id}>{rc.name}</option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle()}>
                  Quartile
                  <select value={quartile} onChange={(e) => setQuartile(e.target.value)} style={inputStyle()}>
                    <option value="p25">P25 (cost-out)</option>
                    <option value="p50">P50 (median)</option>
                    <option value="p75">P75 (investment)</option>
                  </select>
                </label>
                <button type="button" onClick={() => setCreateRateCardOpen(true)} style={linkBtn()}>
                  + Create a rate card
                </button>
              </div>
            )}
          </div>

          <div style={{ padding: "12px 18px", borderTop: `1px solid ${AM.border}`, display: "flex", gap: 8 }}>
            <button onClick={() => { reset(); onClose?.(); }} style={btnGhost()}>Cancel</button>
            <button onClick={submit} style={{ ...btnPrimary(false), flex: 1 }}>Create scenario</button>
          </div>
        </div>
      </div>

      <RateCardModal
        open={createRateCardOpen}
        onClose={() => setCreateRateCardOpen(false)}
        datasetId={datasetId}
        flcCol={flcCol}
        columns={columns}
        columnMeta={columnMeta}
        dbPreviewRateCard={dbPreviewRateCard}
        dbGenerateRateCard={dbGenerateRateCard}
        dbPatchRateCardRow={dbPatchRateCardRow}
        onCreated={(rc) => {
          onRateCardCreated?.(rc);
          if (rc?.id) setRateCardId(String(rc.id));
          setUseRateCard(true);
        }}
      />
    </>
  );
}

function labelStyle() {
  return { display: "block", fontSize: 10, fontWeight: 700, color: AM.textMuted, textTransform: "uppercase", letterSpacing: "0.6px" };
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
function btnPrimary() {
  return { background: AM.navy, color: AM.white, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
}
function btnGhost() {
  return { background: AM.borderLight, color: AM.textSecondary, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
}
function linkBtn() {
  return { background: "transparent", border: "none", color: AM.navy, fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", padding: 0 };
}
