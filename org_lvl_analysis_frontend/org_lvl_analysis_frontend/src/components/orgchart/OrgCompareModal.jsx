import React from "react";
import { AM } from "./orgChartTheme";
import { fmtCompactCurrency, fmtNumber } from "./orgChartLayout";

/**
 * Side-by-side scenario comparison. Pulled in /db/datasets/{id}/compare so it
 * shows every scenario's summary in one table.
 */
export default function OrgCompareModal({ open, onClose, comparison }) {
  if (!open) return null;
  const scenarios = comparison?.scenarios || [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(1,36,74,0.55)",
        zIndex: 50,
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
          width: "min(960px, 92vw)",
          maxHeight: "85vh",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 30px 60px rgba(1,36,74,0.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            background: AM.navy,
            color: AM.white,
            padding: "14px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Scenario Comparison</div>
            <div style={{ fontSize: 11, color: "#a8c0d8", marginTop: 2 }}>
              Headcount, FTE, and cost across all scenarios for this dataset
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: AM.white,
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: AM.borderLight }}>
                <Th>Scenario</Th>
                <Th right>Headcount</Th>
                <Th right>Total FTE</Th>
                <Th right>Total Cost</Th>
                <Th right>Δ FTE</Th>
                <Th right>Δ Cost</Th>
                <Th right>Flagged</Th>
                <Th right>Changes</Th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => {
                const dCost = s.delta?.cost || 0;
                const dFte = s.delta?.fte || 0;
                return (
                  <tr key={s.scenario_id} style={{ borderTop: `1px solid ${AM.borderLight}` }}>
                    <Td>
                      <span style={{ fontWeight: 700 }}>{s.scenario_name}</span>
                      {s.is_promoted ? (
                        <span
                          style={{
                            marginLeft: 8,
                            background: AM.goldLight,
                            color: AM.navy,
                            padding: "1px 7px",
                            fontSize: 9,
                            borderRadius: 3,
                            fontWeight: 700,
                            letterSpacing: "0.6px",
                          }}
                        >
                          LIVE
                        </span>
                      ) : null}
                    </Td>
                    <Td right mono>{fmtNumber(s.current.headcount)}</Td>
                    <Td right mono>{fmtNumber(Number(s.current.total_fte).toFixed(1))}</Td>
                    <Td right mono>{fmtCompactCurrency(s.current.total_cost)}</Td>
                    <Td
                      right
                      mono
                      style={{
                        color: dFte === 0 ? AM.textMuted : dFte < 0 ? AM.success : AM.warning,
                        fontWeight: 600,
                      }}
                    >
                      {dFte === 0 ? "—" : `${dFte > 0 ? "+" : ""}${Number(dFte).toFixed(1)}`}
                    </Td>
                    <Td
                      right
                      mono
                      style={{
                        color: dCost === 0 ? AM.textMuted : dCost < 0 ? AM.success : AM.warning,
                        fontWeight: 600,
                      }}
                    >
                      {dCost === 0 ? "—" : `${dCost > 0 ? "+" : ""}${fmtCompactCurrency(dCost)}`}
                    </Td>
                    <Td right mono>
                      {s.flagged_removed.count}
                      {s.flagged_removed.cost > 0 && (
                        <span style={{ color: AM.textMuted, marginLeft: 4 }}>
                          ({fmtCompactCurrency(s.flagged_removed.cost)})
                        </span>
                      )}
                    </Td>
                    <Td right mono>{s.change_count}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th
      style={{
        textAlign: right ? "right" : "left",
        padding: "10px 14px",
        fontSize: 10,
        fontWeight: 700,
        color: AM.textMuted,
        textTransform: "uppercase",
        letterSpacing: "0.6px",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, right, mono, style }) {
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: right ? "right" : "left",
        fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit",
        color: AM.textPrimary,
        ...style,
      }}
    >
      {children}
    </td>
  );
}
