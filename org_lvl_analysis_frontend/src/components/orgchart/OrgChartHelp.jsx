import React from "react";
import { AM } from "./orgChartTheme";

const SHORTCUT_SECTIONS = [
  {
    heading: "Navigation",
    rows: [
      { keys: ["Scroll"], label: "Zoom in / out (cursor-anchored)" },
      { keys: ["Click + Drag", "canvas"], label: "Pan the chart" },
      { keys: ["Shift", "↑ ↓ ← →"], label: "Pan by a large step" },
      { keys: ["Z"], label: "Zoom in" },
      { keys: ["⇧ Shift", "Z"], label: "Zoom out" },
      { keys: ["X"], label: "Fit entire tree to view" },
      { keys: ["H"], label: "Jump camera back to root" },
      { keys: ["Ctrl", "Z"], label: "Undo last change (Edit Mode)" },
    ],
  },
  {
    heading: "Edit Mode — moving FTEs",
    rows: [
      { keys: ["Drag & Drop"], label: "Move an FTE to a new manager" },
      {
        keys: ["⚠ Amber highlight"],
        label: "Target is at the same level — confirm before proceeding",
      },
      {
        keys: ["🔴 Red highlight"],
        label: "Invalid target (self, descendant, or downward hierarchy)",
      },
      {
        keys: ["✏ Edit panel"],
        label: "Click a node to open detail / edit / flag options",
      },
    ],
  },
  {
    heading: "Edit Mode — other actions",
    rows: [
      { keys: ["Flag (🚩)"], label: "Mark an FTE for removal (shown in impact strip)" },
      { keys: ["+ Add Child"], label: "Add a new FTE under the selected node" },
      { keys: ["Clone"], label: "Duplicate a role into the scenario" },
      { keys: ["Undo"], label: "Ctrl + Z reverts the last recorded change" },
    ],
  },
];

function Key({ label }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        border: "1px solid #d1d5db",
        background: "#f3f4f6",
        fontSize: 11,
        fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        color: "#374151",
        lineHeight: "18px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </kbd>
  );
}

/**
 * Fully controlled by the parent (OrgChart.jsx): `open` decides expanded vs
 * collapsed-pill, and the component is ALWAYS mounted/visible in one of those
 * two states -- it never fully disappears. This guarantees the shortcuts
 * affordance is always reachable, even if the "first visit" DB check is slow
 * or fails.
 */
export default function OrgChartHelp({ open, onOpenChange, onDismiss }) {
  const setOpen = (v) => onOpenChange?.(v);

  const handleDismiss = () => {
    setOpen(false);
    onDismiss?.();
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 100,
        fontFamily: "Inter, system-ui, sans-serif",
        maxWidth: open ? 400 : undefined,
        width: open ? 400 : undefined,
      }}
    >
      {open ? (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${AM.border}`,
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(1,36,74,0.18), 0 2px 8px rgba(1,36,74,0.08)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              background: AM.navy,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
              ⌨ Keyboard shortcuts &amp; Edit guide
            </span>
            <button
              onClick={handleDismiss}
              title="Collapse"
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: "0 2px",
              }}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: "10px 14px 4px", maxHeight: 360, overflowY: "auto" }}>
            {SHORTCUT_SECTIONS.map((sec) => (
              <div key={sec.heading} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: AM.navy,
                    marginBottom: 6,
                    paddingBottom: 3,
                    borderBottom: `1px solid #e2e8f0`,
                  }}
                >
                  {sec.heading}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {sec.rows.map((row, i) => (
                      <tr key={i}>
                        <td style={{ paddingBottom: 4, paddingRight: 10, verticalAlign: "top", width: 130 }}>
                          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                            {row.keys.map((k, ki) => (
                              <Key key={ki} label={k} />
                            ))}
                          </div>
                        </td>
                        <td style={{ paddingBottom: 4, fontSize: 12, color: "#4b5563", verticalAlign: "top" }}>
                          {row.label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "8px 14px 10px",
              borderTop: "1px solid #f1f5f9",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={handleDismiss}
              style={{
                padding: "5px 16px",
                borderRadius: 6,
                border: "none",
                background: AM.navy,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Show keyboard shortcuts &amp; edit guide"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 20,
            border: `1px solid ${AM.border}`,
            background: "rgba(255,255,255,0.92)",
            color: AM.navy,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(1,36,74,0.10)",
            backdropFilter: "blur(4px)",
          }}
        >
          <span style={{ fontSize: 14 }}>⌨</span> Shortcuts &amp; Help
        </button>
      )}
    </div>
  );
}
