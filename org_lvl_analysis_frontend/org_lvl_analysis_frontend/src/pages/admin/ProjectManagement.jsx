import React, { useEffect, useState, useCallback } from "react";
import {
  adminListProjects, adminCreateProject, adminUpdateProject, adminArchiveProject,
  adminHardDeleteProject, adminListAssignments, adminAssignUser, adminUnassignUser, adminListUsers,
} from "../../api/backend";
import ConfirmDialog from "../../components/ConfirmDialog";

function ProjectFormModal({ open, onClose, onSave, editProject }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setDescription(editProject.description || "");
      setDeadline(editProject.deadline ? editProject.deadline.substring(0, 10) : "");
      setStatus(editProject.status);
    } else {
      setName(""); setDescription(""); setDeadline(""); setStatus("active");
    }
    setError(null);
  }, [editProject, open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      const body = { name, description: description || null, deadline: deadline || null };
      if (editProject) {
        body.status = status;
        await adminUpdateProject(editProject.id, body);
      } else {
        await adminCreateProject(body);
      }
      onSave(); onClose();
    } catch (err) {
      setError(err.response?.data?.detail || "Operation failed.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-800">{editProject ? "Edit Project" : "Create Project"}</h3>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none resize-none" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none" />
          </div>
          {editProject && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none bg-white">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-am-500 hover:bg-am-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? "Saving..." : editProject ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignmentPanel({ project, onClose }) {
  const [assignments, setAssignments] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmUnassign, setConfirmUnassign] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      adminListAssignments(project.id),
      adminListUsers(),
    ]).then(([a, u]) => {
      setAssignments(a);
      setAllUsers(u);
    }).catch(console.error).finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const assignedIds = new Set(assignments.map((a) => a.user_id));
  const unassigned = allUsers.filter((u) => u.is_active && !assignedIds.has(u.id));

  const handleAssign = async () => {
    if (!selectedUserId) return;
    setError(null);
    try {
      await adminAssignUser(project.id, { user_id: parseInt(selectedUserId) });
      setSelectedUserId("");
      load();
    } catch (err) {
      setError(err.response?.data?.detail || "Assignment failed.");
    }
  };

  const handleUnassign = async () => {
    if (!confirmUnassign) return;
    try {
      await adminUnassignUser(project.id, confirmUnassign.user_id);
      setConfirmUnassign(null);
      load();
    } catch (err) {
      alert(err.response?.data?.detail || "Unassignment failed.");
      setConfirmUnassign(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Members: {project.name}</h3>
            <p className="text-xs text-gray-500">{assignments.length} assigned</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          {/* Assign new user */}
          <div className="flex gap-2">
            <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none bg-white">
              <option value="">Select a user to assign...</option>
              {unassigned.map((u) => (
                <option key={u.id} value={u.id}>{u.username}{u.display_name ? ` (${u.display_name})` : ""}</option>
              ))}
            </select>
            <button onClick={handleAssign} disabled={!selectedUserId}
              className="px-4 py-2 bg-am-500 hover:bg-am-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-all">
              Assign
            </button>
          </div>

          {/* Current assignments */}
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-am-100 border-t-am-500 rounded-full animate-spin"></div>
            </div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No users assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {assignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <div>
                    <span className="text-sm font-medium text-gray-800">{a.username}</span>
                    {a.display_name && <span className="text-xs text-gray-500 ml-2">{a.display_name}</span>}
                    <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      a.user_role === "admin" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                    }`}>{a.user_role || a.role}</span>
                  </div>
                  <button onClick={() => setConfirmUnassign(a)}
                    className="px-3 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-all">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <ConfirmDialog
          open={!!confirmUnassign}
          title="Remove Assignment"
          message={`Remove "${confirmUnassign?.username}" from "${project.name}"? They will lose access to this project immediately.`}
          confirmLabel="Remove"
          destructive
          onConfirm={handleUnassign}
          onCancel={() => setConfirmUnassign(null)}
        />
      </div>
    </div>
  );
}

export default function ProjectManagement() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [assignProject, setAssignProject] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    adminListProjects().then(setProjects).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleArchive = async () => {
    if (!confirmArchive) return;
    try {
      await adminArchiveProject(confirmArchive.id);
      setConfirmArchive(null);
      load();
    } catch (err) {
      alert(err.response?.data?.detail || "Archive failed.");
      setConfirmArchive(null);
    }
  };

  const handleHardDelete = async () => {
    if (!confirmDelete) return;
    try {
      await adminHardDeleteProject(confirmDelete.id);
      setConfirmDelete(null);
      load();
    } catch (err) {
      alert(err.response?.data?.detail || "Deletion failed.");
      setConfirmDelete(null);
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014";

  const archivedDaysAgo = (p) => {
    if (p.status !== "archived") return null;
    const updated = new Date(p.updated_at);
    return Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Project Management</h2>
          <p className="text-sm text-gray-500 mt-1">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => { setEditProject(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-am-500 hover:bg-am-600 text-white rounded-lg text-sm font-medium shadow-md transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Create Project
        </button>
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
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Project</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Deadline</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => {
                const isExpired = p.deadline && new Date(p.deadline) < new Date();
                const archDays = archivedDaysAgo(p);
                return (
                  <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${p.status !== "active" ? "opacity-60" : ""}`}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-800">{p.name}</div>
                      {p.description && <div className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{p.description}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        p.status === "active" ? "bg-green-100 text-green-700" :
                        p.status === "archived" ? "bg-gray-100 text-gray-600" :
                        "bg-red-100 text-red-700"
                      }`}>{p.status}</span>
                      {archDays !== null && (
                        <span className={`ml-1.5 text-xs ${archDays >= 25 ? "text-red-500 font-medium" : "text-gray-400"}`}>
                          ({archDays}d ago{archDays >= 25 ? " \u2014 auto-deletes at 30d" : ""})
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-sm ${isExpired ? "text-red-600 font-medium" : "text-gray-600"}`}>
                        {formatDate(p.deadline)}
                      </span>
                      {isExpired && <span className="ml-1 text-xs text-red-500">(expired)</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatDate(p.created_at)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setAssignProject(p)}
                          className="px-3 py-1.5 text-xs font-medium text-am-600 bg-am-50 hover:bg-am-100 rounded-lg transition-all">
                          Members
                        </button>
                        <button onClick={() => { setEditProject(p); setShowForm(true); }}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all">
                          Edit
                        </button>
                        {p.status === "active" && (
                          <button onClick={() => setConfirmArchive(p)}
                            className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-all">
                            Archive
                          </button>
                        )}
                        <button onClick={() => setConfirmDelete(p)}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-all">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProjectFormModal open={showForm} onClose={() => setShowForm(false)} onSave={load} editProject={editProject} />

      {assignProject && (
        <AssignmentPanel project={assignProject} onClose={() => { setAssignProject(null); load(); }} />
      )}

      <ConfirmDialog
        open={!!confirmArchive}
        title="Archive Project"
        message={`This will archive "${confirmArchive?.name}". Users will lose access and the project will be hidden from the project selector. Datasets are preserved. The project will be auto-deleted after 30 days.`}
        confirmText={confirmArchive?.name}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setConfirmArchive(null)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Permanently Delete Project"
        message={`This will PERMANENTLY delete "${confirmDelete?.name}" and ALL associated data including datasets, scenarios, change logs, and assignments. This action cannot be undone.`}
        confirmText={confirmDelete?.name}
        confirmLabel="Delete Forever"
        destructive
        onConfirm={handleHardDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
