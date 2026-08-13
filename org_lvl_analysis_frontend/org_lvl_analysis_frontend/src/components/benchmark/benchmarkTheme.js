/**
 * Shared formatting and colour tokens for the benchmarking UI.
 *
 * Every number the user sees in the benchmark tab and report passes through
 * here, so a currency or unit change lands in one place. Unit strings mirror
 * services/benchmark_registry.py.
 */

export const UNITS = {
  PCT: "pct",
  RATIO: "ratio",
  COUNT: "count",
  PER_1000: "per_1000",
  CURRENCY: "currency",
};

export const VERDICT = {
  unfavourable: {
    label: "Above benchmark",
    tone: "bad",
    text: "text-rose-700",
    bg: "bg-rose-50",
    border: "border-rose-200",
    dot: "bg-rose-500",
    hex: "#e11d48",
  },
  favourable: {
    label: "Better than benchmark",
    tone: "good",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
    hex: "#059669",
  },
  in_line: {
    label: "In line",
    tone: "neutral",
    text: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    dot: "bg-slate-400",
    hex: "#64748b",
  },
  not_measured: {
    label: "Not measured",
    tone: "muted",
    text: "text-slate-400",
    bg: "bg-slate-50",
    border: "border-slate-200",
    dot: "bg-slate-300",
    hex: "#cbd5e1",
  },
};

export const verdictOf = (v) => VERDICT[v] || VERDICT.not_measured;

export const CONFIDENCE = {
  high: { label: "High confidence", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  medium: { label: "Medium confidence", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  low: { label: "Low confidence", text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
};

export const HEALTH_BAND = {
  strong: { label: "Strong", hex: "#059669", ring: "#a7f3d0", text: "text-emerald-700" },
  mixed: { label: "Mixed", hex: "#0a3f86", ring: "#bfdbfe", text: "text-brand-600" },
  stretched: { label: "Stretched", hex: "#d97706", ring: "#fde68a", text: "text-amber-700" },
  critical: { label: "Critical", hex: "#e11d48", ring: "#fecdd3", text: "text-rose-700" },
};

export const healthBandOf = (band) => HEALTH_BAND[band] || HEALTH_BAND.mixed;

/** Sequential palette for categorical series — brand navy first, then accents. */
export const SERIES_COLORS = [
  "#0a3f86", "#14b8a6", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316",
];

const CURRENCY_SYMBOLS = { USD: "$", EUR: "\u20ac", GBP: "\u00a3", INR: "\u20b9", JPY: "\u00a5", AUD: "A$", CAD: "C$" };

export const currencySymbol = (code) => CURRENCY_SYMBOLS[(code || "USD").toUpperCase()] || `${code} `;

/** Compact money: $1.2m, $940k, $312. Always signed-positive; callers add direction. */
export function money(value, currency = "USD", { decimals = 1 } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const symbol = currencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(decimals)}bn`;
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(decimals)}m`;
  if (abs >= 1e3) return `${sign}${symbol}${Math.round(abs / 1e3)}k`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

export function moneyExact(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${currencySymbol(currency)}${Math.round(value).toLocaleString()}`;
}

export function moneyRange(low, high, currency = "USD") {
  if (!low && !high) return "—";
  if (low && high && Math.abs(high - low) > 1) {
    return `${money(low, currency)} – ${money(high, currency)}`;
  }
  return money(high || low, currency);
}

export function num(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Render a metric value in its own unit. Mirrors registry.format_value. */
export function metricValue(value, unit, decimals = 1, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (unit) {
    case UNITS.PCT: return `${num(value, decimals)}%`;
    case UNITS.CURRENCY: return money(value, currency);
    case UNITS.COUNT: return num(value, 0);
    case UNITS.PER_1000: return `${num(value, decimals)} / 1k`;
    case UNITS.RATIO:
    default: return num(value, decimals);
  }
}

export function pctDelta(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${num(value, 1)}%`;
}

export function fteCount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${num(value, value >= 100 ? 0 : 1)} FTE`;
}

/**
 * Position a client value on the p25–p75 band as a 0–100 percentage, with
 * headroom so out-of-band values stay visible instead of clipping to the edge.
 */
export function bandPosition(clientValue, p25, median, p75) {
  const values = [clientValue, p25, median, p75].filter((v) => typeof v === "number");
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.18 || Math.abs(hi || 1) * 0.1;
  const min = lo - pad;
  const max = hi + pad;
  const span = max - min || 1;
  const at = (v) => (typeof v === "number" ? ((v - min) / span) * 100 : null);
  return { client: at(clientValue), p25: at(p25), median: at(median), p75: at(p75) };
}

export const scopeLabel = (scope) =>
  ({ org: "Organisation", function: "Function", subfunction: "Sub-function" }[scope] || scope);

export const bucketLabel = (bucket) =>
  bucket === "structural" ? "Structural" : "Functional";

/** Stable, readable label for any variance or opportunity row. */
export const rowLabel = (row) =>
  row.subfunction || row.function || "Organisation-wide";
