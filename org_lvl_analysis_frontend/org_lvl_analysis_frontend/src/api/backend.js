import axios from "axios";

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname}:8601`
  : "http://127.0.0.1:8601";

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

// --- Auth lifecycle callbacks (registered by AuthContext) ---
let _onTokenRefreshed = null;
export const onTokenRefreshed = (fn) => { _onTokenRefreshed = fn; };

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

let _lastRefreshFailAt = 0;
const REFRESH_COOLDOWN_MS = 5_000;

// ---------------------------------------------------------------------------
// Auth debug logger
// All auth events are written to a rolling in-memory log (last 200 entries)
// accessible at window.__authLog, and also printed to the browser console.
// ---------------------------------------------------------------------------
const _authLog = [];
const _MAX_LOG = 200;

const _logAuth = (level, event, detail = {}) => {
  const entry = {
    t: new Date().toISOString(),
    level,   // 'info' | 'warn' | 'error'
    event,
    ...detail,
  };
  _authLog.push(entry);
  if (_authLog.length > _MAX_LOG) _authLog.shift();

  const style = level === "error"
    ? "color:#d94f4f;font-weight:bold"
    : level === "warn"
    ? "color:#d4a942;font-weight:bold"
    : "color:#2e9e6a";
  // eslint-disable-next-line no-console
  console.log(`%c[AUTH ${level.toUpperCase()}] ${entry.t} — ${event}`, style, detail);
};

if (typeof window !== "undefined") {
  window.__authLog = _authLog;
  window.__printAuthLog = () => {
    // eslint-disable-next-line no-console
    console.table(_authLog.map(e => ({
      time: e.t,
      level: e.level,
      event: e.event,
      status: e.status,
      url: e.url,
      detail: e.detail,
      trigger: e.trigger,
    })));
  };
}

// --- Silent refresh ---
const silentRefresh = async (trigger = "unknown") => {
  if (refreshPromise) {
    _logAuth("info", "silentRefresh:deduped", { trigger, note: "another refresh already in flight, sharing promise" });
    return refreshPromise;
  }

  _logAuth("info", "silentRefresh:start", { trigger, currentUsername });

  refreshPromise = axios
    .post(`${BASE_URL}/auth/refresh`, {}, {
      headers: { "X-Requested-With": "fetch" },
      withCredentials: true,
    })
    .then((r) => {
      accessToken = r.data.access_token;
      currentUsername = r.data.user.username;
      _logAuth("info", "silentRefresh:success", {
        trigger,
        username: r.data.user.username,
        newTokenPreview: r.data.access_token?.slice(-8),
      });
      _onTokenRefreshed?.(r.data);
      return r.data;
    })
    .catch((err) => {
      _lastRefreshFailAt = Date.now();
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message;
      _logAuth("error", "silentRefresh:failed", { trigger, status, detail });
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
    const status = error.response?.status;
    const url = orig?.url || "(unknown)";

    if (
      status === 401 &&
      !orig._retry &&
      !orig.url?.includes("/auth/login") &&
      !orig.url?.includes("/auth/refresh")
    ) {
      if (Date.now() - _lastRefreshFailAt < REFRESH_COOLDOWN_MS) {
        _logAuth("warn", "interceptor:401:cooldown_skip", {
          url,
          note: "refresh failed recently, skipping retry",
          msSinceLastFail: Date.now() - _lastRefreshFailAt,
        });
        return Promise.reject(error);
      }

      _logAuth("warn", "interceptor:401:retrying", { url });
      orig._retry = true;
      try {
        await silentRefresh(`interceptor:${url}`);
        orig.headers["Authorization"] = `Bearer ${accessToken}`;
        _logAuth("info", "interceptor:401:retry_success", { url });
        return axios(orig);
      } catch (refreshErr) {
        const refreshStatus = refreshErr?.response?.status;
        const refreshDetail = refreshErr?.response?.data?.detail || refreshErr?.message;
        _logAuth("error", "interceptor:401:refresh_failed", {
          url,
          refreshStatus,
          refreshDetail,
          note: "user stays signed in until explicit logout",
        });
      }
    } else if (status === 401) {
      _logAuth("warn", "interceptor:401:not_retried", {
        url,
        reason: orig._retry ? "already_retried" : "auth_endpoint",
      });
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
export const cleanup = (df, removeExclusion = true, countryCol = null, datasetId = null) => {
  const params = { remove_exclusion: removeExclusion };
  if (countryCol) params.country_col = countryCol;
  if (datasetId) params.dataset_id = datasetId;
  return postJson(`${getProjectUrl()}/cleanup`, df, params);
};

export const validate = (df, empCol, mgrCol, spanCol = null, download = false, datasetId = null) => {
  const params = { emp_col: empCol, mgr_col: mgrCol, span_col: spanCol || "", download };
  if (datasetId) params.dataset_id = datasetId;
  return axios.post(`${getProjectUrl()}/validate`, df, {
    headers: getHeaders({ "Content-Type": "application/json" }),
    params,
    responseType: download ? "blob" : "json"
  }).then(r => r.data);
};

export const hierarchy = async (df, empCol, mgrCol, flcCol = null, fteCol = null, download = false, jobTitleCol = null, datasetId = null) => {
  const params = {
    emp_col: empCol, mgr_col: mgrCol,
    flc_col: flcCol || null, fte_col: fteCol || null,
    job_title_col: jobTitleCol || null, download,
  };
  if (datasetId) params.dataset_id = datasetId;
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

export const spansLayers = async (df, threshold = 0, download = false, empCol = null, mgrCol = null, fteCol = null) => {
  const params = { threshold, download };
  if (empCol) params.emp_col = empCol;
  if (mgrCol) params.mgr_col = mgrCol;
  if (fteCol) params.fte_col = fteCol;
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

export const spansLayersLayerEmployees = async (df, level, empCol = null) => {
  const params = { level };
  if (empCol) params.emp_col = empCol;
  const res = await axios.post(`${getProjectUrl()}/spans_layers/layer_employees`, df, { headers: getHeaders(), params });
  return res.data;
};

export const spansLayersManagerDetail = async (df, empId, threshold = 0, empCol = null, mgrCol = null, fteCol = null) => {
  const params = { emp_id: empId, threshold };
  if (empCol) params.emp_col = empCol;
  if (mgrCol) params.mgr_col = mgrCol;
  if (fteCol) params.fte_col = fteCol;
  const res = await axios.post(`${getProjectUrl()}/spans_layers/manager_detail`, df, { headers: getHeaders(), params });
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

export const dbSaveBaseline = async ({
  name, records, empCol, mgrCol,
  fteCol = null, flcCol = null, jobTitleCol = null, countryCol = null,
  funcCol = null, subfuncCol = null, gradeCol = null, divisionCol = null,
  entityCol = null, startDateCol = null, basicPayCol = null,
  contractTypeCol = null, statusCol = null,
}) => {
  const body = {
    name, records,
    emp_col: empCol, mgr_col: mgrCol,
    fte_col: fteCol, flc_col: flcCol,
    job_title_col: jobTitleCol, country_col: countryCol,
    func_col: funcCol, subfunc_col: subfuncCol,
    grade_col: gradeCol, division_col: divisionCol,
    entity_col: entityCol, start_date_col: startDateCol,
    basic_pay_col: basicPayCol, contract_type_col: contractTypeCol,
    status_col: statusCol,
  };
  const res = await axios.post(`${getProjectUrl()}/db/save_baseline`, body, { headers: jsonHeaders() });
  return res.data;
};

export const dbUpdateColumnConfig = async (datasetId, columns) => {
  const res = await axios.patch(
    `${getProjectUrl()}/db/datasets/${datasetId}/column-config`,
    columns,
    { headers: jsonHeaders() },
  );
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

export const dbGetDatasetRecords = async (datasetId, scenarioId = null) => {
  const params = scenarioId != null ? `?scenario_id=${scenarioId}` : "";
  const res = await axios.get(`${getProjectUrl()}/db/datasets/${datasetId}/records${params}`, { headers: getHeaders() });
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

export const dbMoveEmployee = async (scenarioId, empId, newMgrId, effectiveDate = null) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/move`, { emp_id: empId, new_mgr_id: newMgrId, effective_date: effectiveDate }, { headers: jsonHeaders() });
  return res.data;
};

