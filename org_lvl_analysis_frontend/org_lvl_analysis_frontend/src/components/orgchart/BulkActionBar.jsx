import React, { useState } from "react";
import { AM } from "./orgChartTheme";

/**
 * Floating bar that appears at the bottom of the canvas whenever
 * `multiSelectedIds` has at least 1 entry.
 *
 * Actions:
 *   • Flag for Removal  — POST /bulk_flag  { flagged: true }
 *   • Restore           — POST /bulk_flag  { flagged: false }
 *   • Set Change Reason — POST /bulk_edit_property { field: "Change Reason", value }
 *   • Clear selection
 */
export default function BulkActionBar({
  multiSelectedIds,
  onClearSelection,
  onBulkFlag,
  onBulkEditProperty,
  loading = false,
}) {
  const [changeReason, setChangeReason] = useState("");
  const [reasonOpen, setReasonOpen] = useState(false);
  const count = multiSelectedIds.size;

  if (count === 0) return null;

  const handleFlagRemoval = async () => {
    await onBulkFlag?.(Array.from(multiSelectedIds), true);
    onClearSelection?.();
  };

  const handleRestore = async () => {
    await onBulkFlag?.(Array.from(multiSelectedIds), false);
    onClearSelection?.();
  };

  const handleApplyReason = async () => {
    if (!changeReason.trim()) return;
    await onBulkEditProperty?.(Array.from(multiSelectedIds), "Change Reason", changeReason.trim());
    setChangeReason("");
    setReasonOpen(false);
    onClearSelection?.();
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: AM.navy,
        color: AM.white,
        borderRadius: 16,
        padding: "8px 16px",
        boxShadow: "0 4px 24px rgba(1,36,74,0.3)",
        fontFamily: "'IBM Plex Sans', sans-serif",
        fontSize: 12,
        fontWeight: 600,
        userSelect: "none",
        flexWrap: "wrap",
        maxWidth: "90vw",
      }}
    >
      {/* Count badge */}
      <span
        style={{
          background: AM.gold,
          color: AM.navy,
          borderRadius: 10,
          padding: "2px 10px",
          fontSize: 12,
          fontWeight: 800,
          marginRight: 4,
        }}
      >
        {count} selected
      </span>

      {/* Flag for Removal */}
      <BarBtn
        tone="danger"
        onClick={handleFlagRemoval}
        disabled={loading}
        title="Flag all selected for removal"
      >
        <FlagIcon /> Flag for Removal
      </BarBtn>

      {/* Restore */}
      <BarBtn
        tone="success"
        onClick={handleRestore}
        disabled={loading}
        title="Restore all selected positions"
      >
        <RestoreIcon /> Restore
      </BarBtn>

      {/* Change Reason */}
      {reasonOpen ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            autoFocus
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApplyReason();
              if (e.key === "Escape") setReasonOpen(false);
            }}
            placeholder="e.g. Outsource, Redundancy…"
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              color: AM.white,
              fontSize: 12,
              fontWeight: 500,
              padding: "4px 10px",
              outline: "none",
              width: 220,
            }}
          />
          <BarBtn tone="gold" onClick={handleApplyReason} disabled={loading || !changeReason.trim()}>
            Apply
          </BarBtn>
          <BarBtn onClick={() => setReasonOpen(false)} disabled={loading}>
            Cancel
          </BarBtn>
        </div>
      ) : (
        <BarBtn onClick={() => setReasonOpen(true)} disabled={loading} title="Set Change Reason for selected">
          <ReasonIcon /> Set Reason
        </BarBtn>
      )}

      <div style={{ width: 1, background: "rgba(255,255,255,0.18)", height: 20, marginLeft: 4 }} />

      {/* Clear */}
      <button
        onClick={onClearSelection}
        title="Clear selection"
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: "0 4px",
          fontWeight: 700,
        }}
      >
        ×
      </button>
    </div>
  );
}

function BarBtn({ children, onClick, disabled, tone, title }) {
  const bg =
    tone === "danger"
      ? "#dc2626"
      : tone === "success"
      ? "#16a34a"
      : tone === "gold"
      ? AM.gold
      : "rgba(255,255,255,0.12)";
  const color = tone === "gold" ? AM.navy : AM.white;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: bg,
        border: "none",
        borderRadius: 10,
        color,
        fontSize: 11,
        fontWeight: 700,
        padding: "5px 12px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

const SVG = (props) => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
    {...props}
  />
);
function FlagIcon() {
  return <SVG><path d="M4 21V4" /><path d="M4 4h12l-2 4 2 4H4" /></SVG>;
}
function RestoreIcon() {
  return <SVG><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></SVG>;
}
function ReasonIcon() {
  return <SVG><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" /></SVG>;
}
