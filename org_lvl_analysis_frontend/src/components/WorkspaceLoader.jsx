import React from "react";

export default function WorkspaceLoader({ text = "Loading project...", fullScreen = true }) {
  const content = (
    <div className="flex flex-col items-center justify-center">
      {/* Morphing Ring + Center Icon */}
      <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
        {/* Outer morphing border */}
        <div
          className="absolute inset-0 animate-morph-ring"
          style={{
            border: "2.5px solid #0a3f86",
            borderRadius: "50%",
          }}
        />

        {/* Center solid square with icon */}
        <div
          className="flex items-center justify-center animate-morph-center"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: "#0a3f86",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
      </div>

      {/* Status text */}
      {text && (
        <p
          className="mt-5 text-sm font-semibold tracking-wide"
          style={{ color: "#0a3f86" }}
        >
          {text}
        </p>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes morph-ring {
          0%   { border-radius: 50%; transform: rotate(0deg) scale(1); }
          25%  { border-radius: 40% 60% 60% 40%; transform: rotate(90deg) scale(1.04); }
          50%  { border-radius: 50%; transform: rotate(180deg) scale(1); }
          75%  { border-radius: 60% 40% 40% 60%; transform: rotate(270deg) scale(0.96); }
          100% { border-radius: 50%; transform: rotate(360deg) scale(1); }
        }
        @keyframes morph-center {
          0%, 100% { opacity: 0.85; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1); }
        }
        .animate-morph-ring {
          animation: morph-ring 3s ease-in-out infinite;
        }
        .animate-morph-center {
          animation: morph-center 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-tr from-[#f2f6ff] via-[#f8fbff] to-[#eaf3ff] flex items-center justify-center p-8 animate-fadeInUp">
        <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-float border border-[#dce4ee]/50 px-16 py-12 flex items-center justify-center min-w-[300px]">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-8 animate-fadeInUp">
      {content}
    </div>
  );
}