export const dbEditEmployee = async (scenarioId, empId, updates, effectiveDate = null) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/edit`, { emp_id: empId, updates, effective_date: effectiveDate }, { headers: jsonHeaders() });
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

export const dbFlagEmployee = async (scenarioId, empId, flagged = true, effectiveDate = null) => {
  const res = await axios.post(`${getProjectUrl()}/db/scenarios/${scenarioId}/flag`, { emp_id: empId, flagged, effective_date: effectiveDate }, { headers: jsonHeaders() });
  return res.data;
};

export const dbBulkSetEffectiveDate = async (scenarioId, changeIds, effectiveDate) => {
  const res = await axios.patch(`${getProjectUrl()}/db/scenarios/${scenarioId}/change_log/bulk_date`, { change_ids: changeIds, effective_date: effectiveDate || null }, { headers: jsonHeaders() });
  return res.data;
};

export const dbGetPhasingView = async (scenarioId, fyStartMonth = 1) => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/phasing`, { params: { fy_start_month: fyStartMonth }, headers: jsonHeaders() });
  return res.data;
};

export const dbValidateScenario = async (scenarioId) => {
  const res = await axios.get(`${getProjectUrl()}/db/scenarios/${scenarioId}/validate`, { headers: jsonHeaders() });
  return res.data;
};

