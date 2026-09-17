/**
 * Benchmarking — compare the active dataset against an industry or custom
 * benchmark pack.
 *
 * Left rail configures the comparison (pack, context, assumptions); the main
 * pane shows the deterministic preview, which recomputes whenever the config
 * changes. The AI deep-analysis report opens on top of this in a modal.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  benchmarkListPacks, benchmarkGetConfig, benchmarkSaveConfig, benchmarkPreview,
  benchmarkDownloadTemplate, benchmarkUploadPack, benchmarkDeletePack,
  benchmarkDuplicatePack, benchmarkListReports, benchmarkGetReport, benchmarkDeleteReport,
} from "../api/backend";
import BenchmarkReportModal from "./benchmark/BenchmarkReportModal";
import {
  HealthGauge, KpiTile, VarianceDiverging, VarianceTable, SavingsWaterfall,
  OpportunityCard, CoverageMeter, ChartCard, Chip, CountUp, FunctionQuadrant,
} from "./benchmark/BenchmarkCharts";
import { money, moneyRange, num, fteCount } from "./benchmark/benchmarkTheme";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY", "CHF", "SGD", "AED"];

export default function Benchmarking({ datasetId, scenarioId, datasetName }) {
  const [packs, setPacks] = useState([]);
  const [config, setConfig] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [openedReport, setOpenedReport] = useState(null);
  const [savedReports, setSavedReports] = useState([]);
  const [focus, setFocus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState("overview");

  const fileInputRef = useRef(null);
  const previewTimer = useRef(null);

  const currency = preview?.pack?.currency || "USD";
  const summary = preview?.summary || {};
  const activePack = useMemo(
    () => packs.find((p) => p.id === config?.pack_id) || null,
    [packs, config?.pack_id],
  );

  // --- Load packs + config --------------------------------------------------

  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([benchmarkListPacks(), benchmarkGetConfig(datasetId)])
      .then(([packsRes, configRes]) => {
        if (cancelled) return;
        setPacks(packsRes.packs || []);
        setConfig(configRes.config || null);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || "Could not load benchmark packs"))
      .finally(() => !cancelled && setLoading(false));

    benchmarkListReports(datasetId)
      .then((r) => !cancelled && setSavedReports(r.reports || []))
      .catch(() => {});

    return () => { cancelled = true; };
  }, [datasetId]);

  // --- Preview, debounced against config edits ------------------------------

  const runPreview = useCallback((cfg) => {
    if (!datasetId || !scenarioId || !cfg) return;
    setPreviewing(true);
    setError(null);
    benchmarkPreview({
      dataset_id: datasetId,
      scenario_id: scenarioId,
      pack_id: cfg.pack_id || undefined,
      context: cfg.context || undefined,
      function_map: Object.keys(cfg.function_map || {}).length ? cfg.function_map : undefined,
      realization_low: cfg.realization_low,
      realization_high: cfg.realization_high,
      target_span: cfg.target_span,
    })
      .then(setPreview)
      .catch((e) => setError(e?.response?.data?.detail || "Benchmark preview failed"))
      .finally(() => setPreviewing(false));
  }, [datasetId, scenarioId]);

  useEffect(() => {
    if (!config) return;
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => runPreview(config), 450);
    return () => clearTimeout(previewTimer.current);
  }, [config, runPreview]);

  // --- Mutators -------------------------------------------------------------

  const patchConfig = (patch) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const patchContext = (patch) => {
    setConfig((prev) => ({ ...prev, context: { ...(prev.context || {}), ...patch } }));
    setDirty(true);
  };

  const saveConfig = async () => {
    if (!config) return;
    try {
      await benchmarkSaveConfig({
        dataset_id: datasetId,
        pack_id: config.pack_id,
        context: config.context || {},
        function_map: config.function_map || {},
        realization_low: config.realization_low,
        realization_high: config.realization_high,
        target_span: config.target_span,
      });
      setDirty(false);
      flash("Configuration saved for this dataset");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not save the configuration");
    }
  };

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3200);
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await benchmarkUploadPack(file);
      const refreshed = await benchmarkListPacks();
      setPacks(refreshed.packs || []);
      patchConfig({ pack_id: res.pack.id });
      flash(
        `Loaded "${res.pack.name}" with ${res.metric_count} metrics` +
        (res.warnings?.length ? ` — ${res.warnings.length} row(s) skipped` : "")
      );
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not parse that workbook");
    } finally {
      setUploading(false);
    }
  };

  const handleDuplicate = async () => {
    if (!activePack) return;
    try {
      const res = await benchmarkDuplicatePack(activePack.id);
      const refreshed = await benchmarkListPacks();
      setPacks(refreshed.packs || []);
      patchConfig({ pack_id: res.pack.id });
      flash(`Created an editable copy: ${res.pack.name}`);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not duplicate the pack");
    }
  };

  const handleDeletePack = async () => {
    if (!activePack || activePack.is_builtin) return;
    try {
      await benchmarkDeletePack(activePack.id);
      const refreshed = await benchmarkListPacks();
      setPacks(refreshed.packs || []);
      patchConfig({ pack_id: refreshed.packs?.[0]?.id || null });
      flash("Pack deleted");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not delete the pack");
    }
  };

  const openSavedReport = async (id) => {
    try {
      const res = await benchmarkGetReport(id);
      setOpenedReport(res.report);
      setReportOpen(true);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not open that report");
    }
  };

  // Called by BenchmarkReportModal immediately after a successful save so the
  // list refreshes without requiring the modal to be closed first.
  const handleReportSaved = useCallback(() => {
    benchmarkListReports(datasetId)
      .then((r) => setSavedReports(r.reports || []))
      .catch(() => {});
  }, [datasetId]);

  const removeSavedReport = async (id) => {
    try {
      await benchmarkDeleteReport(id);
      setSavedReports((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not delete that report");
    }
  };

  const openNewReport = () => { setOpenedReport(null); setReportOpen(true); };

  const closeReport = () => {
    setReportOpen(false);
    setOpenedReport(null);
    benchmarkListReports(datasetId).then((r) => setSavedReports(r.reports || [])).catch(() => {});
  };

  // --- Guards ---------------------------------------------------------------

  if (!datasetId || !scenarioId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-6 shadow-lg">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <p className="text-xl font-semibold text-brand-700 mb-1">No Dataset Active</p>
        <p className="text-sm text-brand-400">Load a dataset to benchmark it against industry packs.</p>
      </div>
    );
  }

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-800">Benchmarking</h2>
          <p className="text-xs text-gray-500 truncate">
            {activePack ? `${activePack.name} · ${activePack.industry || "Cross-industry"}` : "Select a benchmark pack"}
          </p>
        </div>

        {previewing && (
          <span className="ml-3 inline-flex items-center gap-1.5 text-[11px] text-brand-500 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            Recomputing
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <button
              onClick={saveConfig}
              className="px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition"
            >
              Save configuration
            </button>
          )}
          <button
            onClick={openNewReport}
            disabled={!preview}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-40"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate AI report
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-800 flex-shrink-0">
          {notice}
        </div>
      )}
      {error && (
        <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center gap-2 flex-shrink-0">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-bold">×</button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Config rail */}
        <aside className="w-[340px] flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto bm-scroll">
          <ConfigPanel
            packs={packs}
            config={config}
            activePack={activePack}
            preview={preview}
            uploading={uploading}
            focus={focus}
            setFocus={setFocus}
            onPatch={patchConfig}
            onPatchContext={patchContext}
            onDownloadTemplate={() => benchmarkDownloadTemplate(activePack?.id)}
            onUploadClick={() => fileInputRef.current?.click()}
            onDuplicate={handleDuplicate}
            onDeletePack={handleDeletePack}
            savedReports={savedReports}
            onOpenReport={openSavedReport}
            onDeleteReport={removeSavedReport}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xlsm"
            onChange={handleUpload}
            className="hidden"
          />
        </aside>

        {/* Results */}
        <div className="flex-1 overflow-y-auto bm-scroll">
          {!preview ? (
            <div className="p-8"><LoadingState inline /></div>
          ) : (
            <div className="p-6 space-y-5 max-w-[1200px]">
              <SummaryStrip summary={summary} preview={preview} currency={currency} />

              <div className="flex items-center gap-1.5 border-b border-gray-200">
                {[
                  ["overview", "Overview"],
                  ["opportunities", `Opportunities (${preview.opportunities?.length || 0})`],
                  ["detail", "All variances"],
                  ["mapping", "Function mapping"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-3.5 py-2 text-xs font-semibold border-b-2 -mb-px transition ${
                      tab === key
                        ? "border-brand-500 text-brand-600"
                        : "border-transparent text-slate-500 hover:text-brand-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "overview" && <OverviewTab preview={preview} currency={currency} />}
              {tab === "opportunities" && <OpportunitiesTab preview={preview} currency={currency} />}
              {tab === "detail" && (
                <ChartCard title="Every measured metric" subtitle="Sortable; click a column header to reorder">
                  <VarianceTable rows={preview.variance || []} currency={currency} maxHeight="34rem" />
                </ChartCard>
              )}
              {tab === "mapping" && <MappingTab preview={preview} />}
            </div>
          )}
        </div>
      </div>

      <BenchmarkReportModal
        open={reportOpen}
        onClose={closeReport}
        datasetId={datasetId}
        scenarioId={scenarioId}
        packId={config?.pack_id}
        datasetName={datasetName}
        focus={focus}
        initialReport={openedReport}
        onSaved={handleReportSaved}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config rail
// ---------------------------------------------------------------------------

function ConfigPanel({
  packs, config, activePack, preview, uploading, focus, setFocus,
  onPatch, onPatchContext, onDownloadTemplate, onUploadClick, onDuplicate,
  onDeletePack, savedReports, onOpenReport, onDeleteReport,
}) {
  const context = config?.context || {};
  const builtin = packs.filter((p) => p.is_builtin);
  const custom = packs.filter((p) => !p.is_builtin);

  return (
    <div className="divide-y divide-gray-100">
      {/* ── Saved reports — always at the top so returning users find them immediately ── */}
      <Section title="Saved reports" icon="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2">
        {savedReports.length === 0 ? (
          <p className="text-[11px] text-slate-400 leading-relaxed py-1">
            No saved reports yet. Generate a report and click <span className="font-semibold text-slate-500">Save report</span> to store it here — it will reopen instantly without re-running the analysis.
          </p>
        ) : (
          <div className="space-y-1.5">
            {savedReports.map((r) => (
              <div key={r.id} className="group flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 hover:border-brand-300 hover:bg-brand-50/40 transition">
                <button onClick={() => onOpenReport(r.id)} className="flex-1 min-w-0 text-left">
                  <p className="text-[11px] font-semibold text-slate-700 truncate">{r.title || `Report #${r.id}`}</p>
                  <p className="text-[10px] text-slate-400">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                  </p>
                </button>
                <button
                  onClick={() => onDeleteReport(r.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition text-sm leading-none flex-shrink-0"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Benchmark pack" icon="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10">
        <select
          value={config?.pack_id || ""}
          onChange={(e) => onPatch({ pack_id: Number(e.target.value) || null })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white"
        >
          {custom.length > 0 && (
            <optgroup label="Your packs">
              {custom.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
          <optgroup label="Built-in">
            {builtin.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        </select>

        {activePack && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <Chip tone="brand">{activePack.region || "Global"}</Chip>
            <Chip>{activePack.currency}</Chip>
            {activePack.effective_year && <Chip>{activePack.effective_year}</Chip>}
            <Chip tone={activePack.is_builtin ? "neutral" : "good"}>
              {activePack.is_builtin ? "Built-in" : "Custom"}
            </Chip>
            {activePack.metric_count ? <Chip>{activePack.metric_count} metrics</Chip> : null}
          </div>
        )}
        {activePack?.notes && (
          <p className="text-[11px] leading-relaxed text-slate-500 mt-2.5 bg-slate-50 rounded-lg p-2.5 border border-slate-100">
            {activePack.notes}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={onDownloadTemplate}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-600 transition"
          >
            Download template
          </button>
          <button
            onClick={onUploadClick}
            disabled={uploading}
            className="px-2.5 py-2 rounded-lg border border-brand-300 bg-brand-50 text-[11px] font-semibold text-brand-600 hover:bg-brand-100 transition disabled:opacity-50"
          >
            {uploading ? "Parsing…" : "Upload pack"}
          </button>
          <button
            onClick={onDuplicate}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-600 transition"
          >
            Duplicate
          </button>
          <button
            onClick={onDeletePack}
            disabled={!activePack || activePack.is_builtin}
            className="px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600 transition disabled:opacity-40"
          >
            Delete
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
          Download the template, fill in your own P25 / median / P75 values, then upload it back to
          benchmark against a client-specific dataset.
        </p>
      </Section>

      <Section title="Client context" icon="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
        <div className="space-y-2.5">
          <Field label="Reporting currency">
            <select
              value={context.currency || ""}
              onChange={(e) => onPatchContext({ currency: e.target.value || null })}
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Not set</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          {context.currency && activePack && context.currency !== activePack.currency && (
            <Field label={`FX rate (1 ${context.currency} → ${activePack.currency})`}>
              <input
                type="number" step="0.0001" min="0"
                value={context.fx_rate ?? ""}
                onChange={(e) => onPatchContext({ fx_rate: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="e.g. 0.012"
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>
          )}

          <Field label="Annual revenue" hint="Unlocks cost-as-%-of-revenue benchmarks">
            <input
              type="number" min="0"
              value={context.revenue ?? ""}
              onChange={(e) => onPatchContext({ revenue: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="Optional"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500"
            />
          </Field>
        </div>
      </Section>

      <Section title="Assumptions" icon="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z">
        <div className="space-y-3.5">
          <SliderField
            label="Target span of control"
            value={config?.target_span ?? 6}
            min={3} max={12} step={0.5}
            display={(v) => `${v} reports`}
            onChange={(v) => onPatch({ target_span: v })}
            hint="Managers below this count as sub-scale"
          />
          <SliderField
            label="Realisation — low"
            value={Math.round((config?.realization_low ?? 0.6) * 100)}
            min={10} max={100} step={5}
            display={(v) => `${v}%`}
            onChange={(v) => onPatch({ realization_low: v / 100 })}
          />
          <SliderField
            label="Realisation — high"
            value={Math.round((config?.realization_high ?? 0.7) * 100)}
            min={10} max={100} step={5}
            display={(v) => `${v}%`}
            onChange={(v) => onPatch({ realization_high: v / 100 })}
            hint="Share of the gross gap assumed capturable"
          />
        </div>
      </Section>

      <Section title="Report focus" icon="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z">
        <textarea
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          rows={3}
          placeholder="Optional. e.g. Concentrate on Finance and Procurement, and on the European entities."
          className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-xs resize-none outline-none focus:ring-2 focus:ring-brand-500"
        />
        <p className="text-[10px] text-slate-400 mt-1.5">
          Steers the AI narrative without changing any computed number.
        </p>
      </Section>

      {preview?.coverage && (
        <Section title="Coverage" icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z">
          <CoverageMeter coverage={preview.coverage} />
        </Section>
      )}

    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-3.5 h-3.5 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
        <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function SliderField({ label, value, min, max, step, display, onChange, hint }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-[11px] font-medium text-slate-600">{label}</label>
        <span className="text-[11px] font-bold text-brand-600 tabular-nums">{display(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-500 cursor-pointer"
      />
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function SummaryStrip({ summary, preview, currency }) {
  const functional = summary.functional || {};
  const structural = summary.structural || {};

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[auto,1fr] gap-4 items-stretch">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-4 flex items-center justify-center">
        <HealthGauge score={summary.health_score || 0} band={summary.health_band} size={170} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Functional opportunity" tone="brand" delay={0}
          value={moneyRange(functional.savings_low, functional.savings_high, currency)}
          sub={functional.fte_gap ? `${fteCount(functional.fte_gap)} equivalent` : "Right-sizing to median"}
        />
        <KpiTile
          label="Structural opportunity" tone="teal" delay={70}
          value={moneyRange(structural.savings_low, structural.savings_high, currency)}
          sub={structural.fte_gap ? `${fteCount(structural.fte_gap)} equivalent` : "Spans and layers"}
        />
        <KpiTile
          label="Above benchmark" tone="rose" delay={140}
          value={<CountUp value={summary.unfavourable_count || 0} format={(v) => Math.round(v)} />}
          sub={`of ${summary.metrics_compared || 0} metrics compared`}
        />
        <KpiTile
          label="Workforce" tone="slate" delay={210}
          value={<CountUp value={summary.total_fte || 0} format={(v) => num(v, 0)} />}
          sub={summary.total_cost ? `${money(summary.total_cost, currency)} total cost` : `${num(summary.headcount, 0)} people`}
        />
      </div>
      {(preview.coverage?.warnings?.length > 0 || preview.currency?.message) && (
        <div className="xl:col-span-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <ul className="space-y-1">
            {[...(preview.coverage?.warnings || []), preview.currency?.message]
              .filter(Boolean)
              .map((w, i) => (
                <li key={i} className="text-[11px] text-amber-900/90 flex gap-2 leading-relaxed">
                  <span className="mt-[6px] w-1 h-1 rounded-full bg-amber-500 flex-shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ preview, currency }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <ChartCard
        title="Variance against benchmark median"
        subtitle="Largest gaps first; red is unfavourable"
        className="lg:col-span-2"
      >
        <VarianceDiverging rows={preview.variance || []} currency={currency} limit={16} />
      </ChartCard>
      <ChartCard title="Function size vs efficiency" subtitle="Bubble area is workforce cost">
        <FunctionQuadrant
          functionAggregates={preview.function_aggregates}
          variance={preview.variance}
          currency={currency}
        />
      </ChartCard>
      <ChartCard title="Where the value sits" subtitle="Cumulative upper-bound savings">
        <SavingsWaterfall opportunities={preview.opportunities || []} currency={currency} limit={8} />
      </ChartCard>
    </div>
  );
}

function OpportunitiesTab({ preview, currency }) {
  const [bucket, setBucket] = useState("all");
  const opportunities = (preview.opportunities || []).filter(
    (o) => bucket === "all" || o.bucket === bucket,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        {[["all", "All"], ["functional", "Functional"], ["structural", "Structural"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setBucket(key)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition ${
              bucket === key
                ? "bg-brand-500 text-white border-brand-500 shadow-sm"
                : "bg-white text-slate-500 border-slate-200 hover:border-brand-300 hover:text-brand-600"
            }`}
          >
            {label}
          </button>
        ))}
        <p className="ml-auto text-[11px] text-slate-400">
          Functional and structural sizing overlap — do not add them together.
        </p>
      </div>

      <div className="space-y-2.5">
        {opportunities.map((o) => (
          <OpportunityCard key={`${o.rank}-${o.label}`} opportunity={o} currency={currency} />
        ))}
        {!opportunities.length && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
            <p className="text-sm font-semibold text-emerald-800">Nothing to size in this bucket</p>
            <p className="text-xs text-emerald-700 mt-1">
              Every measured metric here sits inside the benchmark band.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MappingTab({ preview }) {
  const mapping = preview.function_mapping || [];
  const mapped = mapping.filter((m) => m.mapped_to);
  const unmapped = mapping.filter((m) => !m.mapped_to);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <ChartCard title={`Matched to the pack (${mapped.length})`} subtitle="Client function → benchmark function">
        <div className="space-y-1.5 max-h-[26rem] overflow-y-auto bm-scroll pr-1">
          {mapped.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-slate-100 last:border-0">
              <span className="flex-1 text-slate-700 truncate">{m.client_value}</span>
              <svg className="w-3 h-3 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <span className="flex-1 text-right font-semibold text-brand-600 truncate">{m.mapped_to}</span>
            </div>
          ))}
          {!mapped.length && <p className="text-xs text-slate-400 py-6 text-center">Nothing matched yet.</p>}
        </div>
      </ChartCard>

      <ChartCard
        title={`Unmapped (${unmapped.length})`}
        subtitle="These sit outside the benchmark and dilute coverage"
      >
        <div className="space-y-1.5 max-h-[26rem] overflow-y-auto bm-scroll pr-1">
          {unmapped.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-slate-100 last:border-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              <span className="text-slate-600 truncate">{m.client_value}</span>
            </div>
          ))}
          {!unmapped.length && (
            <p className="text-xs text-emerald-600 py-6 text-center font-medium">
              Every client function maps to the benchmark taxonomy.
            </p>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-100 leading-relaxed">
          Run <span className="font-semibold">Rationalise</span> to fold these onto the master taxonomy —
          it is the single biggest lever on benchmark coverage.
        </p>
      </ChartCard>
    </div>
  );
}

function LoadingState({ inline = false }) {
  return (
    <div className={inline ? "space-y-4" : "flex flex-col items-center justify-center h-full gap-4 p-12"}>
      {inline ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-2xl bg-white border border-slate-200 relative overflow-hidden bm-sweep" />
            ))}
          </div>
          <div className="h-80 rounded-2xl bg-white border border-slate-200 relative overflow-hidden bm-sweep" />
        </>
      ) : (
        <>
          <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center">
            <svg className="w-6 h-6 text-brand-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <p className="text-sm text-slate-500">Loading benchmark packs…</p>
        </>
      )}
    </div>
  );
}
