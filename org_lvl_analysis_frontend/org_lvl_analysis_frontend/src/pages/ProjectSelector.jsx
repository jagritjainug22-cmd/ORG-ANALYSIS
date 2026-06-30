import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useConfirmLogout } from "../hooks/useConfirmLogout";
import { fetchProjects, fetchProjectDetail } from "../api/backend";
import SkeletonTableLoader from "../components/SkeletonTableLoader";
import AMLogo from "../components/AMLogo";

const AVATAR_COLORS = [
  "bg-brand-500", "bg-indigo-500", "bg-rose-500", "bg-accent-500",
  "bg-teal-500", "bg-sky-500", "bg-violet-500", "bg-fuchsia-500",
];


function initialsOf(displayName, username) {
  const src = (displayName || username || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function Avatar({ displayName, username, size = "sm" }) {
  const dims = size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs";
  return (
    <div
      className={`${dims} ${colorFor(username || displayName || "")} ring-2 ring-white rounded-full flex items-center justify-center text-white font-semibold`}
      title={displayName || username}
    >
      {initialsOf(displayName, username)}
    </div>
  );
}

function StackedAvatars({ members, count }) {
  if (!members || members.length === 0) {
    return <span className="text-xs text-gray-400 italic">No team</span>;
  }
  const shown = members.slice(0, 4);
  const extra = (count ?? members.length) - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((m, idx) => (
          <div
            key={m.user_id || idx}
            className={`w-7 h-7 rounded-full ${colorFor(m.username || m.display_name || "")} ring-2 ring-white text-white text-[10px] font-semibold flex items-center justify-center transition-transform hover:translate-y-[-2px] hover:z-10 cursor-default`}
            title={m.display_name || m.username}
            style={{ zIndex: shown.length - idx }}
          >
            {initialsOf(m.display_name, m.username)}
          </div>
        ))}
        {extra > 0 && (
          <div
            className="w-7 h-7 rounded-full bg-gray-200 ring-2 ring-white text-gray-600 text-[10px] font-semibold flex items-center justify-center"
            title={`${extra} more team member${extra === 1 ? "" : "s"}`}
          >
            +{extra}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectSelector() {
  const { user } = useAuth();
  const confirmLogout = useConfirmLogout();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [statusFilter, setStatusFilter] = useState("all");

  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    fetchProjects()
      .then((data) => {
        setProjects(Array.isArray(data) ? data : data.projects ?? []);
      })
      .catch((err) => {
        setError(err.response?.data?.detail || "Failed to load projects");
      })
      .finally(() => setLoading(false));
  }, []);

  const isExpired = (deadline) => deadline && new Date(deadline) < new Date();
  const daysUntilDeadline = (deadline) => {
    if (!deadline) return null;
    return Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24));
  };
  const formatDeadline = (deadline) => {
    if (!deadline) return "No deadline";
    return new Date(deadline).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  };

  const statusOf = (p) => {
    if (p.status === "archived") return "archived";
    if (isExpired(p.deadline)) return "expired";
    return "active";
  };

  const stats = useMemo(() => {
    const counts = { total: projects.length, active: 0, expiring: 0, expired: 0, archived: 0 };
    projects.forEach((p) => {
      const s = statusOf(p);
      counts[s] = (counts[s] || 0) + 1;
      const days = daysUntilDeadline(p.deadline);
      if (s === "active" && days !== null && days <= 7) counts.expiring += 1;
    });
    return counts;
  }, [projects]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = projects.filter((p) => {
      if (q) {
        const m =
          (p.name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q);
        if (!m) return false;
      }
      if (statusFilter !== "all") {
        const s = statusOf(p);
        if (statusFilter === "expiring") {
          const days = daysUntilDeadline(p.deadline);
          if (!(s === "active" && days !== null && days <= 7)) return false;
        } else if (s !== statusFilter) {
          return false;
        }
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let av, bv;
      switch (sortBy) {
        case "status":
          av = statusOf(a); bv = statusOf(b);
          break;
        case "deadline":
          av = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
          bv = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
          break;
        case "description":
          av = (a.description || "").toLowerCase();
          bv = (b.description || "").toLowerCase();
          break;
        case "name":
        default:
          av = (a.name || "").toLowerCase();
          bv = (b.name || "").toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [projects, search, sortBy, sortDir, statusFilter]);

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const toggleExpand = async (project) => {
    const id = project.id;
    const cur = expanded[id];
    if (cur && !cur.loading) {
      setExpanded((e) => {
        const { [id]: _, ...rest } = e;
        return rest;
      });
      return;
    }
    setExpanded((e) => ({ ...e, [id]: { loading: true, members: [], error: null } }));
    try {
      const detail = await fetchProjectDetail(id);
      setExpanded((e) => ({
        ...e,
        [id]: { loading: false, members: detail.members || [], error: null },
      }));
    } catch (err) {
      setExpanded((e) => ({
        ...e,
        [id]: {
          loading: false,
          members: [],
          error: err.response?.data?.detail || "Failed to load team",
        },
      }));
    }
  };

  const SortHeader = ({ col, children, align = "left" }) => {
    const active = sortBy === col;
    return (
      <th
        scope="col"
        className={`px-6 py-3 text-${align} text-xs font-semibold text-white uppercase tracking-wider select-none cursor-pointer hover:text-white/90 transition-colors`}
        onClick={() => toggleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <span className={`text-[10px] ${active ? "text-white/90" : "text-white/60"}`}>
            {active ? (sortDir === "asc" ? "▴" : "▾") : "▴▾"}
          </span>
        </span>
      </th>
    );
  };

  return (
    <div className="min-h-screen bg-page-gradient flex flex-col">
      <header className="px-8 py-4 bg-brand-600 text-white border-b border-brand-700 shadow-sm">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-3">
              <AMLogo className="h-7" />
              <span className="h-5 w-px bg-white/30" />
              <span className="text-white/90 font-semibold">OrgSight</span>
            </div>
          <div className="flex items-center gap-4">
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                className="inline-flex items-center gap-2 px-4 py-2 bg-transparent border border-white/25 text-white hover:bg-white/10 hover:border-white/40 rounded-lg text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Admin Panel
              </button>
            )}

            <div className="h-9 w-px bg-white/15"></div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-white text-brand-700 flex items-center justify-center text-sm font-semibold shadow-md">
                  {initialsOf(user?.display_name, user?.username)}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full ring-2 ring-brand-600"></span>
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-white">{user?.username}</p>
                <p className="text-xs text-white/60">{user?.role === "admin" ? "Administrator" : "Member"}</p>
              </div>
            </div>

            <div className="h-9 w-px bg-white/15"></div>

            <button
              onClick={(e) => confirmLogout(e)}
              className="inline-flex items-center justify-center px-5 py-2 rounded-lg text-sm font-medium text-red-400 bg-red-500/5 border border-red-500/40 backdrop-blur-sm hover:bg-red-500/10 hover:border-red-500/60 hover:text-red-300 transition-all duration-150"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">
        {/* Hero strip */}
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">
            Welcome back{user?.display_name ? `, ${user.display_name.split(" ")[0]}` : ""}
          </h2>
          <p className="text-gray-500 mt-1.5 text-sm">
            Choose a project workspace to continue your organizational analysis.
          </p>
        </div>

        {/* Stats strip */}
        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Total Projects"
              value={stats.total}
              tone="indigo"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7l9-4 9 4M3 7l9 4 9-4M3 7v10l9 4m0 0l9-4V7m-9 14V11" />
                </svg>
              }
              active={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            />
            <StatCard
              label="Active"
              value={stats.active}
              tone="brand"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              active={statusFilter === "active"}
              onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
            />
            <StatCard
              label="Expiring Soon"
              value={stats.expiring}
              tone="amber"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              active={statusFilter === "expiring"}
              onClick={() => setStatusFilter(statusFilter === "expiring" ? "all" : "expiring")}
            />
            <StatCard
              label="Archived / Expired"
              value={(stats.archived || 0) + (stats.expired || 0)}
              tone="gray"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              }
              active={statusFilter === "archived" || statusFilter === "expired"}
              onClick={() => setStatusFilter(statusFilter === "archived" ? "all" : "archived")}
            />
          </div>
        )}

        <div className="flex items-end justify-between mb-4 gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-semibold text-gray-800">{filteredSorted.length}</span> project{filteredSorted.length !== 1 ? "s" : ""}
            {statusFilter !== "all" && (
              <button
                onClick={() => setStatusFilter("all")}
                className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium"
              >
                Clear filter
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="relative w-full max-w-xs">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="search"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition text-sm bg-white shadow-sm"
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTableLoader />
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-md p-6 text-red-700">
            <p className="font-medium">Error loading projects</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-lg font-medium text-gray-800">No projects assigned</p>
            <p className="text-sm text-gray-500 mt-2">
              Contact your administrator to be assigned to a project.
            </p>
          </div>
        ) : filteredSorted.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
            <p className="text-gray-700 font-medium">No projects match your search</p>
            <p className="text-sm text-gray-500 mt-1">Try a different keyword or clear the active filter.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-md">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-brand-600 to-brand-500 text-white">
                  <tr>
                    <th scope="col" className="w-1 px-0 py-3"></th>
                    <th scope="col" className="w-8 px-3 py-3"></th>
                    <SortHeader col="name">Project</SortHeader>
                    <SortHeader col="status">Status</SortHeader>
                    <SortHeader col="deadline">Deadline</SortHeader>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Team
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Datasets
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-white uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSorted.map((project) => {
                    const expired = isExpired(project.deadline);
                    const archived = project.status === "archived";
                    const blocked = expired || archived;
                    const daysLeft = daysUntilDeadline(project.deadline);
                    const isOpen = !!expanded[project.id];
                    const expState = expanded[project.id];
                    const accentTone = archived ? "gray" : expired ? "red" : daysLeft !== null && daysLeft <= 7 ? "amber" : "brand";
                    const accentClass = {
                      gray: "bg-gray-300",
                      red: "bg-red-500",
                      amber: "bg-amber-500",
                      brand: "bg-brand-500",
                    }[accentTone];

                    return (
                      <React.Fragment key={project.id}>
                        <tr className="group hover:bg-gray-50/70 transition-colors">
                          <td className="p-0 align-stretch">
                            <div className={`w-1 h-full ${accentClass}`} style={{ minHeight: 56 }} />
                          </td>
                          <td className="px-3 py-4 align-middle">
                            <button
                              onClick={() => toggleExpand(project)}
                              className="w-6 h-6 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50 flex items-center justify-center transition"
                              aria-label={isOpen ? "Collapse" : "Expand"}
                              title={isOpen ? "Hide team" : "Show full team"}
                            >
                              <svg
                                className={`w-4 h-4 transform transition-transform ${isOpen ? "rotate-90" : ""}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </td>

                          <td className="px-6 py-4 align-middle">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-gray-900 text-[15px]">{project.name}</span>
                              {project.locked_by && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200"
                                  title={`Currently being edited by ${project.locked_by}`}
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                  </svg>
                                  {project.locked_by}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate max-w-md" title={project.description || ""}>
                              {project.description || <span className="italic text-gray-400">No description</span>}
                            </p>
                          </td>

                          <td className="px-6 py-4 align-middle">
                            <StatusBadge status={archived ? "archived" : expired ? "expired" : "active"} />
                          </td>

                          <td className="px-6 py-4 align-middle whitespace-nowrap">
                            <DeadlinePill deadline={project.deadline} daysLeft={daysLeft} expired={expired} formatDeadline={formatDeadline} />
                          </td>

                          <td className="px-6 py-4 align-middle">
                            {(project.member_count ?? 0) === 0 ? (
                              <span className="text-xs text-gray-400 italic">No team</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleExpand(project)}
                                className="group/team inline-flex items-center gap-2 rounded-md px-1.5 py-1 -ml-1.5 hover:bg-gray-100 transition-colors"
                                title={isOpen ? "Hide team" : "View all team members"}
                                aria-expanded={isOpen}
                              >
                                <StackedAvatars
                                  members={project.members_preview || []}
                                  count={project.member_count}
                                />
                                <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-500 group-hover/team:text-brand-600 transition-colors">
                                  {isOpen ? "Hide" : "View all"}
                                  <svg
                                    className={`w-3.5 h-3.5 transform transition-transform ${isOpen ? "rotate-180" : ""}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </span>
                              </button>
                            )}
                          </td>

                          <td className="px-6 py-4 align-middle">
                            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 font-medium">
                              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 4 3h8c2.5 0 4-1 4-3V7c0-2-1.5-3-4-3H8C5.5 4 4 5 4 7zM4 11h16" />
                              </svg>
                              {project.dataset_count ?? 0}
                            </span>
                          </td>

                          <td className="px-6 py-4 align-middle text-right">
                            <button
                              onClick={() => !blocked && navigate(`/projects/${project.id}`)}
                              disabled={blocked}
                              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                                blocked
                                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                  : "bg-brand-500 hover:bg-brand-600 text-white shadow-sm hover:shadow-md hover:gap-2.5"
                              }`}
                              title={
                                blocked
                                  ? archived
                                    ? "Archived â€” contact admin to reactivate"
                                    : "Expired â€” contact admin to extend"
                                  : "Open project"
                              }
                            >
                                Open
                              <svg className={`w-3.5 h-3.5 transition-transform ${blocked ? "" : "group-hover:translate-x-0.5"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                              </svg>
                            </button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="bg-gray-50/60">
                            <td className={`w-1 ${accentClass} opacity-40`} />
                            <td></td>
                            <td colSpan={6} className="px-6 py-4">
                              <ExpandedTeam state={expState} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = "indigo", icon, active, onClick }) {
  const palette = {
    indigo: {
      ring: active ? "ring-2 ring-brand-500 ring-offset-2" : "",
      iconBg: "bg-brand-50 text-brand-600",
      gradient: "from-brand-500/5 to-transparent",
    },
    brand: {
      ring: active ? "ring-2 ring-brand-500 ring-offset-2" : "",
      iconBg: "bg-brand-50 text-brand-600",
      gradient: "from-brand-500/5 to-transparent",
    },
    amber: {
      ring: active ? "ring-2 ring-brand-500 ring-offset-2" : "",
      iconBg: "bg-[#fffbeb] text-[#c5a84a]",
      gradient: "from-[#c5a84a]/5 to-transparent",
    },
    gray: {
      ring: active ? "ring-2 ring-slate-400 ring-offset-2" : "",
      iconBg: "bg-slate-100 text-slate-500",
      gradient: "from-slate-500/5 to-transparent",
    },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden bg-white/90 backdrop-blur-sm border border-brand-100 rounded-xl p-4 text-left transition-all duration-300 hover:shadow-panel hover:-translate-y-0.5 shadow-card ${palette.ring} ${
        active ? "bg-brand-50/30 border-brand-300" : ""
      }`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${palette.gradient} pointer-events-none`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{label}</p>
          <p className="text-3xl font-extrabold text-[#01244a] mt-2 leading-none" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg ${palette.iconBg} flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </div>
      </div>
    </button>
  );
}


function DeadlinePill({ deadline, daysLeft, expired, formatDeadline }) {
  if (!deadline) {
    return <span className="text-sm text-gray-400 italic">No deadline</span>;
  }
  if (expired) {
    return (
      <span className="inline-flex flex-col">
        <span className="text-sm font-semibold text-red-600">Expired</span>
        <span className="text-[11px] text-red-400">{formatDeadline(deadline)}</span>
      </span>
    );
  }
  if (daysLeft !== null && daysLeft <= 7) {
    return (
      <span className="inline-flex flex-col">
        <span className="text-sm font-semibold text-amber-600">{daysLeft} day{daysLeft !== 1 ? "s" : ""} left</span>
        <span className="text-[11px] text-amber-400">{formatDeadline(deadline)}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <span className="text-sm text-gray-700">{formatDeadline(deadline)}</span>
      {daysLeft !== null && <span className="text-[11px] text-gray-400">in {daysLeft} days</span>}
    </span>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: "bg-brand-50 text-brand-700 border-brand-200",
    archived: "bg-gray-100 text-gray-600 border-gray-200",
    expired: "bg-red-50 text-red-700 border-red-200",
  };
  const dots = {
    active: "bg-brand-500",
    archived: "bg-gray-400",
    expired: "bg-red-500",
  };
  const labels = {
    active: "Active",
    archived: "Archived",
    expired: "Expired",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]} ${status === "active" ? "animate-pulse" : ""}`}></span>
      {labels[status]}
    </span>
  );
}

function ExpandedTeam({ state }) {
  if (!state) return null;
  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="w-4 h-4 border-2 border-brand-100 border-t-brand-500 rounded-full animate-spin"></div>
        Loading team...
      </div>
    );
  }
  if (state.error) {
    return <div className="text-sm text-red-600">{state.error}</div>;
  }
  if (!state.members || state.members.length === 0) {
    return <div className="text-sm text-gray-500">No team members assigned.</div>;
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Team Members ({state.members.length})
      </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {state.members.map((m) => (
          <div
            key={m.user_id}
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-brand-300 hover:shadow-sm transition-all"
          >
            <Avatar displayName={m.display_name} username={m.username} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {m.display_name || m.username}
              </p>
              <p className="text-xs text-gray-500 truncate">
                @{m.username}
                {m.role && m.role !== "member" && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-50 text-accent-700 border border-accent-200">
                    {m.role}
                  </span>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
