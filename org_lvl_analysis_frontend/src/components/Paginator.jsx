import React from "react";

/**
 * Shared paginator component.
 * Props: page (1-based), totalPages, onChange(newPage)
 */
export default function Paginator({ page, totalPages, onChange, totalItems, pageSize }) {
  if (totalPages <= 1) return null;

  // Build page number window: always show first, last, current ±1
  const pages = [];
  const add = (n) => { if (n >= 1 && n <= totalPages && !pages.includes(n)) pages.push(n); };

  add(1);
  add(page - 1);
  add(page);
  add(page + 1);
  add(totalPages);
  pages.sort((a, b) => a - b);

  // Insert ellipsis markers
  const items = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) items.push("…");
    items.push(p);
  });

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between px-1 pt-3 pb-1 select-none">
      {/* Row count */}
      <span className="text-xs text-slate-400">
        {from}–{to} of {totalItems}
      </span>

      {/* Page buttons */}
      <div className="flex items-center gap-1">
        {/* Prev */}
        <button
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
          aria-label="Previous page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {items.map((item, i) =>
          item === "…" ? (
            <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-slate-400">
              …
            </span>
          ) : (
            <button
              key={item}
              onClick={() => onChange(item)}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs font-medium transition-all duration-150 ${
                item === page
                  ? "bg-brand-500 text-white shadow-sm scale-105"
                  : "text-slate-600 hover:bg-brand-50 hover:text-brand-700"
              }`}
              style={item === page ? { transform: "scale(1.08)" } : {}}
            >
              {item}
            </button>
          )
        )}

        {/* Next */}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
          aria-label="Next page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