export const dbBulkFlag = async (scenarioId, empIds, flagged, effectiveDate = null) => {
  const res = await axios.post(
    `${getProjectUrl()}/db/scenarios/${scenarioId}/bulk_flag`,
    { emp_ids: empIds, flagged, effective_date: effectiveDate },
    { headers: jsonHeaders() }
  );
  return res.data;
};

export const dbBulkEditProperty = async (scenarioId, empIds, field, value, effectiveDate = null) => {
  const res = await axios.post(
    `${getProjectUrl()}/db/scenarios/${scenarioId}/bulk_edit_property`,
    { emp_ids: empIds, field, value, effective_date: effectiveDate },
    { headers: jsonHeaders() }
  );
  return res.data;
};

export const dbBulkMove = async (scenarioId, empIds, newMgrId, effectiveDate = null) => {
  const res = await axios.post(
    `${getProjectUrl()}/db/scenarios/${scenarioId}/bulk_move`,
    { emp_ids: empIds, new_mgr_id: newMgrId, effective_date: effectiveDate },
    { headers: jsonHeaders() }
  );
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

// --- Datasets (admin) ---
export const adminListProjectDatasets = (projectId) =>
  axios.get(`${BASE_URL}/admin/projects/${projectId}/datasets`, { headers: getHeaders() }).then(r => r.data);

export const adminDeleteProjectDataset = (projectId, datasetId) =>
  axios.delete(`${BASE_URL}/admin/projects/${projectId}/datasets/${datasetId}`, { headers: getHeaders() }).then(r => r.data);

// --- Audit Log ---
export const adminGetAuditLog = (params = {}) =>
  axios.get(`${BASE_URL}/admin/audit-log`, { headers: getHeaders(), params }).then(r => r.data);


// ===========================================================================
// Activity Analysis
// ===========================================================================

export const activityListConfigs = (datasetId) =>
  axios.get(`${getProjectUrl()}/activity/configs`, { headers: getHeaders(), params: { dataset_id: datasetId } }).then(r => r.data);

export const activityCreateConfig = (body) =>
  axios.post(`${getProjectUrl()}/activity/configs`, body, { headers: jsonHeaders() }).then(r => r.data);

export const activityGetConfig = (configId) =>
  axios.get(`${getProjectUrl()}/activity/configs/${configId}`, { headers: getHeaders() }).then(r => r.data);

export const activityGetRoles = (configId) =>
  axios.get(`${getProjectUrl()}/activity/configs/${configId}/roles`, { headers: getHeaders() }).then(r => r.data);

export const activityUpsertActivities = (configId, activities) =>
  axios.post(`${getProjectUrl()}/activity/configs/${configId}/activities`, { activities }, { headers: jsonHeaders() }).then(r => r.data);

export const activityUploadActivities = (configId, file) => {
  const fd = new FormData(); fd.append("file", file);
  return axios.post(`${getProjectUrl()}/activity/configs/${configId}/activities/upload`, fd, { headers: getHeaders() }).then(r => r.data);
};

export const activityGetAllocations = (configId) =>
  axios.get(`${getProjectUrl()}/activity/configs/${configId}/allocations`, { headers: getHeaders() }).then(r => r.data);

export const activityUpsertAllocations = (configId, allocations) =>
  axios.post(`${getProjectUrl()}/activity/configs/${configId}/allocations`, { allocations }, { headers: jsonHeaders() }).then(r => r.data);

export const activityUploadAllocations = (configId, file) => {
  const fd = new FormData(); fd.append("file", file);
  return axios.post(`${getProjectUrl()}/activity/configs/${configId}/allocations/upload`, fd, { headers: getHeaders() }).then(r => r.data);
};

export const activityGetLevers = (configId) =>
  axios.get(`${getProjectUrl()}/activity/configs/${configId}/levers`, { headers: getHeaders() }).then(r => r.data);

export const activityUpsertLevers = (configId, levers) =>
  axios.post(`${getProjectUrl()}/activity/configs/${configId}/levers`, { levers }, { headers: jsonHeaders() }).then(r => r.data);

export const activityDeleteLever = (configId, leverId) =>
  axios.delete(`${getProjectUrl()}/activity/configs/${configId}/levers/${leverId}`, { headers: getHeaders() }).then(r => r.data);

export const activityUploadLevers = (configId, file) => {
  const fd = new FormData(); fd.append("file", file);
  return axios.post(`${getProjectUrl()}/activity/configs/${configId}/levers/upload`, fd, { headers: getHeaders() }).then(r => r.data);
};

export const activityCompute = (configId, params = {}) =>
  axios.post(`${getProjectUrl()}/activity/configs/${configId}/compute`, {}, { headers: jsonHeaders(), params }).then(r => r.data);

// ---------------------------------------------------------------------------
// Formula API (Feature 7)
// ---------------------------------------------------------------------------

export const dbListFormulas = (datasetId) =>
  axios.get(`${getProjectUrl()}/datasets/${datasetId}/formulas`, { headers: getHeaders() }).then(r => r.data);

export const dbCreateFormula = (datasetId, colName, expression) =>
  axios.post(`${getProjectUrl()}/datasets/${datasetId}/formulas`, { col_name: colName, expression }, { headers: jsonHeaders() }).then(r => r.data);

export const dbDeleteFormula = (datasetId, formulaId) =>
  axios.delete(`${getProjectUrl()}/datasets/${datasetId}/formulas/${formulaId}`, { headers: getHeaders() }).then(r => r.data);

export const dbPreviewFormula = (datasetId, expression, data, availableColumns = []) =>
  axios.post(`${getProjectUrl()}/datasets/${datasetId}/formulas/preview`, { expression, data, available_columns: availableColumns, sample_size: 5 }, { headers: jsonHeaders() }).then(r => r.data);

export const dbValidateFormula = (datasetId, expression, availableColumns = []) =>
  axios.post(`${getProjectUrl()}/datasets/${datasetId}/formulas/validate`, { expression, data: [], available_columns: availableColumns }, { headers: jsonHeaders() }).then(r => r.data);

// ---------------------------------------------------------------------------
// Completeness heatmap (Feature 8)
// ---------------------------------------------------------------------------

export const dbGetCompletenessHeatmap = (records, fields, groupCol) =>
  axios.post(
    `${getProjectUrl()}/completeness_heatmap`,
    { data: records, fields, group_col: groupCol },
    { headers: jsonHeaders() }
  ).then(r => r.data);

// ---------------------------------------------------------------------------
// Smart Upload & Rationalisation API (Feature: Data Quality Agent)
// ---------------------------------------------------------------------------

export const smartUpload = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return axios.post(`${getProjectUrl()}/smart-upload`, fd, {
    headers: getHeaders({ "Content-Type": "multipart/form-data" }),
    timeout: 120000,
  }).then(r => r.data);
};

