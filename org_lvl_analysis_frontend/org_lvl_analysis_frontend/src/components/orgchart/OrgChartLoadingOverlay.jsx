import React from "react";
import { AM } from "./orgChartTheme";

/**
 * Full-area overlay shown while a scenario is loading from the backend.
 */
export default function OrgChartLoadingOverlay({ message = "Loading scenario…", submessage }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(244, 246, 249, 0.82)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <style>{`
        @keyframes orgChartOverlaySpin {
          to { transform: rotate(360deg); }
        }
        @keyframes orgChartOverlayPulse {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes orgChartOverlayGlow {
          0%, 100% { filter: drop-shadow(0 0 2px rgba(0, 133, 202, 0.35)); }
          50% { filter: drop-shadow(0 0 10px rgba(0, 133, 202, 0.75)); }
        }
        @keyframes orgChartOverlayFlow {
          0% { stroke-dashoffset: 24; }
          100% { stroke-dashoffset: 0; }
        }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          padding: "32px 40px",
          background: AM.white,
          borderRadius: 16,
          border: `1px solid ${AM.border}`,
          boxShadow: "0 12px 40px rgba(1,36,74,0.12)",
          maxWidth: 320,
          textAlign: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 88,
            height: 88,
            animation: "orgChartOverlayPulse 2.4s ease-in-out infinite",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 4,
              borderRadius: "50%",
              border: `3px solid ${AM.borderLight}`,
              borderTopColor: AM.blue,
              animation: "orgChartOverlaySpin 0.9s linear infinite",
            }}
          />
          <svg
            viewBox="0 0 100 80"
            fill="none"
            style={{
              position: "absolute",
              inset: 18,
              width: 52,
              height: 52,
              animation: "orgChartOverlayGlow 2s ease-in-out infinite",
            }}
          >
            <line x1="50" y1="18" x2="26" y2="38" stroke={AM.blueMid} strokeWidth="1.5" strokeDasharray="4 4" style={{ animation: "orgChartOverlayFlow 1.2s linear infinite" }} />
            <line x1="50" y1="18" x2="74" y2="38" stroke={AM.blueMid} strokeWidth="1.5" strokeDasharray="4 4" style={{ animation: "orgChartOverlayFlow 1.2s linear infinite" }} />
            <line x1="26" y1="38" x2="12" y2="58" stroke={AM.blueMid} strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="26" y1="38" x2="38" y2="58" stroke={AM.blueMid} strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="74" y1="38" x2="62" y2="58" stroke={AM.blueMid} strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="74" y1="38" x2="88" y2="58" stroke={AM.blueMid} strokeWidth="1.5" strokeDasharray="4 4" />
            <circle cx="50" cy="14" r="7" fill={AM.navy} />
            <circle cx="26" cy="38" r="5" fill={AM.navyLight} />
            <circle cx="74" cy="38" r="5" fill={AM.navyLight} />
            <circle cx="12" cy="62" r="4" fill={AM.blueLight} stroke={AM.blueMid} strokeWidth="1" />
            <circle cx="38" cy="62" r="4" fill={AM.blueLight} stroke={AM.blueMid} strokeWidth="1" />
            <circle cx="62" cy="62" r="4" fill={AM.blueLight} stroke={AM.blueMid} strokeWidth="1" />
            <circle cx="88" cy="62" r="4" fill={AM.blueLight} stroke={AM.blueMid} strokeWidth="1" />
          </svg>
        </div>

        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: AM.navy,
              letterSpacing: "0.2px",
            }}
          >
            {message}
          </div>
          {submessage && (
            <div
              style={{
                fontSize: 12,
                color: AM.textMuted,
                marginTop: 6,
                lineHeight: 1.45,
              }}
            >
              {submessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
