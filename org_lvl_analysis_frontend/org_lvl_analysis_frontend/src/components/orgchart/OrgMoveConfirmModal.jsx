import React from "react";
import { AM } from "./orgChartTheme";

function parseReasons(reasons) {
  const parts = [];
  for (const r of reasons) {
    if (r.startsWith("subtree-size:")) {
      const count = r.split(":")[1];
      parts.push({ type: "subtree", count: Number(count) });
    } else if (r.startsWith("cross-function:")) {
      const [from, to] = r.split(":")[1].split("\u2192");
      parts.push({ type: "function", from, to });
    } else if (r.startsWith("level-jump:")) {
      const [fromL, toL] = r.split(":")[1].split("\u2192");
      const fromNum = Number(fromL.replace("L", ""));
      const toNum = Number(toL.replace("L", ""));
      parts.push({ type: "level", from: fromL, to: toL, delta: fromNum - toNum });
    } else if (r.startsWith("same-level:")) {
      const lvl = r.split(":")[1];
      parts.push({ type: "same-level", level: lvl });
    }
  }
  return parts;
}

export default function OrgMoveConfirmModal({
  srcNode,
  targetNode,
  reasons,
  empCol,
  onConfirm,
  onCancel,
}) {
  const srcName =
    srcNode?.["Employee Name"] ||
    srcNode?.["Name"] ||
    srcNode?.[empCol] ||
    srcNode?.__emp_id ||
    "this employee";
  const targetName =
    targetNode?.["Employee Name"] ||
    targetNode?.["Name"] ||
    targetNode?.[empCol] ||
    targetNode?.__emp_id ||
    "the target";

  const parsed = parseReasons(reasons || []);
  const subtree = parsed.find((p) => p.type === "subtree");
  const func = parsed.find((p) => p.type === "function");
  const level = parsed.find((p) => p.type === "level");
  const sameLevel = parsed.find((p) => p.type === "same-level");

  const headline = subtree
    ? `Move ${srcName} and ${subtree.count} reports under ${targetName}?`
    : `Move ${srcName} under ${targetName}?`;

  const details = [];
  if (sameLevel) details.push(`The reporting manager is at the same level. Please review and confirm before proceeding.`);
  if (func) details.push(`This will cross from ${func.from} to ${func.to}.`);
  if (level) details.push(`This moves up ${level.delta} level${level.delta > 1 ? "s" : ""} (${level.from} to ${level.to}).`);

  const warnColor = sameLevel && !func && !level ? "#d97706" : AM.navy;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 460,
          width: "90%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 16,
            fontWeight: 600,
            color: warnColor,
          }}
        >
          {sameLevel && !func && !level ? "⚠ Same-Level Move" : "Confirm Move"}
        </h3>

        <p style={{ margin: "0 0 6px", fontSize: 14, color: "#333", lineHeight: 1.5 }}>
          {headline}
        </p>

        {details.length > 0 && (
          <ul style={{ margin: "8px 0 16px", paddingLeft: 18, fontSize: 13, color: "#555", lineHeight: 1.6 }}>
            {details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}

        {details.length === 0 && <div style={{ height: 12 }} />}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: `1px solid ${AM.border}`,
              background: "#fff",
              color: AM.navy,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: "none",
              background: sameLevel && !func && !level ? "#d97706" : AM.gold,
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Confirm Move
          </button>
        </div>
      </div>
    </div>
  );
}