export const autoMapColumns = (columns, sampleRows) =>
  axios.post(`${getProjectUrl()}/auto-map-columns`, { columns, sample_rows: sampleRows }, { headers: jsonHeaders() })
    .then(r => r.data?.mappings ?? r.data);

export const autoMapColumnsWithFeedback = (columns, sampleRows) =>
  axios.post(`${getProjectUrl()}/auto-map-columns`, { columns, sample_rows: sampleRows }, { headers: jsonHeaders() })
    .then(r => r.data);

export const rationalisePropose = (records, funcCol, subfuncCol, titleCol, useLearnedAliases = false) =>
  axios.post(`${getProjectUrl()}/rationalise`, {
    records,
    func_col: funcCol || null,
    subfunc_col: subfuncCol || null,
    title_col: titleCol || null,
    ignore_learned_aliases: !useLearnedAliases,
  }, { headers: jsonHeaders(), timeout: 300000 }).then(r => r.data);

export const rationaliseApply = (body) =>
  axios.post(`${getProjectUrl()}/rationalise/apply`, body, { headers: jsonHeaders() }).then(r => r.data);

export const getLearnedTaxonomy = () =>
  axios.get(`${getProjectUrl()}/learned-taxonomy`, { headers: getHeaders() }).then(r => r.data?.entries ?? []);

