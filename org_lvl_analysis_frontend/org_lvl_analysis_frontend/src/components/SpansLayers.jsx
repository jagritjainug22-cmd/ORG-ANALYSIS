import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Plot from "react-plotly.js";
import PptxGenJS from "pptxgenjs";
import {
  spansLayers,
  hierarchy as hierarchyBackend,
  listSpansScenarios,
  createSpansScenario,
  updateSpansScenario,
  deleteSpansScenario,
} from "../api/backend";
import * as XLSX from "xlsx";

const NAVY = "#01244A";
const BLUE_MID = "#5C8BB4";
const AMBER = "#ED8F12";
const TEAL = "#14B8A6";
const WHITE = "FFFFFF";
const NAVY_HEX = "01244A";
const BLUE_MID_HEX = "5C8BB4";
const LIGHT_BG_HEX = "E8EEF4";
const MAX_SCENARIOS = 5;
const CHART_FONT = "Manrope, Inter, sans-serif";
// Palette used across multi-series charts (comparison, scenario series) — keeps navy as the
// primary series and layers teal/amber/coral for additional series, per the app's chart palette.
const SERIES_COLORS = [NAVY, TEAL, AMBER, "#F97316", "#8B5CF6"];

function scenarioKey(s) {
  return s?.id != null ? `id:${s.id}` : `local:${s?.localKey}`;
}

function makeDraftScenario(index = 1, threshold = 5) {
  return {
    localKey: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    id: null,
    name: `Span ${threshold}`,
    threshold,
    result: null,
  };
}

function slimResultForSave(res) {
  if (!res) return {};
  const { df, ...rest } = res;
  return rest;
}

function OpenInOrgChartButton({ empId, onJump }) {
  if (!empId || !onJump) return null;
  return (
    <button
      type="button"
      onClick={() => onJump(empId)}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-brand-600 hover:text-white hover:bg-brand-500 rounded-lg border border-brand-200 hover:border-brand-500 transition-all duration-150"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      Org Chart
    </button>
  );
}

function StatCard({ label, value, sub, icon, badge }) {
  return (
    <div className="relative overflow-hidden bg-white/90 backdrop-blur-sm border border-brand-100 rounded-xl p-4 shadow-card hover:shadow-panel hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent pointer-events-none" />
      <div className="relative flex items-center gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider leading-none" style={{ fontFamily: CHART_FONT }}>{label}</p>
            {badge}
          </div>
          <p className="text-xl font-extrabold text-[#01244a] mt-1.5 leading-none" style={{ fontFamily: CHART_FONT }}>{value}</p>
        </div>
      </div>
      {sub && (
        <div className="relative mt-3.5 pt-2.5 border-t border-slate-100/60">
          <p className="text-[11px] text-slate-400 font-medium leading-normal">{sub}</p>
        </div>
      )}
    </div>
  );
}

// Simple heuristic benchmark for average span of control — widely-cited org design guidance
// puts a "healthy" span in the 5–8 range; below is often micro-management risk, well above
// can mean overloaded managers. Purely a visual cue, not a hard rule.
function spanBenchmarkBadge(avgSpan) {
  if (avgSpan == null || Number.isNaN(Number(avgSpan))) return null;
  const v = Number(avgSpan);
  if (v <= 0) return null;
  if (v < 5) {
    return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">Narrow</span>;
  }
  if (v <= 8) {
    return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">Optimal</span>;
  }
  return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-sky-100 text-sky-700">Wide</span>;
}


