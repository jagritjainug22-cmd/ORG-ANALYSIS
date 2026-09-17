import React, { useState, useMemo, useRef, useEffect } from "react";
import { AM } from "./orgChartTheme";

/**
 * Floating bar that appears at the bottom of the canvas whenever
 * `multiSelectedIds` has at least 1 entry.
 *
 * Actions:
 *   • Flag for Removal  — POST /bulk_flag  { flagged: true }   (only when ≥1 selected are NOT flagged)
 *   • Restore           — POST /bulk_flag  { flagged: false }  (only when ≥1 selected ARE flagged)
 *   • Set Change Reason — POST /bulk_edit_property             (only when ≥1 selected are flagged/added)
 *   • Move To...        — POST /bulk_move  { new_mgr_id }
 *   • Clear selection
 *
 * Selection is NOT auto-cleared after actions — the user keeps their selection
 * so they can see the updated state and continue working.
 */
export default function BulkActionBar({
  multiSelectedIds,
  onClearSelection,
  onBulkFlag,
  onBulkEditProperty,
  onBulkMove,
  onBulkIgnoreIssues,
  nodeIssuesMap = null,
  allRecords = [],
  empCol = "__emp_id",
  jobTitleCol,
  loading = false,
  editMode = false,
}) {
  const [changeReason, setChangeReason] = useState("");
  const [reasonOpen, setReasonOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState("");
  const [moveDropdownOpen, setMoveDropdownOpen] = useState(false);
  const moveInputRef = useRef(null);
  const count = multiSelectedIds.size;

  // When move panel opens, focus the input
  useEffect(() => {
    if (moveOpen) {
      setTimeout(() => moveInputRef.current?.focus(), 50);
    }
  }, [moveOpen]);

  // Derive state of the selected nodes so we can show/hide buttons contextually
  const selectedNodes = useMemo(() => {
    if (!allRecords.length) return [];
    return allRecords.filter((r) => {
      const eid = String(r.__emp_id ?? r[empCol] ?? "");
      return eid && multiSelectedIds.has(eid);
    });
  }, [allRecords, multiSelectedIds, empCol]);

  const anyFlagged   = useMemo(() => selectedNodes.some((r) => r.is_flagged_removed), [selectedNodes]);
  const anyUnflagged = useMemo(() => selectedNodes.some((r) => !r.is_flagged_removed), [selectedNodes]);
  // "Set Reason" is useful when a flagged or added node has no change reason yet
  const anyNeedReason = useMemo(() => selectedNodes.some((r) => {
    if (!r.is_flagged_removed && !r.is_added) return false;
    const reason = (r["Change Reason"] || r["change_reason"] || "").toString().trim();
    return !reason;
  }), [selectedNodes]);
  // How many currently-visible validation issues sit on the selected nodes —
  // drives the "Clear validation flags" button (available regardless of
  // edit mode, since ignoring is a display-only, non-destructive action).
  const selectedIssueCount = useMemo(() => {
    if (!nodeIssuesMap) return 0;
    let total = 0;
    for (const id of multiSelectedIds) total += (nodeIssuesMap.get(id) || []).length;
    return total;
  }, [nodeIssuesMap, multiSelectedIds]);

  // Build a searchable list of potential target nodes (exclude selected nodes themselves)
  const targetOptions = useMemo(() => {
    if (!moveOpen || !allRecords.length) return [];
    return allRecords
      .filter((r) => {
        const eid = String(r.__emp_id ?? r[empCol] ?? "");
        return eid && !multiSelectedIds.has(eid) && !r.is_flagged_removed;
      })
      .map((r) => {
        const eid = String(r.__emp_id ?? r[empCol] ?? "");
        const title = jobTitleCol ? (r[jobTitleCol] || "").toString().trim() : "";
        return { eid, title, label: title ? `${title} — ${eid}` : eid };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [moveOpen, allRecords, multiSelectedIds, empCol, jobTitleCol]);

  const filteredTargets = useMemo(() => {
    if (!moveQuery.trim()) return targetOptions.slice(0, 10);
    const q = moveQuery.toLowerCase();
    return targetOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || o.eid.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [targetOptions, moveQuery]);

  if (count === 0) return null;

  // Handlers — intentionally do NOT call onClearSelection so the bar stays
  // visible after the action. Users can see the updated node state and clear
  // manually via the × button.
  const handleFlagRemoval = async () => {
    await onBulkFlag?.(Array.from(multiSelectedIds), true);
  };

  const handleRestore = async () => {
    await onBulkFlag?.(Array.from(multiSelectedIds), false);
  };

  const handleApplyReason = async () => {
    if (!changeReason.trim()) return;
    await onBulkEditProperty?.(Array.from(multiSelectedIds), "Change Reason", changeReason.trim());
    setChangeReason("");
    setReasonOpen(false);
  };

  const handleSelectTarget = async (targetId) => {
    setMoveDropdownOpen(false);
    setMoveOpen(false);
    setMoveQuery("");
    await onBulkMove?.(Array.from(multiSelectedIds), targetId);
  };

  const handleCloseMove = () => {
    setMoveOpen(false);
    setMoveQuery("");
    setMoveDropdownOpen(false);
  };

  const handleCloseReason = () => {
    setReasonOpen(false);
    setChangeReason("");
  };

  const handleIgnoreIssues = () => {
    onBulkIgnoreIssues?.(Array.from(multiSelectedIds));
  };

  // Only one panel open at a time
  const openMove = () => { setReasonOpen(false); setChangeReason(""); setMoveOpen(true); };
  const openReason = () => { handleCloseMove(); setReasonOpen(true); };

  return (
    <div
      className="bulk-action-bar"
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
        fontFamily: "Inter, system-ui, sans-serif",
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

      {/* Write actions — only available in edit mode */}
      {editMode && (
        <>
          {/* Flag for Removal — only when at least one selected node is not already flagged */}
          {!reasonOpen && !moveOpen && anyUnflagged && (
            <BarBtn
              tone="danger"
              onClick={handleFlagRemoval}
              disabled={loading}
              title="Flag all selected for removal"
            >
              <FlagIcon /> Flag for Removal
            </BarBtn>
          )}

          {/* Restore — only when at least one selected node is already flagged */}
          {!reasonOpen && !moveOpen && anyFlagged && (
            <BarBtn
              tone="success"
              onClick={handleRestore}
              disabled={loading}
              title="Restore all flagged selections"
            >
              <RestoreIcon /> Restore
            </BarBtn>
          )}

          {/* Change Reason panel — only shown when at least one selected node needs a reason */}
          {anyNeedReason && (
            reasonOpen ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  autoFocus
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleApplyReason();
                    if (e.key === "Escape") handleCloseReason();
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
                <BarBtn onClick={handleCloseReason} disabled={loading}>
                  Cancel
                </BarBtn>
              </div>
            ) : !moveOpen ? (
              <BarBtn onClick={openReason} disabled={loading} title="Set Change Reason for flagged/added positions">
                <ReasonIcon /> Set Reason
              </BarBtn>
            ) : null
          )}
        </>
      )}

      {/* Move To... panel — only available in edit mode */}
      {editMode && moveOpen ? (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
          <MoveIcon style={{ color: "rgba(255,255,255,0.7)", flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>
            Move to:
          </span>
          <div style={{ position: "relative" }}>
            <input
              ref={moveInputRef}
              value={moveQuery}
              onChange={(e) => { setMoveQuery(e.target.value); setMoveDropdownOpen(true); }}
              onFocus={() => setMoveDropdownOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") handleCloseMove();
                if (e.key === "Enter" && filteredTargets.length === 1) {
                  handleSelectTarget(filteredTargets[0].eid);
                }
              }}
              placeholder="Search by name or ID…"
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 8,
                color: AM.white,
                fontSize: 12,
                fontWeight: 500,
                padding: "4px 10px",
                outline: "none",
                width: 240,
              }}
            />
            {moveDropdownOpen && filteredTargets.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 6px)",
                  left: 0,
                  minWidth: 280,
                  background: "#fff",
                  border: `1px solid ${AM.border}`,
                  borderRadius: 8,
                  boxShadow: "0 4px 20px rgba(1,36,74,0.18)",
                  zIndex: 400,
                  overflow: "hidden",
                }}
              >
                {filteredTargets.map((opt) => (
                  <button
                    key={opt.eid}
                    onMouseDown={(e) => { e.preventDefault(); handleSelectTarget(opt.eid); }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 12px",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderBottom: `1px solid ${AM.borderLight}`,
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "Inter, system-ui, sans-serif",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = AM.borderLight)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    {opt.title ? (
                      <>
                        <span style={{ fontWeight: 700, color: AM.navy }}>{opt.title}</span>
                        <span style={{ marginLeft: 6, color: AM.textMuted, fontSize: 11 }}>{opt.eid}</span>
                      </>
                    ) : (
                      <span style={{ fontWeight: 600, color: AM.navy }}>{opt.eid}</span>
                    )}
                  </button>
                ))}
                {filteredTargets.length === 0 && moveQuery && (
                  <div style={{ padding: "10px 12px", fontSize: 12, color: AM.textMuted }}>
                    No matches found
                  </div>
                )}
              </div>
            )}
          </div>
          <BarBtn onClick={handleCloseMove} disabled={loading}>
            Cancel
          </BarBtn>
        </div>
      ) : editMode && !reasonOpen ? (
        <BarBtn onClick={openMove} disabled={loading} title="Move all selected to a new manager">
          <MoveIcon /> Move To…
        </BarBtn>
      ) : null}

      {/* Clear validation flags — display-only, so available whether or not
          edit mode is on */}
      {selectedIssueCount > 0 && (
        <BarBtn
          onClick={handleIgnoreIssues}
          disabled={loading}
          title="Hide validation issues on the selected positions (data isn't changed)"
        >
          <IgnoreIcon /> Clear {selectedIssueCount} Validation Flag{selectedIssueCount !== 1 ? "s" : ""}
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
function IgnoreIcon() {
  return <SVG><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><path d="M4 4l16 16" /></SVG>;
}
function MoveIcon(props) {
  return (
    <SVG {...props}>
      <path d="M5 9l-3 3 3 3" />
      <path d="M19 9l3 3-3 3" />
      <path d="M2 12h20" />
    </SVG>
  );
}
