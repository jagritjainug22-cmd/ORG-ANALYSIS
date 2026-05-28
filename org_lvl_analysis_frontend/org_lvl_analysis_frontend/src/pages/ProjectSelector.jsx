import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { fetchProjects, fetchProjectDetail } from "../api/backend";

const AVATAR_COLORS = [
  "bg-am-500", "bg-indigo-500", "bg-rose-500", "bg-amber-500",
  "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-fuchsia-500",
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

export default function ProjectSelector() {
  const { user, handleLogout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  // expanded rows: project id -> { loading, members, error }
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

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = projects.filter((p) => {
      if (!q) return true;
      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
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
  }, [projects, search, sortBy, sortDir]);

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
        className={`px-6 py-3 text-${align} text-xs font-semibold text-gray-600 uppercase tracking-wider select-none cursor-pointer hover:text-am-600 transition-colors`}
        onClick={() => toggleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <span className={`text-[10px] ${active ? "text-am-600" : "text-gray-300"}`}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "▲▼"}
          </span>
        </span>
      </th>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="px-8 py-4 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <span className="text-am-500 font-bold text-xl tracking-tight">A&amp;M</span>
            <span className="h-5 w-px bg-gray-300" />
            <span className="text-gray-800 font-semibold">Org Analysis</span>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                className="inline-flex items-center gap-2 px-4 py-2 bg-am-500 hover:bg-am-600 text-white rounded-md text-sm font-medium transition shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Admin Panel
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full">
              <div className={`w-6 h-6 rounded-full ${colorFor(user?.username || "")} flex items-center justify-center text-white text-[10px] font-semibold`}>
                {initialsOf(user?.display_name, user?.username)}
              </div>
              <span className="text-sm text-gray-700 font-medium">
                {user?.username}{user?.role === "admin" ? " (Admin)" : ""}
              </span>
            </div>
            <button
              onClick={() => { handleLogout(); navigate("/login"); }}
              className="inline-flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md text-sm font-medium transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Your Projects</h2>
            <p className="text-gray-500 mt-1 text-sm">
              Select a project workspace to continue your analysis
            </p>
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
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition text-sm bg-white"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-am-100 border-t-am-500 rounded-full animate-spin"></div>
              <p className="text-gray-500 text-sm">Loading projects...</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-md p-6 text-red-700">
            <p className="font-medium">Error loading projects</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-lg font-medium text-gray-800">No projects assigned</p>
            <p className="text-sm text-gray-500 mt-2">
              Contact your administrator to be assigned to a project.
            </p>
          </div>
        ) : filteredSorted.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p className="text-gray-700 font-medium">No projects match your search</p>
            <p className="text-sm text-gray-500 mt-1">Try a different keyword.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="w-8 px-3 py-3"></th>
                    <SortHeader col="name">Project Name</SortHeader>
                    <SortHeader col="description">Description</SortHeader>
                    <SortHeader col="status">Status</SortHeader>
                    <SortHeader col="deadline">Deadline</SortHeader>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Team
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
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

                    return (
                      <React.Fragment key={project.id}>
                        <tr className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-4 align-middle">
                            <button
                              onClick={() => toggleExpand(project)}
                              className="w-6 h-6 rounded-md text-gray-400 hover:text-am-600 hover:bg-am-50 flex items-center justify-center transition"
                              aria-label={isOpen ? "Collapse" : "Expand"}
                              title={isOpen ? "Hide team" : "Show team"}
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
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900">{project.name}</span>
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
                          </td>

                          <td className="px-6 py-4 align-middle max-w-xs">
                            <p className="text-sm text-gray-600 truncate" title={project.description || ""}>
                              {project.description || <span className="text-gray-400 italic">No description</span>}
                            </p>
                          </td>

                          <td className="px-6 py-4 align-middle">
                            <StatusBadge status={archived ? "archived" : expired ? "expired" : "active"} />
                          </td>

                          <td className="px-6 py-4 align-middle whitespace-nowrap">
                            <span
                              className={`text-sm ${
                                expired
                                  ? "text-red-600 font-medium"
                                  : daysLeft !== null && daysLeft <= 7
                                  ? "text-amber-600 font-medium"
                                  : "text-gray-700"
                              }`}
                            >
                              {expired
                                ? `Expired ${formatDeadline(project.deadline)}`
                                : daysLeft !== null && daysLeft <= 7
                                ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`
                                : formatDeadline(project.deadline)}
                            </span>
                          </td>

                          <td className="px-6 py-4 align-middle">
                            <button
                              onClick={() => toggleExpand(project)}
                              className="inline-flex items-center text-xs text-am-600 hover:text-am-700 font-medium"
                            >
                              {isOpen ? "Hide team" : "View team"}
                              <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d={isOpen ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
                              </svg>
                            </button>
                          </td>

                          <td className="px-6 py-4 align-middle text-right">
                            <button
                              onClick={() => !blocked && navigate(`/projects/${project.id}`)}
                              disabled={blocked}
                              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition ${
                                blocked
                                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                  : "bg-am-500 hover:bg-am-600 text-white shadow-sm"
                              }`}
                              title={
                                blocked
                                  ? archived
                                    ? "Archived — contact admin to reactivate"
                                    : "Expired — contact admin to extend"
                                  : "Open project"
                              }
                            >
                              Open
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                              </svg>
                            </button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="bg-gray-50/60">
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

function StatusBadge({ status }) {
  const styles = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    archived: "bg-gray-100 text-gray-600 border-gray-200",
    expired: "bg-red-50 text-red-700 border-red-200",
  };
  const dots = {
    active: "bg-emerald-500",
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
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`}></span>
      {labels[status]}
    </span>
  );
}

function ExpandedTeam({ state }) {
  if (!state) return null;
  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="w-4 h-4 border-2 border-am-100 border-t-am-500 rounded-full animate-spin"></div>
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
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-md px-3 py-2"
          >
            <Avatar displayName={m.display_name} username={m.username} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {m.display_name || m.username}
              </p>
              <p className="text-xs text-gray-500 truncate">
                @{m.username}
                {m.role && m.role !== "member" && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-am-50 text-am-700 border border-am-200">
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
