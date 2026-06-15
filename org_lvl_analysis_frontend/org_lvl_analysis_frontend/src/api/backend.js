import axios from "axios";

const BASE_URL = "http://127.0.0.1:8001";

// --- In-memory auth state ---
let accessToken = null;
let currentUsername = null;
let refreshPromise = null;

// --- Dynamic project context (set by ProjectWorkspace on mount) ---
let currentProjectId = null;

export const setAccessToken = (token) => { accessToken = token; };
export const getAccessToken = () => accessToken;
export const setCurrentUsername = (username) => { currentUsername = username; };
export const getCurrentUsername = () => currentUsername;
export const setCurrentProjectId = (id) => { currentProjectId = id; };
export const getCurrentProjectId = () => currentProjectId;

const getProjectUrl = () => {
  if (!currentProjectId) throw new Error("No project selected");
  return `${BASE_URL}/projects/${currentProjectId}`;
};

const getHeaders = (additionalHeaders = {}) => {
  const headers = { ...additionalHeaders };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  if (currentUsername) {
    headers["X-Username"] = currentUsername;
  }
  return headers;
};

// --- Silent refresh ---
const silentRefresh = async () => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = axios
    .post(`${BASE_URL}/auth/refresh`, {}, {
      headers: { "X-Requested-With": "fetch" },
      withCredentials: true,
    })
    .then((r) => {
      accessToken = r.data.access_token;
      currentUsername = r.data.user.username;
      return r.data;
    })
    .catch((err) => {
      accessToken = null;
      currentUsername = null;
      throw err;
    })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
};

export { silentRefresh };

// --- Axios interceptor: retry once on 401 via refresh ---
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const orig = error.config;
    if (
      error.response?.status === 401 &&
      !orig._retry &&
      !orig.url?.includes("/auth/login") &&
      !orig.url?.includes("/auth/refresh")
    ) {
      orig._retry = true;
      try {
        await silentRefresh();
        orig.headers["Authorization"] = `Bearer ${accessToken}`;
        return axios(orig);
      } catch {
        // refresh failed -- let the 401 bubble up
      }
    }
    return Promise.reject(error);
  }
);

// ---------------------- AUTH ----------------------
export const login = (username, password) =>
  axios.post(
    `${BASE_URL}/auth/login`,
    { username, password },
    { withCredentials: true }
  ).then((r) => {
    accessToken = r.data.access_token;
    currentUsername = r.data.user.username;
    return r.data;
  });

export const logout = () =>
  axios.post(
    `${BASE_URL}/auth/logout`,
    {},
    { headers: getHeaders(), withCredentials: true }
  ).then((r) => {
    accessToken = null;
    currentUsername = null;
    currentProjectId = null;
    return r.data;
  }).catch(() => {
    accessToken = null;
    currentUsername = null;
    currentProjectId = null;
  });

export const changePassword = (oldPassword, newPassword) =>
  axios.post(
    `${BASE_URL}/auth/change-password`,
    { old_password: oldPassword, new_password: newPassword },
    { headers: getHeaders() }
  ).then((r) => r.data);

// ---------------------- PROJECTS (no project scope needed) ----------------------
export const fetchProjects = async () => {
  const res = await axios.get(`${BASE_URL}/projects`, { headers: getHeaders() });
  return res.data;
};

export const fetchProjectDetail = async (projectId) => {
  const res = await axios.get(`${BASE_URL}/projects/${projectId}`, { headers: getHeaders() });
  return res.data;
};

// ---------------------- LOCKS (Phase 6) ----------------------
export const acquireLock = async (projectId) => {
  const res = await axios.post(`${BASE_URL}/projects/${projectId}/lock`, {}, { headers: getHeaders() });
  return res.data;
};

export const lockHeartbeat = async (projectId) => {
  const res = await axios.post(`${BASE_URL}/projects/${projectId}/lock/heartbeat`, {}, { headers: getHeaders() });
  return res.data;
};

export const releaseLock = async (projectId) => {
  const res = await axios.delete(`${BASE_URL}/projects/${projectId}/lock`, { headers: getHeaders() });
  return res.data;
};

export const getLockStatus = async (projectId) => {
  const res = await axios.get(`${BASE_URL}/projects/${projectId}/lock`, { headers: getHeaders() });
  return res.data;
};

// ---------------------- DATASET LOCKS (Phase 6b) ----------------------
export const acquireDatasetLock = async (datasetId) => {
  const res = await axios.post(`${getProjectUrl()}/db/datasets/${datasetId}/lock`, {}, { headers: getHeaders() });
  return res.data;
};

