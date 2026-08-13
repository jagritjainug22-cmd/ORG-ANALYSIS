/**
 * Visual component library for the benchmarking module.
 *
 * Everything here is presentational: it takes rows straight off the
 * deterministic comparison payload and renders them. No fetching, no state
 * beyond hover/animation.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ScatterChart, Scatter, ZAxis,
  RadialBarChart, RadialBar, PolarAngleAxis, LabelList,
} from "recharts";
import {
  SERIES_COLORS, verdictOf, healthBandOf, CONFIDENCE,
  money, moneyRange, num, pctDelta, metricValue, fteCount,
  bandPosition, rowLabel, bucketLabel,
} from "./benchmarkTheme";

// ===========================================================================
// Primitives
// ===========================================================================

/** Count that eases up to its final value — used on the report hero tiles. */
export function CountUp({ value, format, duration = 900, className = "" }) {
  const [shown, setShown] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    const target = Number(value) || 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(target * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <span className={className}>{format ? format(shown) : num(shown, 0)}</span>;
}

export function Chip({ children, tone = "neutral", className = "" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-600 border-slate-200",
    brand: "bg-brand-50 text-brand-600 border-brand-200",
    good: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    bad: "bg-rose-50 text-rose-700 border-rose-200",
    dark: "bg-white/10 text-white border-white/25",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${tones[tone] || tones.neutral} ${className}`}>
      {children}
    </span>
  );
}

export function ChartCard({ title, subtitle, action, children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-brand-600 truncate">{title}</h4>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

function EmptyChart({ message = "Not enough data to chart this yet." }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <svg className="w-9 h-9 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2" />
      </svg>
      <p className="text-xs text-slate-400 max-w-xs">{message}</p>
    </div>
  );
}

function TooltipShell({ children }) {
  return (
    <div className="bg-brand-600 text-white rounded-lg shadow-xl px-3 py-2 text-xs border border-brand-700">
      {children}
    </div>
  );
}

// ===========================================================================
// Health gauge — headline "how do we compare" score
// ===========================================================================

export function HealthGauge({ score = 0, band = "mixed", size = 190, label = "Benchmark health" }) {
  const theme = healthBandOf(band);
  const data = [{ name: "score", value: Math.max(score, 2), fill: theme.hex }];

  return (
    <div className="flex flex-col items-center">
      <div style={{ width: size, height: size * 0.72 }} className="relative">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="72%" outerRadius="100%"
            startAngle={200} endAngle={-20}
            data={data} barSize={16}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: theme.ring }} dataKey="value" cornerRadius={10} isAnimationActive />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-4 pointer-events-none">
          <CountUp
            value={score}
            format={(v) => Math.round(v)}
            className="text-4xl font-black tabular-nums"
            duration={1100}
          />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.hex }}>
            {theme.label}
          </span>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-1">{label}</p>
    </div>
  );
}

// ===========================================================================
// Bullet bar — a single metric against its p25 / median / p75 band
// ===========================================================================

export function VarianceBullet({ row, currency = "USD", showLabel = true, compact = false }) {
  const pos = bandPosition(row.client_value, row.p25, row.median, row.p75);
  const theme = verdictOf(row.verdict);
  if (!pos || pos.client === null) {
    return showLabel ? (
      <div className="text-xs text-slate-400 italic">{row.metric_label} — no client value</div>
    ) : null;
  }

  const bandLeft = Math.min(pos.p25 ?? 0, pos.p75 ?? 100);
  const bandWidth = Math.abs((pos.p75 ?? 100) - (pos.p25 ?? 0));

  return (
    <div className={compact ? "" : "py-1.5"}>
      {showLabel && (
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          <span className="text-xs font-medium text-slate-700 truncate">{row.metric_label}</span>
          <span className={`text-xs font-bold tabular-nums ${theme.text} flex-shrink-0`}>
            {metricValue(row.client_value, row.unit, row.decimals, currency)}
            <span className="text-slate-400 font-normal ml-1.5">
              vs {metricValue(row.median, row.unit, row.decimals, currency)}
            </span>
          </span>
        </div>
      )}
      <div className="relative h-6 group">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-100" />
        {/* Inter-quartile band */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-brand-200/70"
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
          title="P25 – P75 benchmark range"
        />
        {/* Median tick */}
        {pos.median !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-brand-600 rounded-full"
            style={{ left: `${pos.median}%` }}
            title="Benchmark median"
          />
        )}
        {/* Client marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 transition-all duration-500"
          style={{ left: `${pos.client}%` }}
        >
          <div
            className="w-3.5 h-3.5 -ml-[7px] rounded-full ring-[3px] ring-white shadow-md"
            style={{ background: theme.hex }}
            title={`Client: ${metricValue(row.client_value, row.unit, row.decimals, currency)}`}
          />
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Diverging variance bars — every metric's distance from median, at a glance
// ===========================================================================

export function VarianceDiverging({ rows = [], currency = "USD", limit = 14, height = 380 }) {
  const data = useMemo(() => {
    return rows
      .filter((r) => r.delta_pct !== null && r.delta_pct !== undefined && r.verdict !== "not_measured")
      .map((r) => ({
        name: `${rowLabel(r)} · ${r.metric_short || r.metric_label}`,
        delta: r.delta_pct,
        verdict: r.verdict,
        row: r,
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, limit)
      .sort((a, b) => a.delta - b.delta);
  }, [rows, limit]);

  if (!data.length) return <EmptyChart message="No measurable variances against this benchmark pack." />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number" tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
          axisLine={false} tickLine={false}
        />
        <YAxis
          type="category" dataKey="name" width={230}
          tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false}
        />
        <ReferenceLine x={0} stroke="#0a3f86" strokeWidth={1.5} />
        <Tooltip
          cursor={{ fill: "rgba(10,63,134,0.04)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload.row;
            return (
              <TooltipShell>
                <p className="font-bold mb-1">{rowLabel(r)}</p>
                <p className="text-white/80">{r.metric_label}</p>
                <div className="mt-1.5 pt-1.5 border-t border-white/20 space-y-0.5">
                  <p>Client <span className="font-bold tabular-nums">{metricValue(r.client_value, r.unit, r.decimals, currency)}</span></p>
                  <p>Median <span className="font-bold tabular-nums">{metricValue(r.median, r.unit, r.decimals, currency)}</span></p>
                  <p>Variance <span className="font-bold tabular-nums">{pctDelta(r.delta_pct)}</span></p>
                </div>
              </TooltipShell>
            );
          }}
        />
        <Bar dataKey="delta" radius={[3, 3, 3, 3]} barSize={13} isAnimationActive>
          {data.map((d, i) => <Cell key={i} fill={verdictOf(d.verdict).hex} />)}
          <LabelList
            dataKey="delta" position="right"
            formatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`}
            style={{ fontSize: 10, fill: "#64748b", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ===========================================================================
// Savings waterfall — ranked opportunities stacking to a bucket total
// ===========================================================================

export function SavingsWaterfall({ opportunities = [], currency = "USD", bucket = null, limit = 10 }) {
  const data = useMemo(() => {
    const filtered = bucket ? opportunities.filter((o) => o.bucket === bucket) : opportunities;
    let running = 0;
    return filtered
      .filter((o) => (o.savings_high || 0) > 0)
      .slice(0, limit)
      .map((o) => {
        const base = running;
        const value = o.savings_high || 0;
        running += value;
        return {
          name: rowLabel(o),
          base,
          value,
          low: o.savings_low || 0,
          opp: o,
        };
      });
  }, [opportunities, bucket, limit]);

  if (!data.length) return <EmptyChart message="No quantified savings for this bucket." />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(280, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 74, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number" tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={(v) => money(v, currency, { decimals: 0 })}
          axisLine={false} tickLine={false}
        />
        <YAxis
          type="category" dataKey="name" width={170}
          tick={{ fontSize: 11, fill: "#334155" }} axisLine={false} tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(10,63,134,0.04)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const o = payload[0].payload.opp;
            return (
              <TooltipShell>
                <p className="font-bold mb-1">{rowLabel(o)}</p>
                <p className="text-white/80">{o.primary_metric_label}</p>
                <div className="mt-1.5 pt-1.5 border-t border-white/20 space-y-0.5">
                  <p>Savings <span className="font-bold">{moneyRange(o.savings_low, o.savings_high, currency)}</span></p>
                  {o.fte_gap ? <p>Headcount <span className="font-bold">{fteCount(o.fte_gap)}</span></p> : null}
                  <p className="text-white/70 capitalize">{o.confidence} confidence</p>
                </div>
              </TooltipShell>
            );
          }}
        />
        <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="value" stackId="a" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive>
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.92} />
          ))}
          <LabelList
            dataKey="value" position="right"
            formatter={(v) => money(v, currency)}
            style={{ fontSize: 10, fill: "#475569", fontWeight: 700 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ===========================================================================
// Function scatter — size vs efficiency, the "where to look" quadrant
// ===========================================================================

export function FunctionQuadrant({ functionAggregates = [], variance = [], currency = "USD" }) {
  const data = useMemo(() => {
    const varianceByFunction = {};
    for (const row of variance) {
      if (row.scope !== "function" || !row.function) continue;
      if (row.delta_pct === null || row.delta_pct === undefined) continue;
      const current = varianceByFunction[row.function];
      if (!current || Math.abs(row.delta_pct) > Math.abs(current)) {
        varianceByFunction[row.function] = row.delta_pct;
      }
    }
    return (functionAggregates || [])
      .filter((f) => f.group_value && (f.total_fte || 0) > 0)
      .map((f) => ({
        name: f.group_value,
        fte: Number(f.total_fte) || 0,
        cost: Number(f.total_cost) || 0,
        delta: varianceByFunction[f.group_value] ?? 0,
        span: f.managers ? (Number(f.subordinates) || 0) / Number(f.managers) : null,
      }));
  }, [functionAggregates, variance]);

  if (!data.length) return <EmptyChart message="Function-level aggregates are unavailable for this dataset." />;

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ top: 12, right: 24, left: 4, bottom: 24 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" />
        <XAxis
          type="number" dataKey="fte" name="FTE"
          tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
          label={{ value: "Function size (FTE)", position: "insideBottom", offset: -14, fontSize: 11, fill: "#64748b" }}
        />
        <YAxis
          type="number" dataKey="delta" name="Variance"
          tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
          tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
          label={{ value: "Variance vs median", angle: -90, position: "insideLeft", fontSize: 11, fill: "#64748b" }}
        />
        <ZAxis type="number" dataKey="cost" range={[80, 700]} />
        <ReferenceLine y={0} stroke="#0a3f86" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload;
            return (
              <TooltipShell>
                <p className="font-bold mb-1">{d.name}</p>
                <p>{fteCount(d.fte)}</p>
                {d.cost ? <p>{money(d.cost, currency)} cost</p> : null}
                <p>Variance <span className="font-bold">{pctDelta(d.delta)}</span></p>
                {d.span ? <p>Avg span {num(d.span, 1)}</p> : null}
              </TooltipShell>
            );
          }}
        />
        <Scatter data={data} isAnimationActive>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.delta > 5 ? "#e11d48" : d.delta < -5 ? "#059669" : "#0a3f86"}
              fillOpacity={0.55}
              stroke={d.delta > 5 ? "#be123c" : d.delta < -5 ? "#047857" : "#08304a"}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ===========================================================================
