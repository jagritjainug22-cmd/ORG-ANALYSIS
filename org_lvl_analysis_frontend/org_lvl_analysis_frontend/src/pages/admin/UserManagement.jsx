import React, { useEffect, useState, useCallback } from "react";
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
              disabled={!!editUser} className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editUser ? "Reset Password (leave blank to keep)" : "Password"}
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              minLength={editUser ? 0 : 8} required={!editUser} placeholder={editUser ? "Leave blank to keep current" : "Min 8 characters"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
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
          className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium shadow-md transition-all">
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
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
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
          <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
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