export const datasetLockHeartbeat = async (datasetId) => {
  const res = await axios.post(`${getProjectUrl()}/db/datasets/${datasetId}/lock/heartbeat`, {}, { headers: getHeaders() });
  return res.data;
};

export const releaseDatasetLock = async (datasetId) => {
  const res = await axios.delete(`${getProjectUrl()}/db/datasets/${datasetId}/lock`, { headers: getHeaders() });
  return res.data;
};

export const getDatasetLockStatus = async (datasetId) => {
  const res = await axios.get(`${getProjectUrl()}/db/datasets/${datasetId}/lock`, { headers: getHeaders() });
  return res.data;
};

/**
 * Shared three-state handler for 423 (dataset_locked) errors.
 * Used by both OrgChart mutation handler and heartbeat logic.
 *
 * @param {Error} err - axios error
 * @param {number} datasetId - dataset to re-acquire lock on
 * @returns {Object} { state: "reacquired"|"lost", holder?, holderId? }
 * @throws if the error is not a 423 dataset_locked
 */
export const handleLockConflict = async (err, datasetId) => {
  const status = err?.response?.status;
  const data = err?.response?.data?.detail || err?.response?.data;
  if (status !== 423 || data?.error_code !== "dataset_locked") {
    throw err;
  }
  // Someone else holds the lock -- try to re-acquire in case it expired
  try {
    const result = await acquireDatasetLock(datasetId);
    if (result.acquired) {
      return { state: "reacquired" };
    }
    return { state: "lost", holder: result.holder, holderId: result.holder_id };
  } catch {
    return { state: "lost", holder: data.holder, holderId: data.holder_id };
  }
};

// ---------------------- FILE UPLOAD ----------------------
export const uploadFile = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return axios
    .post(`${getProjectUrl()}/upload`, fd, {
      headers: getHeaders({ "Content-Type": "multipart/form-data" }),
    })
    .then(r => r.data);
};

// ---------------------- POST JSON HELPER ----------------------
const postJson = (url, df, params = {}, responseType = "json") =>
  axios.post(url, df, {
    headers: getHeaders({ "Content-Type": "application/json" }),
    params,
    responseType
  }).then(r => r.data);

// ---------------------- CORE ENDPOINTS ----------------------
export const cleanup = (df, removeExclusion = true, countryCol = null) => {
  const params = { remove_exclusion: removeExclusion };
  if (countryCol) params.country_col = countryCol;
  return postJson(`${getProjectUrl()}/cleanup`, df, params);
};

export const validate = (df, empCol, mgrCol, spanCol = null, download = false) => {
  const params = { emp_col: empCol, mgr_col: mgrCol, span_col: spanCol || "", download };
  return axios.post(`${getProjectUrl()}/validate`, df, {
    headers: getHeaders({ "Content-Type": "application/json" }),
    params,
    responseType: download ? "blob" : "json"
  }).then(r => r.data);
};

export const hierarchy = async (df, empCol, mgrCol, flcCol = null, fteCol = null, download = false, jobTitleCol = null) => {
  const params = {
    emp_col: empCol, mgr_col: mgrCol,
    flc_col: flcCol || null, fte_col: fteCol || null,
    job_title_col: jobTitleCol || null, download
  };
  if (download) {
    const res = await axios.post(`${getProjectUrl()}/hierarchy`, df, {
      headers: getHeaders(), params, responseType: "blob"
    });
    const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = "org_hierarchy_output.xlsx";
    link.click();
    return;
  }
  const res = await axios.post(`${getProjectUrl()}/hierarchy`, df, { headers: getHeaders(), params });
  return res.data;
};

export const filterErrors = (df, empCol, mgrCol, removeDup = true, removeMissing = true, removeInvalid = true, removeCircular = true) =>
  postJson(`${getProjectUrl()}/filter_errors`, df, {
    emp_col: empCol, mgr_col: mgrCol,
    remove_dup: removeDup, remove_missing: removeMissing,
    remove_invalid: removeInvalid, remove_circular: removeCircular,
  });

export const spansLayers = async (df, threshold = 0, download = false) => {
  const params = { threshold, download };
  if (download) {
    const res = await axios.post(`${getProjectUrl()}/spans_layers`, df, {
      headers: getHeaders(), params, responseType: "blob"
    });
    if (!res.data || res.data.size === 0) throw new Error("Received empty blob");
    const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "spans_layers_with_threshold.xlsx"; link.style.display = "none";
    document.body.appendChild(link); link.click();
    setTimeout(() => { document.body.removeChild(link); window.URL.revokeObjectURL(url); }, 1000);
    return;
  }
  const res = await axios.post(`${getProjectUrl()}/spans_layers`, df, { headers: getHeaders(), params });
  return res.data;
};

