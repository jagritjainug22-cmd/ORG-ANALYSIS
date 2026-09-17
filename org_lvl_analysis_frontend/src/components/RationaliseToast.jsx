import React, { useEffect, useState } from "react";

export default function RationaliseToast({ visible, onUpdateConfig, onDismiss }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setShow(true));
      const timer = setTimeout(() => { setShow(false); setTimeout(onDismiss, 400); }, 30000);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className={`fixed top-6 right-6 z-[9999] max-w-sm transition-all duration-400 ${
        show ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
      }`}
    >
      <div
        className="rounded-xl border border-brand-200 shadow-xl px-5 py-4"
        style={{
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">Rationalisation applied</p>
            <p className="text-xs text-slate-500 mt-0.5">New columns added. Update column config to use rationalised values downstream.</p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => { onUpdateConfig(); setShow(false); setTimeout(onDismiss, 400); }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-brand-500 rounded-lg hover:bg-brand-600 transition-colors"
              >
                Update Config
              </button>
              <button
                onClick={() => { setShow(false); setTimeout(onDismiss, 400); }}
                className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            onClick={() => { setShow(false); setTimeout(onDismiss, 400); }}
            className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
