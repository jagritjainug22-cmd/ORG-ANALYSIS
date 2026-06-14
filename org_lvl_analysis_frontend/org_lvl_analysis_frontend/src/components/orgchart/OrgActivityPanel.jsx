import React, { useMemo, useState } from "react";
import { AM } from "./orgChartTheme";

/**
 * Right-side slide-out panel that shows the dataset's activity feed:
 * grouped by "new since your last visit" vs "previously seen", filterable
 * by scenario, color-coded by action type, with human-readable descriptions
 * derived from the change_log payload.
 */
export default function OrgActivityPanel({
  open,
  changes,
  scenarios,
  lastSeenAt,
  unseenCount,
  loading,
  records,
  empCol,
  jobTitleCol,
  onClose,
}) {
  const [scenarioFilter, setScenarioFilter] = useState("all");

  const nameOf = useMemo(() => {
    if (!records) return () => null;
    const map = new Map();
    records.forEach((r) => {
      const id = String(r.__emp_id ?? r[empCol] ?? "");
      if (!id) return;
      const label = (jobTitleCol && r[jobTitleCol]) || r["Job Title"] || r[empCol] || id;
      map.set(id, String(label));
    });
    return (id) => (id == null ? null : map.get(String(id)));
  }, [records, empCol, jobTitleCol]);

  if (!open) return null;

  const filtered = (changes || []).filter((c) => {
    if (scenarioFilter === "all") return true;
    return String(c.scenario_id) === String(scenarioFilter);
  });
  const unseen = filtered.filter((c) => c.is_unseen);
  const seen = filtered.filter((c) => !c.is_unseen);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: AM.white,
        borderLeft: `1px solid ${AM.border}`,
        boxShadow: "-8px 0 24px rgba(11, 35, 75, 0.12)",
        display: "flex",
        flexDirection: "column",
        zIndex: 11,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: AM.navy,
          color: AM.white,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.3px" }}>
            Activity Feed
          </span>
          {unseenCount > 0 && (
            <span
              style={{
                background: AM.gold,
                color: AM.navy,
                borderRadius: 10,
                padding: "1px 7px",
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {unseenCount} NEW
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close activity panel"
          style={{
            background: "transparent",
            border: "none",
            color: AM.white,
            fontSize: 22,
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Scenario filter */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${AM.border}`, background: AM.bg }}>
        <label
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: AM.textMuted,
            display: "block",
            marginBottom: 4,
          }}
        >
          Scenario
        </label>
        <select
          value={scenarioFilter}
          onChange={(e) => setScenarioFilter(e.target.value)}
          style={{
            width: "100%",
            background: AM.white,
            border: `1px solid ${AM.border}`,
            color: AM.textPrimary,
            borderRadius: 6,
            padding: "5px 8px",
            fontSize: 12,
            outline: "none",
          }}
        >
          <option value="all">All scenarios</option>
          {(scenarios || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 16px" }}>
        {loading ? (
          <EmptyMessage text="Loading activity..." />
        ) : filtered.length === 0 ? (
          <EmptyMessage text="No changes recorded yet for this scenario." />
        ) : (
          <>
            {unseen.length > 0 && (
              <>
                <DividerLine label="NEW SINCE YOUR LAST VISIT" tone="new" />
                {unseen.map((c) => (
                  <ChangeRow key={c.id} change={c} nameOf={nameOf} highlight />
                ))}
              </>
            )}
            {seen.length > 0 && (
              <>
                <DividerLine label={unseen.length > 0 ? "PREVIOUSLY SEEN" : "RECENT ACTIVITY"} tone="seen" />
                {seen.map((c) => (
                  <ChangeRow key={c.id} change={c} nameOf={nameOf} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {lastSeenAt && (
        <div
          style={{
            borderTop: `1px solid ${AM.border}`,
            padding: "10px 14px",
            fontSize: 10,
            color: AM.textMuted,
            background: AM.bg,
            textAlign: "center",
          }}
        >
          Last visited {formatRelative(lastSeenAt)}
        </div>
      )}
    </div>
  );
}

function DividerLine({ label, tone }) {
  const color = tone === "new" ? AM.gold : AM.textMuted;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 14px 6px",
      }}
    >
      <div style={{ flex: 1, height: 1, background: tone === "new" ? AM.gold : AM.border, opacity: tone === "new" ? 0.6 : 1 }} />
      <span style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: "0.8px" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: tone === "new" ? AM.gold : AM.border, opacity: tone === "new" ? 0.6 : 1 }} />
    </div>
  );
}

function EmptyMessage({ text }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        fontSize: 12,
        color: AM.textMuted,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function ChangeRow({ change, nameOf, highlight }) {
  const palette = actionPalette(change.action);
  const description = describeChange(change, nameOf);

  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: `1px solid ${AM.borderLight}`,
        background: highlight ? "rgba(197, 168, 74, 0.06)" : "transparent",
        display: "flex",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: palette.bg,
          color: palette.fg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 700,
        }}
        title={change.username || "Unknown"}
      >
        {initialsOf(change.username)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: AM.textPrimary }}>
            {change.username || "Unknown"}
          </span>
          <span style={{ fontSize: 10, color: AM.textMuted, fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0 }}>
            {formatRelative(change.timestamp)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: palette.dot,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 12, color: AM.textPrimary, lineHeight: 1.4 }}>
            {description}
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            color: AM.textMuted,
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 8,
              background: AM.borderLight,
              fontWeight: 600,
            }}
          >
            {change.scenario_name || `Scenario #${change.scenario_id}`}
          </span>
        </div>
      </div>
    </div>
  );
}

function actionPalette(action) {
  switch (action) {
    case "move":
      return { dot: "#2563eb", bg: "#dbeafe", fg: "#1d4ed8" };
    case "edit":
      return { dot: "#d97706", bg: "#fef3c7", fg: "#b45309" };
    case "add":
      return { dot: "#16a34a", bg: "#dcfce7", fg: "#15803d" };
    case "clone":
      return { dot: "#0891b2", bg: "#cffafe", fg: "#0e7490" };
    case "flag_remove":
    case "delete":
      return { dot: "#dc2626", bg: "#fee2e2", fg: "#b91c1c" };
    case "unflag_restore":
      return { dot: "#0891b2", bg: "#cffafe", fg: "#0e7490" };
    case "reset":
      return { dot: "#7c3aed", bg: "#ede9fe", fg: "#6d28d9" };
    default:
      return { dot: AM.textMuted, bg: AM.borderLight, fg: AM.navy };
  }
}

function describeChange(change, nameOf) {
  const empLabel = nameOf?.(change.emp_id) || change.emp_id || "an employee";
  const empWithId = nameOf?.(change.emp_id)
    ? `${nameOf(change.emp_id)} (#${change.emp_id})`
    : `#${change.emp_id || "?"}`;

  switch (change.action) {
    case "move": {
      const oldMgr = nameOf?.(change.old_mgr_id) || change.old_mgr_id;
      const newMgr = nameOf?.(change.new_mgr_id) || change.new_mgr_id;
      if (oldMgr && newMgr) return `Moved ${empLabel} from ${oldMgr} to ${newMgr}`;
      if (newMgr) return `Moved ${empLabel} under ${newMgr}`;
      if (oldMgr) return `Detached ${empLabel} from ${oldMgr}`;
      return `Moved ${empLabel}`;
    }
    case "edit": {
      if (change.field) {
        const oldV = change.old_value ?? "—";
        const newV = change.new_value ?? "—";
        return `Edited ${empLabel} · ${change.field}: "${oldV}" → "${newV}"`;
      }
      return `Edited ${empLabel}`;
    }
    case "add":
      return `Added new employee ${empWithId}`;
    case "clone": {
      const source = change.old_value || change.field || "another position";
      return `Cloned ${source} to ${empWithId}`;
    }
    case "flag_remove":
      return `Flagged ${empLabel} for removal`;
    case "unflag_restore":
      return `Restored ${empLabel}`;
    case "delete":
      return `Deleted ${empLabel}`;
    case "reset":
      return `Reset scenario to baseline`;
    default:
      return `${change.action || "Updated"} ${empLabel}`;
  }
}

function initialsOf(name) {
  const src = (name || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(iso) {
  if (!iso) return "";
  try {
    const then = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
    const now = new Date();
    const diffMs = now - then;
    const sec = Math.max(0, Math.round(diffMs / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return day === 1 ? "yesterday" : `${day}d ago`;
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