export const patchLearnedMapping = (payload) =>
  axios.patch(`${getProjectUrl()}/learned-taxonomy`, payload, { headers: jsonHeaders() }).then(r => r.data);

// Ask OrgSight chat layer (DuckDB)
export const chatEnsure = (datasetId, scenarioId) =>
  axios.post(`${getProjectUrl()}/chat/ensure`, { dataset_id: datasetId, scenario_id: scenarioId }, { headers: jsonHeaders() })
    .then(r => r.data);

export const chatStatus = () =>
  axios.get(`${getProjectUrl()}/chat/status`, { headers: getHeaders() }).then(r => r.data);

export const chatCloseSession = () =>
  axios.delete(`${getProjectUrl()}/chat/session`, { headers: getHeaders() }).then(r => r.data);

export const chatMessage = (message, datasetId, scenarioId, history = []) =>
  axios.post(`${getProjectUrl()}/chat/message`, {
    message,
    dataset_id: datasetId,
    scenario_id: scenarioId,
    history,
  }, { headers: jsonHeaders(), timeout: 60000 }).then(r => r.data);

/**
 * Stream a chat agent turn using Server-Sent Events.
 *
 * Uses native fetch + ReadableStream (not axios, which buffers the full body).
 *
 * @param {string}   message       - User's natural-language question
 * @param {number}   datasetId
 * @param {number}   scenarioId
 * @param {Array}    history       - Prior conversation turns
 * @param {Object}   callbacks
 * @param {Function} callbacks.onStatus  - ({phase, message}) => void
 * @param {Function} callbacks.onToken   - (text: string) => void
 * @param {Function} callbacks.onDone    - (payload: object) => void
 * @param {Function} callbacks.onError   - (message: string) => void
 *
 * @returns {Function} cleanup — call to abort the stream
 */
export const chatMessageStream = (
  message,
  datasetId,
  scenarioId,
  history = [],
  { onStatus, onToken, onDone, onError } = {},
  resolvedColumns = {}
) => {
  const controller = new AbortController();

  const run = async () => {
    let response;
    try {
      response = await fetch(`${getProjectUrl()}/chat/stream`, {
        method: "POST",
        headers: {
          ...getHeaders(),
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({
          message,
          dataset_id: datasetId,
          scenario_id: scenarioId,
          history,
          resolved_columns: resolvedColumns,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        onError?.(`Network error: ${err.message}`);
      }
      return;
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        detail = body?.detail?.detail || body?.detail || detail;
      } catch (_) { /* ignore */ }
      onError?.(detail);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const processEvents = (chunk) => {
      buffer += chunk;
      // SSE events are separated by double newlines
      const events = buffer.split(/\n\n/);
      // The last element may be an incomplete event — keep it in the buffer
      buffer = events.pop() ?? "";

      for (const rawEvent of events) {
        if (!rawEvent.trim()) continue;
        // Parse named event blocks: lines starting with "event:" and "data:"
        let eventType = "message";
        let dataStr = "";
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataStr = line.slice(5).trim();
          }
        }
        if (!dataStr) continue;

        let payload;
        try {
          payload = JSON.parse(dataStr);
        } catch (_) {
          payload = { text: dataStr };
        }

        switch (eventType) {
          case "status":
            onStatus?.(payload);
            break;
          case "token":
            onToken?.(payload.text ?? "");
            break;
          case "done":
            onDone?.(payload);
            break;
          case "error":
            onError?.(payload.message ?? "Unknown error");
            break;
          default:
            break;
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processEvents(decoder.decode(value, { stream: true }));
      }
      // Flush any remaining buffered data
      if (buffer.trim()) processEvents("\n\n");
    } catch (err) {
      if (err.name !== "AbortError") {
        onError?.(`Stream read error: ${err.message}`);
      }
    }
  };

  run();

  // Return a cleanup / abort function
  return () => controller.abort();
};


// ---------------------------------------------------------------------------

export const activityExportImpact = async (configId, configName = "activity") => {
  const res = await axios.get(`${getProjectUrl()}/activity/configs/${configId}/impact/export`, {
    headers: getHeaders(), responseType: "blob",
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url; a.download = `orgsight_activity_${configName}.xlsx`; a.click();
  URL.revokeObjectURL(url);
};