export const crosstab = async (df, colX = null, colY = null, fteCol = null, flcCol = null, download = false, colXThreshold = null, colYThreshold = null, thresholdMetric = null, excludedCategories = [], previewOnly = false) => {
  const params = {
    col_x: colX || null, col_y: colY || null, fte_col: fteCol || null, flc_col: flcCol || null,
    download, col_x_threshold: colXThreshold, col_y_threshold: colYThreshold,
    threshold_metric: thresholdMetric, excluded_categories: excludedCategories.join(","), preview_only: previewOnly
  };
  const res = await axios.post(`${getProjectUrl()}/crosstab`, df, {
    headers: getHeaders({ "Content-Type": "application/json" }), params,
    responseType: download ? "blob" : "json"
  });
  if (download) {
    const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob); link.download = "crosstab.xlsx"; link.click();
    return;
  }
  return res.data;
};

export const orgchart = async (df, empCol, mgrCol, filteredEmpIds = null) => {
  const cleanDf = df.map(row => {
    const newRow = {};
    Object.entries(row).forEach(([k, v]) => {
      newRow[k] = (typeof v === "number" && !isFinite(v)) ? null : v;
    });
    return newRow;
  });
  const params = { emp_col: empCol, mgr_col: mgrCol };
  if (filteredEmpIds && filteredEmpIds.length > 0) params.filtered_emp_ids = filteredEmpIds.join(",");
  const res = await axios.post(`${getProjectUrl()}/orgchart`, cleanDf, {
    headers: getHeaders({ "Content-Type": "application/json" }), params,
  });
  return res.data;
};

// ---------------------- EXPORT ----------------------
export const exportExcel = async (df, sheetName = "Sheet1") => {
  const res = await axios.post(`${getProjectUrl()}/export/excel`, df, {
    headers: getHeaders(), responseType: "blob", params: { sheet_name: sheetName }
  });
  return res.data;
};

export const exportPpt = async (svgContent) => {
  const res = await axios.post(`${getProjectUrl()}/export_ppt`, { svg_content: svgContent }, {
    headers: getHeaders(), responseType: "blob"
  });
  const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  downloadBlobAs(blob, "OrgChart.pptx");
};

// ---------------------- ACTIVITY LOGS ----------------------
export const getActivityLogs = async (limit = 100) => {
  const res = await axios.get(`${getProjectUrl()}/logs/activity`, { headers: getHeaders(), params: { limit } });
  return res.data;
};

export const getUserStats = async (username) => {
  const res = await axios.get(`${getProjectUrl()}/logs/stats/${username}`, { headers: getHeaders() });
  return res.data;
};

// =================================================================
// OrgSight 2.0 -- Database / Scenario / Modelling API
// =================================================================
const jsonHeaders = () => getHeaders({ "Content-Type": "application/json" });

export const dbSaveBaseline = async ({ name, records, empCol, mgrCol, fteCol = null, flcCol = null, jobTitleCol = null, countryCol = null }) => {
  const body = { name, records, emp_col: empCol, mgr_col: mgrCol, fte_col: fteCol, flc_col: flcCol, job_title_col: jobTitleCol, country_col: countryCol };
  const res = await axios.post(`${getProjectUrl()}/db/save_baseline`, body, { headers: jsonHeaders() });
  return res.data;
};

export const dbListDatasets = async (mineOnly = false, includePreview = false) => {
  const res = await axios.get(`${getProjectUrl()}/db/datasets`, {
    headers: getHeaders(),
    params: { mine_only: mineOnly, include_preview: includePreview },
  });
  return res.data;
};

export const dbGetDataset = async (datasetId) => {
  const res = await axios.get(`${getProjectUrl()}/db/datasets/${datasetId}`, { headers: getHeaders() });
  return res.data;
};

export const dbGetScenario = async (scenarioId) => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}`, { headers: getHeaders() });
  return res.data;
};

export const dbCreateScenario = async (datasetId, { name, description = "", sourceScenarioId = null, rateCardId = null, rateCardQuartile = "p50" }) => {
  const res = await axios.post(`${getProjectUrl()}/db/datasets/${datasetId}/scenarios`, {
    name,
    description,
    source_scenario_id: sourceScenarioId,
    rate_card_id: rateCardId,
    rate_card_quartile: rateCardQuartile,
  }, { headers: jsonHeaders() });
  return res.data;
};

export const dbRenameScenario = async (scenarioId, { name, description = "" }) => {
  const res = await axios.patch(`${getProjectUrl()}/db/scenarios/${scenarioId}/rename`, { name, description }, { headers: jsonHeaders() });
  return res.data;
};

export const dbDeleteScenario = async (scenarioId) => {
  const res = await axios.delete(`${getProjectUrl()}/db/scenarios/${scenarioId}`, { headers: getHeaders() });
  return res.data;
};

export const dbMoveEmployee = async (scenarioId, empId, newMgrId) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/move`, { emp_id: empId, new_mgr_id: newMgrId }, { headers: jsonHeaders() });
  return res.data;
};

