import React, { useState, useMemo } from "react";
import { AM } from "./orgChartTheme";

/**
 * Export-to-PowerPoint scope picker modal.
 *
 * Props:
 *   open              – boolean
 *   onClose           – () => void
 *   onExport          – ({ detail, scope, rootId }) => void
 *   scenarioName      – string (display only)
 *   l1Functions       – [{ id, title, headcount }]  top-level function nodes
 *   focusedNodeId     – string | null  currently focused/selected node
 *   focusedNodeTitle  – string | null  display title of focused node
 */
export default function OrgExportModal({
  open,
  onClose,
  onExport,
  scenarioName = "",
  l1Functions = [],
  focusedNodeId = null,
  focusedNodeTitle = null,
}) {
  const [scope, setScope]    = useState("all");
  const [funcId, setFuncId]  = useState("");
  const [detail, setDetail]  = useState("summary");

  const canExportSelection = Boolean(focusedNodeId);

  // Reset funcId if functions list changes
  const defaultFuncId = useMemo(() => l1Functions[0]?.id || "", [l1Functions]);

  function handleExport() {
    let rootId = null;
    if (scope === "function") {
      rootId = funcId || defaultFuncId || null;
    } else if (scope === "selected") {
      rootId = focusedNodeId;
    }
    const resolvedScope = rootId ? "subtree" : "all";
    onExport({ detail, scope: resolvedScope, rootId });
    onClose();
  }

  if (!open) return null;

  const radio = (id, value, label, disabled = false, sub = null) => (
    <label
      key={value}
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        background: scope === value ? AM.blueLight : "transparent",
        border: `1px solid ${scope === value ? AM.blueMid : AM.borderLight}`,
        opacity: disabled ? 0.45 : 1,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <input
        type="radio" id={id} name="scope"
        value={value}
        checked={scope === value}
        disabled={disabled}
        onChange={() => setScope(value)}
        style={{ marginTop: 3, accentColor: AM.navy, cursor: disabled ? "not-allowed" : "pointer" }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: AM.navy }}>{label}</div>
        {sub && (
          <div style={{ fontSize: 11, color: AM.textMuted, marginTop: 2 }}>{sub}</div>
        )}
      </div>
    </label>
  );

  const detailOpt = (value, label, desc) => (
    <label
      key={value}
      htmlFor={`detail-${value}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: detail === value ? "#f0f4fa" : "transparent",
        border: `1px solid ${detail === value ? AM.blueMid : AM.borderLight}`,
        transition: "background 0.15s",
      }}
    >
      <input
        type="radio" id={`detail-${value}`} name="detail"
        value={value}
        checked={detail === value}
        onChange={() => setDetail(value)}
        style={{ marginTop: 3, accentColor: AM.navy, cursor: "pointer" }}
      />
      <div>
        <span style={{ fontSize: 12, fontWeight: 600, color: AM.navy }}>{label}</span>
        <span style={{ fontSize: 11, color: AM.textMuted, marginLeft: 6 }}>{desc}</span>
      </div>
    </label>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(1,36,74,0.28)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "28px 30px 24px",
          maxWidth: 480,
          width: "92%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: AM.navy }}>
              Export to PowerPoint
            </h3>
            {scenarioName && (
              <p style={{ margin: "3px 0 0", fontSize: 11, color: AM.textMuted }}>
                Scenario: {scenarioName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: AM.textMuted, fontSize: 20, lineHeight: 1, padding: 4,
            }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Scope section */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: AM.textSecondary, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
            What to export
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {radio("scope-all", "all", "Entire Organization", false, "All roles across the full org")}
            {radio(
              "scope-func", "function",
              "Specific Function",
              l1Functions.length === 0,
              l1Functions.length === 0 ? "No direct-report functions found" : "Choose a top-level function below",
            )}
            {scope === "function" && l1Functions.length > 0 && (
              <div style={{ paddingLeft: 22, marginTop: -2 }}>
                <select
                  value={funcId || defaultFuncId}
                  onChange={(e) => setFuncId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${AM.border}`,
                    fontSize: 12,
                    color: AM.navy,
                    background: "#fff",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {l1Functions.map((fn) => (
                    <option key={fn.id} value={fn.id}>
                      {fn.title}{fn.headcount ? ` (${fn.headcount} roles)` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {radio(
              "scope-sel", "selected",
              focusedNodeTitle ? `Selected: "${focusedNodeTitle}"` : "Current Selection",
              !canExportSelection,
              canExportSelection ? "Exports the subtree under the selected card" : "Select a card on the chart first",
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: AM.borderLight, margin: "0 0 16px" }} />

        {/* Detail level */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: AM.textSecondary, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
            Slide depth
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {detailOpt("overview", "Overview", "Overview only (L1–L2)")}
            {detailOpt("summary", "Summary", "Overview + one slide per function")}
            {detailOpt("full", "Full Detail", "All levels, recursively split")}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "9px 20px", borderRadius: 8,
              border: `1px solid ${AM.border}`,
              background: "#fff", color: AM.navy,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            style={{
              padding: "9px 22px", borderRadius: 8,
              border: "none",
              background: AM.navy, color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 7,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export .pptx
          </button>
        </div>
      </div>
    </div>
  );
}