function fmtCost(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function SpansLayers({
  validatedDf,
  setValidatedDf,
  empCol = "",
  mgrCol = "",
  fteCol = "",
  flcCol = "",
  funcCol = "",
  jobTitleCol = "",
  datasetId = null,
  onJumpToOrgChart,
}) {
  const [scenarios, setScenarios] = useState(() => []);
  const [activeKey, setActiveKey] = useState(null);
  const [viewMode, setViewMode] = useState("scenario"); // "scenario" | "compare"
  const [loading, setLoading] = useState(false); // scenario simulation loading
  const [savingScenario, setSavingScenario] = useState(false);
  const [error, setError] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [analysisTab, setAnalysisTab] = useState("micro");
  const [downloading, setDownloading] = useState(false);
  const [pendingThreshold, setPendingThreshold] = useState(5); // used before any scenario has been created
  const [baseline, setBaseline] = useState({ result: null, loading: false, error: null });
  const enrichingRef = useRef(false);
  const plotRef = useRef(null);
  const scenariosLoadedForRef = useRef(null);
  const baselineRunKeyRef = useRef(null);
  
  // Dynamic filter states
  const [filters, setFilters] = useState([
    { id: 1, column: "", mode: "No Filter", values: [] },
    { id: 2, column: "", mode: "No Filter", values: [] }
  ]);
  const [nextId, setNextId] = useState(3);
  const [filteredDf, setFilteredDf] = useState(null);

  const activeScenario = useMemo(
    () => scenarios.find((s) => scenarioKey(s) === activeKey) || null,
    [scenarios, activeKey]
  );
  // Baseline (threshold = 0) computes automatically and always reflects the current data/filters.
  // A scenario's result — once simulated — is a superset of baseline fields plus the
  // threshold-dependent opportunity fields, so we can just prefer it when present.
  const baselineResult = baseline.result;
  const simResult = activeScenario?.result || null;
  const hasSimulation = !!simResult;
  const result = simResult || baselineResult;
  const threshold = activeScenario ? (activeScenario.threshold ?? 5) : pendingThreshold;

  const setThreshold = useCallback((val) => {
    const t = Number(val);
    if (!activeScenario) {
      setPendingThreshold(t);
      return;
    }
    setScenarios((prev) =>
      prev.map((s) =>
        scenarioKey(s) === activeKey
          ? { ...s, threshold: t, name: Number.isFinite(t) && t > 0 ? `Span ${t}` : s.name }
          : s
      )
    );
  }, [activeKey, activeScenario]);

  // Load persisted scenarios when dataset is available
  useEffect(() => {
    if (!datasetId) {
      scenariosLoadedForRef.current = null;
      return;
    }
    if (scenariosLoadedForRef.current === datasetId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await listSpansScenarios(datasetId);
        if (cancelled) return;
        const loaded = (data?.scenarios || []).map((s) => ({
          id: s.id,
          localKey: null,
          name: s.name,
          threshold: Number(s.threshold) || 0,
          result: s.result && Object.keys(s.result).length ? s.result : null,
        }));
        scenariosLoadedForRef.current = datasetId;
        setScenarios(loaded);
        setActiveKey(loaded.length ? scenarioKey(loaded[0]) : null);
      } catch (err) {
        console.warn("Could not load spans scenarios:", err);
        scenariosLoadedForRef.current = datasetId;
      }
    })();
    return () => { cancelled = true; };
  }, [datasetId]);

  // Safety check
  const baseDf = Array.isArray(validatedDf) ? validatedDf : [];

  const canRun =
    baseDf.length > 0 &&
    baseDf[0]?.hasOwnProperty("Span") &&
    baseDf[0]?.hasOwnProperty("Level");

  const needsEnrichment =
    baseDf.length > 0 &&
    empCol &&
    mgrCol &&
    (!baseDf[0]?.hasOwnProperty("Span") || !baseDf[0]?.hasOwnProperty("Level"));

  const getDisplayName = useCallback((row) => {
    if (!row) return "";
    if (jobTitleCol && row[jobTitleCol]) return String(row[jobTitleCol]);
    for (const c of ["Name", "Employee Name", "Full Name"]) {
      if (row[c]) return String(row[c]);
    }
    return empCol ? String(row[empCol] ?? "") : "";
  }, [empCol, jobTitleCol]);

  // Auto-enrich Span + Level via hierarchy when missing
  useEffect(() => {
    if (!needsEnrichment || enrichingRef.current) return;
    const run = async () => {
      enrichingRef.current = true;
      setEnriching(true);
      setError(null);
      try {
        const res = await hierarchyBackend(
          validatedDf, empCol, mgrCol, flcCol || null, fteCol || null,
          false, jobTitleCol || null, datasetId || null
        );
        if (res?.df && setValidatedDf) setValidatedDf(res.df);
      } catch (err) {
        console.error("Auto-enrichment failed:", err);
        setError("Could not compute Span/Level automatically. Run Hierarchy first.");
      } finally {
        setEnriching(false);
        enrichingRef.current = false;
      }
    };
    run();
  }, [needsEnrichment, validatedDf, empCol, mgrCol, flcCol, fteCol, jobTitleCol, datasetId, setValidatedDf]);

  // Get available columns for filtering
  const availableColumns = baseDf.length > 0 ? Object.keys(baseDf[0]) : [];

  const addFilter = () => {
    setFilters([...filters, { id: nextId, column: "", mode: "No Filter", values: [] }]);
    setNextId(nextId + 1);
  };

  const removeFilter = (id) => {
    if (filters.length > 1) {
      setFilters(filters.filter(f => f.id !== id));
    }
  };

  const updateFilterColumn = (id, column) => {
    setFilters(filters.map(f => 
      f.id === id ? { ...f, column, values: [] } : f
    ));
  };

  const updateFilterMode = (id, mode) => {
    setFilters(filters.map(f => 
      f.id === id ? { ...f, mode, values: mode === "No Filter" ? [] : f.values } : f
    ));
  };

  const updateFilterValues = (id, values) => {
    setFilters(filters.map(f => 
      f.id === id ? { ...f, values } : f
    ));
  };

  const getFilterLabel = (index) => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (index < 26) return letters[index];
    return letters[Math.floor(index / 26) - 1] + letters[index % 26];
  };

  // Get unique values for a column
  const getUniqueValues = (colName) => {
    if (!colName || !baseDf.length) return [];
    const values = [...new Set(baseDf.map(row => row[colName]).filter(v => v != null))];
    
    // Sort numerically if column is "Level", otherwise sort as strings
    if (colName === "Level") {
      return values.sort((a, b) => Number(a) - Number(b));
    }
    return values.sort();
  };

  // Apply filters to dataframe
  useEffect(() => {
    if (!baseDf.length) {
      setFilteredDf(null);
      return;
    }

    let filtered = [...baseDf];

    // Apply all active filters
    filters.forEach(filter => {
      if (filter.column && filter.mode !== "No Filter" && filter.values.length > 0) {
        if (filter.mode === "Include") {
          filtered = filtered.filter(row => {
            const value = row[filter.column];
            // Handle numeric comparison for Level column
            if (filter.column === "Level") {
              return filter.values.map(v => Number(v)).includes(Number(value));
            }
            return filter.values.includes(value);
          });
        } else if (filter.mode === "Exclude") {
          filtered = filtered.filter(row => {
            const value = row[filter.column];
            // Handle numeric comparison for Level column
            if (filter.column === "Level") {
              return !filter.values.map(v => Number(v)).includes(Number(value));
            }
            return !filter.values.includes(value);
          });
        }
      }
    });

    setFilteredDf(filtered);
  }, [baseDf, filters]);

  const dataToAnalyze = useMemo(
    () => (filteredDf && filteredDf.length > 0 ? filteredDf : baseDf),
    [filteredDf, baseDf]
  );

  // Baseline auto-computes (threshold = 0) as soon as data is ready, and re-computes
  // whenever the filtered dataset or column mapping changes — no button required.
  useEffect(() => {
    if (!dataToAnalyze.length || !dataToAnalyze[0]?.hasOwnProperty("Span")) return;
    const runKey = JSON.stringify({
      n: dataToAnalyze.length,
      empCol, mgrCol, fteCol, flcCol, funcCol,
      sample: dataToAnalyze.slice(0, 3).map((r) => r[empCol]),
    });
    if (baselineRunKeyRef.current === runKey) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBaseline((b) => ({ ...b, loading: true, error: null }));
      try {
        const res = await spansLayers(
          dataToAnalyze, 0, false,
          empCol || null, mgrCol || null, fteCol || null, flcCol || null, funcCol || null
        );
        if (cancelled) return;
        baselineRunKeyRef.current = runKey;
        setBaseline({ result: res, loading: false, error: null });
      } catch (err) {
        console.error("Baseline computation failed:", err);
        if (!cancelled) setBaseline((b) => ({ ...b, loading: false, error: "Failed to compute baseline spans & layers." }));
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [dataToAnalyze, empCol, mgrCol, fteCol, flcCol, funcCol]);

  const persistActiveScenario = useCallback(async (scenarioPatch) => {
    if (!datasetId) return scenarioPatch;
    setSavingScenario(true);
    try {
      const payload = {
        name: scenarioPatch.name,
        threshold: scenarioPatch.threshold,
        filters,
        result: slimResultForSave(scenarioPatch.result),
      };
      if (scenarioPatch.id) {
        const data = await updateSpansScenario(datasetId, scenarioPatch.id, payload);
        return { ...scenarioPatch, ...(data?.scenario || {}), localKey: null, result: scenarioPatch.result };
      }
      const data = await createSpansScenario(datasetId, payload);
      const saved = data?.scenario;
      return {
        ...scenarioPatch,
        id: saved?.id ?? scenarioPatch.id,
        name: saved?.name ?? scenarioPatch.name,
        threshold: saved?.threshold ?? scenarioPatch.threshold,
        localKey: null,
        result: scenarioPatch.result,
      };
    } catch (err) {
      console.warn("Failed to persist spans scenario:", err);
      setError(err.response?.data?.detail || "Analysis ran, but saving the scenario failed.");
      return scenarioPatch;
    } finally {
      setSavingScenario(false);
    }
  }, [datasetId, filters]);

  const addScenarioTab = useCallback(() => {
    if (scenarios.length >= MAX_SCENARIOS) {
      setError(`Maximum of ${MAX_SCENARIOS} scenarios. Delete one to add another.`);
      return;
    }
    const draft = makeDraftScenario(scenarios.length + 1, threshold || 5);
    setScenarios((prev) => [...prev, draft]);
    setActiveKey(scenarioKey(draft));
    setViewMode("scenario");
    setSelectedLayer(null);
    setError(null);
  }, [scenarios.length, threshold]);

  const removeScenarioTab = useCallback(async (key) => {
    const target = scenarios.find((s) => scenarioKey(s) === key);
    if (!target) return;
    if (target.id && datasetId) {
      try {
        await deleteSpansScenario(datasetId, target.id);
      } catch (err) {
        setError(err.response?.data?.detail || "Failed to delete scenario.");
        return;
      }
    }
    const next = scenarios.filter((s) => scenarioKey(s) !== key);
    setScenarios(next);
    if (activeKey === key) {
      setActiveKey(next.length ? scenarioKey(next[0]) : null);
      setSelectedLayer(null);
    }
  }, [scenarios, datasetId, activeKey]);

  // Simulate a target-span scenario (hasSimulation). Baseline (threshold = 0) runs separately
  // and automatically — this only fires when the user explicitly asks to simulate impact.
  const runScenarioSimulation = async (downloadMode = false) => {
    if (!dataToAnalyze.length || !dataToAnalyze[0]?.hasOwnProperty("Span")) {
      setError("Data must have 'Span' and 'Level' columns. Please run Hierarchy first.");
      return;
    }
    const t = Number(threshold) || 0;
    if (t <= 0) {
      setError("Enter a target span threshold greater than 0 to simulate impact.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await spansLayers(
        dataToAnalyze,
        t,
        downloadMode,
        empCol || null,
        mgrCol || null,
        fteCol || null,
        flcCol || null,
        funcCol || null
      );

      if (!downloadMode) {
        const base = activeScenario || makeDraftScenario(scenarios.length + 1, t);
        const patched = { ...base, threshold: t, name: `Span ${t}`, result: res };
        const saved = await persistActiveScenario(patched);
        setScenarios((prev) => {
          const exists = prev.some((s) => scenarioKey(s) === scenarioKey(base));
          return exists
            ? prev.map((s) => (scenarioKey(s) === scenarioKey(base) ? saved : s))
            : [...prev, saved];
        });
        setActiveKey(scenarioKey(saved));
        setSelectedLayer(null);
        setViewMode("scenario");
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Failed to compute Spans & Layers. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (threshold <= 0) {
      setError("Please set a threshold value greater than 0 to download marked data.");
      return;
    }
    runScenarioSimulation(true);
  };

  // Download summary as Excel
  const downloadSummary = () => {
    if (!result || !result.summary || result.summary.length === 0) {
      setError("No summary data available to download.");
      return;
    }

    try {
      const ws = XLSX.utils.json_to_sheet(result.summary);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Spans & Layers Summary");
      XLSX.writeFile(wb, `spans_layers_summary_${new Date().toISOString().split('T')[0]}.xlsx`);
      console.log("✅ Summary downloaded successfully");
    } catch (err) {
      console.error("❌ Failed to download summary:", err);
      setError("Failed to download summary.");
    }
  };

  // PPT export — fully editable shapes (no screenshots)
  const downloadPPT = async () => {
    if (!result || !result.summary?.length) {
      setError("No analysis data to export. Run analysis first.");
      return;
    }
    setDownloading(true);
    try {
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "OrgSight";
      pptx.title = "Spans & Layers Analysis";

      const ins = result.insights || {};
      const summary = result.summary || [];
      const hasSim = hasSimulation;

      // ── Shared table style helpers ───────────────────────────────────────
      const TH = { color: WHITE, fill: { color: NAVY_HEX }, bold: true, fontSize: 8.5, align: "center", valign: "middle" };
      const TD = { fontSize: 8.5, align: "center", valign: "middle", border: { type: "solid", pt: 0.5, color: "CCCCCC" } };
      const TDA = { ...TD, fill: { color: LIGHT_BG_HEX } };
      const TDL = { ...TD, align: "left" };
      const TDLA = { ...TDA, align: "left" };

      const addSlideHeader = (slide, title, subtitle = "") => {
        slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.6, fill: { color: NAVY_HEX } });
        slide.addText(title, { x: 0.38, y: 0.1, w: 10, h: 0.38, fontSize: 17, bold: true, color: WHITE, fontFace: "Calibri" });
        if (subtitle) {
          slide.addText(subtitle, { x: 0.38, y: 0.42, w: 12, h: 0.18, fontSize: 9, color: BLUE_MID_HEX, fontFace: "Calibri" });
        }
      };

      const addFooterStrip = (slide, text) => {
        slide.addShape("rect", { x: 0, y: 7.18, w: "100%", h: 0.32, fill: { color: NAVY_HEX } });
        slide.addText(text, { x: 0.3, y: 7.2, w: 12.7, h: 0.28, fontSize: 8, color: BLUE_MID_HEX, align: "center", fontFace: "Calibri" });
      };

      // ── Slide 1: Structure Overview (Pyramid + KPI Cards) ────────────────
      const s1 = pptx.addSlide();

      // Header
      addSlideHeader(s1, "Spans & Layers Analysis",
        hasSim ? `Target Span Threshold: ${threshold}` : "Baseline (no target threshold simulated)");

      // Grey background for full content area
      s1.addShape("rect", { x: 0, y: 0.6, w: "100%", h: 6.58, fill: { color: "F4F6F9" } });

      // ── LEFT: Pyramid chart ──────────────────────────────────────────────
      const CHART_L    = 0.28;
      const CHART_TOP  = 0.7;
      const AXIS_X     = 3.30;   // center axis x position
      const AXIS_HALF  = 0.22;   // half-width of level label column
      const IC_MAX_W   = 2.50;
      const MGR_MAX_W  = 2.10;
      const ROW_H      = 0.72;
      const ROW_START  = 1.08;
      const BAR_H      = 0.58;
      const BAR_PAD    = 0.07;

      const maxIC  = Math.max(...summary.map((r) => r.IC_Count  || 0), 1);
      const maxMgr = Math.max(...summary.map((r) => r.Manager_Count || 0), 1);

      // Chart section label
      s1.addText("Organization Structure by Level", {
        x: CHART_L + 0.12, y: CHART_TOP + 0.06, w: 7.5, h: 0.28,
        fontSize: 12, bold: true, color: NAVY_HEX, fontFace: "Calibri",
      });
      s1.addText(
        `IC Count ← Level → Manager Count`, {
        x: CHART_L + 0.12, y: CHART_TOP + 0.36, w: 7.5, h: 0.2,
        fontSize: 8, color: "9AABBE", fontFace: "Calibri",
      });

      summary.forEach((row, i) => {
        const rowY  = ROW_START + i * ROW_H;
        const icW   = Math.max(0, (row.IC_Count  || 0) / maxIC  * IC_MAX_W);
        const mgrW  = Math.max(0, (row.Manager_Count || 0) / maxMgr * MGR_MAX_W);
        const barT  = rowY + BAR_PAD;

        // IC bar — extends LEFT from axis
        const icLeft = AXIS_X - AXIS_HALF - icW;
        if (icW > 0.04) {
          s1.addShape("rect", { x: icLeft, y: barT, w: icW, h: BAR_H, fill: { color: BLUE_MID_HEX } });
          s1.addText(String(row.IC_Count || 0), {
            x: icLeft + 0.06, y: barT, w: Math.max(icW - 0.1, 0.3), h: BAR_H,
            fontSize: 9.5, bold: true, color: WHITE, align: "left", valign: "middle", fontFace: "Calibri",
          });
        }

        // Level label (center axis)
        s1.addText(`L${row.Level}`, {
          x: AXIS_X - AXIS_HALF, y: rowY + 0.16, w: AXIS_HALF * 2, h: 0.38,
          fontSize: 11.5, bold: true, color: NAVY_HEX, align: "center", fontFace: "Calibri",
        });

        // Mgr bar — extends RIGHT from axis
        const mgrLeft = AXIS_X + AXIS_HALF;
        if (mgrW > 0.04) {
          s1.addShape("rect", { x: mgrLeft, y: barT, w: mgrW, h: BAR_H, fill: { color: NAVY_HEX } });
          s1.addText(String(row.Manager_Count || 0), {
            x: mgrLeft + 0.06, y: barT, w: Math.max(mgrW - 0.1, 0.3), h: BAR_H,
            fontSize: 9.5, bold: true, color: WHITE, align: "left", valign: "middle", fontFace: "Calibri",
          });
        }

        // Avg span gold badge
        const badgeX = AXIS_X + AXIS_HALF + MGR_MAX_W + 0.22;
        const badgeY = rowY + 0.14;
        s1.addShape("ellipse", { x: badgeX, y: badgeY, w: 0.44, h: 0.44, fill: { color: "C5A84A" } });
        s1.addText(row.Avg_Span != null ? String(row.Avg_Span) : "—", {
          x: badgeX, y: badgeY, w: 0.44, h: 0.44,
          fontSize: 8, bold: true, color: NAVY_HEX, align: "center", valign: "middle", fontFace: "Calibri",
        });

        // Row annotation: total
        s1.addText(`${row.Total_Employees || 0} total`, {
          x: badgeX + 0.5, y: rowY + 0.22, w: 1.15, h: 0.24,
          fontSize: 7.5, color: "888888", fontFace: "Calibri",
        });
      });

      // Legend
      const legendY = ROW_START + summary.length * ROW_H + 0.15;
      s1.addShape("rect", { x: CHART_L + 0.12, y: legendY, w: 0.22, h: 0.16, fill: { color: BLUE_MID_HEX } });
      s1.addText("Individual Contributors", { x: CHART_L + 0.4, y: legendY, w: 2.4, h: 0.16, fontSize: 8, color: "555555", fontFace: "Calibri" });
      s1.addShape("rect", { x: CHART_L + 2.85, y: legendY, w: 0.22, h: 0.16, fill: { color: NAVY_HEX } });
      s1.addText("Managers", { x: CHART_L + 3.13, y: legendY, w: 1.5, h: 0.16, fontSize: 8, color: "555555", fontFace: "Calibri" });
      s1.addShape("ellipse", { x: CHART_L + 4.7, y: legendY - 0.01, w: 0.18, h: 0.18, fill: { color: "C5A84A" } });
      s1.addText("Avg Span", { x: CHART_L + 4.95, y: legendY, w: 1.5, h: 0.16, fontSize: 8, color: "555555", fontFace: "Calibri" });

      // ── RIGHT: KPI metric cards ──────────────────────────────────────────
      const KPI_L      = 8.45;
      const KPI_W      = 4.55;
      const CARD_H_KPI = 0.98;
      const CARD_GAP   = 0.09;
      const kpiStartY  = 0.82;

      s1.addText("Key Metrics", {
        x: KPI_L, y: kpiStartY - 0.04, w: KPI_W, h: 0.3,
        fontSize: 12, bold: true, color: NAVY_HEX, fontFace: "Calibri",
      });

      const totalHC = (ins.total_managers || 0) + (ins.total_ics || 0);

      const kpiCards = [
        {
          label: "TOTAL HEADCOUNT",
          value: totalHC || "—",
          sub: `${ins.total_managers || 0} managers · ${ins.total_ics || 0} ICs`,
          accentColor: NAVY_HEX,
          valueColor: NAVY_HEX,
        },
        {
          label: "AVERAGE SPAN",
          value: ins.avg_span != null ? String(ins.avg_span) : "—",
          sub: "Direct reports per manager",
          accentColor: NAVY_HEX,
          valueColor: NAVY_HEX,
          gauge: ins.avg_span != null ? ins.avg_span : null,
        },
        {
          label: "MANAGEMENT DEPTH",
          value: ins.management_depth != null ? String(ins.management_depth) : "—",
          sub: "Number of hierarchy layers",
          accentColor: NAVY_HEX,
          valueColor: NAVY_HEX,
        },
        {
          label: "BELOW TARGET SPAN",
          value: hasSim ? String(ins.below_target_count ?? 0) : "—",
          sub: hasSim ? `Threshold: ${threshold} · FTE opp: ${ins.fte_opportunity ?? 0}` : "Simulate a threshold to calculate",
          accentColor: "D97706",
          valueColor: hasSim && (ins.below_target_count ?? 0) > 0 ? "D97706" : NAVY_HEX,
        },
        {
          label: "MICRO-TEAMS (1:1)",
          value: String(ins.one_to_one_count ?? 0),
          sub: "Managers with exactly 1 direct report",
          accentColor: "C5A84A",
          valueColor: (ins.one_to_one_count ?? 0) > 0 ? "C5A84A" : NAVY_HEX,
        },
      ];

      kpiCards.forEach((kpi, i) => {
        const cy = kpiStartY + 0.34 + i * (CARD_H_KPI + CARD_GAP);
        s1.addShape("rect", { x: KPI_L, y: cy, w: KPI_W, h: CARD_H_KPI,
          fill: { color: WHITE }, line: { color: "DCE4EE", pt: 0.75 } });
        // Left accent strip
        s1.addShape("rect", { x: KPI_L, y: cy, w: 0.055, h: CARD_H_KPI, fill: { color: kpi.accentColor } });
        // Label
        s1.addText(kpi.label, { x: KPI_L + 0.14, y: cy + 0.1, w: KPI_W - 0.2, h: 0.18,
          fontSize: 7.5, bold: true, color: "8A9AB4", charSpacing: 0.5, fontFace: "Calibri" });
        // Value
        s1.addText(String(kpi.value), { x: KPI_L + 0.14, y: cy + 0.28, w: KPI_W - 0.2, h: 0.42,
          fontSize: 26, bold: true, color: kpi.valueColor, fontFace: "Calibri" });
        // Sub-text or gauge
        if (kpi.gauge != null) {
          const gY = cy + 0.72;
          const gW = KPI_W - 0.28;
          const gX = KPI_L + 0.14;
          s1.addShape("rect", { x: gX, y: gY, w: gW, h: 0.065, fill: { color: "E8EEF4" } });
          const fillFrac = Math.min(kpi.gauge / 10, 1.0);
          if (fillFrac > 0) {
            s1.addShape("rect", { x: gX, y: gY, w: gW * fillFrac, h: 0.065, fill: { color: NAVY_HEX } });
          }
          // Marker label
          s1.addText(`${kpi.gauge} of 10 target`, { x: gX, y: gY + 0.08, w: gW, h: 0.16,
            fontSize: 7, color: "888888", fontFace: "Calibri" });
        } else {
          s1.addText(kpi.sub, { x: KPI_L + 0.14, y: cy + 0.73, w: KPI_W - 0.2, h: 0.18,
            fontSize: 7.5, color: "888888", fontFace: "Calibri" });
        }
      });

      // Footer summary strip
      const totalIcRatio = ins.total_managers ? `1:${Math.round((ins.total_ics || 0) / ins.total_managers)}` : "—";
      addFooterStrip(s1,
        `Total Headcount: ${totalHC || "—"}   |   Avg Span: ${ins.avg_span ?? "—"}   |   Depth: ${ins.management_depth ?? "—"}   |   Manager:IC Ratio ${totalIcRatio}`);

      // ── Slide 2: KPI Detail + Summary Table ──────────────────────────────
      const s2 = pptx.addSlide();
      addSlideHeader(s2, "Summary Table", "Headcount, IC and Manager distribution by hierarchy level");
      s2.addShape("rect", { x: 0, y: 0.6, w: "100%", h: 6.58, fill: { color: "F4F6F9" } });

      // Summary table (full width, polished)
      const sumHeaders = [[
        { text: "Level", options: TH },
        { text: "ICs", options: TH },
        { text: "Managers", options: TH },
        { text: "Total", options: { ...TH, bold: true } },
        { text: "Avg Span", options: TH },
        { text: "% of Org", options: TH },
      ]];
      const orgTotal = summary.reduce((a, r) => a + (r.Total_Employees || 0), 0) || 1;
      const sumRows = summary.map((r, i) => {
        const opt  = i % 2 ? TDA : TD;
        const optL = i % 2 ? TDLA : TDL;
        return [
          { text: `L${r.Level}`, options: { ...optL, bold: true, color: NAVY_HEX } },
          { text: String(r.IC_Count || 0), options: opt },
          { text: String(r.Manager_Count || 0), options: opt },
          { text: String(r.Total_Employees || 0), options: { ...opt, bold: true } },
          { text: r.Avg_Span != null ? String(r.Avg_Span) : "—", options: opt },
          { text: `${Math.round((r.Total_Employees || 0) / orgTotal * 100)}%`, options: opt },
        ];
      });
      // Totals row
      const totalsRow = [
        { text: "Total", options: { ...TH } },
        { text: String(ins.total_ics || 0), options: { ...TH } },
        { text: String(ins.total_managers || 0), options: { ...TH } },
        { text: String(totalHC || 0), options: { ...TH, bold: true } },
        { text: ins.avg_span != null ? String(ins.avg_span) : "—", options: { ...TH } },
        { text: "100%", options: { ...TH } },
      ];

      s2.addTable([...sumHeaders, ...sumRows, totalsRow], {
        x: 0.35, y: 0.85, w: 12.6,
        colW: [1.2, 2.1, 2.1, 2.1, 2.1, 2.0],
        rowH: 0.38,
        border: { type: "solid", pt: 0.5, color: "CCCCCC" },
      });

      // Insight callout box if insights available
      if (ins.avg_span != null) {
        const calloutY = 0.85 + (summary.length + 2) * 0.38 + 0.3;
        s2.addShape("roundRect", {
          x: 0.35, y: calloutY, w: 12.6, h: 0.9,
          fill: { color: "E8F0FA" }, line: { color: "5C8BB4", pt: 1.0 }, rectRadius: 0.08,
        });
        const calloutText = [
          `Average Span: ${ins.avg_span} (${ins.avg_span >= 5 ? "healthy" : "below recommended 5–8 range"}).`,
          ins.one_to_one_count > 0 ? ` ${ins.one_to_one_count} micro-team(s) identified.` : "",
          ins.thin_layer_count > 0 ? ` ${ins.thin_layer_count} thin management layer(s) present.` : "",
          hasSim && ins.below_target_count > 0
            ? ` ${ins.below_target_count} manager(s) below target span of ${threshold} — FTE opportunity: ${ins.fte_opportunity}.`
            : "",
        ].filter(Boolean).join("");
        s2.addText(calloutText, {
          x: 0.55, y: calloutY + 0.1, w: 12.2, h: 0.7,
          fontSize: 10, color: NAVY_HEX, fontFace: "Calibri", bullet: false,
        });
      }

      addFooterStrip(s2, "OrgSight  |  Spans & Layers Analysis");

      // ── Slide 3: Micro-Teams ─────────────────────────────────────────────
      if (ins.one_to_one_managers?.length > 0) {
        const s3 = pptx.addSlide();
        addSlideHeader(s3, "Micro-Teams (1:1 Managers)",
          `${ins.one_to_one_count} manager(s) with exactly 1 direct report — review for consolidation`);
        s3.addShape("rect", { x: 0, y: 0.6, w: "100%", h: 6.58, fill: { color: "F4F6F9" } });

        const microHdrs = [[
          { text: "Manager Name", options: TH },
          { text: "Employee ID", options: TH },
          { text: "Level", options: TH },
          { text: "Span", options: TH },
        ]];
        const microRows = ins.one_to_one_managers.map((m, i) => {
          const opt = i % 2 ? TDA : TD;
          return [
            { text: String(m.name || "—"), options: { ...opt, align: "left" } },
            { text: String(m.emp_id || "—"), options: opt },
            { text: String(m.level ?? "—"), options: opt },
            { text: "1", options: { ...opt, bold: true, color: "D97706" } },
          ];
        });
        s3.addTable([...microHdrs, ...microRows], {
          x: 0.35, y: 0.85, w: 12.6,
          colW: [4.5, 3.5, 2.3, 2.3], rowH: 0.32,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
        });
        addFooterStrip(s3, `Micro-teams: ${ins.one_to_one_count} managers  |  OrgSight  |  Spans & Layers Analysis`);
      }

      // ── Slide 4: Below Target Span ───────────────────────────────────────
      if (hasSim && ins.below_target?.length > 0) {
        const s4 = pptx.addSlide();
        addSlideHeader(s4, "Below Target Span",
          `${ins.below_target_count} manager(s) below target span of ${threshold}  ·  FTE opportunity: ${ins.fte_opportunity ?? 0}  ·  Cost opportunity: ${ins.cost_opportunity ? fmtCost(ins.cost_opportunity) : "—"}`);
        s4.addShape("rect", { x: 0, y: 0.6, w: "100%", h: 6.58, fill: { color: "F4F6F9" } });

        const belowHdrs = [[
          { text: "Manager Name", options: TH },
          { text: "Level", options: TH },
          { text: "Current Span", options: TH },
          { text: "Target", options: TH },
          { text: "Gap", options: TH },
          { text: "FTE", options: TH },
        ]];
        const belowRows = ins.below_target.map((m, i) => {
          const opt = i % 2 ? TDA : TD;
          const gap = (m.gap != null && m.gap < 0)
            ? { ...opt, color: "D97706", bold: true }
            : opt;
          return [
            { text: String(m.name || "—"), options: { ...opt, align: "left" } },
            { text: String(m.level ?? "—"), options: opt },
            { text: String(m.current_span ?? "—"), options: opt },
            { text: String(m.target_span ?? threshold), options: opt },
            { text: String(m.gap ?? "—"), options: gap },
            { text: String(m.fte ?? "—"), options: opt },
          ];
        });
        s4.addTable([...belowHdrs, ...belowRows], {
          x: 0.35, y: 0.85, w: 12.6,
          colW: [3.8, 1.6, 2.0, 1.6, 1.8, 1.8], rowH: 0.32,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
        });
        addFooterStrip(s4, `Below target: ${ins.below_target_count}  |  OrgSight  |  Spans & Layers Analysis`);
      }

      // ── Slide 5: Thin Layers ─────────────────────────────────────────────
      if (ins.thin_layers?.length > 0) {
        const s5 = pptx.addSlide();
        addSlideHeader(s5, "Thin Management Layers",
          `${ins.thin_layer_count} consecutive 1:1 management chain(s) — consider layer removal`);
        s5.addShape("rect", { x: 0, y: 0.6, w: "100%", h: 6.58, fill: { color: "F4F6F9" } });

        const thinHdrs = [[
          { text: "Manager Name", options: TH },
          { text: "Sole Direct Report", options: TH },
          { text: "Level", options: TH },
        ]];
        const thinRows = ins.thin_layers.map((t, i) => {
          const opt = i % 2 ? TDA : TD;
          return [
            { text: String(t.name || "—"), options: { ...opt, align: "left" } },
            { text: `${t.report_name || "—"}${t.report_id ? ` (${t.report_id})` : ""}`, options: { ...opt, align: "left" } },
            { text: String(t.level ?? "—"), options: opt },
          ];
        });
        s5.addTable([...thinHdrs, ...thinRows], {
          x: 0.35, y: 0.85, w: 12.6,
          colW: [4.6, 5.4, 2.6], rowH: 0.32,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
        });
        addFooterStrip(s5, `Thin layers: ${ins.thin_layer_count}  |  OrgSight  |  Spans & Layers Analysis`);
      }

      // ── Slide 6: Function Benchmarks ─────────────────────────────────────
      const byFunc = ins.by_function || [];
      if (byFunc.length > 0) {
        const s6 = pptx.addSlide();
        addSlideHeader(s6, "Function Benchmark",
          hasSim
            ? `Sorted by FTE opportunity — prioritize functions with narrowest spans`
            : "Spans & layer distribution by function");
        s6.addShape("rect", { x: 0, y: 0.6, w: "100%", h: 6.58, fill: { color: "F4F6F9" } });

        const sortedFuncs = hasSim
          ? [...byFunc].sort((a, b) => (b.fte_opportunity || 0) - (a.fte_opportunity || 0) || (a.avg_span || 0) - (b.avg_span || 0))
          : byFunc;

        const funcBaseHdrs = [
          { text: "#", options: TH },
          { text: "Function", options: TH },
          { text: "HC", options: TH },
          { text: "Managers", options: TH },
          { text: "Avg Span", options: TH },
          { text: "Median", options: TH },
          { text: "1:1s", options: TH },
        ];
        const funcSimHdrs = hasSim ? [
          { text: "Below Tgt", options: TH },
          { text: "FTE Opp.", options: TH },
          { text: "Cost Opp.", options: TH },
        ] : [];
        const funcHdrs = [[...funcBaseHdrs, ...funcSimHdrs]];

        const funcRows = sortedFuncs.map((r, i) => {
          const opt  = i % 2 ? TDA : TD;
          const optL = i % 2 ? TDLA : TDL;
          const baseRow = [
            { text: String(i + 1), options: { ...opt, color: "AAAAAA" } },
            { text: String(r.function || "—"), options: { ...optL, bold: true } },
            { text: String(r.headcount ?? "—"), options: opt },
            { text: String(r.manager_count ?? "—"), options: opt },
            { text: String(r.avg_span ?? "—"), options: { ...opt, bold: true } },
            { text: String(r.median_span ?? "—"), options: opt },
            { text: String(r.one_to_one_count ?? "—"), options: opt },
          ];
          const simRow = hasSim ? [
            { text: String(r.below_target_count ?? "—"), options: opt },
            { text: String(r.fte_opportunity ?? "—"), options: { ...opt, color: r.fte_opportunity > 0 ? "D97706" : "222222", bold: !!r.fte_opportunity } },
            { text: r.cost_opportunity ? fmtCost(r.cost_opportunity) : "—", options: { ...opt, color: r.cost_opportunity > 0 ? "D97706" : "222222" } },
          ] : [];
          return [...baseRow, ...simRow];
        });

        const baseColW = hasSim
          ? [0.5, 2.8, 0.9, 1.1, 1.0, 1.0, 0.8, 1.0, 1.1, 1.1]
          : [0.5, 3.5, 1.2, 1.4, 1.3, 1.3, 1.1];

        const totalColW = baseColW.reduce((a, b) => a + b, 0);
        const scaledColW = baseColW.map((w) => (w / totalColW) * 12.6);

        s6.addTable([...funcHdrs, ...funcRows], {
          x: 0.35, y: 0.85, w: 12.6,
          colW: scaledColW, rowH: 0.32,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
        });
        addFooterStrip(s6, `${sortedFuncs.length} functions  |  OrgSight  |  Spans & Layers Analysis`);
      }

      await pptx.writeFile({ fileName: `Spans_Layers_Analysis_${new Date().toISOString().split("T")[0]}.pptx` });
    } catch (err) {
      console.error("PPT export failed:", err);
      setError("Failed to generate PPT. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  // Summary data
  const summary = result?.summary || [];
  const insights = result?.insights;
  const spanDistribution = insights?.span_distribution || [];
  const byFunction = insights?.by_function || [];
  const funcHighlights = insights?.function_highlights || {};
  const redesignPriority = insights?.redesign_priority || [];
  const hasCostData = !!insights?.has_cost_data || !!flcCol;

  // When simulating a target, prioritize functions with the largest opportunity
  const functionTableRows = useMemo(() => {
    if (!byFunction.length) return [];
    if (hasSimulation) {
      return [...byFunction].sort(
        (a, b) =>
          (b.fte_opportunity || 0) - (a.fte_opportunity || 0) ||
          (b.cost_opportunity || 0) - (a.cost_opportunity || 0) ||
          (a.avg_span || 0) - (b.avg_span || 0)
      );
    }
    return byFunction;
  }, [byFunction, hasSimulation]);

  // Scale for the inline "vs org avg" mini-bar in the function benchmark table.
  const maxFuncAvgSpan = useMemo(
    () => Math.max(...byFunction.map((r) => r.avg_span || 0), 1),
    [byFunction]
  );

  const spanDistChart = useMemo(() => {
    if (!spanDistribution.length) return null;
    const maxCount = Math.max(...spanDistribution.map((d) => d.count), 1);
    return {
      data: [{
        x: spanDistribution.map((d) => d.bucket),
        y: spanDistribution.map((d) => d.count),
        type: "bar",
        marker: {
          color: spanDistribution.map((d) => {
            if (d.bucket === "1") return "#c5a84a";
            if (d.count === 0) return "#dbe4ee";
            return NAVY;
          }),
          line: { width: 0 },
          cornerradius: 6,
        },
        text: spanDistribution.map((d) => (d.count > 0 ? d.count : "")),
        textposition: "outside",
        textfont: { size: 13, family: CHART_FONT, color: NAVY, weight: 700 },
        hovertemplate: "<b>Span %{x}</b><br>%{y} managers<extra></extra>",
      }],
      layout: {
        height: 240,
        margin: { l: 48, r: 20, t: 28, b: 48 },
        paper_bgcolor: "white",
        plot_bgcolor: "white",
        font: { family: CHART_FONT, size: 12, color: "#334155" },
        xaxis: {
          title: { text: "Span of control", font: { size: 12, family: CHART_FONT, color: "#64748b" } },
          tickfont: { size: 12, family: CHART_FONT },
          fixedrange: true,
        },
        yaxis: {
          title: { text: "Managers", font: { size: 12, family: CHART_FONT, color: "#64748b" } },
          tickfont: { size: 11 },
          gridcolor: "#eef2f7",
          zeroline: false,
          rangemode: "tozero",
          range: [0, maxCount * 1.25],
          fixedrange: true,
        },
        bargap: 0.4,
        showlegend: false,
      },
      config: { displayModeBar: false, responsive: true },
    };
  }, [spanDistribution]);

  // Ranked horizontal bar chart for redesign priority — easier to scan than a pill list.
  const redesignChart = useMemo(() => {
    if (!redesignPriority.length) return null;
    const top = redesignPriority.slice(0, 8);
    const metric = hasCostData ? "cost_opportunity" : "fte_opportunity";
    const values = top.map((r) => r[metric] || 0);
    const maxVal = Math.max(...values, 1);
    return {
      data: [{
        y: top.map((r) => r.function).reverse(),
        x: values.slice().reverse(),
        type: "bar",
        orientation: "h",
        marker: {
          color: top.map((_, i) => (i === 0 ? AMBER : NAVY)).reverse(),
          line: { width: 0 },
          cornerradius: 6,
        },
        text: top.map((r) => (hasCostData ? fmtCost(r.cost_opportunity) : `${r.fte_opportunity} FTE`)).reverse(),
        textposition: "outside",
        textfont: { size: 11, family: CHART_FONT, color: NAVY, weight: 700 },
        hovertemplate: hasCostData
          ? "<b>%{y}</b><br>Cost opportunity: %{text}<extra></extra>"
          : "<b>%{y}</b><br>FTE opportunity: %{text}<extra></extra>",
      }],
      layout: {
        height: 40 + top.length * 34,
        margin: { l: 140, r: 60, t: 8, b: 32 },
        paper_bgcolor: "white",
        plot_bgcolor: "white",
        font: { family: CHART_FONT, size: 11, color: "#334155" },
        xaxis: {
          title: { text: hasCostData ? "Cost opportunity ($)" : "FTE opportunity", font: { size: 11, family: CHART_FONT, color: "#64748b" } },
          tickfont: { size: 10 },
          gridcolor: "#eef2f7",
          zeroline: false,
          rangemode: "tozero",
          range: [0, maxVal * 1.3],
          fixedrange: true,
        },
        yaxis: { tickfont: { size: 11, family: CHART_FONT, color: NAVY }, fixedrange: true },
        showlegend: false,
      },
      config: { displayModeBar: false, responsive: true },
    };
  }, [redesignPriority, hasCostData]);

  const layerEmployees = useMemo(() => {
    if (selectedLayer == null) return [];
    const dataSource = (filteredDf && filteredDf.length > 0) ? filteredDf : baseDf;
    if (!dataSource.length) return [];
    const lvl = Number(selectedLayer);
    const matched = dataSource.filter((r) => Number(r.Level) === lvl);
    return matched.map((r) => ({
        emp_id: empCol ? String(r[empCol]) : "",
        name: getDisplayName(r),
        span: Number(r.Span || 0),
        is_manager: Number(r.Span || 0) > 0,
      }));
  }, [selectedLayer, filteredDf, baseDf, empCol, getDisplayName]);

  // Derived chart arrays
  const maxLevel = summary.length > 0 ? Math.max(...summary.map(r => r.Level)) : 1;
  const levels = useMemo(() => summary.map(r => r.Level), [summary]);
  const icCounts = useMemo(() => summary.map(r => r.IC_Count), [summary]);
  const mgrCounts = useMemo(() => summary.map(r => r.Manager_Count), [summary]);
  const totals = useMemo(() => summary.map(r => r.Total_Employees), [summary]);

  const maxVal = Math.max(...icCounts, ...mgrCounts, 1);
  const pad = maxVal * 0.2;

  // Total-label annotations (replaces the old invisible trace that blocked clicks)
  const totalAnnotations = useMemo(() => levels.map((lvl, i) => ({
    x: maxVal + pad * 0.3,
    y: lvl,
    text: `<b>${totals[i]}</b>`,
    showarrow: false,
    font: { size: 13, family: CHART_FONT, color: NAVY },
    xanchor: "left",
  })), [levels, totals, maxVal, pad]);

  // 4 traces only: mirror IC, mirror Mgr, IC, Mgr — NO invisible 5th trace
  const chartData = useMemo(() => [
    { y: levels, x: icCounts.map(v => -v), type: "bar", orientation: "h", marker: { color: BLUE_MID, cornerradius: 4 }, showlegend: false, hovertemplate: "<b>Layer %{y}</b><br>%{x:.0f} ICs<br><i>Click to drill down</i><extra></extra>" },
    { y: levels, x: mgrCounts.map(v => -v), type: "bar", orientation: "h", marker: { color: NAVY, cornerradius: 4 }, showlegend: false, hovertemplate: "<b>Layer %{y}</b><br>%{x:.0f} managers<br><i>Click to drill down</i><extra></extra>" },
    { y: levels, x: icCounts, type: "bar", orientation: "h", name: "Individual Contributors", marker: { color: BLUE_MID, cornerradius: 4 }, text: icCounts.map((v) => (v > 0 ? v : "")), textposition: "inside", textfont: { color: "white", size: 12, family: CHART_FONT, weight: 700 }, hovertemplate: "<b>Layer %{y}</b><br>%{x} ICs<br><i>Click to drill down</i><extra></extra>" },
    { y: levels, x: mgrCounts, type: "bar", orientation: "h", name: "Managers", marker: { color: NAVY, cornerradius: 4 }, text: mgrCounts.map((v) => (v > 0 ? v : "")), textposition: "inside", textfont: { color: "white", size: 12, family: CHART_FONT, weight: 700 }, hovertemplate: "<b>Layer %{y}</b><br>%{x} managers<br><i>Click to drill down</i><extra></extra>" },
  ], [levels, icCounts, mgrCounts]);

  const chartLayout = useMemo(() => ({
    height: 90 + (summary.length * 48),
    barmode: "relative",
    bargap: 0.22,
    bargroupgap: 0.06,
    dragmode: "pan",
    plot_bgcolor: "white",
    paper_bgcolor: "white",
    font: { family: CHART_FONT, color: "#334155" },
    yaxis: {
      autorange: "reversed",
      range: [0, maxLevel],
      tickvals: levels,
      ticktext: levels.map((l) => `L${l}`),
      tickfont: { size: 13, family: CHART_FONT, color: NAVY, weight: 700 },
      fixedrange: false,
      title: { text: "Layer", font: { size: 12, family: CHART_FONT, color: "#64748b" } },
      gridcolor: "#eef2f7",
    },
    xaxis: {
      range: [-(maxVal + pad), maxVal + pad],
      title: { text: "Employee count", font: { size: 12, family: CHART_FONT, color: "#64748b" } },
      zeroline: true,
      zerolinecolor: "#cbd5e1",
      zerolinewidth: 1,
      fixedrange: false,
      showticklabels: false,
      gridcolor: "#eef2f7",
    },
    clickmode: "event",
    annotations: totalAnnotations,
    margin: { l: 48, r: 24, t: 36, b: 36 },
    showlegend: true,
    legend: {
      orientation: "h",
      yanchor: "bottom",
      y: -0.22,
      xanchor: "center",
      x: 0.5,
      font: { size: 12, family: CHART_FONT },
    },
  }), [summary, maxLevel, levels, maxVal, pad, totalAnnotations]);

  const chartConfig = useMemo(() => ({
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['select2d', 'lasso2d'],
    scrollZoom: true,
    responsive: true,
    toImageButtonOptions: { format: 'png', filename: `org_pyramid_${new Date().toISOString().split('T')[0]}`, height: 80 + (summary.length * 41), scale: 2 },
  }), [summary]);

  // Bind plotly_click via onInitialized/onUpdate (fires after Plotly has set up the graphDiv)
  const bindPlotClick = useCallback((_figure, graphDiv) => {
    if (!graphDiv || typeof graphDiv.on !== "function") return;
    graphDiv.removeAllListeners("plotly_click");
    graphDiv.on("plotly_click", (data) => {
      const pt = data?.points?.[0];
      if (!pt) return;
      setSelectedLayer((prev) => (prev === pt.y ? null : pt.y));
    });
  }, []);

  const ranScenarios = scenarios.filter((s) => s.result?.summary?.length);
  const canCompare = ranScenarios.length >= 2;
  const compareHasCostData = ranScenarios.some((s) => s.result?.insights?.has_cost_data);

  // Grouped bar chart comparing headline KPIs across simulated scenarios.
  const compareKpiChart = useMemo(() => {
    if (ranScenarios.length < 2) return null;
    const names = ranScenarios.map((s) => s.name || `Span ${s.threshold}`);
    const metricDefs = [
      { key: "avg_span", label: "Avg Span", color: NAVY },
      { key: "below_target_count", label: "Below Target", color: AMBER },
      { key: "fte_opportunity", label: "FTE Opportunity", color: TEAL },
    ];
    const traces = metricDefs.map((m) => ({
      x: names,
      y: ranScenarios.map((s) => Number(s.result?.insights?.[m.key] ?? 0)),
      type: "bar",
      name: m.label,
      marker: { color: m.color, cornerradius: 6 },
      hovertemplate: `<b>%{x}</b><br>${m.label}: %{y}<extra></extra>`,
    }));
    return {
      data: traces,
      layout: {
        height: 300,
        barmode: "group",
        bargap: 0.25,
        bargroupgap: 0.12,
        margin: { l: 44, r: 16, t: 12, b: 40 },
        paper_bgcolor: "white",
        plot_bgcolor: "white",
        font: { family: CHART_FONT, size: 12, color: "#334155" },
        xaxis: { tickfont: { size: 12, family: CHART_FONT, color: NAVY }, fixedrange: true },
        yaxis: { gridcolor: "#eef2f7", zeroline: false, rangemode: "tozero", tickfont: { size: 11 }, fixedrange: true },
        legend: { orientation: "h", yanchor: "bottom", y: -0.22, xanchor: "center", x: 0.5, font: { size: 11, family: CHART_FONT } },
      },
      config: { displayModeBar: false, responsive: true },
    };
  }, [ranScenarios]);

  // Horizontal grouped bar comparing FTE/cost opportunity by function across scenarios.
  const compareFunctionChart = useMemo(() => {
    if (ranScenarios.length < 2) return null;
    const metric = compareHasCostData ? "cost_opportunity" : "fte_opportunity";
    const allFns = Array.from(new Set(
      ranScenarios.flatMap((s) => (s.result?.insights?.by_function || []).map((f) => f.function))
    ));
    if (!allFns.length) return null;
    // Rank functions by their max opportunity across scenarios, show top 8.
    const ranked = allFns
      .map((fn) => ({
        fn,
        max: Math.max(...ranScenarios.map((s) => {
          const row = (s.result?.insights?.by_function || []).find((f) => f.function === fn);
          return row ? (row[metric] || 0) : 0;
        })),
      }))
      .sort((a, b) => b.max - a.max)
      .slice(0, 8)
      .map((r) => r.fn)
      .reverse();

    const traces = ranScenarios.map((s, i) => ({
      y: ranked,
      x: ranked.map((fn) => {
        const row = (s.result?.insights?.by_function || []).find((f) => f.function === fn);
        return row ? (row[metric] || 0) : 0;
      }),
      type: "bar",
      orientation: "h",
      name: s.name || `Span ${s.threshold}`,
      marker: { color: SERIES_COLORS[i % SERIES_COLORS.length], cornerradius: 4 },
      hovertemplate: `<b>%{y}</b><br>${s.name}: %{x}<extra></extra>`,
    }));

    return {
      data: traces,
      layout: {
        height: 60 + ranked.length * 30 * ranScenarios.length * 0.55,
        barmode: "group",
        margin: { l: 140, r: 20, t: 8, b: 40 },
        paper_bgcolor: "white",
        plot_bgcolor: "white",
        font: { family: CHART_FONT, size: 11, color: "#334155" },
        xaxis: {
          title: { text: compareHasCostData ? "Cost opportunity ($)" : "FTE opportunity", font: { size: 11, family: CHART_FONT, color: "#64748b" } },
          gridcolor: "#eef2f7", zeroline: false, rangemode: "tozero", tickfont: { size: 10 }, fixedrange: true,
        },
        yaxis: { tickfont: { size: 11, family: CHART_FONT, color: NAVY }, fixedrange: true },
        legend: { orientation: "h", yanchor: "bottom", y: -0.18, xanchor: "center", x: 0.5, font: { size: 11, family: CHART_FONT } },
      },
      config: { displayModeBar: false, responsive: true },
    };
  }, [ranScenarios, compareHasCostData]);

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      {/* Header - compact */}
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-bold text-gray-900 font-display">Spans & Layers Analysis</h3>
          <p className="text-xs text-gray-500">
            Baseline computes automatically below. Add a target threshold to simulate FTE &amp; cost impact.
            {datasetId ? " Scenarios save with this dataset." : ""}
          </p>
        </div>
      </div>

      {/* Scenario tabs — target-threshold simulations layered on top of the always-on baseline */}
      <div className="bg-white border border-brand-100 rounded-xl shadow-sm px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {scenarios.length === 0 && (
            <span className="px-2 py-1.5 text-xs text-slate-400 italic">
              No target scenarios yet — showing baseline only.
            </span>
          )}
          {scenarios.map((s) => {
            const key = scenarioKey(s);
            const active = viewMode === "scenario" && key === activeKey;
            const hasRun = !!s.result?.summary?.length;
            return (
              <div
                key={key}
                className={`group inline-flex items-center gap-1 rounded-lg border transition-all duration-150 ${
                  active
                    ? "bg-brand-500 text-white border-brand-500 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 hover:border-brand-300 hover:bg-brand-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveKey(key);
                    setViewMode("scenario");
                    setSelectedLayer(null);
                    setError(null);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold"
                  title={hasRun ? `Threshold ${s.threshold}` : "Not run yet"}
                >
                  {s.name || `Span ${s.threshold}`}
                  {!hasRun && <span className={`ml-1 font-normal ${active ? "text-white/70" : "text-slate-400"}`}>· draft</span>}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeScenarioTab(key); }}
                  className={`pr-2 pl-0.5 text-sm leading-none ${active ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-red-500"}`}
                  title="Delete scenario"
                  aria-label="Delete scenario"
                >
                  ×
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addScenarioTab}
            disabled={scenarios.length >= MAX_SCENARIOS}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-dashed border-brand-300 text-brand-600 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title={scenarios.length >= MAX_SCENARIOS ? `Max ${MAX_SCENARIOS} scenarios` : "Add a target threshold scenario"}
          >
            + Add target
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => { if (canCompare) setViewMode("compare"); }}
            disabled={!canCompare}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              viewMode === "compare"
                ? "bg-[#01244a] text-white border-[#01244a]"
                : "border-slate-200 text-slate-600 hover:border-[#01244a]/40 hover:bg-slate-50 disabled:opacity-40"
            }`}
            title={canCompare ? "Compare ran scenarios side-by-side" : "Run at least 2 scenarios to compare"}
          >
            Compare {canCompare ? `(${ranScenarios.length})` : ""}
          </button>

          {savingScenario && (
            <span className="text-[10px] text-slate-400 font-medium">Saving…</span>
          )}
        </div>
      </div>

      {viewMode === "compare" && (
        <div className="bg-white border border-brand-100 rounded-xl shadow-card overflow-hidden animate-fadeInUp">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/80">
            <h4 className="text-sm font-semibold text-[#01244a] font-display">
              Scenario comparison
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Side-by-side metrics from each simulated threshold scenario
            </p>
          </div>

          {compareKpiChart && (
            <div className="p-4 border-b border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">KPIs at a glance</p>
              <Plot
                data={compareKpiChart.data}
                layout={compareKpiChart.layout}
                config={compareKpiChart.config}
                style={{ width: "100%" }}
                useResizeHandler
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-[#01244a] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-[#01244a]">Metric</th>
                  {ranScenarios.map((s) => (
                    <th key={scenarioKey(s)} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                      {s.name}
                      <span className="block text-[10px] font-normal text-white/70">threshold {s.threshold}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Avg span", get: (s) => s.result?.insights?.avg_span ?? "—" },
                  { label: "Managers", get: (s) => s.result?.insights?.total_managers ?? "—" },
                  { label: "Mgmt depth", get: (s) => s.result?.insights?.management_depth ?? "—" },
                  { label: "1:1 managers", get: (s) => s.result?.insights?.one_to_one_count ?? "—" },
                  { label: "Thin layers", get: (s) => s.result?.insights?.thin_layer_count ?? "—" },
                  { label: "Below target", get: (s) => s.result?.insights?.below_target_count ?? "—" },
                  { label: "High / Low span", get: (s) => `${s.result?.high ?? "—"} / ${s.result?.low ?? "—"}` },
                  { label: "FTE opportunity", get: (s) => s.result?.insights?.fte_opportunity ?? "—" },
                  { label: "Cost opportunity", get: (s) => fmtCost(s.result?.insights?.cost_opportunity) },
                ].map((row, idx) => (
                  <tr key={row.label} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 bg-inherit border-b border-slate-100">
                      {row.label}
                    </td>
                    {ranScenarios.map((s) => (
                      <td key={scenarioKey(s)} className="px-3 py-2 text-right tabular-nums font-semibold text-[#01244a] border-b border-slate-100">
                        {row.get(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Function opportunity compare when available */}
          {ranScenarios.some((s) => s.result?.insights?.by_function?.length) && (
            <div className="border-t border-slate-100 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                {compareHasCostData ? "Cost" : "FTE"} opportunity by function
              </p>
              <p className="text-[11px] text-slate-400 mb-3">Top functions ranked by opportunity, across scenarios</p>

              {compareFunctionChart && (
                <div className="mb-4">
                  <Plot
                    data={compareFunctionChart.data}
                    layout={compareFunctionChart.layout}
                    config={compareFunctionChart.config}
                    style={{ width: "100%" }}
                    useResizeHandler
                  />
                </div>
              )}

              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-600 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Function</th>
                      {ranScenarios.map((s) => (
                        <th key={scenarioKey(s)} className="px-3 py-2 text-right font-semibold">{s.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(
                      new Set(
                        ranScenarios.flatMap((s) =>
                          (s.result?.insights?.by_function || []).map((f) => f.function)
                        )
                      )
                    ).map((fn, idx) => (
                      <tr key={fn} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                        <td className="px-3 py-1.5 font-medium text-slate-700 truncate max-w-[180px]" title={fn}>{fn}</td>
                        {ranScenarios.map((s) => {
                          const row = (s.result?.insights?.by_function || []).find((f) => f.function === fn);
                          if (!row) return <td key={scenarioKey(s)} className="px-3 py-1.5 text-right text-slate-300">—</td>;
                          return (
                            <td key={scenarioKey(s)} className="px-3 py-1.5 text-right tabular-nums text-brand-700 font-semibold">
                              {compareHasCostData ? fmtCost(row.cost_opportunity) : row.fte_opportunity}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end">
            <button
              type="button"
              onClick={() => setViewMode("scenario")}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 text-white hover:bg-brand-600"
            >
              Back to scenario
            </button>
          </div>
        </div>
      )}

      {viewMode === "scenario" && (
      <>

      {/* Auto-enrichment banner */}
      {enriching && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <p className="text-xs text-brand-700 font-medium">Computing hierarchy levels and spans…</p>
        </div>
      )}

      {/* Filters - inline row */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </h4>
          <button
            onClick={addFilter}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-brand-500 text-white hover:bg-brand-600 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map((filter, index) => (
            <div key={filter.id} className="flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50">
              <span className="flex items-center justify-center w-6 h-6 bg-brand-500 text-white rounded text-xs font-bold flex-shrink-0">
                {getFilterLabel(index)}
              </span>
              <select
                value={filter.column}
                onChange={(e) => updateFilterColumn(filter.id, e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-brand-500 outline-none bg-white min-w-[120px]"
              >
                <option value="">Column...</option>
                {availableColumns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              {filter.column && (
                <>
                  <div className="flex border border-gray-300 rounded overflow-hidden">
                    {["No Filter", "Include", "Exclude"].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateFilterMode(filter.id, mode)}
                        className={`px-2 py-1 text-[10px] font-medium transition ${
                          filter.mode === mode
                            ? "bg-brand-500 text-white"
                            : "bg-white text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        {mode === "No Filter" ? "Off" : mode}
                      </button>
                    ))}
                  </div>
                  {filter.mode !== "No Filter" && (
                    <select
                      multiple
                      value={filter.values}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, option => option.value);
                        updateFilterValues(filter.id, selected);
                      }}
                      className="border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-brand-500 outline-none bg-white min-w-[100px] max-h-[60px]"
                    >
                      {getUniqueValues(filter.column).map((val) => (
                        <option key={val} value={val}>{val}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {filters.length > 1 && (
                <button onClick={() => removeFilter(filter.id)} className="p-0.5 text-red-500 hover:text-red-700" title="Remove">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>

        {filteredDf && filteredDf.length !== baseDf.length && (
          <p className="text-xs text-blue-700 mt-2">
            <strong>Filtered:</strong> {filteredDf.length.toLocaleString()} of {baseDf.length.toLocaleString()} rows
          </p>
        )}
      </div>

      {/* Baseline status + exports (available as soon as baseline is ready — no threshold needed) */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex items-center gap-3 flex-wrap">
          {baseline.loading ? (
            <div className="flex items-center gap-2 text-xs text-brand-600 font-semibold">
              <svg className="animate-spin h-4 w-4 text-brand-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Computing baseline…
            </div>
          ) : baselineResult ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-md text-xs font-semibold text-emerald-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Baseline ready
            </span>
          ) : (
            <span className="text-xs text-slate-400">Waiting for Span &amp; Level columns…</span>
          )}
          {baseline.error && <span className="text-xs text-red-600 font-medium">{baseline.error}</span>}

          <div className="flex-1" />

          {summary.length > 0 && (
            <button
              onClick={downloadPPT}
              disabled={downloading || baseline.loading}
              className="px-3 py-1.5 bg-white border border-[#01244A] text-[#01244A] hover:bg-brand-50 rounded-md text-sm font-medium transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {downloading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-[#01244A]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download PPT
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-fadeIn">
          <svg
            className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="font-medium text-red-900">Analysis Failed</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Results Section */}
      {summary.length > 0 && (
        <>
          {/* 1. Current state */}
          {insights && (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold text-white bg-brand-500 rounded-md px-1.5 py-0.5">1</span>
                <p className="text-[11px] font-bold text-brand-500 uppercase tracking-wider" style={{ fontFamily: CHART_FONT }}>
                  Current state
                </p>
                <p className="text-[11px] text-slate-400">Baseline spans &amp; layers before any redesign</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                <StatCard
                  label="Avg Span"
                  value={insights.avg_span ?? "—"}
                  sub="Managers only"
                  badge={spanBenchmarkBadge(insights.avg_span)}
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  }
                />
                <StatCard
                  label="Micro-managers"
                  value={insights.one_to_one_count ?? 0}
                  sub="1:1 reporting (span = 1)"
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  }
                />
                <StatCard
                  label="Thin Layers"
                  value={insights.thin_layer_count ?? 0}
                  sub="Consecutive 1:1 chains"
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                  }
                />
                <StatCard
                  label="Mgmt Depth"
                  value={insights.management_depth ?? "—"}
                  sub={`${insights.total_managers ?? 0} managers · ${insights.total_ics ?? 0} ICs`}
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  }
                />
                <StatCard
                  label="Managers"
                  value={insights.total_managers ?? 0}
                  sub="With at least 1 direct report"
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  }
                />
              </div>
            </div>
          )}

          {/* Span distribution + function highlights */}
          {insights && (spanDistChart || byFunction.length > 0) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {spanDistChart && (
                <div className="bg-white border border-brand-100 rounded-xl shadow-card overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                    <h4 className="text-sm font-semibold text-[#01244a]" style={{ fontFamily: CHART_FONT }}>
                      Span distribution
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">How managers are spread across span-of-control buckets</p>
                  </div>
                  <div className="p-3">
                    <Plot
                      data={spanDistChart.data}
                      layout={spanDistChart.layout}
                      config={spanDistChart.config}
                      style={{ width: "100%" }}
                      useResizeHandler
                    />
                  </div>
                </div>
              )}

              {byFunction.length > 0 && (
                <div className="bg-white border border-brand-100 rounded-xl shadow-card overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-bold text-white bg-brand-500 rounded-md px-1.5 py-0.5">2</span>
                      <h4 className="text-sm font-semibold text-[#01244a]" style={{ fontFamily: CHART_FONT }}>
                        Function highlights
                      </h4>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">Internal benchmarking — narrowest, widest, most efficiently structured</p>
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { key: "narrowest", label: "Narrowest span", tip: "Lowest avg span — redesign priority", color: "border-amber-200 bg-amber-50/70" },
                      { key: "widest", label: "Widest span", tip: "Highest avg span", color: "border-sky-200 bg-sky-50/60" },
                      { key: "most_efficient", label: "Most efficient", tip: "Highest avg span (≥2 managers)", color: "border-brand-200 bg-brand-50/60" },
                    ].map(({ key, label, tip, color }) => {
                      const item = funcHighlights[key];
                      return (
                        <div key={key} className={`rounded-xl border px-3 py-3 transition-shadow hover:shadow-sm ${color}`}>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{label}</p>
                          {item ? (
                            <>
                              <p className="text-sm font-bold text-[#01244a] truncate" title={item.function}>{item.function}</p>
                              <p className="text-xs text-slate-600 mt-1">
                                Avg span <span className="font-semibold">{item.avg_span}</span>
                                <span className="text-slate-400"> · {item.manager_count} mgrs</span>
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">{tip}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!byFunction.length && (
                <div className="bg-white border border-dashed border-brand-200 rounded-xl p-4 flex flex-col justify-center">
                  <h4 className="text-sm font-semibold text-[#01244a]" style={{ fontFamily: CHART_FONT }}>
                    Function benchmarks
                  </h4>
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                    Map a <span className="font-semibold">Function</span> column in Column Configuration, then re-run analysis
                    to see narrowest / widest / most efficiently structured functions.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 3. Target span simulation — opt-in, layered on top of the baseline above */}
          {insights && (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold text-white bg-brand-500 rounded-md px-1.5 py-0.5">3</span>
                <p className="text-[11px] font-bold text-brand-500 uppercase tracking-wider font-display">
                  Target span simulation
                </p>
                <p className="text-[11px] text-slate-400">Optional — define a target to quantify FTE &amp; cost impact</p>
              </div>

              <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-amber-50/40 p-4 shadow-card">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Target Span Threshold</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-20 border border-brand-200 rounded-md px-2 py-1.5 text-sm font-semibold text-[#01244a] focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => runScenarioSimulation(false)}
                    disabled={loading || !(Number(threshold) > 0)}
                    className="px-4 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-md text-sm font-semibold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Simulating…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        {hasSimulation ? "Re-simulate" : "Simulate Impact"}
                      </>
                    )}
                  </button>

                  {hasSimulation && (
                    <>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#01244A] rounded-md">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                        <span className="text-xs text-white/70">High</span>
                        <span className="text-sm font-bold text-white">{result.high || 0}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#01244A]/30 rounded-md">
                        <svg className="w-3 h-3 text-[#01244A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        <span className="text-xs text-[#01244A]/70">Low</span>
                        <span className="text-sm font-bold text-[#01244A]">{result.low || 0}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleDownload}
                        disabled={loading}
                        className="px-3 py-1.5 bg-white border border-[#01244A] text-[#01244A] hover:bg-brand-50 rounded-md text-xs font-semibold shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                        title="Download the dataset marked with High/Low span classification"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Marked Excel
                      </button>
                    </>
                  )}
                </div>

                {hasSimulation ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                      <div className="rounded-lg bg-white/80 border border-brand-100 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target span</p>
                        <p className="text-xl font-extrabold text-[#01244a] mt-1 font-display">{threshold}</p>
                      </div>
                      <div className="rounded-lg bg-white/80 border border-brand-100 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Below target</p>
                        <p className="text-xl font-extrabold text-amber-700 mt-1 font-display">{insights.below_target_count ?? 0}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">managers</p>
                      </div>
                      <div className="rounded-lg bg-white/80 border border-brand-100 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">FTE opportunity</p>
                        <p className="text-xl font-extrabold text-brand-700 mt-1 font-display">{insights.fte_opportunity ?? 0}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">potential reduction</p>
                      </div>
                      <div className="rounded-lg bg-white/80 border border-brand-100 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cost savings</p>
                        <p className="text-xl font-extrabold text-brand-700 mt-1 font-display">
                          {hasCostData ? fmtCost(insights.cost_opportunity) : "—"}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {hasCostData ? "from below-target managers" : "Map FLC column for cost"}
                        </p>
                      </div>
                    </div>
                    {redesignChart && (
                      <div className="mt-4 pt-3 border-t border-brand-100">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Redesign priority by function</p>
                        <p className="text-[11px] text-slate-400 mb-2">Ranked by {hasCostData ? "cost" : "FTE"} opportunity — where to focus redesign first</p>
                        <Plot
                          data={redesignChart.data}
                          layout={redesignChart.layout}
                          config={redesignChart.config}
                          style={{ width: "100%" }}
                          useResizeHandler
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500 mt-3">
                    Enter a target span above and click <span className="font-semibold text-slate-700">Simulate Impact</span> to see below-target managers, FTE reduction, and cost savings by function.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Function-level internal benchmark table */}
          {byFunction.length > 0 && (
            <div className="bg-white border border-brand-100 rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-[#01244a]" style={{ fontFamily: CHART_FONT }}>
                    Function-level span benchmark
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {hasSimulation
                      ? "Sorted by largest FTE opportunity — use this to prioritize org redesign"
                      : "Sorted by narrowest avg span · set a target threshold to see FTE / cost opportunity"}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#01244a] text-white">
                    <tr>
                      {hasSimulation && <th className="px-3 py-2 text-left font-semibold">#</th>}
                      <th className="px-3 py-2 text-left font-semibold">Function</th>
                      <th className="px-3 py-2 text-right font-semibold">HC</th>
                      <th className="px-3 py-2 text-right font-semibold">Mgrs</th>
                      <th className="px-3 py-2 text-right font-semibold">Avg Span</th>
                      <th className="px-3 py-2 text-left font-semibold w-24">vs Org Avg</th>
                      <th className="px-3 py-2 text-right font-semibold">Median</th>
                      <th className="px-3 py-2 text-right font-semibold">1:1s</th>
                      <th className="px-3 py-2 text-right font-semibold">Min–Max</th>
                      {hasSimulation && (
                        <>
                          <th className="px-3 py-2 text-right font-semibold">Below tgt</th>
                          <th className="px-3 py-2 text-right font-semibold">FTE opp.</th>
                          <th className="px-3 py-2 text-right font-semibold">Cost opp.</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {functionTableRows.map((row, idx) => (
                      <tr
                        key={row.function}
                        className={`border-b border-slate-200 transition-colors hover:bg-brand-50/70 ${
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                        }`}
                      >
                        {hasSimulation && (
                          <td className="px-3 py-2 text-slate-400 font-bold tabular-nums">{idx + 1}</td>
                        )}
                        <td className="px-3 py-2 font-medium text-slate-800 max-w-[200px] truncate" title={row.function}>
                          {row.function}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.headcount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.manager_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#01244a]">{row.avg_span}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden min-w-[48px]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(100, ((row.avg_span || 0) / maxFuncAvgSpan) * 100)}%`,
                                  backgroundColor: (row.avg_span || 0) < (insights?.avg_span || 0) ? AMBER : TEAL,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.median_span}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700 font-medium">{row.one_to_one_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{row.min_span}–{row.max_span}</td>
                        {hasSimulation && (
                          <>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.below_target_count}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-700">{row.fte_opportunity}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-700">
                              {hasCostData ? fmtCost(row.cost_opportunity) : <span className="text-slate-300 font-normal">—</span>}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasSimulation && !hasCostData && (
                <p className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
                  Map an FLC / cost column in Column Configuration to quantify cost savings by function.
                </p>
              )}
            </div>
          )}

        <div className="bg-white border border-brand-100 rounded-xl overflow-hidden shadow-card">
          <div className="bg-gradient-to-r from-slate-50 to-white px-4 py-2.5 border-b border-slate-100">
            <h4 className="text-sm font-semibold text-[#01244a] flex items-center gap-2" style={{ fontFamily: CHART_FONT }}>
              <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Layers structure
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">Headcount by layer — click a bar or row to drill down</p>
          </div>

          <div className="p-4">
            {/* Summary Table and Pyramid side by side */}
            <div className="grid grid-cols-12 gap-4">
              {/* Summary Table - Takes 3 columns */}
              <div className="col-span-3">
                <h5 className="text-xs font-semibold text-gray-700 mb-2">Summary</h5>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-[#01244a] text-white">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold">Level</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">IC</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Mgr</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Total</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Avg Span</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {summary.map((r) => (
                        <tr
                          key={r.Level}
                          onClick={() => setSelectedLayer((prev) => (prev === r.Level ? null : r.Level))}
                          className={`cursor-pointer transition-colors ${selectedLayer === r.Level ? "bg-brand-50 ring-1 ring-brand-300" : "hover:bg-gray-50"}`}
                        >
                          <td className="px-3 py-2 font-medium text-gray-900">{r.Level}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{r.IC_Count || "-"}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{r.Manager_Count || "-"}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{r.Total_Employees || "-"}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{r.Avg_Span || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pyramid Chart - Takes 9 columns */}
              <div className="col-span-9">
                <p className="text-xs text-gray-400 mb-2">Click a layer bar or summary row to drill down into employees</p>
                <div className="overflow-auto" style={{ maxHeight: "600px", width: "100%" }}>
                  <Plot
                    ref={plotRef}
                    onInitialized={bindPlotClick}
                    onUpdate={bindPlotClick}
                    data={chartData}
                    layout={chartLayout}
                    config={chartConfig}
                    style={{ width: "100%" }}
                    useResizeHandler
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

          {/* Layer drill-down */}
          {selectedLayer != null && layerEmployees.length > 0 && (
            <div className="mt-4 rounded-xl border border-gray-200 overflow-hidden shadow-sm transition-all duration-300 animate-fadeInUp">
              <div className="bg-[#01244a] text-white px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-bold">L{selectedLayer}</span>
                  <p className="text-sm font-semibold">Layer {selectedLayer} — {layerEmployees.length} employees</p>
                </div>
                <button type="button" onClick={() => setSelectedLayer(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors" title="Close">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-sm">
                  <thead className="bg-[#01244a] text-white sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold">Employee</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold">ID</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold">Span</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold">Role</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {layerEmployees.map((row) => (
                      <tr key={row.emp_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900">{row.name || row.emp_id}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{row.emp_id}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{row.span}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${row.is_manager ? "bg-[#01244a]/10 text-[#01244a]" : "bg-blue-50 text-blue-700"}`}>
                            {row.is_manager ? "Manager" : "IC"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <OpenInOrgChartButton empId={row.emp_id} onJump={onJumpToOrgChart} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Analysis tabs */}
          {insights && (
            <div className="mt-4">
              <div className="border-b border-gray-200 flex gap-0">
                {[
                  { id: "micro", label: "Micro-Teams", count: insights.one_to_one_count },
                  { id: "below", label: "Below Target", count: insights.below_target_count },
                  { id: "thin", label: "Thin Layers", count: insights.thin_layer_count },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAnalysisTab(tab.id)}
                    className={`px-5 py-3 text-sm font-medium transition-colors ${
                      analysisTab === tab.id
                        ? "border-b-2 border-brand-500 text-brand-600 font-semibold bg-white"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-100 text-brand-700">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="bg-white border border-gray-200 border-t-0 rounded-b-xl p-5 shadow-sm">
                {analysisTab === "micro" && (
                  <>
                    <div className="mb-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 border border-brand-200 rounded-full text-xs font-semibold text-brand-700">
                        {insights.one_to_one_count} manager{insights.one_to_one_count !== 1 ? "s" : ""} with exactly 1 direct report
                      </span>
                    </div>
                    {insights.one_to_one_managers?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#01244a] text-white">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold">Manager</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold">ID</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold">Level</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold">Span</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {insights.one_to_one_managers.map((m) => (
                              <tr key={m.emp_id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium">{m.name}</td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-500">{m.emp_id}</td>
                                <td className="px-3 py-2 text-right">{m.level}</td>
                                <td className="px-3 py-2 text-right text-red-600 font-semibold">{m.span}</td>
                                <td className="px-3 py-2 text-right"><OpenInOrgChartButton empId={m.emp_id} onJump={onJumpToOrgChart} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No 1:1 managers detected.</p>
                    )}
                  </>
                )}
                {analysisTab === "below" && (
                  <>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {hasSimulation ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 border border-brand-200 rounded-full text-xs font-semibold text-brand-700">
                            {insights.below_target_count} manager{insights.below_target_count !== 1 ? "s" : ""} below target span of {threshold}
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-xs font-semibold text-slate-700">
                            FTE opp: {insights.fte_opportunity}
                          </span>
                          {hasCostData && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-xs font-semibold text-amber-800">
                              Cost opp: {fmtCost(insights.cost_opportunity)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-gray-500">Simulate a target span threshold above to identify below-target managers.</span>
                      )}
                    </div>
                    {hasSimulation && insights.below_target?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#01244a] text-white">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold">Manager</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Current Span</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Target</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Gap</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">FTE</th>
                              {hasCostData && <th className="px-3 py-2 text-right text-xs font-semibold">Cost</th>}
                              <th className="px-3 py-2 text-right text-xs font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {insights.below_target.map((m) => (
                              <tr key={m.emp_id} className="hover:bg-brand-50/50">
                                <td className="px-3 py-2 font-medium">{m.name}</td>
                                <td className="px-3 py-2 text-right text-amber-600 font-semibold">{m.current_span}</td>
                                <td className="px-3 py-2 text-right">{m.target_span}</td>
                                <td className="px-3 py-2 text-right text-red-600">{m.gap}</td>
                                <td className="px-3 py-2 text-right">{m.fte}</td>
                                {hasCostData && (
                                  <td className="px-3 py-2 text-right font-medium text-brand-700">{fmtCost(m.cost)}</td>
                                )}
                                <td className="px-3 py-2 text-right"><OpenInOrgChartButton empId={m.emp_id} onJump={onJumpToOrgChart} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : hasSimulation ? (
                      <p className="text-sm text-gray-500">All managers meet the target span.</p>
                    ) : null}
                  </>
                )}
                {analysisTab === "thin" && (
                  <>
                    <div className="mb-4">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 border border-brand-200 rounded-full text-xs font-semibold text-brand-700">
                        {insights.thin_layer_count} consecutive 1:1 management chain{insights.thin_layer_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {insights.thin_layers?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#01244a] text-white">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold">Manager</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold">Report</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Level</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {insights.thin_layers.map((t, i) => (
                              <tr key={`${t.emp_id}-${i}`} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium">{t.name}</td>
                                <td className="px-3 py-2 text-gray-600">{t.report_name} <span className="font-mono text-xs text-gray-400">({t.report_id})</span></td>
                                <td className="px-3 py-2 text-right">{t.level}</td>
                                <td className="px-3 py-2 text-right">
                                  <OpenInOrgChartButton empId={t.emp_id} onJump={onJumpToOrgChart} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No thin-layer chains detected.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
      </>
      )}

      {/* Info Box */}
      <details className="bg-blue-50 border border-blue-200 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-blue-900 cursor-pointer flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          About Spans & Layers
        </summary>
        <ul className="px-3 pb-2 text-[11px] text-blue-700 space-y-0.5 columns-2">
          <li>• <strong>Pyramid:</strong> ICs (blue) vs Managers (navy)</li>
          <li>• <strong>Span:</strong> Avg direct reports per manager</li>
          <li>• <strong>Filters:</strong> Add column filters for segments</li>
          <li>• <strong>Threshold scenarios:</strong> Up to 5 tabs · Compare savings</li>
          <li>• <strong>Insights:</strong> Micro-teams, thin layers</li>
          <li>• <strong>Org Chart:</strong> Click to jump & fix</li>
        </ul>
      </details>
    </div>
  );
}