export const dbEditEmployee = async (scenarioId, empId, updates) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/edit`, { emp_id: empId, updates }, { headers: jsonHeaders() });
  return res.data;
};

export const dbAddEmployee = async (scenarioId, payload) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/add`, payload, { headers: jsonHeaders() });
  return res.data;
};

export const dbCloneEmployee = async (scenarioId, payload) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/clone`, payload, { headers: jsonHeaders() });
  return res.data;
};

export const dbFlagEmployee = async (scenarioId, empId, flagged = true) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/flag`, { emp_id: empId, flagged }, { headers: jsonHeaders() });
  return res.data;
};

export const dbPromoteScenario = async (scenarioId) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/promote`, {}, { headers: jsonHeaders() });
  return res.data;
};

export const dbResetScenario = async (scenarioId) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/reset`, {}, { headers: jsonHeaders() });
  return res.data;
};

export const dbUndoLastChange = async (scenarioId) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/undo`, {}, { headers: jsonHeaders() });
  return res.data;
};

export const dbGetSummary = async (scenarioId) => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/summary`, { headers: getHeaders() });
  return res.data;
};

export const dbGetChangeLog = async (scenarioId) => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/change_log`, { headers: getHeaders() });
  return res.data;
};

export const dbGetScenarioSummaryByDim = async (scenarioId, dimCol) => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/summary_by_dim`, {
    headers: getHeaders(),
    params: { dim_col: dimCol },
  });
  return res.data;
};

export const dbGetDatasetRecentChanges = async (datasetId, { since = null, limit = 50 } = {}) => {
  const params = { limit };
  if (since) params.since = since;
  const res = await axios.get(`${getProjectUrl()}/db/datasets/${datasetId}/recent-changes`, {
    headers: getHeaders(),
    params,
  });
  return res.data;
};

export const dbMarkDatasetSeen = async (datasetId) => {
  const res = await axios.post(`${getProjectUrl()}/db/datasets/${datasetId}/mark-seen`, {}, { headers: jsonHeaders() });
  return res.data;
};

export const dbCompareScenarios = async (datasetId) => {
  const res = await axios.get(`${getProjectUrl()}/db/datasets/${datasetId}/compare`, { headers: getHeaders() });
  return res.data;
};

export const dbGetDatasetColumns = async (datasetId) => {
  const res = await axios.get(`${getProjectUrl()}/db/datasets/${datasetId}/columns`, { headers: getHeaders() });
  return res.data;
};

export const dbListRateCards = async (datasetId) => {
  const res = await axios.get(`${getProjectUrl()}/db/datasets/${datasetId}/rate_cards`, { headers: getHeaders() });
  return res.data;
};

export const dbPreviewRateCard = async (datasetId, payload) => {
  const res = await axios.post(`${getProjectUrl()}/db/datasets/${datasetId}/rate_cards/preview`, payload, { headers: jsonHeaders() });
  return res.data;
};

export const dbGenerateRateCard = async (datasetId, payload) => {
  const res = await axios.post(`${getProjectUrl()}/db/datasets/${datasetId}/rate_cards/generate`, payload, { headers: jsonHeaders() });
  return res.data;
};

export const dbUploadRateCard = async (datasetId, formData) => {
  const res = await axios.post(`${getProjectUrl()}/db/datasets/${datasetId}/rate_cards/upload`, formData, {
    headers: { ...getHeaders(), "Content-Type": "multipart/form-data" },
  });
  return res.data;
};

export const dbGetRateCard = async (rateCardId) => {
  const res = await axios.get(`${getProjectUrl()}/db/rate_cards/${rateCardId}`, { headers: getHeaders() });
  return res.data;
};

export const dbPatchRateCardRow = async (datasetId, rateCardId, payload) => {
  const res = await axios.patch(`${getProjectUrl()}/db/datasets/${datasetId}/rate_cards/${rateCardId}/rows`, payload, { headers: jsonHeaders() });
  return res.data;
};

