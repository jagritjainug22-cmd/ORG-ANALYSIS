import React, { useEffect, useState, useCallback } from "react";
import { adminGetAuditLog, adminListUsers } from "../../api/backend";

const ACTION_COLORS = {
  "user.create": "bg-green-100 text-green-700",
  "user.update": "bg-blue-100 text-blue-700",
  "user.deactivate": "bg-red-100 text-red-700",
  "project.create": "bg-green-100 text-green-700",
  "project.update": "bg-blue-100 text-blue-700",
  "project.archive": "bg-red-100 text-red-700",
  "project.assign": "bg-am-100 text-am-700",
  "project.unassign": "bg-orange-100 text-orange-700",
  "admin_override": "bg-amber-100 text-amber-700",
};

const PAGE_SIZE = 50;

// Backend stores timestamps as UTC ISO strings WITHOUT a 'Z' suffix
// (datetime.utcnow().isoformat()). JavaScript would otherwise parse them as
// local time, so we explicitly mark them as UTC before formatting in IST.
const formatIST = (iso) => {
  if (!iso) return "—";
  const utc = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(utc);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }) + " IST";
};

export default function AuditLog() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Filters
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const load = useCallback((newOffset = 0) => {
    setLoading(true);
    const params = { limit: PAGE_SIZE, offset: newOffset };
    if (filterUser) params.user_id = parseInt(filterUser);
    if (filterAction) params.action = filterAction;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo + "T23:59:59";

    adminGetAuditLog(params)
      .then((data) => {
        setEntries(data);
        setOffset(newOffset);
        setHasMore(data.length === PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterUser, filterAction, filterDateFrom, filterDateTo]);

  useEffect(() => { load(0); }, [load]);

  useEffect(() => {
    adminListUsers().then(setUsers).catch(() => {});
  }, []);

  const knownActions = [
    "user.create", "user.update", "user.deactivate",
    "project.create", "project.update", "project.archive",
    "project.assign", "project.unassign", "admin_override",
  ];

  const clearFilters = () => {
    setFilterUser(""); setFilterAction(""); setFilterDateFrom(""); setFilterDateTo("");
  };

  const hasFilters = filterUser || filterAction || filterDateFrom || filterDateTo;

  const formatDetails = (entry) => {
    if (!entry.details) return null;
    const d = typeof entry.details === "string" ? JSON.parse(entry.details) : entry.details;
    return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(", ");
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Audit Log</h2>
        <p className="text-sm text-gray-500 mt-1">Track all administrative actions and access overrides</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-700">Filters</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto text-xs text-am-600 hover:underline">Clear all</button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">User</label>
            <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none bg-white">
              <option value="">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none bg-white">
              <option value="">All actions</option>
              {knownActions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-am-100 border-t-am-500 rounded-full animate-spin"></div>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-gray-500">No audit entries found{hasFilters ? " for the selected filters" : ""}.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-56">Time (IST)</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">User</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-36">Action</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-gray-500 font-mono whitespace-nowrap" title={e.created_at + " UTC"}>
                      {formatIST(e.created_at)}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700 font-medium">{e.username || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        ACTION_COLORS[e.action] || "bg-gray-100 text-gray-600"
                      }`}>{e.action}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500 truncate max-w-md" title={formatDetails(e) || ""}>
                      {formatDetails(e) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <button onClick={() => load(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Showing {offset + 1}–{offset + entries.length}
            </span>
            <button onClick={() => load(offset + PAGE_SIZE)} disabled={!hasMore}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
