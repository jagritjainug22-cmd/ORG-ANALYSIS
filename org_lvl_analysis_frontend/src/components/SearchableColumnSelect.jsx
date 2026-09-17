import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Compact searchable column picker. Renders the menu in a portal so it is not
 * clipped by overflow:hidden parents (e.g. the Column Configuration panel).
 */
export default function SearchableColumnSelect({
  value = "",
  options = [],
  onChange,
  placeholder = "Select…",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 220, openUp: false });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.trim().toLowerCase())
  );

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelH = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < panelH && rect.top > spaceBelow;
    setPos({
      top: openUp ? Math.max(8, rect.top - panelH) : rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 200) - 8),
      width: Math.max(rect.width, 200),
      openUp,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const focusTimer = setTimeout(() => searchRef.current?.focus(), 0);

    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePosition();

    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const pick = (next) => {
    onChange?.(next);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`w-full flex items-center justify-between gap-1 rounded-md border px-2 py-1 text-left transition ${
          open
            ? "border-brand-400 ring-2 ring-brand-500/20 bg-white"
            : "border-brand-100 bg-white hover:border-brand-300"
        }`}
        title={value || placeholder}
      >
        <span
          className={`truncate text-xs font-semibold ${
            value ? "text-slate-800" : "text-slate-400"
          }`}
        >
          {value || placeholder}
        </span>
        <svg
          className={`w-3 h-3 text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 9999,
            }}
            className="bg-white border border-brand-200 rounded-lg shadow-xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-1.5 border-b border-brand-100 bg-brand-50/50">
              <div className="relative">
                <svg
                  className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search columns…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-brand-100 rounded-md outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                />
              </div>
            </div>

            <div className="max-h-36 overflow-y-auto py-1 overscroll-contain">
              <button
                type="button"
                onClick={() => pick("")}
                className={`w-full text-left px-2.5 py-1.5 text-xs font-semibold transition ${
                  !value
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                }`}
              >
                Clear selection
              </button>
              {filtered.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-slate-400 font-medium">No matches</p>
              ) : (
                filtered.map((opt) => {
                  const selected = opt === value;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => pick(opt)}
                      className={`w-full text-left px-2.5 py-1.5 text-xs font-semibold truncate transition ${
                        selected
                          ? "bg-brand-500 text-white"
                          : "text-slate-700 hover:bg-brand-50 hover:text-brand-800"
                      }`}
                      title={opt}
                    >
                      {opt}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
