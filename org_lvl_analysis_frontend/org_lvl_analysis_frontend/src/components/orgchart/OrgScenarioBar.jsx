import React, { useState } from "react";
import { AM } from "./orgChartTheme";

/**
 * Scenario tab bar: switch between scenarios, create new ones (forked from
 * baseline or from the current scenario), rename, delete, and promote a
 * scenario to be the new baseline.
 */
export default function OrgScenarioBar({
  scenarios,
  activeScenarioId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onPromote,
  onCompare,
  onReset,
  onUndo,
  onActivity,
  activityUnseenCount = 0,
  activityActive = false,
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [forkFromActive, setForkFromActive] = useState(true);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  const active = scenarios.find((s) => s.id === activeScenarioId);
  const isBaseline = active?.name === "Baseline";

  const submitCreate = () => {
    if (!newName.trim()) return;
    onCreate?.(newName.trim(), forkFromActive ? activeScenarioId : null);
    setNewName("");
    setAdding(false);
  };

  const submitRename = (id) => {
    if (!renameDraft.trim()) {
      setRenamingId(null);
      return;
    }
    onRename?.(id, renameDraft.trim());
    setRenamingId(null);
  };

  return (
    <div
      style={{
        background: AM.white,
        borderBottom: `1px solid ${AM.border}`,
        padding: "8px 24px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: AM.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.7px",
          marginRight: 6,
        }}
      >
        Scenarios
      </span>

      {scenarios.map((s) => {
        const isActive = s.id === activeScenarioId;
        const isRenaming = renamingId === s.id;
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            aria-label={`Scenario ${s.name}${isActive ? " (active)" : ""}`}
            aria-pressed={isActive}
            style={{
              display: "flex",
              alignItems: "center",
              background: isActive ? AM.navy : AM.borderLight,
              color: isActive ? AM.white : AM.textSecondary,
              borderRadius: 14,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              gap: 6,
              cursor: "pointer",
              border: s.is_promoted ? `1px solid ${AM.gold}` : `1px solid transparent`,
            }}
            onClick={() => !isRenaming && onSwitch?.(s.id)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !isRenaming) {
                e.preventDefault();
                onSwitch?.(s.id);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenamingId(s.id);
              setRenameDraft(s.name);
            }}
          >
            {isRenaming ? (
              <input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => submitRename(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(s.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  fontWeight: 600,
                  fontSize: 12,
                  outline: "none",
                  width: 90,
                }}
              />
            ) : (
              <>
                {s.is_promoted ? <GoldDot /> : null}
                <span>{s.name}</span>
                {isActive && !isBaseline && s.name !== "Baseline" && (
                  <button
                    title="Delete scenario"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete scenario "${s.name}"? This cannot be undone.`)) {
                        onDelete?.(s.id);
                      }
                    }}
                    style={smallIcon(true)}
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {adding ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Scenario name"
            style={{
              border: `1px solid ${AM.border}`,
              borderRadius: 12,
              padding: "4px 10px",
              fontSize: 12,
              outline: "none",
              width: 140,
            }}
          />
          <label style={{ fontSize: 10, color: AM.textSecondary, display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={forkFromActive}
              onChange={(e) => setForkFromActive(e.target.checked)}
            />
            fork from active
          </label>
          <button onClick={submitCreate} style={ghostPill(true)}>Create</button>
          <button onClick={() => setAdding(false)} style={ghostPill()}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={ghostPill()} title="New scenario">
          + New
        </button>
      )}

      <div style={{ flex: 1 }} />

      {onActivity && (
        <button
          onClick={onActivity}
          title={activityUnseenCount > 0
            ? `${activityUnseenCount} new change${activityUnseenCount === 1 ? "" : "s"} since your last visit`
            : "Activity feed"}
          style={{
            ...ghostPill(),
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            paddingRight: activityUnseenCount > 0 ? 24 : 10,
            background: activityActive ? AM.gold : AM.white,
            color: activityActive ? AM.navy : AM.textSecondary,
            border: `1px solid ${activityActive ? AM.gold : AM.border}`,
            fontWeight: activityActive ? 700 : 600,
          }}
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          Activity
          {activityUnseenCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -5,
                right: -5,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                background: AM.gold,
                color: AM.navy,
                fontSize: 9,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 4px",
                border: `1.5px solid ${AM.white}`,
                boxShadow: `0 0 0 1px ${AM.gold}`,
                animation: "orgsight-pulse 1.6s ease-in-out infinite",
              }}
            >
              {activityUnseenCount > 99 ? "99+" : activityUnseenCount}
            </span>
          )}
        </button>
      )}

      <button onClick={() => onUndo?.()} style={ghostPill()} title="Undo last change (Ctrl+Z)">
        Undo
      </button>
      {active && !isBaseline && (
        <button
          onClick={() => {
            if (confirm(`Reset "${active.name}" to baseline? All changes will be lost.`)) {
              onReset?.(activeScenarioId);
            }
          }}
          style={ghostPill()}
          title="Revert scenario to baseline"
        >
          Reset
        </button>
      )}
      <button onClick={onCompare} style={ghostPill()} title="Compare all scenarios">
        Compare
      </button>
      {active && !isBaseline && (
        <button
          onClick={() => {
            if (confirm(`Promote "${active.name}" to be the new baseline? This replaces the saved baseline.`)) {
              onPromote?.(activeScenarioId);
            }
          }}
          style={{
            ...ghostPill(),
            background: AM.gold,
            color: AM.navy,
            fontWeight: 700,
            border: "none",
          }}
        >
          Promote to live
        </button>
      )}
    </div>
  );
}

function GoldDot() {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: AM.gold,
        display: "inline-block",
      }}
    />
  );
}

function smallIcon(invert) {
  return {
    background: "transparent",
    border: "none",
    color: invert ? AM.white : AM.textSecondary,
    cursor: "pointer",
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
    marginLeft: 2,
  };
}

function ghostPill(primary) {
  return {
    background: primary ? AM.navy : AM.white,
    color: primary ? AM.white : AM.textSecondary,
    border: `1px solid ${primary ? AM.navy : AM.border}`,
    borderRadius: 14,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  };
}
