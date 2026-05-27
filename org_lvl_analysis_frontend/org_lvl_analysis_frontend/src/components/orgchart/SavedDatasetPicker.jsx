import React, { useEffect, useState } from "react";
import { AM } from "./orgChartTheme";
import { dbListDatasets, dbGetDataset } from "../../api/backend";
import { fmtNumber } from "./orgChartLayout";

/**
 * Empty-state picker for the Org Chart: lets the user reopen a baseline that
 * was saved during a previous session (or by another teammate). Fetches all
 * datasets from /db/datasets and, when one is picked, calls back with
 * datasetId + its scenarios so the OrgChart can hydrate from SQLite.
 */
export default function SavedDatasetPicker({ onPick, onUploadInstead }) {
  const [datasets, setDatasets] = useState(null);
  const [error, setError] = useState(null);
  const [loadingId, setLoadingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    dbListDatasets()
      .then((data) => { if (!cancelled) setDatasets(data.datasets || []); })
      .catch((e) => { if (!cancelled) setError(e.message || "Failed to list saved datasets."); });
    return () => { cancelled = true; };
  }, []);

  const pick = async (datasetId) => {
    setLoadingId(datasetId);
    try {
      const resp = await dbGetDataset(datasetId);
      const baseline = (resp.scenarios || []).find((s) => s.name === "Baseline")
        || (resp.scenarios || [])[0];
      onPick({
        dataset: resp.dataset,
        scenarios: resp.scenarios || [],
        activeScenarioId: baseline?.id ?? null,
      });
    } catch (e) {
      setError(e.message || "Failed to load dataset.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div
      style={{
        height: "100%",
        minHeight: 480,
        background: AM.bg,
        borderRadius: 12,
        border: `1px solid ${AM.border}`,
        padding: 40,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: AM.navy,
          color: AM.gold,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 22,
        }}
      >
        A
      </div>
      <h3 style={{ fontSize: 22, fontWeight: 700, color: AM.navy, margin: 0 }}>
        Welcome to OrgSight 2.0
      </h3>
      <p style={{ fontSize: 13, color: AM.textMuted, margin: 0, textAlign: "center", maxWidth: 520 }}>
        Reopen a baseline you saved earlier, or run a fresh dataset through the
        pipeline (Upload → Cleanup → Validate → Filter Errors → Hierarchy).
      </p>

      {error ? (
        <div
          style={{
            background: AM.dangerLight,
            color: AM.danger,
            padding: "10px 14px",
            borderRadius: 6,
            fontSize: 12,
            marginTop: 8,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          width: "100%",
          maxWidth: 720,
          background: AM.white,
          border: `1px solid ${AM.border}`,
          borderRadius: 10,
          overflow: "hidden",
          marginTop: 12,
        }}
      >
        <div
          style={{
            background: AM.navy,
            color: AM.white,
            padding: "10px 16px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Saved baselines</span>
          {datasets ? (
            <span style={{ color: "#a8c0d8", fontWeight: 600 }}>{datasets.length} in database</span>
          ) : null}
        </div>

        {datasets === null ? (
          <div style={{ padding: 24, fontSize: 12, color: AM.textMuted, textAlign: "center" }}>
            Loading saved datasets…
          </div>
        ) : datasets.length === 0 ? (
          <div style={{ padding: 24, fontSize: 12, color: AM.textMuted, textAlign: "center" }}>
            No saved datasets yet. Upload an Excel file and run the Hierarchy step to create one.
          </div>
        ) : (
          datasets.map((d) => (
            <button
              key={d.id}
              onClick={() => pick(d.id)}
              disabled={loadingId !== null}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderBottom: `1px solid ${AM.borderLight}`,
                padding: "12px 16px",
                cursor: loadingId === null ? "pointer" : "wait",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = AM.borderLight; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ overflow: "hidden", flex: 1 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: AM.navy,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={d.name}
                >
                  {d.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: AM.textMuted,
                    marginTop: 2,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  #{d.id} · {fmtNumber(d.row_count)} rows · {d.username || "unknown user"} · {formatUploadTime(d.upload_time)}
                </div>
              </div>
              <span
                style={{
                  background: loadingId === d.id ? AM.gold : AM.navy,
                  color: loadingId === d.id ? AM.navy : AM.white,
                  padding: "5px 12px",
                  borderRadius: 14,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.4px",
                }}
              >
                {loadingId === d.id ? "Loading…" : "Open"}
              </span>
            </button>
          ))
        )}
      </div>

      {onUploadInstead ? (
        <button
          onClick={onUploadInstead}
          style={{
            marginTop: 4,
            background: "transparent",
            border: `1px solid ${AM.border}`,
            color: AM.textSecondary,
            borderRadius: 14,
            padding: "6px 16px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Or upload a new file →
        </button>
      ) : null}
    </div>
  );
}

function formatUploadTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
