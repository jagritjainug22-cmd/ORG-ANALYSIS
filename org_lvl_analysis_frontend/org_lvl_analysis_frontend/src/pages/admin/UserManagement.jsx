import React, { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { adminListUsers, adminCreateUser, adminUpdateUser, adminDeactivateUser } from "../../api/backend";
import ConfirmDialog from "../../components/ConfirmDialog";

function UserFormModal({ open, onClose, onSave, editUser }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editUser) {
      setUsername(editUser.username);
      setDisplayName(editUser.display_name || "");
      setRole(editUser.role);
      setPassword("");
    } else {
      setUsername(""); setDisplayName(""); setPassword(""); setRole("member");
    }
    setError(null);
  }, [editUser, open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editUser) {
        const body = {};
        if (displayName !== (editUser.display_name || "")) body.display_name = displayName || null;
        if (role !== editUser.role) body.role = role;
        if (password) body.reset_password = password;
        await adminUpdateUser(editUser.id, body);
      } else {
        if (!username || !password) { setError("Username and password are required."); setSaving(false); return; }
        await adminCreateUser({ username, password, display_name: displayName || null, role });
      }
      onSave();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || "Operation failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-800">
            {editUser ? "Edit User" : "Create User"}
          </h3>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              disabled={!!editUser} className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none disabled:bg-gray-100 disabled:text-gray-500" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editUser ? "Reset Password (leave blank to keep)" : "Password"}
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none"
              minLength={editUser ? 0 : 8} required={!editUser} placeholder={editUser ? "Leave blank to keep current" : "Min 8 characters"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none bg-white">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-am-500 hover:bg-am-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? "Saving..." : editUser ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    adminListUsers().then(setUsers).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDeactivate = async () => {
    if (!confirmDeactivate) return;
    try {
      await adminDeactivateUser(confirmDeactivate.id);
      setConfirmDeactivate(null);
      load();
    } catch (err) {
      alert(err.response?.data?.detail || "Deactivation failed.");
      setConfirmDeactivate(null);
    }
  };

  const sortedAndFiltered = users
    .filter((u) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return u.username.toLowerCase().includes(q) || (u.display_name || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (a.role === b.role) return a.username.localeCompare(b.username);
      return a.role === "admin" ? -1 : 1;
    });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">User Management</h2>
          <p className="text-sm text-gray-500 mt-1">{users.length} user{users.length !== 1 ? "s" : ""} total</p>
        </div>
        <button onClick={() => { setEditUser(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-am-500 hover:bg-am-600 text-white rounded-lg text-sm font-medium shadow-md transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Create User
        </button>
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username or display name..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none bg-white"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {search && <p className="text-xs text-gray-500 mt-1">{sortedAndFiltered.length} result{sortedAndFiltered.length !== 1 ? "s" : ""}</p>}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-am-100 border-t-am-500 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Projects</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedAndFiltered.map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.is_active ? "opacity-50" : ""}`}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-800">{u.username}</div>
                    {u.display_name && <div className="text-xs text-gray-500">{u.display_name}</div>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      u.role === "admin" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                    }`}>{u.role}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                      u.is_active ? "text-green-600" : "text-red-500"
                    }`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-green-500" : "bg-red-400"}`}></div>
                      {u.is_active ? "Active" : "Deactivated"}
                    </span>
                    {u.must_change_password === 1 && u.is_active ? (
                      <span className="ml-2 text-xs text-amber-600">(password change pending)</span>
                    ) : null}
                  </td>
                  <td className="px-6 py-4">
                    <ProjectPills projects={u.projects || []} />
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => { setEditUser(u); setShowForm(true); }}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all">
                        Edit
                      </button>
                      {u.is_active ? (
                        <button onClick={() => setConfirmDeactivate(u)}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-all">
                          Deactivate
                        </button>
                      ) : (
                        <button onClick={async () => { await adminUpdateUser(u.id, { is_active: true }); load(); }}
                          className="px-3 py-1.5 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-all">
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserFormModal open={showForm} onClose={() => setShowForm(false)} onSave={load} editUser={editUser} />

      <ConfirmDialog
        open={!!confirmDeactivate}
        title="Deactivate User"
        message={`This will deactivate "${confirmDeactivate?.username}" and revoke all their sessions. They will not be able to log in until reactivated.`}
        confirmText={confirmDeactivate?.username}
        confirmLabel="Deactivate"
        destructive
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(null)}
      />
    </div>
  );
}

const PILL_PALETTES = [
  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-sky-50 text-sky-700 border-sky-200",
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-teal-50 text-teal-700 border-teal-200",
  "bg-orange-50 text-orange-700 border-orange-200",
];

function paletteFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PILL_PALETTES[Math.abs(h) % PILL_PALETTES.length];
}