export const dbSetScenarioRateCard = async (scenarioId, payload) => {
  const res = await axios.patch(`${getProjectUrl()}/db/scenarios/${scenarioId}/rate_card`, payload, { headers: jsonHeaders() });
  return res.data;
};

export const dbLookupRateCardCost = async (scenarioId, values) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/rate_card/lookup`, { values }, { headers: jsonHeaders() });
  return res.data;
};

const downloadBlobAs = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click();
  setTimeout(() => { document.body.removeChild(link); window.URL.revokeObjectURL(url); }, 200);
};

export const dbExportChanges = async (scenarioId, scenarioName = "scenario") => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/export/changes`, { headers: getHeaders(), responseType: "blob" });
  downloadBlobAs(res.data, `orgsight_changes_${scenarioName.replace(/[^a-z0-9-_]/gi, "") || "scenario"}.xlsx`);
};

export const dbExportRecords = async (scenarioId, scenarioName = "scenario") => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/export/records`, { headers: getHeaders(), responseType: "blob" });
  downloadBlobAs(res.data, `orgsight_records_${scenarioName.replace(/[^a-z0-9-_]/gi, "") || "scenario"}.xlsx`);
};

export const dbExportPpt = async (scenarioId, scenarioName = "scenario", detail = "summary") => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/export/ppt`, {
    headers: getHeaders(), responseType: "blob", params: { detail },
  });
  downloadBlobAs(res.data, `orgsight_${scenarioName.replace(/[^a-z0-9-_]/gi, "") || "scenario"}.pptx`);
};

export const dbExportPdf = async (scenarioId, scenarioName = "scenario", detail = "summary") => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/export/pdf`, {
    headers: getHeaders(), responseType: "blob", params: { detail },
  });
  downloadBlobAs(res.data, `orgsight_${scenarioName.replace(/[^a-z0-9-_]/gi, "") || "scenario"}.pdf`);
};

export const dbExportSvg = async (scenarioId, scenarioName = "scenario") => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/export/svg`, { headers: getHeaders(), responseType: "blob" });
  downloadBlobAs(res.data, `orgsight_${scenarioName.replace(/[^a-z0-9-_]/gi, "") || "scenario"}.svg`);
};

// =================================================================
// Admin API
// =================================================================

// --- Users ---
export const adminListUsers = () =>
  axios.get(`${BASE_URL}/admin/users`, { headers: getHeaders() }).then(r => r.data);

export const adminCreateUser = (body) =>
  axios.post(`${BASE_URL}/admin/users`, body, { headers: jsonHeaders() }).then(r => r.data);

export const adminUpdateUser = (userId, body) =>
  axios.patch(`${BASE_URL}/admin/users/${userId}`, body, { headers: jsonHeaders() }).then(r => r.data);

export const adminDeactivateUser = (userId) =>
  axios.delete(`${BASE_URL}/admin/users/${userId}`, { headers: getHeaders() }).then(r => r.data);

// --- Projects ---
export const adminListProjects = () =>
  axios.get(`${BASE_URL}/admin/projects`, { headers: getHeaders() }).then(r => r.data);

export const adminCreateProject = (body) =>
  axios.post(`${BASE_URL}/admin/projects`, body, { headers: jsonHeaders() }).then(r => r.data);

export const adminUpdateProject = (projectId, body) =>
  axios.patch(`${BASE_URL}/admin/projects/${projectId}`, body, { headers: jsonHeaders() }).then(r => r.data);

export const adminArchiveProject = (projectId) =>
  axios.delete(`${BASE_URL}/admin/projects/${projectId}`, { headers: getHeaders() }).then(r => r.data);

export const adminHardDeleteProject = (projectId) =>
  axios.post(`${BASE_URL}/admin/projects/${projectId}/delete`, {}, { headers: getHeaders() }).then(r => r.data);

// --- Assignments ---
export const adminListAssignments = (projectId) =>
  axios.get(`${BASE_URL}/admin/projects/${projectId}/assignments`, { headers: getHeaders() }).then(r => r.data);

export const adminAssignUser = (projectId, body) =>
  axios.post(`${BASE_URL}/admin/projects/${projectId}/assignments`, body, { headers: jsonHeaders() }).then(r => r.data);

export const adminUnassignUser = (projectId, userId) =>
  axios.delete(`${BASE_URL}/admin/projects/${projectId}/assignments/${userId}`, { headers: getHeaders() }).then(r => r.data);

// --- Audit Log ---
export const adminGetAuditLog = (params = {}) =>
  axios.get(`${BASE_URL}/admin/audit-log`, { headers: getHeaders(), params }).then(r => r.data);
