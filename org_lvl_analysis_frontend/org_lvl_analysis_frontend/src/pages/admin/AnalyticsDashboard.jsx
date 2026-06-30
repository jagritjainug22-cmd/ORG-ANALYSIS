import React, { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { adminGetAnalytics, adminRevokeUserSessions } from "../../api/backend";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

const REFRESH_INTERVAL = 30_000;
const PAGE_SIZE = 5;

// Module-level cache — survives tab switches (component unmount/remount)
let _cachedData = null;
let _cachedAt = 0;
let _cachedRange = "7d";
const BLUE_PALETTE = ["#0a3f86", "#155bb2", "#2d7bd4", "#5a9ee0", "#8fc0f0"];
const DIST_COLORS = {
  "Logins": BLUE_PALETTE[1],
  "Data Uploads": BLUE_PALETTE[2],
  "Scenario Edits": BLUE_PALETTE[3],
  "Admin Actions": BLUE_PALETTE[4],
  "No activity": "#e2e8f0",
};
const AVATAR_COLORS = ["#0a3f86", "#155bb2", "#2d7bd4", "#5a9ee0", "#1e6ec2", "#3d84c8", "#6ba7d8", "#1a538f"];
const TH_STYLE = "px-3 py-2.5 text-[10px] font-bold text-white uppercase tracking-wider";
const TH_BG = "#01244a";

function avatarColor(initials) {
  let hash = 0;
  for (let i = 0; i < initials.length; i++) hash = initials.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function relativeTime(iso) {
  if (!iso) return "—";
  const utc = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const diff = (Date.now() - new Date(utc).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(utc).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function shortDate(dateStr) {
  if (!dateStr) return "";
  if (dateStr.length === 2) return `${dateStr}:00`;
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// ---------------------------------------------------------------------------
// Animated count-up (Strict Mode safe)
// ---------------------------------------------------------------------------
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  const prevTarget = useRef(0);

  useEffect(() => {
    const from = prevTarget.current;
    if (target === from) { setValue(target); return; }
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else prevTarget.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setValue(target);
    };
  }, [target, duration]);

  return value;
}

function Skeleton({ className = "" }) {
  return <div className={`animate-pulse bg-brand-100/60 rounded ${className}`} />;
}

function Sparkline({ data, color = "#155bb2", height = 24 }) {
  if (!data || data.length === 0) return null;
  const chartData = data.map((v) => ({ v }));
  return (
    <ResponsiveContainer width={56} height={height}>
      <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive animationDuration={800} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SectionHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <div className="w-0.5 h-4 rounded-full bg-brand-500" />
        <h3 className="text-[13px] font-bold text-brand-700" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{title}</h3>
        {subtitle && <span className="text-[10px] text-gray-400">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------
function Modal({ open, onClose, title, subtitle, width = "max-w-lg", children }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className={`relative bg-white rounded-xl shadow-2xl ${width} w-full mx-4 max-h-[80vh] flex flex-col animate-fadeInUp`}
           onClick={e => e.stopPropagation()} style={{ fontFamily: "Inter, sans-serif" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100" style={{ background: TH_BG }}>
          <div>
            <h3 className="text-sm font-bold text-white" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{title}</h3>
            {subtitle && <p className="text-[10px] text-white/60 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// KPI Card — compact with action link
// ---------------------------------------------------------------------------
function KpiCard({ label, value, sparkline, delta, deltaLabel, icon, accentColor, warning, actionLabel, onAction }) {
  const animatedValue = useCountUp(value || 0);
  return (
    <div className="bg-white rounded-lg border border-brand-100 p-3 relative overflow-hidden transition-all duration-200 hover:shadow-md group"
         style={{ boxShadow: "0 1px 4px rgba(15,46,92,0.06)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-400 mb-0" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{label}</p>
            {actionLabel && (
              <button onClick={onAction}
                className="text-[9px] font-semibold text-brand-500 hover:text-brand-700 underline decoration-dotted underline-offset-2 transition-colors cursor-pointer mb-0">
                {actionLabel}
              </button>
            )}
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <p className="text-2xl font-extrabold text-brand-800 leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
              {formatNumber(animatedValue)}
            </p>
            {sparkline && <Sparkline data={sparkline} color={accentColor} height={22} />}
          </div>
          <div className="mt-0.5">
            {warning ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                {warning}
              </span>
            ) : delta !== undefined ? (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${delta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={delta >= 0 ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                </svg>
                {delta >= 0 ? "+" : ""}{delta} {deltaLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
             style={{ background: `${accentColor}15`, color: accentColor }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-brand-100 rounded-lg px-2.5 py-1.5 text-[11px]"
         style={{ boxShadow: "0 4px 12px rgba(15,46,92,0.12)" }}>
      <p className="font-bold text-brand-700 mb-0.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-500">{p.name}</span>
          <span className="font-bold text-brand-800 ml-auto pl-2">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function Avatar({ initials, size = 24 }) {
  const bg = avatarColor(initials || "??");
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 ring-1 ring-white"
         style={{ width: size, height: size, fontSize: size * 0.38, backgroundColor: bg }}>
      {initials}
    </div>
  );
}

function feedDotColor(action) {
  const a = (action || "").toLowerCase();
  if (a.includes("create") || a.includes("upload") || a.includes("assign")) return "bg-emerald-400";
  if (a.includes("update") || a.includes("edit") || a.includes("scenario") || a.includes("lock")) return "bg-brand-400";
  if (a.includes("delete") || a.includes("deactivate") || a.includes("archive") || a.includes("remove")) return "bg-red-400";
  return "bg-gray-300";
}

function feedActionLabel(action, details) {
  const parts = (action || "").split(".");
  const verb = parts.length > 1 ? parts[1] : parts[0];
  const resource = parts.length > 1 ? parts[0] : "";
  const label = `${verb}d ${resource}`.trim();
  return details ? `${label}: "${details}"` : label;
}

function fileIcon(name) {
  const ext = (name || "").split(".").pop()?.toLowerCase();
  if (ext === "csv") return <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded">CSV</span>;
  if (ext === "xlsx" || ext === "xls") return <span className="text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 px-1 py-0.5 rounded">XLS</span>;
  return <span className="text-[9px] font-bold text-brand-600 bg-brand-50 border border-brand-100 px-1 py-0.5 rounded">FILE</span>;
}

// ---------------------------------------------------------------------------
// Quick stat pill
// ---------------------------------------------------------------------------
function QuickStat({ label, value, sub, icon, color, onClick }) {
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 bg-white rounded-lg border border-brand-100 ${onClick ? "cursor-pointer hover:border-brand-300 transition-colors" : ""}`}
         style={{ boxShadow: "0 1px 4px rgba(15,46,92,0.05)" }}
         onClick={onClick}>
      <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
           style={{ background: `${color}15`, color }}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-brand-400 font-semibold uppercase tracking-wide leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{label}</p>
        <p className="text-base font-extrabold text-brand-800 leading-tight" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{value}</p>
        {sub && <p className="text-[10px] text-gray-400 leading-none">{sub}</p>}
      </div>
      {onClick && (
        <svg className="w-3 h-3 text-brand-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );
}

// ===========================================================================
// Main component
// ===========================================================================
export default function AnalyticsDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const hasCachedData = _cachedData && (Date.now() - _cachedAt < REFRESH_INTERVAL * 4);
  const [data, setData] = useState(hasCachedData ? _cachedData : null);
  const [loading, setLoading] = useState(!hasCachedData);
  const [lastRefresh, setLastRefresh] = useState(hasCachedData ? _cachedAt : null);
  const [secondsAgo, setSecondsAgo] = useState(hasCachedData ? Math.floor((Date.now() - _cachedAt) / 1000) : 0);
  const [dsSearch, setDsSearch] = useState("");
  const [dsPage, setDsPage] = useState(0);
  const [timeRange, setTimeRange] = useState(_cachedRange);

  // Modals
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [userStatusOpen, setUserStatusOpen] = useState(false);
  const [actDetailOpen, setActDetailOpen] = useState(null);
  const [contribOpen, setContribOpen] = useState(false);

  // End Session (force logout) state
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const timerRef = useRef(null);
  const datasetsRef = useRef(null);

  const firstName = (user?.display_name || user?.username || "Admin").split(" ")[0];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });

  const fetchData = useCallback(async (range, force = false) => {
    try {
      const r = range || timeRange;
      const result = await adminGetAnalytics(r, force);
      setData(result);
      setLastRefresh(Date.now());
      setSecondsAgo(0);
      _cachedData = result;
      _cachedAt = Date.now();
      _cachedRange = r;
    } catch (err) {
      console.error("Analytics fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    if (hasCachedData) {
      fetchData(undefined, false);
    } else {
      fetchData();
    }
    const interval = setInterval(() => fetchData(), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (lastRefresh) setSecondsAgo(Math.floor((Date.now() - lastRefresh) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [lastRefresh]);

  const handleRangeChange = (r) => {
    setTimeRange(r);
    _cachedRange = r;
    fetchData(r);
  };

  const handleForceRefresh = () => {
    fetchData(undefined, true);
  };

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-8 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <Skeleton className="lg:col-span-3 h-44 rounded-lg" />
          <Skeleton className="lg:col-span-2 h-44 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    kpis, quick_stats,
    daily_activity_trend, activity_distribution, activity_detail,
    recent_activity, top_contributors,
    active_sessions_by_user, active_locks, scenarios_overview, user_status_list,
    datasets_overview,
  } = data;

  const rangeLabel = { "1d": "24 hours", "7d": "7 days", "30d": "30 days" }[timeRange];
  const trendData = daily_activity_trend.map(d => ({ ...d, label: shortDate(d.date) }));
  const distTotal = activity_distribution.reduce((s, d) => s + d.count, 0);

  const filteredDatasets = (datasets_overview || []).filter(d =>
    d.name.toLowerCase().includes(dsSearch.toLowerCase()) ||
    d.project_name.toLowerCase().includes(dsSearch.toLowerCase())
  );
  const totalPages = Math.ceil(filteredDatasets.length / PAGE_SIZE);
  const pagedDatasets = filteredDatasets.slice(dsPage * PAGE_SIZE, (dsPage + 1) * PAGE_SIZE);

  const scrollToDatasets = () => {
    datasetsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // User status breakdown
  const activeUsersList = (user_status_list || []).filter(u => u.is_active);
  const inactiveUsersList = (user_status_list || []).filter(u => !u.is_active);
  const neverLoggedIn = (user_status_list || []).filter(u => !u.last_login);

  return (
    <div className="space-y-3">

      {/* ============= Header bar ============= */}
      <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg px-4 py-2.5"
           style={{ background: `linear-gradient(135deg, ${TH_BG}, #155bb2)` }}>
        <h2 className="text-[15px] font-bold text-white" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>
          Welcome back, {firstName}
        </h2>
        <div className="flex items-center gap-2 text-[11px]">
          <button onClick={handleForceRefresh}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white/10 border border-white/20 rounded-full hover:bg-white/20 transition-colors text-white"
            title="Force refresh — bypass cache">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {secondsAgo}s ago
          </button>
          <span className="text-white/40">|</span>
          <span className="text-white/80">{today}</span>
        </div>
      </div>

      {/* ============= KPI cards ============= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Users" value={kpis.total_users}
          sparkline={kpis.users_sparkline} delta={kpis.users_delta} deltaLabel="this period"
          accentColor="#155bb2" actionLabel="view" onAction={() => navigate("/admin/users")}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <KpiCard label="Online Now" value={kpis.active_sessions}
          sparkline={kpis.sessions_sparkline} delta={kpis.sessions_delta} deltaLabel="this period"
          accentColor="#2d7bd4" actionLabel="details" onAction={() => setSessionsOpen(true)}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" /></svg>}
        />
        <KpiCard label="Active Projects" value={kpis.active_projects}
          sparkline={kpis.projects_sparkline} accentColor="#0a3f86"
          warning={kpis.projects_near_deadline > 0 ? `${kpis.projects_near_deadline} near deadline` : undefined}
          actionLabel="manage" onAction={() => navigate("/admin/projects")}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>}
        />
        <KpiCard label="Total Datasets" value={kpis.total_datasets}
          sparkline={kpis.datasets_sparkline} delta={kpis.datasets_delta} deltaLabel="this period"
          accentColor="#5a9ee0" actionLabel="view" onAction={scrollToDatasets}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>}
        />
      </div>

      {/* ============= Quick stats row ============= */}
      {quick_stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <QuickStat label="Total Scenarios" value={quick_stats.total_scenarios}
            sub="across all datasets" color="#0a3f86" onClick={() => setScenariosOpen(true)}
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
          />
          <QuickStat label="Active Users" value={`${quick_stats.active_user_pct}%`}
            sub={`${quick_stats.inactive_users} inactive`} color="#155bb2" onClick={() => setUserStatusOpen(true)}
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <QuickStat label="Avg Datasets / Project" value={quick_stats.avg_datasets_per_project}
            sub="per active project" color="#2d7bd4"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
          />
          <QuickStat label="Total Change Log Edits" value={quick_stats.edits_in_range || 0}
            sub={`in the last ${rangeLabel}`} color="#5a9ee0"
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
          />
        </div>
      )}

      {/* ============= Charts row ============= */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">

        {/* Platform Activity — with time range toggle */}
        <div className="lg:col-span-3 bg-white rounded-lg border border-brand-100 p-3"
             style={{ boxShadow: "0 1px 4px rgba(15,46,92,0.06)" }}>
          <SectionHeader title="Platform Activity" subtitle={`last ${rangeLabel}`}>
            <div className="flex items-center gap-1.5">
              {["1d", "7d", "30d"].map(r => (
                <button key={r} onClick={() => handleRangeChange(r)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                    timeRange === r
                      ? "text-white"
                      : "bg-brand-50 text-brand-500 hover:bg-brand-100"
                  }`}
                  style={timeRange === r ? { backgroundColor: TH_BG } : undefined}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </SectionHeader>
          <div className="flex items-center gap-3 mb-1 text-[10px] text-gray-500">
            {[
              { label: "Logins", color: BLUE_PALETTE[0] },
              { label: "Uploads", color: BLUE_PALETTE[1] },
              { label: "Edits", color: BLUE_PALETTE[2] },
              { label: "Admin", color: BLUE_PALETTE[3] },
            ].map(s => (
              <span key={s.label} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />{s.label}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={trendData} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
              <defs>
                {BLUE_PALETTE.slice(0, 4).map((c, i) => (
                  <linearGradient key={i} id={`gBlue${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eaf3ff" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="logins" name="Logins" stroke={BLUE_PALETTE[0]} strokeWidth={2} fill="url(#gBlue0)" isAnimationActive animationDuration={800} />
              <Area type="monotone" dataKey="uploads" name="Uploads" stroke={BLUE_PALETTE[1]} strokeWidth={1.5} fill="url(#gBlue1)" isAnimationActive animationDuration={1000} />
              <Area type="monotone" dataKey="scenario_edits" name="Edits" stroke={BLUE_PALETTE[2]} strokeWidth={1.5} fill="url(#gBlue2)" isAnimationActive animationDuration={1200} />
              <Area type="monotone" dataKey="admin_actions" name="Admin" stroke={BLUE_PALETTE[3]} strokeWidth={1.5} fill="url(#gBlue3)" isAnimationActive animationDuration={1400} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Activity Distribution donut */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-brand-100 p-3"
             style={{ boxShadow: "0 1px 4px rgba(15,46,92,0.06)" }}>
          <SectionHeader title="Activity Breakdown" subtitle={`last ${rangeLabel}`} />
          <div className="flex items-center gap-3">
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie data={activity_distribution} dataKey="count" nameKey="category"
                     cx="50%" cy="50%" innerRadius={35} outerRadius={55}
                     paddingAngle={3} isAnimationActive animationDuration={800} label={false}>
                  {activity_distribution.map((d, i) => (
                    <Cell key={d.category} fill={DIST_COLORS[d.category] || BLUE_PALETTE[i % BLUE_PALETTE.length]}
                          className="cursor-pointer" onClick={() => setActDetailOpen(d.category)} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, name) => [v, name]} />
                <text x="50%" y="45%" textAnchor="middle" dominantBaseline="middle"
                      style={{ fontSize: 16, fontWeight: 800, fontFamily: "Manrope, Inter, sans-serif", fill: "#0f172a" }}>
                  {distTotal}
                </text>
                <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle"
                      style={{ fontSize: 9, fill: "#94a3b8" }}>total</text>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {activity_distribution.map((d) => (
                <div key={d.category} className="cursor-pointer hover:opacity-80 transition-opacity"
                     onClick={() => setActDetailOpen(d.category)}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: DIST_COLORS[d.category] || "#e2e8f0" }} />
                      <span className="text-[11px] text-gray-600">{d.category}</span>
                    </div>
                    <span className="text-[11px] font-bold text-brand-700">{d.count}</span>
                  </div>
                  <div className="h-1 bg-brand-50 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                         style={{ width: `${d.percentage}%`, backgroundColor: DIST_COLORS[d.category] || "#e2e8f0" }} />
                  </div>
                </div>
              ))}
              <p className="text-[9px] text-gray-400 pt-1">Click a category for breakdown</p>
            </div>
          </div>
        </div>
      </div>

      {/* ============= Recent Activity + Top Contributors ============= */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">

        {/* Recent activity — capped at 4 + audit link */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-brand-100 p-3"
             style={{ boxShadow: "0 1px 4px rgba(15,46,92,0.06)" }}>
          <SectionHeader title="Recent Activity">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </SectionHeader>
          <div className="space-y-0 relative">
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-brand-50" />
            {(recent_activity || []).slice(0, 4).map((item, i) => (
              <div key={item.id || i} className="flex items-start gap-2 py-1 relative">
                <div className={`w-[11px] h-[11px] rounded-full ${feedDotColor(item.action)} flex-shrink-0 mt-0.5 ring-2 ring-white z-10`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-700 leading-snug truncate">
                    <span className="font-bold text-brand-700">{item.username}</span>{" "}
                    <span className="text-gray-500">{feedActionLabel(item.action, item.details)}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => navigate("/admin/audit")}
            className="mt-2 w-full text-center text-[10px] font-semibold text-brand-500 hover:text-brand-700 py-1 border-t border-brand-50 transition-colors">
            View full Audit Log →
          </button>
        </div>

        {/* Top contributors — cap 3 + view all */}
        <div className="lg:col-span-3 bg-white rounded-lg border border-brand-100 p-3"
             style={{ boxShadow: "0 1px 4px rgba(15,46,92,0.06)" }}>
          <SectionHeader title="Top Contributors" subtitle={`last ${rangeLabel}`} />
          {(!top_contributors || top_contributors.length === 0) ? (
            <p className="text-[11px] text-gray-400 text-center py-3">No activity recorded</p>
          ) : (
            <div className="space-y-1.5">
              {top_contributors.slice(0, 3).map((c, i) => {
                const maxScore = top_contributors[0]?.action_count || 1;
                const pct = Math.round((c.action_count / maxScore) * 100);
                return (
                  <div key={c.username} className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 w-24 flex-shrink-0">
                      {i === 0 && <span className="text-amber-400 text-xs">&#9733;</span>}
                      <Avatar initials={c.initials} size={20} />
                      <span className="text-[11px] font-semibold text-brand-700 truncate">{c.username}</span>
                    </div>
                    <div className="flex-1 h-4 bg-brand-50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                           style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${BLUE_PALETTE[0]}, ${BLUE_PALETTE[2]})` }} />
                    </div>
                    <span className="text-[11px] font-bold text-brand-700 w-12 text-right">{c.action_count}pts</span>
                  </div>
                );
              })}
            </div>
          )}
          {top_contributors && top_contributors.length > 3 && (
            <button onClick={() => setContribOpen(true)}
              className="mt-1.5 w-full text-center text-[10px] font-semibold text-brand-500 hover:text-brand-700 py-1 border-t border-brand-50 transition-colors">
              View all contributors →
            </button>
          )}
        </div>
      </div>

      {/* ============= Datasets table with pagination ============= */}
      <div ref={datasetsRef} className="bg-white rounded-lg border border-brand-100 overflow-hidden"
           style={{ boxShadow: "0 1px 4px rgba(15,46,92,0.06)" }}>

        <div className="px-3 py-2 flex items-center justify-between gap-3 border-b border-brand-50">
          <div className="flex items-center gap-2">
            <div className="w-0.5 h-4 rounded-full bg-brand-500" />
            <h3 className="text-[13px] font-bold text-brand-700" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Datasets</h3>
            <span className="text-[10px] text-gray-400">{filteredDatasets.length} total</span>
          </div>
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search…" value={dsSearch}
              onChange={e => { setDsSearch(e.target.value); setDsPage(0); }}
              className="pl-7 pr-3 py-1 text-[11px] border border-gray-200 rounded-full bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 w-44 transition-all"
              style={{ fontFamily: "Inter, sans-serif" }} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontFamily: "Inter, sans-serif" }}>
            <thead>
              <tr style={{ backgroundColor: TH_BG }}>
                <th className={`text-left ${TH_STYLE}`} style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Dataset</th>
                <th className={`text-left ${TH_STYLE}`} style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Project</th>
                <th className={`text-left ${TH_STYLE}`} style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Uploaded By</th>
                <th className={`text-right ${TH_STYLE}`} style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Size</th>
                <th className={`text-center ${TH_STYLE}`} style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Scenarios</th>
                <th className={`text-left ${TH_STYLE}`} style={{ minWidth: 110, fontFamily: "Manrope, Inter, sans-serif" }}>Engagement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-50">
              {pagedDatasets.map((d) => (
                <tr key={d.id} className="hover:bg-brand-50/40 transition-colors">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {fileIcon(d.name)}
                      <span className="text-[12px] font-semibold text-brand-800">{d.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-600">{d.project_name}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Avatar initials={d.uploader_initials} size={18} />
                      <span className="text-[11px] text-gray-600">{d.uploaded_by}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-[11px] text-gray-600">{formatNumber(d.row_count)} rows</td>
                  <td className="px-3 py-2 text-center text-[12px] font-semibold text-brand-700">{d.scenario_count}</td>
                  <td className="px-3 py-2" style={{ minWidth: 110 }}>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-brand-50 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                             style={{ width: `${d.engagement_pct}%`, background: `linear-gradient(90deg, ${BLUE_PALETTE[0]}, ${BLUE_PALETTE[2]})` }} />
                      </div>
                      <span className="text-[10px] font-bold text-brand-500 w-8 text-right">{d.engagement_pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {pagedDatasets.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-[12px] text-gray-400">
                    {dsSearch ? `No datasets match "${dsSearch}"` : "No datasets found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-brand-50 text-[11px] text-gray-500">
            <span>Page {dsPage + 1} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <button disabled={dsPage === 0} onClick={() => setDsPage(p => p - 1)}
                className="px-2 py-0.5 rounded border border-gray-200 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                ← Prev
              </button>
              <button disabled={dsPage >= totalPages - 1} onClick={() => setDsPage(p => p + 1)}
                className="px-2 py-0.5 rounded border border-gray-200 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ============= MODALS ============= */}

      {/* Sessions Modal */}
      <Modal open={sessionsOpen} onClose={() => setSessionsOpen(false)}
             title="Online Now" subtitle={`${kpis.active_sessions} user${kpis.active_sessions !== 1 ? "s" : ""} active in the last 5 minutes`} width="max-w-xl">
        {active_sessions_by_user && active_sessions_by_user.length > 0 ? (
          <div>
            <table className="w-full text-[11px]" style={{ fontFamily: "Inter, sans-serif" }}>
              <thead>
                <tr style={{ backgroundColor: TH_BG }}>
                  <th className={`text-left ${TH_STYLE}`}>User</th>
                  <th className={`text-center ${TH_STYLE}`}>Devices</th>
                  <th className={`text-left ${TH_STYLE}`}>Last Seen</th>
                  <th className={`text-center ${TH_STYLE}`}>Dataset Lock</th>
                  <th className={`text-center ${TH_STYLE}`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {active_sessions_by_user.map(s => {
                  const dsLock = (active_locks?.dataset_locks || []).find(l => l.username === s.username);
                  return (
                    <tr key={s.username} className="hover:bg-brand-50/40">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Avatar initials={s.initials} size={20} />
                          <div>
                            <p className="font-semibold text-brand-700">{s.display_name || s.username}</p>
                            {s.display_name && <p className="text-[9px] text-gray-400">@{s.username}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-brand-700">{s.session_count}</td>
                      <td className="px-3 py-2 text-gray-500">{relativeTime(s.last_active)}</td>
                      <td className="px-3 py-2 text-center">
                        {dsLock ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-semibold">
                            🔒 {dsLock.dataset_name}
                          </span>
                        ) : (
                          <span className="text-[9px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setRevokeTarget(s)}
                          className="px-2 py-0.5 text-[9px] font-semibold rounded border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                          title="End all sessions for this user"
                        >
                          End Session
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {active_locks?.project_locks?.length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-100">
                <p className="text-[10px] font-bold text-brand-600 mb-1">Project Locks Active:</p>
                {active_locks.project_locks.map((l, i) => (
                  <p key={i} className="text-[10px] text-gray-600">
                    <span className="font-semibold">{l.username}</span> has <span className="text-brand-600 font-semibold">{l.project_name}</span> locked
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">No users active in the last 5 minutes</p>
        )}
      </Modal>

      {/* End Session Confirm Dialog */}
      {revokeTarget && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => !revoking && setRevokeTarget(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 animate-fadeInUp"
               onClick={e => e.stopPropagation()} style={{ fontFamily: "Inter, sans-serif" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">End Session</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {revokeTarget.display_name || revokeTarget.username}
                  {revokeTarget.display_name && <span className="text-gray-400"> (@{revokeTarget.username})</span>}
                </p>
              </div>
            </div>
            <p className="text-[12px] text-gray-600 mb-2">
              This will revoke <span className="font-semibold text-red-600">{revokeTarget.session_count} active session{revokeTarget.session_count !== 1 ? "s" : ""}</span> for this user.
              They will be signed out on their next request.
            </p>
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-4">
              Note: Their current browser session may remain active for up to 24 hours until their access token expires.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRevokeTarget(null)}
                disabled={revoking}
                className="px-3 py-1.5 text-[11px] font-semibold rounded border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setRevoking(true);
                  try {
                    await adminRevokeUserSessions(revokeTarget.user_id);
                    setRevokeTarget(null);
                    await fetchData(timeRange, true);
                  } catch (err) {
                    console.error("Failed to revoke sessions:", err);
                  } finally {
                    setRevoking(false);
                  }
                }}
                disabled={revoking}
                className="px-3 py-1.5 text-[11px] font-semibold rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center gap-1.5"
              >
                {revoking ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Revoking…
                  </>
                ) : "End Session"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Scenarios Modal */}
      <Modal open={scenariosOpen} onClose={() => setScenariosOpen(false)}
             title="All Scenarios" subtitle={`${total_scenarios_count(scenarios_overview)} scenarios across all projects`} width="max-w-2xl">
        {scenarios_overview && scenarios_overview.length > 0 ? (
          <table className="w-full text-[11px]" style={{ fontFamily: "Inter, sans-serif" }}>
            <thead>
              <tr style={{ backgroundColor: TH_BG }}>
                <th className={`text-left ${TH_STYLE}`}>Scenario</th>
                <th className={`text-left ${TH_STYLE}`}>Dataset</th>
                <th className={`text-left ${TH_STYLE}`}>Project</th>
                <th className={`text-center ${TH_STYLE}`}>Status</th>
                <th className={`text-left ${TH_STYLE}`}>Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scenarios_overview.map(s => (
                <tr key={s.id} className="hover:bg-brand-50/40">
                  <td className="px-3 py-2 font-semibold text-brand-700">{s.name}</td>
                  <td className="px-3 py-2 text-gray-600">{s.dataset_name}</td>
                  <td className="px-3 py-2 text-gray-600">{s.project_name}</td>
                  <td className="px-3 py-2 text-center">
                    {s.is_promoted ? (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-semibold">
                        ✓ Promoted
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 bg-brand-50 text-brand-600 border border-brand-100 rounded text-[9px] font-semibold">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{relativeTime(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">No scenarios found</p>
        )}
      </Modal>

      {/* User Status Modal */}
      <Modal open={userStatusOpen} onClose={() => setUserStatusOpen(false)}
             title="User Status" subtitle={`${kpis.total_users} total users`} width="max-w-xl">
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Active = account enabled & can log in</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Inactive = account disabled by admin</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> Never logged in = no session recorded</span>
          </div>

          <div>
            <p className="text-[11px] font-bold text-emerald-700 mb-1">Active ({activeUsersList.length})</p>
            <div className="grid grid-cols-2 gap-1">
              {activeUsersList.map(u => (
                <div key={u.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-50/60 text-[11px]">
                  <Avatar initials={u.initials} size={18} />
                  <span className="font-semibold text-brand-700 truncate">{u.display_name || u.username}</span>
                  {u.last_login && <span className="text-[9px] text-gray-400 ml-auto flex-shrink-0">{relativeTime(u.last_login)}</span>}
                </div>
              ))}
            </div>
          </div>

          {inactiveUsersList.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-red-600 mb-1">Inactive ({inactiveUsersList.length})</p>
              <div className="grid grid-cols-2 gap-1">
                {inactiveUsersList.map(u => (
                  <div key={u.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50/60 text-[11px]">
                    <Avatar initials={u.initials} size={18} />
                    <span className="font-semibold text-gray-500 truncate">{u.display_name || u.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {neverLoggedIn.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-500 mb-1">Never Logged In ({neverLoggedIn.length})</p>
              <div className="grid grid-cols-2 gap-1">
                {neverLoggedIn.map(u => (
                  <div key={u.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-50 text-[11px]">
                    <Avatar initials={u.initials} size={18} />
                    <span className="font-semibold text-gray-400 truncate">{u.display_name || u.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Activity Detail Modal */}
      <Modal open={!!actDetailOpen} onClose={() => setActDetailOpen(null)}
             title={`${actDetailOpen || ""} Breakdown`}
             subtitle={`last ${rangeLabel}`} width="max-w-lg">
        {actDetailOpen && activity_detail && (
          <div>
            {actDetailOpen === "Admin Actions" && Array.isArray(activity_detail["Admin Actions"]) && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ backgroundColor: TH_BG }}>
                    <th className={`text-left ${TH_STYLE}`}>Action Type</th>
                    <th className={`text-right ${TH_STYLE}`}>Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activity_detail["Admin Actions"].map((r, i) => (
                    <tr key={i} className="hover:bg-brand-50/40">
                      <td className="px-3 py-1.5 text-gray-700">{r.action}</td>
                      <td className="px-3 py-1.5 text-right font-bold text-brand-700">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {actDetailOpen === "Logins" && Array.isArray(activity_detail["Logins"]) && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ backgroundColor: TH_BG }}>
                    <th className={`text-left ${TH_STYLE}`}>User</th>
                    <th className={`text-right ${TH_STYLE}`}>Login Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activity_detail["Logins"].map((r, i) => (
                    <tr key={i} className="hover:bg-brand-50/40">
                      <td className="px-3 py-1.5 text-gray-700">{r.username}</td>
                      <td className="px-3 py-1.5 text-right font-bold text-brand-700">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {actDetailOpen === "Data Uploads" && Array.isArray(activity_detail["Data Uploads"]) && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ backgroundColor: TH_BG }}>
                    <th className={`text-left ${TH_STYLE}`}>Dataset</th>
                    <th className={`text-left ${TH_STYLE}`}>User</th>
                    <th className={`text-left ${TH_STYLE}`}>When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activity_detail["Data Uploads"].map((r, i) => (
                    <tr key={i} className="hover:bg-brand-50/40">
                      <td className="px-3 py-1.5 font-semibold text-brand-700">{r.dataset}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.user}</td>
                      <td className="px-3 py-1.5 text-gray-500">{relativeTime(r.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {actDetailOpen === "Scenario Edits" && (
              <div className="text-center py-6">
                <p className="text-3xl font-extrabold text-brand-700" style={{ fontFamily: "Manrope" }}>
                  {typeof activity_detail["Scenario Edits"] === "number" ? activity_detail["Scenario Edits"] : 0}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">total change log entries in the last {rangeLabel}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Contributors Modal */}
      <Modal open={contribOpen} onClose={() => setContribOpen(false)}
             title="All Contributors" subtitle={`score = uploads×5 + edits + admin, last ${rangeLabel}`} width="max-w-xl">
        {top_contributors && top_contributors.length > 0 ? (
          <table className="w-full text-[11px]" style={{ fontFamily: "Inter, sans-serif" }}>
            <thead>
              <tr style={{ backgroundColor: TH_BG }}>
                <th className={`text-left ${TH_STYLE}`}>#</th>
                <th className={`text-left ${TH_STYLE}`}>User</th>
                <th className={`text-right ${TH_STYLE}`}>Uploads</th>
                <th className={`text-right ${TH_STYLE}`}>Edits</th>
                <th className={`text-right ${TH_STYLE}`}>Admin</th>
                <th className={`text-right ${TH_STYLE}`}>Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {top_contributors.map((c, i) => (
                <tr key={c.username} className="hover:bg-brand-50/40">
                  <td className="px-3 py-1.5 text-gray-400 font-bold">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Avatar initials={c.initials} size={18} />
                      <span className="font-semibold text-brand-700">{c.display_name || c.username}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{c.uploads}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{c.edits}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{c.admin_actions}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-brand-700">{c.action_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">No contributors in this period</p>
        )}
      </Modal>

    </div>
  );
}

function total_scenarios_count(list) {
  return list ? list.length : 0;
}