function ProjectPills({ projects }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: "right" });
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const computePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const POPOVER_WIDTH = 280;
    const GAP = 6;
    const room = window.innerWidth - rect.right;
    const placeRight = room >= POPOVER_WIDTH + GAP + 8;
    setCoords({
      top: rect.bottom + 4,
      left: placeRight ? rect.right + GAP : Math.max(8, rect.left - POPOVER_WIDTH - GAP),
      placement: placeRight ? "right" : "left",
    });
  }, []);

  useLayoutEffect(() => {
    if (!popoverOpen) return;
    computePosition();
    const onResize = () => computePosition();
    const onScroll = () => computePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [popoverOpen, computePosition]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onClickAway = (e) => {
      if (
        triggerRef.current?.contains(e.target) ||
        popoverRef.current?.contains(e.target)
      ) return;
      setPopoverOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  if (!projects || projects.length === 0) {
    return <span className="text-xs text-gray-400 italic">None</span>;
  }
  const MAX_VISIBLE = 3;
  const visible = projects.slice(0, MAX_VISIBLE);
  const hidden = projects.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1.5 items-center max-w-xs">
      {visible.map((p) => (
        <ProjectPill key={p.id} project={p} />
      ))}
      {hidden > 0 && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setPopoverOpen((v) => !v)}
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border transition ${
            popoverOpen
              ? "bg-am-50 border-am-200 text-am-700"
              : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
          }`}
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
        >
          +{hidden}
        </button>
      )}
      {popoverOpen && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="All assigned projects"
          style={{ position: "fixed", top: coords.top, left: coords.left, width: 280, zIndex: 60 }}
          className="bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden animate-[fadeIn_0.12s_ease-out]"
        >
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
              All projects ({projects.length})
            </span>
            <button
              onClick={() => setPopoverOpen(false)}
              className="text-gray-400 hover:text-gray-700 transition"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <ul className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {projects.map((p) => {
              const archived = p.status === "archived";
              const expired = p.status === "expired";
              const palette = archived || expired
                ? "bg-gray-100 text-gray-500"
                : paletteFor(p.name);
              return (
                <li key={p.id} className="px-3 py-2 hover:bg-gray-50 transition flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${palette.split(" ")[0]}`} />
                  <span
                    className={`text-sm text-gray-800 font-medium flex-1 truncate ${archived || expired ? "line-through text-gray-400" : ""}`}
                    title={p.name}
                  >
                    {p.name}
                  </span>
                  {p.role === "admin" && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-am-50 text-am-700 border border-am-200">
                      admin
                    </span>
                  )}
                  {p.status && p.status !== "active" && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
                      {p.status}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ProjectPill({ project: p }) {
  const archived = p.status === "archived";
  const expired = p.status === "expired";
  const palette = archived || expired
    ? "bg-gray-100 text-gray-500 border-gray-200"
    : paletteFor(p.name);
  return (
    <span
      title={`${p.name}${p.role ? ` · ${p.role}` : ""}${p.status && p.status !== "active" ? ` (${p.status})` : ""}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${palette} ${archived || expired ? "line-through" : ""}`}
    >
      {p.role === "admin" && (
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      )}
      <span className="max-w-[120px] truncate">{p.name}</span>
    </span>
  );
}