// Span distribution + layer pyramid — the structural story
// ===========================================================================

export function SpanDistribution({ orgAggregate = {}, variance = [] }) {
  const targetRow = variance.find((r) => r.metric_key === "pct_managers_below_target_span");
  const spanRow = variance.find((r) => r.metric_key === "avg_span_of_control");

  const singleReport = Number(orgAggregate.single_report_mgrs) || 0;
  const belowTarget = Number(orgAggregate.mgrs_below_target) || 0;
  const managers = Number(orgAggregate.managers) || 0;

  // "Below target" already contains the single-report managers, so the middle
  // bucket nets them out to keep the three bars mutually exclusive.
  const buckets = [
    { name: "1 report", value: singleReport, tone: "#e11d48" },
    { name: "Below target", value: Math.max(belowTarget - singleReport, 0), tone: "#f59e0b" },
    { name: "At or above target", value: Math.max(managers - belowTarget, 0), tone: "#059669" },
  ].filter((b) => b.value > 0);

  if (!buckets.length) return <EmptyChart message="No manager population detected in this dataset." />;

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={buckets} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(10,63,134,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              return (
                <TooltipShell>
                  <p className="font-bold">{payload[0].payload.name}</p>
                  <p>{num(payload[0].value, 0)} managers</p>
                </TooltipShell>
              );
            }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={54} isAnimationActive>
            {buckets.map((b, i) => <Cell key={i} fill={b.tone} fillOpacity={0.85} />)}
            <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "#334155", fontWeight: 700 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-3">
        {spanRow && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Average span</p>
            <p className="text-xl font-bold text-brand-600 tabular-nums mt-0.5">{num(spanRow.client_value, 1)}</p>
            <p className="text-[11px] text-slate-500">Benchmark {num(spanRow.median, 1)}</p>
          </div>
        )}
        {targetRow && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Managers below target</p>
            <p className="text-xl font-bold text-brand-600 tabular-nums mt-0.5">{num(targetRow.client_value, 1)}%</p>
            <p className="text-[11px] text-slate-500">Benchmark {num(targetRow.median, 1)}%</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LayerPyramid({ orgAggregate = {}, variance = [] }) {
  const layerRow = variance.find((r) => r.metric_key === "total_layers");
  const layers = Number(orgAggregate.max_level) || Number(layerRow?.client_value) || 0;
  const benchmark = Number(layerRow?.median) || 0;
  if (!layers) return <EmptyChart message="Layer depth is unavailable — check the hierarchy build." />;

  const rows = Array.from({ length: Math.round(layers) }, (_, i) => i + 1);
  const excess = benchmark ? Math.max(Math.round(layers - benchmark), 0) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-1.5">
        {rows.map((layer) => {
          const width = 26 + (layer / rows.length) * 68;
          const isExcess = excess > 0 && layer > rows.length - excess;
          return (
            <div
              key={layer}
              className={`h-6 rounded-md flex items-center justify-center text-[10px] font-bold transition-all ${
                isExcess ? "text-rose-700" : "text-white"
              }`}
              style={{
                width: `${width}%`,
                background: isExcess
                  ? "repeating-linear-gradient(45deg,#fecdd3,#fecdd3 6px,#fee2e2 6px,#fee2e2 12px)"
                  : `rgba(10,63,134,${0.35 + (layer / rows.length) * 0.6})`,
              }}
              title={isExcess ? `Layer ${layer} — beyond the benchmark depth` : `Layer ${layer}`}
            >
              L{layer}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500">
        <span><span className="font-bold text-brand-600">{Math.round(layers)}</span> layers</span>
        {benchmark ? <span>Benchmark <span className="font-bold">{num(benchmark, 0)}</span></span> : null}
        {excess ? <span className="text-rose-600 font-semibold">{excess} beyond benchmark</span> : null}
      </div>
    </div>
  );
}

// ===========================================================================
// KPI tile grid
// ===========================================================================

export function KpiTile({ label, value, sub, tone = "brand", icon, delay = 0 }) {
  const tones = {
    brand: "from-brand-500 to-brand-700 text-white",
    teal: "from-teal-500 to-teal-700 text-white",
    amber: "from-amber-500 to-orange-600 text-white",
    rose: "from-rose-500 to-rose-700 text-white",
    slate: "from-slate-600 to-slate-800 text-white",
  };
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${tones[tone] || tones.brand} px-5 py-4 shadow-lg`}
      style={{ animation: `bmFadeUp 480ms ease-out ${delay}ms both` }}
    >
      <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/10" />
      <div className="absolute -right-2 -bottom-4 w-16 h-16 rounded-full bg-white/5" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-1.5">
          {icon}
          <p className="text-[10px] uppercase tracking-wider font-bold text-white/75">{label}</p>
        </div>
        <p className="text-2xl font-black tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-white/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ===========================================================================
// Opportunity card
// ===========================================================================

export function OpportunityCard({ opportunity, currency = "USD", onSelect, expanded = false }) {
  const [open, setOpen] = useState(expanded);
  const conf = CONFIDENCE[opportunity.confidence] || CONFIDENCE.medium;
  const accent = SERIES_COLORS[((opportunity.rank || 1) - 1) % SERIES_COLORS.length];

  return (
    <div className="group rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all overflow-hidden">
      <div className="flex items-stretch">
        <div className="w-1.5 flex-shrink-0" style={{ background: accent }} />
        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-brand-600 text-white text-[10px] font-black">
                  {opportunity.rank}
                </span>
                <h5 className="text-sm font-bold text-brand-600 truncate">{rowLabel(opportunity)}</h5>
                <Chip tone={opportunity.bucket === "structural" ? "warn" : "brand"}>
                  {bucketLabel(opportunity.bucket)}
                </Chip>
              </div>
              <p className="text-xs text-slate-500">
                {opportunity.primary_metric_label} ·{" "}
                <span className="font-semibold text-slate-700">
                  {metricValue(opportunity.client_value, undefined, 1, currency)}
                </span>{" "}
                vs median{" "}
                <span className="font-semibold text-slate-700">
                  {metricValue(opportunity.median, undefined, 1, currency)}
                </span>{" "}
                <span className="text-rose-600 font-semibold">{pctDelta(opportunity.delta_pct)}</span>
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-base font-black text-brand-600 tabular-nums">
                {moneyRange(opportunity.savings_low, opportunity.savings_high, currency)}
              </p>
              {opportunity.fte_gap ? (
                <p className="text-[11px] text-slate-500">{fteCount(opportunity.fte_gap)} equivalent</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${conf.bg} ${conf.text} ${conf.border}`}>
              {conf.label}
            </span>
            {opportunity.supporting_metrics?.length > 0 && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="text-[11px] font-medium text-brand-500 hover:text-brand-600 transition"
              >
                {open ? "Hide" : "Show"} {opportunity.supporting_metrics.length} supporting metric
                {opportunity.supporting_metrics.length === 1 ? "" : "s"}
              </button>
            )}
            {onSelect && (
              <button
                onClick={() => onSelect(opportunity)}
                className="ml-auto text-[11px] font-medium text-slate-400 hover:text-brand-600 transition"
              >
                Explore →
              </button>
            )}
          </div>

          {open && opportunity.supporting_metrics?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
              {opportunity.supporting_metrics.map((m) => (
                <div key={m.metric_key} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-slate-500 truncate">{m.metric_label}</span>
                  <span className="tabular-nums text-slate-700 flex-shrink-0">
                    {num(m.client_value, 1)} vs {num(m.median, 1)}
                    <span className="ml-1.5 font-semibold text-rose-600">{pctDelta(m.delta_pct)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Variance table — the dense, sortable detail view
// ===========================================================================

export function VarianceTable({ rows = [], currency = "USD", maxHeight = "26rem" }) {
  const [sort, setSort] = useState({ key: "severity", dir: "desc" });
  const [filter, setFilter] = useState("all");

  const shown = useMemo(() => {
    let out = rows.filter((r) => r.verdict !== "not_measured");
    if (filter !== "all") out = out.filter((r) => r.verdict === filter);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "string" || typeof bv === "string") {
        return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
      }
      return ((av ?? 0) - (bv ?? 0)) * dir;
    });
  }, [rows, sort, filter]);

  const toggleSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  const counts = useMemo(() => ({
    all: rows.filter((r) => r.verdict !== "not_measured").length,
    unfavourable: rows.filter((r) => r.verdict === "unfavourable").length,
    in_line: rows.filter((r) => r.verdict === "in_line").length,
    favourable: rows.filter((r) => r.verdict === "favourable").length,
  }), [rows]);

  const Th = ({ label, sortKey, align = "left" }) => (
    <th
      onClick={sortKey ? () => toggleSort(sortKey) : undefined}
      className={`px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-slate-50 sticky top-0 z-10 border-b border-slate-200 ${
        align === "right" ? "text-right" : "text-left"
      } ${sortKey ? "cursor-pointer hover:text-brand-600 select-none" : ""}`}
    >
      {label}
      {sort.key === sortKey && <span className="ml-1 text-brand-500">{sort.dir === "desc" ? "▾" : "▴"}</span>}
    </th>
  );

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {[
          ["all", "All"],
          ["unfavourable", "Above benchmark"],
          ["in_line", "In line"],
          ["favourable", "Better"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
              filter === key
                ? "bg-brand-500 text-white border-brand-500 shadow-sm"
                : "bg-white text-slate-500 border-slate-200 hover:border-brand-300 hover:text-brand-600"
            }`}
          >
            {label} <span className="opacity-70">{counts[key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 overflow-auto" style={{ maxHeight }}>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <Th label="Scope" sortKey="scope" />
              <Th label="Area" sortKey="function" />
              <Th label="Metric" sortKey="metric_label" />
              <Th label="Client" sortKey="client_value" align="right" />
              <Th label="P25" align="right" />
              <Th label="Median" sortKey="median" align="right" />
              <Th label="P75" align="right" />
              <Th label="Variance" sortKey="delta_pct" align="right" />
              <Th label="Position" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const theme = verdictOf(r.verdict);
              return (
                <tr key={`${r.scope}-${r.function}-${r.subfunction}-${r.metric_key}-${i}`}
                    className="border-b border-slate-100 last:border-0 hover:bg-brand-50/40 transition">
                  <td className="px-3 py-2 text-slate-400 capitalize">{r.scope}</td>
                  <td className="px-3 py-2 font-medium text-slate-700 max-w-[180px] truncate" title={rowLabel(r)}>
                    {rowLabel(r)}
                  </td>
                  <td className="px-3 py-2 text-slate-600 max-w-[220px] truncate" title={r.metric_label}>
                    {r.metric_label}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-800">
                    {metricValue(r.client_value, r.unit, r.decimals, currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {metricValue(r.p25, r.unit, r.decimals, currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {metricValue(r.median, r.unit, r.decimals, currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {metricValue(r.p75, r.unit, r.decimals, currency)}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-bold ${theme.text}`}>
                    {pctDelta(r.delta_pct)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${theme.bg} ${theme.text} ${theme.border}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />
                      {theme.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-400 text-xs">
                  Nothing matches this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===========================================================================
// Coverage meter
// ===========================================================================

export function CoverageMeter({ coverage = {}, compact = false }) {
  const pct = Number(coverage.coverage_pct) || 0;
  const tone = pct >= 80 ? "#059669" : pct >= 60 ? "#f59e0b" : "#e11d48";

  return (
    <div className={compact ? "" : "space-y-2"}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Benchmark coverage</span>
        <span className="text-sm font-black tabular-nums" style={{ color: tone }}>{num(pct, 1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, background: tone }}
        />
      </div>
      {!compact && (
        <p className="text-[11px] text-slate-500">
          {num(coverage.mapped_fte, 0)} of {num(coverage.total_fte, 0)} FTE sit in a benchmarked function
        </p>
      )}
    </div>
  );
}

// ===========================================================================
// Roadmap timeline
// ===========================================================================

export function RoadmapTimeline({ horizons = null }) {
  const stages = horizons || [
    { label: "First 30 days", theme: "Validate and mobilise", tone: "#0a3f86" },
    { label: "60 days", theme: "Design the target state", tone: "#14b8a6" },
    { label: "90 days+", theme: "Execute and track", tone: "#f59e0b" },
  ];
  return (
    <div className="relative pl-6">
      <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-brand-500 via-teal-500 to-amber-500 rounded-full" />
      <div className="space-y-5">
        {stages.map((s, i) => (
          <div key={i} className="relative">
            <div
              className="absolute -left-6 top-1 w-4 h-4 rounded-full ring-4 ring-white shadow"
              style={{ background: s.tone }}
            />
            <p className="text-xs font-black text-brand-600 uppercase tracking-wide">{s.label}</p>
            <p className="text-xs text-slate-600 mt-0.5">{s.theme}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
