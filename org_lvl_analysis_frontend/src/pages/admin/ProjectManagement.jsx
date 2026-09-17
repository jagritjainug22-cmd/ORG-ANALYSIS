import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  adminListProjects, adminCreateProject, adminUpdateProject, adminArchiveProject,
  adminHardDeleteProject, adminListAssignments, adminAssignUser, adminUnassignUser, adminListUsers,
  adminListProjectDatasets, adminDeleteProjectDataset,
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
      <div className="bg-white rounded-md shadow-xl border border-gray-200 w-full max-w-md mx-4">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h3 className="text-base font-semibold text-gray-800">{editProject ? "Edit Project" : "Create Project"}</h3>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none resize-none" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
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
            <button type="button" onClick={onClose} className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
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
      <div className="bg-white rounded-md shadow-xl border border-gray-200 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b bg-[#01244a] border-[#08304a] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Members: {project.name}</h3>
            <p className="text-xs text-gray-200">{assignments.length} assigned</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md transition">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          {/* Assign new user */}
          <div className="flex gap-2">
            <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white">
              <option value="">Select a user to assign...</option>
              {unassigned.map((u) => (
                <option key={u.id} value={u.id}>{u.username}{u.display_name ? ` (${u.display_name})` : ""}</option>
              ))}
            </select>
            <button onClick={handleAssign} disabled={!selectedUserId}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-md text-sm font-medium disabled:opacity-40 transition-all">
              Assign
            </button>
          </div>

          {/* Current assignments */}
            {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-brand-100 border-t-brand-500 rounded-full animate-spin"></div>
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

function fmtRows(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString();
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function DatasetPanel({ project, onClose }) {
  const [datasets, setDatasets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminListProjectDatasets(project.id)
      .then((data) => {
        setDatasets(data.datasets || []);
        setError(null);
      })
      .catch((err) => setError(err.response?.data?.detail || "Failed to load datasets."))
      .finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await adminDeleteProjectDataset(project.id, confirmDelete.id);
      setConfirmDelete(null);
      load();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to delete dataset.");
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-md shadow-xl border border-gray-200 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b bg-[#01244a] border-[#08304a] flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-white">Datasets: {project.name}</h3>
            <p className="text-xs text-gray-200 mt-0.5">
              {datasets === null ? "Loading…" : `${datasets.length} dataset${datasets.length !== 1 ? "s" : ""} in this project`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md transition">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-4 border-am-100 border-t-am-500 rounded-full animate-spin" />
            </div>
          ) : !datasets || datasets.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-600">No datasets in this project</p>
              <p className="text-xs text-gray-400 mt-1">Datasets are created when users run the Hierarchy step.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {datasets.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100 hover:border-gray-200 transition"
                >
                  {/* Accent dot */}
                  <div className="w-2 h-2 rounded-full bg-[#01244a] flex-shrink-0" />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800 truncate" title={d.name}>
                        {d.name}
                      </span>
                      <span className="text-[11px] text-gray-400 font-mono">#{d.id}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                      <span>{fmtRows(d.row_count)} rows</span>
                      <span className="text-gray-300">·</span>
                      <span>uploaded by {d.username || "unknown"}</span>
                      <span className="text-gray-300">·</span>
                      <span>{fmtDate(d.upload_time)}</span>
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => setConfirmDelete(d)}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-gray-50 flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
            Close
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Dataset"
        message={`Permanently delete "${confirmDelete?.name}"? This will remove all scenarios, change logs, and records for this dataset. This action cannot be undone.`}
        confirmText={confirmDelete?.name}
        confirmLabel={deleting ? "Deleting…" : "Delete Forever"}
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default function ProjectManagement() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [assignProject, setAssignProject] = useState(null);
  const [datasetProject, setDatasetProject] = useState(null);
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
          <div className="w-8 h-8 border-4 border-brand-100 border-t-brand-500 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="bg-white rounded-md shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[#01244a] border-b border-[#08304a]">
                <th className="text-left px-4 py-2 text-xs font-semibold text-white uppercase tracking-wider">Project</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-white uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-white uppercase tracking-wider">Deadline</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-white uppercase tracking-wider">Created</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-white uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => {
                const isExpired = p.deadline && new Date(p.deadline) < new Date();
                const archDays = archivedDaysAgo(p);
                return (
                  <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${p.status !== "active" ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{p.name}</div>
                      {p.description && <div className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{p.description}</div>}
                    </td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
                      <span className={`text-sm ${isExpired ? "text-red-600 font-medium" : "text-gray-600"}`}>
                        {formatDate(p.deadline)}
                      </span>
                      {isExpired && <span className="ml-1 text-xs text-red-500">(expired)</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setAssignProject(p)}
                          className="px-3 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-md transition-all">
                          Members
                        </button>
                        <button onClick={() => setDatasetProject(p)}
                          className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-all">
                          Datasets
                        </button>
                        <button onClick={() => navigate(`/projects/${p.id}`)}
                          className="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-all">
                          Open
                        </button>
                        <button onClick={() => { setEditProject(p); setShowForm(true); }}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-all">
                          Edit
                        </button>
                        {p.status === "active" && (
                          <button onClick={() => setConfirmArchive(p)}
                            className="px-3 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-md transition-all">
                            Archive
                          </button>
                        )}
                        <button onClick={() => setConfirmDelete(p)}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-all">
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

      {datasetProject && (
        <DatasetPanel project={datasetProject} onClose={() => setDatasetProject(null)} />
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
