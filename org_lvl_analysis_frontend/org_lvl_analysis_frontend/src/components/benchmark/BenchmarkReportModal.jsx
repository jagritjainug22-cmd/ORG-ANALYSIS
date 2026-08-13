/**
 * Benchmark deep-analysis report.
 *
 * Opens full-screen, streams the report over SSE and renders it as a
 * presentation-grade document: hero scorecard, section rail, narration
 * interleaved with the charts each section calls for.
 *
 * The deterministic comparison arrives before any narration, so charts paint
 * immediately and the prose fills in behind them.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  benchmarkAnalysisStream, benchmarkExportReport, benchmarkSaveReport,
} from "../../api/backend";
import ReportMarkdown from "./ReportMarkdown";
import {
  HealthGauge, KpiTile, VarianceDiverging, VarianceBullet,
  SavingsWaterfall, FunctionQuadrant, SpanDistribution, LayerPyramid,
  OpportunityCard, CoverageMeter, RoadmapTimeline, ChartCard, Chip, CountUp,
} from "./BenchmarkCharts";
import {
  money, moneyRange, num, fteCount, healthBandOf, rowLabel,
} from "./benchmarkTheme";

// ---------------------------------------------------------------------------
// Section iconography
// ---------------------------------------------------------------------------

const ICONS = {
  sparkles: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
  layers: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  hierarchy: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  target: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  route: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
};

const SectionIcon = ({ name, className = "w-4 h-4" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={ICONS[name] || ICONS.sparkles} />
  </svg>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BenchmarkReportModal({
  open,
  onClose,
  datasetId,
  scenarioId,
  packId = null,
  datasetName = "",
  focus = "",
  initialReport = null,
  onSaved = null,          // called with (reportId, title) after successful save
}) {
  const [comparison, setComparison] = useState(initialReport || null);
  const [sections, setSections] = useState(initialReport?.sections || []);
  const [streamingText, setStreamingText] = useState({});
  const [evidence, setEvidence] = useState({});
  const [activeSection, setActiveSection] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [finalReport, setFinalReport] = useState(initialReport);
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState(null);   // id of the just-saved report
  const [busyAction, setBusyAction] = useState(null);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});

  const currency = comparison?.pack?.currency || comparison?.summary?.currency || "USD";
  const summary = comparison?.summary || {};

  // --- Stream lifecycle -----------------------------------------------------

  const startStream = useCallback(() => {
    if (!datasetId || !scenarioId) return;
    abortRef.current?.();
    setComparison(null); setSections([]); setStreamingText({}); setEvidence({});
    setError(null); setFinalReport(null); setSaved(false); setRunning(true);
    setStatus({ message: "Preparing the comparison…", progress: 4 });

    abortRef.current = benchmarkAnalysisStream(
      { dataset_id: datasetId, scenario_id: scenarioId, pack_id: packId || undefined, focus: focus || undefined },
      {
        onStatus: (s) => setStatus(s),
        onDeterministic: (data) => setComparison(data),
        onSectionStart: (s) => {
          setSections((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, { ...s, text: "" }]));
          setActiveSection((cur) => cur || s.id);
        },
        onEvidence: (e) => setEvidence((prev) => ({ ...prev, [e.section]: e.queries })),
        onToken: (sectionId, text) =>
          setStreamingText((prev) => ({ ...prev, [sectionId]: (prev[sectionId] || "") + text })),
        onSectionEnd: (payload) =>
          setSections((prev) => prev.map((s) => (s.id === payload.id ? { ...s, ...payload } : s))),
        onDone: (report) => {
          setFinalReport(report);
          setSections(report.sections || []);
          setRunning(false);
          setStatus({ message: "Report complete", progress: 100 });
        },
        onError: (message) => { setError(message); setRunning(false); },
      },
    );
  }, [datasetId, scenarioId, packId, focus]);

  useEffect(() => {
    if (!open) return;
    if (initialReport) {
      setComparison(initialReport);
      setSections(initialReport.sections || []);
      setFinalReport(initialReport);
      setActiveSection(initialReport.sections?.[0]?.id || null);
      return;
    }
    startStream();
    return () => abortRef.current?.();
  }, [open, initialReport, startStream]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll-spy so the rail tracks whatever the reader is looking at.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.dataset?.section) setActiveSection(visible.target.dataset.section);
      },
      { root, rootMargin: "-25% 0px -60% 0px", threshold: [0.1, 0.4] },
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const handleClose = () => { abortRef.current?.(); onClose?.(); };

  const scrollToSection = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(id);
  };

  const reportForExport = useMemo(
    () => finalReport || (comparison ? { ...comparison, sections } : null),
    [finalReport, comparison, sections],
  );

  const handleExport = async () => {
    if (!reportForExport) return;
    setBusyAction("export");
    try {
      await benchmarkExportReport(
        reportForExport,
        `${datasetName || "OrgSight"} — Benchmark Report`,
      );
    } catch (e) {
      setError(e?.response?.data?.detail || "Export failed");
    } finally { setBusyAction(null); }
  };

  const handleSave = async () => {
    if (!reportForExport) return;
    setBusyAction("save");
    const title = `${datasetName || "Benchmark"} — ${new Date().toLocaleDateString()}`;
    try {
      const res = await benchmarkSaveReport({
        dataset_id: datasetId,
        scenario_id: scenarioId,
        pack_id: comparison?.pack?.id,
        title,
        report: reportForExport,
      });
      setSaved(true);
      setSavedId(res?.id ?? null);
      // Tell the parent immediately so the saved-reports list refreshes without
      // the user having to close and reopen the modal first.
      onSaved?.(res?.id, title);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not save the report");
    } finally { setBusyAction(null); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="relative w-full max-w-[1500px] bg-slate-50 sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        <HeroHeader
          summary={summary}
          pack={comparison?.pack}
          coverage={comparison?.coverage}
          datasetName={datasetName}
          currency={currency}
          running={running}
          status={status}
          onClose={handleClose}
        />

        <div className="flex-1 flex min-h-0">
          <SectionRail
            sections={sections}
            active={activeSection}
            running={running}
            onSelect={scrollToSection}
          />

          <div ref={scrollRef} className="flex-1 overflow-y-auto bm-scroll">
            <div className="max-w-5xl mx-auto px-6 sm:px-10 py-8 space-y-10">
              {error && <ErrorBanner message={error} onRetry={startStream} />}

              {!comparison && !error && <SkeletonReport status={status} />}

              {comparison && (
                <>
                  <Scorecard comparison={comparison} currency={currency} />

                  {sections.map((section) => (
                    <ReportSection
                      key={section.id}
                      ref={(el) => { sectionRefs.current[section.id] = el; }}
                      section={section}
                      text={section.text || streamingText[section.id] || ""}
                      streaming={running && !section.text}
                      evidence={evidence[section.id]}
                      comparison={comparison}
                      currency={currency}
                    />
                  ))}

                  {!running && sections.length > 0 && (
                    <MethodologyBlock comparison={comparison} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <FooterBar
          running={running}
          hasReport={Boolean(reportForExport)}
          saved={saved}
          savedId={savedId}
          busyAction={busyAction}
          onExport={handleExport}
          onSave={handleSave}
          onRegenerate={startStream}
          onClose={handleClose}
          onViewSaved={() => { handleClose(); }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function HeroHeader({ summary, pack, coverage, datasetName, currency, running, status, onClose }) {
  const band = healthBandOf(summary.health_band);
  const functional = summary.functional || {};
  const structural = summary.structural || {};

  return (
    <div className="relative bg-gradient-to-br from-brand-600 via-brand-500 to-[#08304a] text-white overflow-hidden flex-shrink-0">
      {/* Ambient geometry */}
      <div className="absolute inset-0 opacity-[0.13] pointer-events-none">
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full border-[24px] border-white" />
        <div className="absolute -bottom-32 left-1/4 w-72 h-72 rounded-full border-[18px] border-teal-300" />
        <div className="absolute top-8 left-1/2 w-40 h-40 rotate-45 border-2 border-white/60" />
      </div>

      <div className="relative px-6 sm:px-10 pt-6 pb-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/25 text-[10px] font-bold uppercase tracking-wider">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI Benchmark Analysis
              </span>
              {pack?.name && <Chip tone="dark">{pack.name}</Chip>}
              {pack?.effective_year && <Chip tone="dark">{pack.effective_year}</Chip>}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight truncate">
              {datasetName || "Organisation"} vs benchmark
            </h2>
            <p className="text-sm text-white/70 mt-1">
              {num(summary.total_fte, 0)} FTE · {num(summary.headcount, 0)} people
              {summary.total_cost ? ` · ${money(summary.total_cost, currency)} workforce cost` : ""}
              {summary.metrics_compared ? ` · ${summary.metrics_compared} metrics compared` : ""}
            </p>
          </div>

          <div className="flex items-start gap-6 flex-shrink-0">
            <div className="hidden lg:block text-center">
              <div className="text-white">
                <HealthGauge
                  score={summary.health_score || 0}
                  band={summary.health_band}
                  size={150}
                  label=""
                />
              </div>
              <p className="text-[10px] uppercase tracking-wider text-white/60 -mt-1">Benchmark health</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/15 transition text-white/80 hover:text-white"
              title="Close (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Headline numbers */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <HeroStat
            label="Functional opportunity"
            value={moneyRange(functional.savings_low, functional.savings_high, currency)}
            sub={functional.fte_gap ? `${fteCount(functional.fte_gap)} equivalent` : "Right-sizing to median"}
          />
          <HeroStat
            label="Structural opportunity"
            value={moneyRange(structural.savings_low, structural.savings_high, currency)}
            sub={structural.fte_gap ? `${fteCount(structural.fte_gap)} equivalent` : "Spans and layers"}
            muted
          />
          <HeroStat
            label="Above benchmark"
            value={<CountUp value={summary.unfavourable_count || 0} format={(v) => Math.round(v)} />}
            sub={`of ${summary.metrics_compared || 0} metrics compared`}
            tone="bad"
          />
          <HeroStat
            label="At or better"
            value={<CountUp value={(summary.in_line_count || 0) + (summary.favourable_count || 0)} format={(v) => Math.round(v)} />}
            sub={`${num(coverage?.coverage_pct, 0)}% FTE coverage`}
            tone="good"
          />
        </div>

        <p className="text-[11px] text-white/50 mt-3">
          Functional and structural opportunity overlap — they draw on the same population and must not be added together.
        </p>
      </div>

      {/* Streaming progress */}
      {running && (
        <div className="relative">
          <div className="h-1 bg-white/15">
            <div
              className="h-full bg-gradient-to-r from-teal-300 to-white transition-all duration-500"
              style={{ width: `${status?.progress || 5}%` }}
            />
          </div>
          <div className="px-6 sm:px-10 py-2 bg-black/20 flex items-center gap-2.5">
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-teal-300 animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
            <span className="text-xs text-white/85">{status?.message || "Working…"}</span>
            <span className="ml-auto text-[11px] tabular-nums text-white/50">{status?.progress || 0}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroStat({ label, value, sub, tone = "brand", muted = false }) {
  const accent = {
    brand: "text-white",
    good: "text-emerald-300",
    bad: "text-rose-300",
  }[tone];
  return (
    <div className={`rounded-xl px-4 py-3 border backdrop-blur-sm ${
      muted ? "bg-white/[0.07] border-white/15" : "bg-white/[0.12] border-white/25"
    }`}>
      <p className="text-[10px] uppercase tracking-wider font-bold text-white/60">{label}</p>
      <p className={`text-xl font-black tabular-nums mt-0.5 ${accent}`}>{value}</p>
      <p className="text-[11px] text-white/55 mt-0.5">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section rail
// ---------------------------------------------------------------------------

function SectionRail({ sections, active, running, onSelect }) {
  return (
    <nav className="hidden md:flex flex-col w-60 flex-shrink-0 border-r border-slate-200 bg-white overflow-y-auto bm-scroll">
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Report contents</p>
      </div>
      <div className="p-2 space-y-0.5">
        {sections.length === 0 && (
          <div className="px-3 py-4 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        )}
        {sections.map((s) => {
          const isActive = active === s.id;
          const done = Boolean(s.text);
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all ${
                isActive
                  ? "bg-brand-50 text-brand-600 shadow-sm ring-1 ring-brand-200"
                  : "text-slate-500 hover:bg-slate-50 hover:text-brand-600"
              }`}
            >
              <span className={`mt-0.5 flex-shrink-0 ${isActive ? "text-brand-500" : "text-slate-400"}`}>
                <SectionIcon name={s.icon} />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{s.eyebrow}</span>
                <span className="block text-xs font-semibold leading-tight">{s.title}</span>
              </span>
              <span className="ml-auto flex-shrink-0 mt-1">
                {done ? (
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : running ? (
                  <span className="block w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Scorecard — the deterministic layer, above all narration
// ---------------------------------------------------------------------------

function Scorecard({ comparison, currency }) {
  const { summary = {}, coverage = {}, currency: fx = {}, opportunities = [], variance = [] } = comparison;
  const warnings = [...(coverage.warnings || [])];
  if (fx.message) warnings.push(fx.message);

  const topVariances = useMemo(
    () => variance
      .filter((r) => r.verdict === "unfavourable" && r.delta_pct !== null)
      .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))
      .slice(0, 5),
    [variance],
  );

  return (
    <section className="space-y-5" style={{ animation: "bmFadeUp 500ms ease-out both" }}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Total FTE" tone="brand" delay={0}
          value={<CountUp value={summary.total_fte || 0} format={(v) => num(v, 0)} />}
          sub={`${num(summary.headcount, 0)} people on file`}
        />
        <KpiTile
          label="Workforce cost" tone="slate" delay={60}
          value={<CountUp value={summary.total_cost || 0} format={(v) => money(v, currency)} />}
          sub={`Reported in ${fx.client_currency || currency}`}
        />
        <KpiTile
          label="Opportunities found" tone="amber" delay={120}
          value={<CountUp value={opportunities.length} format={(v) => Math.round(v)} />}
          sub={`${(summary.functional || {}).opportunity_count || 0} functional · ${(summary.structural || {}).opportunity_count || 0} structural`}
        />
        <KpiTile
          label="Benchmark pack" tone="teal" delay={180}
          value={<span className="text-base leading-snug">{summary.pack_name || "—"}</span>}
          sub={summary.pack_industry || "Cross-industry"}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <ChartCard title="Biggest gaps to median" subtitle="Client position within the P25–P75 band" className="lg:col-span-2">
          {topVariances.length ? (
            <div className="space-y-3">
              {topVariances.map((r, i) => (
                <div key={i}>
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-[11px] font-bold text-brand-600">{rowLabel(r)}</span>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">{r.scope}</span>
                  </div>
                  <VarianceBullet row={r} currency={currency} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-8 text-center">
              No unfavourable variances — this organisation sits within the benchmark band on every measured metric.
            </p>
          )}
        </ChartCard>

        <div className="space-y-4">
          <ChartCard title="Data confidence">
            <CoverageMeter coverage={coverage} />
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Realisation assumption</span>
                <span className="font-semibold text-slate-700">
                  {Math.round((summary.realization_low || 0) * 100)}–{Math.round((summary.realization_high || 0) * 100)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Currency basis</span>
                <span className="font-semibold text-slate-700">
                  {fx.ok ? `${fx.pack_currency} aligned` : "Cost metrics suppressed"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Functions matched</span>
                <span className="font-semibold text-slate-700">{(coverage.matched_functions || []).length}</span>
              </div>
            </div>
          </ChartCard>

          {warnings.length > 0 && <WarningsCard warnings={warnings} />}
        </div>
      </div>
    </section>
  );
}

function WarningsCard({ warnings }) {
  const [open, setOpen] = useState(false);
  const shown = open ? warnings : warnings.slice(0, 1);
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3.03l-6.93-11.6a2 2 0 00-3.42 0l-6.93 11.6A2 2 0 005.07 19z" />
        </svg>
        <p className="text-xs font-bold text-amber-800">Read these caveats first</p>
      </div>
      <ul className="space-y-1.5">
        {shown.map((w, i) => (
          <li key={i} className="text-[11px] leading-relaxed text-amber-900/90 flex gap-2">
            <span className="mt-[6px] w-1 h-1 rounded-full bg-amber-500 flex-shrink-0" />
            <span>{w}</span>
          </li>
        ))}
      </ul>
      {warnings.length > 1 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[11px] font-semibold text-amber-700 hover:text-amber-900"
        >
          {open ? "Show less" : `+${warnings.length - 1} more`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A narrative section with its visuals
// ---------------------------------------------------------------------------

const ReportSection = React.forwardRef(function ReportSection(
  { section, text, streaming, evidence, comparison, currency }, ref,
) {
  return (
    <section
      ref={ref}
      data-section={section.id}
      className="scroll-mt-6"
      style={{ animation: "bmFadeUp 460ms ease-out both" }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center shadow-md flex-shrink-0">
          <SectionIcon name={section.icon} className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-bold text-brand-400">{section.eyebrow}</p>
          <h3 className="text-lg font-black text-brand-600 leading-tight">{section.title}</h3>
        </div>
        {streaming && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-teal-600 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
            Writing
          </span>
        )}
      </div>

      <SectionVisuals section={section} comparison={comparison} currency={currency} />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-5 mt-4">
        {text ? (
          <ReportMarkdown text={text} />
        ) : (
          <div className="space-y-2.5 py-1">
            {[100, 92, 96, 70].map((w, i) => (
              <div key={i} className="h-3 rounded bg-slate-100 relative overflow-hidden bm-sweep" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {streaming && text && <span className="inline-block w-1.5 h-4 bg-brand-400 ml-0.5 animate-blink align-middle" />}
      </div>

      {evidence?.length > 0 && <EvidencePanel queries={evidence} />}
    </section>
  );
});

function SectionVisuals({ section, comparison, currency }) {
  const visuals = section.visuals || [];
  const { variance = [], opportunities = [], org_aggregate = {}, function_aggregates = [] } = comparison;

  const blocks = [];

  if (visuals.includes("variance_diverging")) {
    blocks.push(
      <ChartCard key="vd" title="Variance against benchmark median" subtitle="Positive means above the benchmark; red is unfavourable">
        <VarianceDiverging rows={variance} currency={currency} />
      </ChartCard>
    );
  }
  if (visuals.includes("function_table")) {
    blocks.push(
      <ChartCard key="ft" title="Function size vs efficiency" subtitle="Bubble area is workforce cost">
        <FunctionQuadrant functionAggregates={function_aggregates} variance={variance} currency={currency} />
      </ChartCard>
    );
  }
  if (visuals.includes("span_distribution")) {
    blocks.push(
      <ChartCard key="sd" title="Manager span distribution">
        <SpanDistribution orgAggregate={org_aggregate} variance={variance} />
      </ChartCard>
    );
  }
  if (visuals.includes("layer_pyramid")) {
    blocks.push(
      <ChartCard key="lp" title="Organisational depth" subtitle="Layers beyond the benchmark are hatched">
        <LayerPyramid orgAggregate={org_aggregate} variance={variance} />
      </ChartCard>
    );
  }
  if (visuals.includes("cost_vs_span_scatter")) {
    blocks.push(
      <ChartCard key="cs" title="Where the variance concentrates" subtitle="Function size against distance from median">
        <FunctionQuadrant functionAggregates={function_aggregates} variance={variance} currency={currency} />
      </ChartCard>
    );
  }
  if (visuals.includes("savings_waterfall")) {
    blocks.push(
      <ChartCard
        key="sw"
        title="Ranked opportunity build-up"
        subtitle="Cumulative upper-bound savings, largest first"
      >
        <SavingsWaterfall opportunities={opportunities} currency={currency} />
      </ChartCard>
    );
  }
  if (visuals.includes("opportunity_table")) {
    blocks.push(
      <div key="ot" className="space-y-2.5">
        {opportunities.slice(0, 8).map((o) => (
          <OpportunityCard key={`${o.rank}-${o.label}`} opportunity={o} currency={currency} />
        ))}
        {!opportunities.length && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
            <p className="text-xs text-emerald-800 font-semibold">
              No quantified opportunities — every measured metric sits inside the benchmark band.
            </p>
          </div>
        )}
      </div>
    );
  }
  if (visuals.includes("roadmap_timeline")) {
    blocks.push(
      <ChartCard key="rt" title="Delivery horizons">
        <RoadmapTimeline />
      </ChartCard>
    );
  }
  if (visuals.includes("health_gauge") || visuals.includes("kpi_cards")) {
    // The hero and scorecard already carry these; repeating them here would be noise.
    return null;
  }

  if (!blocks.length) return null;

  const grid = blocks.length > 1 && !visuals.includes("opportunity_table")
    ? "grid lg:grid-cols-2 gap-4"
    : "space-y-4";

  return <div className={grid}>{blocks}</div>;
}

function EvidencePanel({ queries }) {
  const [open, setOpen] = useState(false);
  const ok = queries.filter((q) => !q.error);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 hover:text-brand-600 hover:border-brand-200 transition shadow-sm"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V7M4 7a2 2 0 012-2h12a2 2 0 012 2M4 7h16M9 11h6" />
        </svg>
        {ok.length} drill-down quer{ok.length === 1 ? "y" : "ies"} ran for this section
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {queries.map((q, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-900 overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-800 flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-300 truncate">{q.purpose || "Drill-down"}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0">
                  {q.error ? "failed" : `${q.row_count ?? 0} rows`}
                </span>
              </div>
              <pre className="px-3 py-2 text-[10px] leading-relaxed text-teal-300 font-mono overflow-x-auto whitespace-pre-wrap">
                {q.sql}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

function MethodologyBlock({ comparison }) {
  const { pack = {}, coverage = {}, summary = {}, suppressed_metrics = [], function_mapping = [] } = comparison;
  const unmapped = (coverage.unmapped_functions || []).slice(0, 12);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
        <h3 className="text-sm font-black text-brand-600">Methodology and provenance</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Every number above is computed in SQL against the live dataset. The narrative is written from those numbers.
        </p>
      </div>
      <div className="p-6 grid md:grid-cols-2 gap-6 text-xs">
        <div className="space-y-2.5">
          <Detail label="Benchmark pack" value={pack.name} />
          <Detail label="Industry" value={pack.industry || "Cross-industry"} />
          <Detail label="Region" value={pack.region || "Global"} />
          <Detail label="Size band" value={pack.size_band || "All sizes"} />
          <Detail label="Effective year" value={pack.effective_year} />
          <Detail label="Source" value={pack.source_type === "custom" ? "Client-supplied pack" : "Built-in A&M pack"} />
          <Detail
            label="Realisation"
            value={`${Math.round((summary.realization_low || 0) * 100)}–${Math.round((summary.realization_high || 0) * 100)}% of the gross gap`}
          />
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Function mapping</p>
            <p className="text-slate-600">
              {function_mapping.filter((m) => m.mapped_to).length} client function
              {function_mapping.filter((m) => m.mapped_to).length === 1 ? "" : "s"} matched to the pack taxonomy
              {unmapped.length > 0 && `; ${coverage.unmapped_functions.length} unmapped`}.
            </p>
            {unmapped.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {unmapped.map((f) => (
                  <span key={f} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px]">{f}</span>
                ))}
              </div>
            )}
          </div>
          {suppressed_metrics.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">
                Metrics deliberately withheld
              </p>
              <ul className="space-y-1">
                {suppressed_metrics.slice(0, 5).map((m) => (
                  <li key={m.metric_key} className="text-slate-500 leading-relaxed">
                    <span className="font-semibold text-slate-600">{m.label}</span> — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-1.5">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-slate-700 text-right">{value ?? "—"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function FooterBar({ running, hasReport, saved, savedId, busyAction, onExport, onSave, onRegenerate, onClose, onViewSaved }) {
  return (
    <div className="flex-shrink-0 px-6 py-3 bg-white border-t border-slate-200 flex items-center gap-3 flex-wrap">
      {saved ? (
        /* After saving: explain where to find it */
        <div className="flex items-center gap-2 text-[11px]">
          <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-emerald-700 font-semibold">Report saved.</span>
          <span className="text-slate-400">
            Close this modal and click it in the <span className="font-semibold text-slate-600">Saved reports</span> section to reopen instantly without re-running.
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 hidden sm:block">
          Directional analysis for discussion — validate assumptions before client use.
        </p>
      )}

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        {!running && (
          <button
            onClick={onRegenerate}
            className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-600 transition"
          >
            Regenerate
          </button>
        )}

        {!saved ? (
          <button
            onClick={onSave}
            disabled={!hasReport || busyAction === "save"}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold transition border border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-40"
          >
            {busyAction === "save" ? "Saving…" : "Save report"}
          </button>
        ) : (
          /* Saved state: show a "Close & view saved" shortcut */
          <button
            onClick={onViewSaved}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Saved — close to view
          </button>
        )}

        <button
          onClick={onExport}
          disabled={!hasReport || busyAction === "export"}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold shadow-sm transition disabled:opacity-40"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {busyAction === "export" ? "Building…" : "Export to Excel"}
        </button>
        <button
          onClick={onClose}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 transition"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 flex items-start gap-3">
      <svg className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div className="min-w-0">
        <p className="text-sm font-bold text-rose-800">The analysis could not complete</p>
        <p className="text-xs text-rose-700 mt-0.5">{message}</p>
        <button
          onClick={onRetry}
          className="mt-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function SkeletonReport({ status }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-white border border-slate-200 relative overflow-hidden bm-sweep" />
        ))}
      </div>
      <div className="h-72 rounded-2xl bg-white border border-slate-200 relative overflow-hidden bm-sweep" />
      <p className="text-center text-xs text-slate-400">
        {status?.message || "Computing the deterministic comparison…"}
      </p>
    </div>
  );
}
