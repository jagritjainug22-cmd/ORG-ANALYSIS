import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useConfirmLogout } from "../hooks/useConfirmLogout";
import { useWorkGuard } from "../contexts/WorkGuardContext";
import { setCurrentProjectId, fetchProjectDetail, orgchart, acquireLock, lockHeartbeat, releaseLock, dbPromoteScenario, dbResetScenario, releaseDatasetLock, dbListDatasets, dbGetDatasetRecords, dbListFormulas, dbSaveBaseline, smartUpload, autoMapColumns, autoMapColumnsWithFeedback, dbUpdateColumnConfig } from "../api/backend";
import ActiveDatasetDropdown from "../components/ActiveDatasetDropdown";
import FormulaEditor from "../components/FormulaEditor";
import WorkspaceLoader from "../components/WorkspaceLoader";

import UploadAndPrepare from "../components/UploadAndPrepare";
import Rationalise from "../components/Rationalise";
import {
  computeColumnReadiness,
  columnStateFromWorkspace,
  columnStateFromMappings,
  columnStateFromDataset,
  applyReadinessToState,
} from "../utils/columnReadiness";
import Hierarchy from "../components/Hierarchy";
import SpansLayers from "../components/SpansLayers";
import Crosstab from "../components/Crosstab";
import OrgChart from "../components/OrgChart";
import ActivityAnalysis from "../components/ActivityAnalysis";
import Benchmarking from "../components/Benchmarking";
import ExportExcel from "../components/ExportExcel";
import AskOrgSight from "../components/AskOrgSight";
import RationaliseToast from "../components/RationaliseToast";
import AMLogo from "../components/AMLogo";
import SearchableColumnSelect from "../components/SearchableColumnSelect";

const MODULES = [
  {
    id: "Upload", label: "Upload & Prepare",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>)
  },
  {
    id: "Rationalise", label: "Rationalise",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>)
  },
  {
    id: "Formulas", label: "Custom Metrics",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-2M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" /></svg>)
  },
  {
    id: "Hierarchy", label: "Hierarchy",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>)
  },
  {
    id: "Spans & Layers", label: "Spans & Layers",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>)
  },
  {
    id: "Crosstab", label: "Crosstab",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>)
  },
  {
    id: "Org Chart", label: "Org Chart",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>)
  },
  {
    id: "Activity Analysis", label: "Activity Analysis",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>)
  },
  {
    id: "Benchmarking", label: "Benchmarking",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 20h18M6 20V10m6 10V4m6 16v-7" /></svg>)
  },
  {
    id: "Ask OrgSight", label: "Ask OrgSight",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>)
  }
];

// Benchmarking is still in development — only visible to the allowlisted user.
const BETA_MODULES = new Set(["Benchmarking"]);
const BETA_USERS   = new Set(["jagrit.admin"]);

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const visibleModules = MODULES.filter(
    (m) => !BETA_MODULES.has(m.id) || BETA_USERS.has(user?.username),
  );
  const confirmLogout = useConfirmLogout();
  const pid = parseInt(projectId, 10);

  const userInitials = (user?.display_name || user?.username || "")
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";

  // --- Project context ---
  const [project, setProject] = useState(null);
  const [projectError, setProjectError] = useState(null);

  // --- DATA (same as old App.jsx) ---
  const [dfRecords, setDfRecords] = useState(null);
  const [validatedDf, setValidatedDf] = useState(null);
  const [columns, setColumns] = useState(null);

  // --- GLOBAL COLUMN CONTROLS ---
  const [empCol, setEmpCol] = useState("");
  const [mgrCol, setMgrCol] = useState("");
  const [fteCol, setFteCol] = useState("");
  const [flcCol, setFlcCol] = useState("");
  const [countryCol, setCountryCol] = useState("");
  const [jobTitleCol, setJobTitleCol] = useState("");

  // --- Extended column mappings ---
  const [funcCol, setFuncCol] = useState("");
  const [subfuncCol, setSubfuncCol] = useState("");
  const [gradeCol, setGradeCol] = useState("");
  const [divisionCol, setDivisionCol] = useState("");
  const [entityCol, setEntityCol] = useState("");
  const [startDateCol, setStartDateCol] = useState("");
  const [basicPayCol, setBasicPayCol] = useState("");
  const [contractTypeCol, setContractTypeCol] = useState("");
  const [statusCol, setStatusCol] = useState("");

  // --- Smart upload state (Phase 1: read + auto-map) ---
  const [columnMappings, setColumnMappings] = useState(null);
  const [columnMappingMessage, setColumnMappingMessage] = useState(null);
  const [columnMappingRequiresAttention, setColumnMappingRequiresAttention] = useState(false);
  const [columnMappingSummary, setColumnMappingSummary] = useState(null);
  const [columnReadiness, setColumnReadiness] = useState(null);
  const [preprocessingSummary, setPreprocessingSummary] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [dataSource, setDataSource] = useState(null); // 'upload' | 'saved' | null

  // --- Activity Analysis: remount on sidebar navigate to reset to setup screen ---
  const [activityNavKey, setActivityNavKey] = useState(0);

  // --- UI STATE ---
  const [activeModule, setActiveModule] = useState("Upload");
  // Row-count breakdown for the Export & Stats panel: uploaded / removed / remaining.
  // Populated by UploadAndPrepare via onDatasetStatsChange as cleanup/validate/filter run.
  const [datasetStats, setDatasetStats] = useState(null);
  const [colConfigCollapsed, setColConfigCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [showRatToast, setShowRatToast] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState({ cleanup: null, validate: null, rationalise: null, hierarchy: null });
  const [configSaved, setConfigSaved] = useState(false);
  const [treeData, setTreeData] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // --- OrgSight 2.0 DB state ---
  const [datasetId, setDatasetId] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState("");

  // --- Active dataset label (shown in header) ---
  // "db:<name>" for saved datasets, "file:<filename>" for Excel uploads
  const [activeDatasetLabel, setActiveDatasetLabel] = useState(null);
  const [activeDatasetName, setActiveDatasetName] = useState(null);

  // --- Saved datasets cache (fetched once per project load) ---
  const [savedDatasets, setSavedDatasets] = useState(null);

  // --- Formula columns (Feature 7) ---
  const [formulas, setFormulas] = useState([]);

  // --- Track visited modules for status pills ---
  const [visitedModules, setVisitedModules] = useState({});

  useEffect(() => {
    setVisitedModules({});
  }, [datasetId]);

  useEffect(() => {
    if (activeModule) {
      setVisitedModules((prev) => ({
        ...prev,
        [activeModule]: true,
      }));
    }
  }, [activeModule]);

  // --- Org Chart focus from Spans & Layers (Feature 9) ---
  const [focusNodeId, setFocusNodeId] = useState(null);
  const jumpToOrgChartNode = useCallback((empId) => {
    if (empId != null && empId !== "") {
      setFocusNodeId(String(empId));
      setActiveModule("Org Chart");
    }
  }, []);

  // --- Switch-dataset confirmation dialog ---
  const [switchPending, setSwitchPending] = useState(false);
  const [datasetSwitching, setDatasetSwitching] = useState(false);

  // Set backend project context synchronously before children mount
  useLayoutEffect(() => {
    setCurrentProjectId(pid);
    return () => setCurrentProjectId(null);
  }, [pid]);

  // Fetch saved dataset list once per project (shared cache for header dropdown)
  useEffect(() => {
    setSavedDatasets(null);
    dbListDatasets(false, false)
      .then((data) => setSavedDatasets(data?.datasets || []))
      .catch(() => setSavedDatasets([]));
  }, [pid]);

  // --- Lock state ---
  const [lockHolder, setLockHolder] = useState(null);
  const [lockAcquired, setLockAcquired] = useState(false);
  const [lockBannerDismissed, setLockBannerDismissed] = useState(false);
  const heartbeatRef = useRef(null);
  const orgGuardRef = useRef(null);
  const { registerGuard, unregisterGuard } = useWorkGuard();

  const handleOrgGuardStateChange = useCallback((state) => {
    orgGuardRef.current = state;
  }, []);

  useEffect(() => {
    registerGuard("org-chart", {
      getLabel: () => {
        const s = orgGuardRef.current;
        if (!s?.inDbMode) return "Org Chart";
        return s.scenarioName ? `Org Chart (${s.scenarioName})` : "Org Chart";
      },
      getDescription: () => {
        const s = orgGuardRef.current;
        if (!s?.inDbMode) return "";
        const parts = [];
        if ((s.changeLogLength ?? 0) > 0) {
          parts.push(`${s.changeLogLength} change(s) in "${s.scenarioName || "scenario"}" not saved to baseline`);
        }
        if (s.editMode && s.lockAcquired) {
          parts.push("Edit mode is active with dataset lock held");
        }
        return parts.join(" · ");
      },
      hasUnsavedWork: () => {
        const s = orgGuardRef.current;
        if (!s?.inDbMode || !s.datasetId) return false;
        return (s.changeLogLength ?? 0) > 0 || (s.editMode && s.lockAcquired);
      },
      save: async () => {
        const s = orgGuardRef.current;
        if (!s?.inDbMode) return;
        if ((s.changeLogLength ?? 0) > 0 && s.activeScenarioId) {
          await dbPromoteScenario(s.activeScenarioId);
        }
        if (s.editMode && s.lockAcquired && s.datasetId) {
          await releaseDatasetLock(s.datasetId).catch(() => {});
        }
        orgGuardRef.current = { ...s, changeLogLength: 0, editMode: false, lockAcquired: false };
      },
      revert: async () => {
        const s = orgGuardRef.current;
        if (!s?.inDbMode) return;
        if ((s.changeLogLength ?? 0) > 0 && s.activeScenarioId) {
          await dbResetScenario(s.activeScenarioId);
        }
        if (s.editMode && s.lockAcquired && s.datasetId) {
          await releaseDatasetLock(s.datasetId).catch(() => {});
        }
        orgGuardRef.current = { ...s, changeLogLength: 0, editMode: false, lockAcquired: false };
      },
    });
    return () => unregisterGuard("org-chart");
  }, [registerGuard, unregisterGuard]);


  // Fetch project details for header display + access check
  useEffect(() => {
    setProject(null);
    setProjectError(null);
    fetchProjectDetail(pid)
      .then((data) => setProject(data.project || data))
      .catch((err) => {
        const status = err.response?.status;
        const body = err.response?.data;
        const detail = body?.detail;
        const errDetail =
          typeof detail === "object" && detail !== null ? detail : body;
        const errMessage =
          errDetail?.message ||
          (typeof detail === "string" ? detail : null) ||
          "Failed to load project";
        if (status === 403) {
          setProjectError({
            code: errDetail?.error_code || "access_denied",
            message: errMessage,
          });
        } else if (status === 404) {
          setProjectError({ code: "not_found", message: "Project not found" });
        } else if (!err.response) {
          setProjectError({
            code: "backend_unreachable",
            message: "Cannot reach the API at port 8601. Is the backend running?",
          });
        } else {
          setProjectError({ code: "unknown", message: errMessage });
        }
      });
  }, [pid]);

  // Lock lifecycle: acquire on mount, heartbeat every 20s, release on unmount
  useEffect(() => {
    let cancelled = false;

    const tryAcquire = async () => {
      try {
        const res = await acquireLock(pid);
        if (cancelled) return;
        if (res.acquired) {
          setLockAcquired(true);
          setLockHolder(null);
        } else {
          setLockAcquired(false);
          setLockHolder(res.holder);
        }
      } catch {
        if (!cancelled) setLockHolder(null);
      }
    };

    tryAcquire();

    heartbeatRef.current = setInterval(async () => {
      try {
        await lockHeartbeat(pid);
      } catch {
        // Lock lost (expired or force-released); try to reacquire
        tryAcquire();
      }
    }, 20_000);

    // Fire an immediate heartbeat when the user returns to this tab so the
    // 90s lock TTL doesn't expire while the browser throttles background intervals.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        lockHeartbeat(pid).catch(() => tryAcquire());
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(heartbeatRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      releaseLock(pid).catch(() => {});
    };
  }, [pid]);

  useEffect(() => {
    setLockBannerDismissed(false);
  }, [lockHolder]);

  const handleOrgChart = async () => {
    if (!empCol || !mgrCol) {
      alert("Please select Employee & Manager columns first.");
      return;
    }
    try {
      const res = await orgchart(validatedDf || dfRecords, empCol, mgrCol);
      setTreeData(res);
      setErrorMsg(null);
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to generate org chart.");
    }
  };

  // --- Smart upload handler ---
  const hydrateColumnSelections = useCallback((mappings) => {
    if (!mappings) return;
    const get = (key) => (mappings[key] || {}).source_column || "";
    setEmpCol(get("employee_id"));
    setMgrCol(get("manager_id"));
    setFteCol(get("fte"));
    setFlcCol(get("flc"));
    setCountryCol(get("country"));
    setJobTitleCol(get("job_title"));
    setFuncCol(get("function"));
    setSubfuncCol(get("subfunction"));
    setGradeCol(get("grade"));
    setDivisionCol(get("division"));
    setEntityCol(get("entity"));
    setStartDateCol(get("start_date"));
    setBasicPayCol(get("basic_pay"));
    setContractTypeCol(get("contract_type"));
    setStatusCol(get("status"));
  }, []);

  const hydrateColumnsFromDataset = useCallback((dataset) => {
    if (!dataset) return;
    setEmpCol(dataset.emp_col || "");
    setMgrCol(dataset.mgr_col || "");
    setFteCol(dataset.fte_col || "");
    setFlcCol(dataset.flc_col || "");
    setCountryCol(dataset.country_col || "");
    setJobTitleCol(dataset.job_title_col || "");
    setFuncCol(dataset.func_col || "");
    setSubfuncCol(dataset.subfunc_col || "");
    setGradeCol(dataset.grade_col || "");
    setDivisionCol(dataset.division_col || "");
    setEntityCol(dataset.entity_col || "");
    setStartDateCol(dataset.start_date_col || "");
    setBasicPayCol(dataset.basic_pay_col || "");
    setContractTypeCol(dataset.contract_type_col || "");
    setStatusCol(dataset.status_col || "");
  }, []);

  const refreshColumnReadiness = useCallback((cols) => {
    const readiness = computeColumnReadiness(cols);
    applyReadinessToState(readiness, {
      setColumnMappingMessage,
      setColumnMappingRequiresAttention,
      setColumnMappingSummary,
      setColumnReadiness,
    });
    return readiness;
  }, []);

  const refreshColumnReadinessFromWorkspace = useCallback(() => {
    return refreshColumnReadiness(columnStateFromWorkspace({
      empCol, mgrCol, fteCol, flcCol, countryCol, jobTitleCol, funcCol, subfuncCol,
    }));
  }, [empCol, mgrCol, fteCol, flcCol, countryCol, jobTitleCol, funcCol, subfuncCol, refreshColumnReadiness]);

  const fillMissingColumnsFromAutoMap = useCallback(async (dataset, cols, records) => {
    const optionalDbFields = [
      "func_col", "subfunc_col", "grade_col", "division_col", "entity_col",
      "start_date_col", "basic_pay_col", "contract_type_col", "status_col",
    ];
    const needsAutoMap = optionalDbFields.some((f) => !dataset[f]);
    if (!needsAutoMap || !cols?.length || !records?.length) return columnStateFromDataset(dataset);
    try {
      const mapRes = await autoMapColumnsWithFeedback(cols, records.slice(0, 10));
      setColumnMappings(mapRes.mappings);
      setColumnMappingSummary(mapRes.mapping_summary || null);
      const get = (key) => (mapRes.mappings[key] || {}).source_column || "";
      if (!dataset.func_col && get("function")) setFuncCol(get("function"));
      if (!dataset.subfunc_col && get("subfunction")) setSubfuncCol(get("subfunction"));
      if (!dataset.grade_col && get("grade")) setGradeCol(get("grade"));
      if (!dataset.division_col && get("division")) setDivisionCol(get("division"));
      if (!dataset.entity_col && get("entity")) setEntityCol(get("entity"));
      if (!dataset.start_date_col && get("start_date")) setStartDateCol(get("start_date"));
      if (!dataset.basic_pay_col && get("basic_pay")) setBasicPayCol(get("basic_pay"));
      if (!dataset.contract_type_col && get("contract_type")) setContractTypeCol(get("contract_type"));
      if (!dataset.status_col && get("status")) setStatusCol(get("status"));
      const mergedDataset = {
        ...dataset,
        func_col: dataset.func_col || get("function") || null,
        subfunc_col: dataset.subfunc_col || get("subfunction") || null,
      };
      if (dataset.id) {
        await dbUpdateColumnConfig(dataset.id, {
          func_col: mergedDataset.func_col,
          subfunc_col: mergedDataset.subfunc_col,
          grade_col: dataset.grade_col || get("grade") || null,
          division_col: dataset.division_col || get("division") || null,
          entity_col: dataset.entity_col || get("entity") || null,
          start_date_col: dataset.start_date_col || get("start_date") || null,
          basic_pay_col: dataset.basic_pay_col || get("basic_pay") || null,
          contract_type_col: dataset.contract_type_col || get("contract_type") || null,
          status_col: dataset.status_col || get("status") || null,
        });
      }
      return columnStateFromDataset(mergedDataset);
    } catch (err) {
      console.warn("Auto-map fallback for saved dataset failed:", err);
      return columnStateFromDataset(dataset);
    }
  }, []);

  // Persist column config when user edits dropdowns on a saved dataset
  useEffect(() => {
    if (!datasetId) return;
    const timer = setTimeout(() => {
      dbUpdateColumnConfig(datasetId, {
        emp_col: empCol || null,
        mgr_col: mgrCol || null,
        fte_col: fteCol || null,
        flc_col: flcCol || null,
        job_title_col: jobTitleCol || null,
        country_col: countryCol || null,
        func_col: funcCol || null,
        subfunc_col: subfuncCol || null,
        grade_col: gradeCol || null,
        division_col: divisionCol || null,
        entity_col: entityCol || null,
        start_date_col: startDateCol || null,
        basic_pay_col: basicPayCol || null,
        contract_type_col: contractTypeCol || null,
        status_col: statusCol || null,
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [
    datasetId, empCol, mgrCol, fteCol, flcCol, jobTitleCol, countryCol,
    funcCol, subfuncCol, gradeCol, divisionCol, entityCol,
    startDateCol, basicPayCol, contractTypeCol, statusCol,
  ]);

  const handleSmartUpload = useCallback(async (file) => {
    setUploading(true);
    setUploadStep("read");
    setPreprocessingSummary(null);
    setColumnMappings(null);
    setColumnMappingMessage(null);
    setColumnMappingRequiresAttention(false);
    setColumnReadiness(null);
    setValidatedDf(null);
    setDatasetStats(null);
    setDataSource(null);

    // A brand-new file is a brand-new dataset — clear any dataset/scenario
    // identity carried over from a previously loaded/saved dataset so the
    // next pipeline save can't silently overwrite unrelated saved data.
    setDatasetId(null);
    setScenarios([]);
    setActiveScenarioId(null);
    setPipelineStatus({ cleanup: null, validate: null, rationalise: null, hierarchy: null });

    // Clear previous column configurations immediately on new upload
    setEmpCol("");
    setMgrCol("");
    setFteCol("");
    setFlcCol("");
    setCountryCol("");
    setJobTitleCol("");
    setFuncCol("");
    setSubfuncCol("");
    setGradeCol("");
    setDivisionCol("");
    setEntityCol("");
    setStartDateCol("");
    setBasicPayCol("");
    setContractTypeCol("");
    setStatusCol("");

    try {
      const readRes = await smartUpload(file);
      setColumns(readRes.columns);
      setDfRecords(readRes.records);
      setPreprocessingSummary(readRes.preprocessing);

      setUploadStep("map");
      const mapRes = await autoMapColumnsWithFeedback(readRes.columns, readRes.records.slice(0, 10));
      setColumnMappings(mapRes.mappings);
      setColumnMappingSummary(mapRes.mapping_summary || null);
      hydrateColumnSelections(mapRes.mappings);
      refreshColumnReadiness(columnStateFromMappings(mapRes.mappings));
      setColConfigCollapsed(false);

      setUploadedFileName(file.name);
      setActiveDatasetLabel(file.name);
      setActiveDatasetName(file.name);
      setDataSource("upload");
    } catch (err) {
      console.error("Smart upload error:", err);
      alert(err.response?.data?.detail || "Failed to upload file. Please try again.");
    } finally {
      setUploading(false);
      setUploadStep("");
    }
  }, [hydrateColumnSelections, refreshColumnReadiness]);

  // Centralized pipeline-stage persistence: called after Cleanup+Validate,
  // Apply Filters, Rationalise-apply, and Hierarchy all complete, so a
  // dataset's progress survives closing the tab/reopening the project
  // instead of only existing in memory until Hierarchy is (re-)run.
  //
  // Must stay above any early returns — React requires hooks to run in the
  // same order every render (including while project is still loading).
  //
  // Creates the dataset on first save (whichever stage happens first — a
  // user can jump straight to Rationalise or Hierarchy), then updates that
  // same dataset in place on every later save. This intentionally never
  // creates a second dataset row for an in-progress session, which is what
  // previously caused Hierarchy re-runs to orphan the dataset that held the
  // real pipeline-stage timestamps.
  const persistPipelineStage = useCallback(async (records, stage) => {
    if (!records?.length || !empCol || !mgrCol) return null;
    try {
      const saved = await dbSaveBaseline({
        name: uploadedFileName || activeDatasetName || `Dataset ${new Date().toLocaleString()}`,
        records, empCol, mgrCol,
        fteCol: fteCol || null, flcCol: flcCol || null,
        jobTitleCol: jobTitleCol || null, countryCol: countryCol || null,
        funcCol: funcCol || null, subfuncCol: subfuncCol || null,
        gradeCol: gradeCol || null, divisionCol: divisionCol || null,
        entityCol: entityCol || null, startDateCol: startDateCol || null,
        basicPayCol: basicPayCol || null, contractTypeCol: contractTypeCol || null,
        statusCol: statusCol || null,
        datasetId: datasetId || null,
        stage,
      });
      setDatasetId(saved.dataset_id);
      setScenarios(saved.scenarios || []);
      setActiveScenarioId((prev) => {
        if (prev) return prev;
        const defaultScenario = (saved.scenarios || []).find((s) => s.name === "Baseline")
          || (saved.scenarios || [])[0];
        return defaultScenario?.id ?? null;
      });
      if (saved.dataset) {
        setPipelineStatus({
          cleanup: saved.dataset.last_cleanup_at || null,
          validate: saved.dataset.last_validate_at || null,
          rationalise: saved.dataset.last_rationalise_at || null,
          hierarchy: saved.dataset.last_hierarchy_at || null,
        });
      }
      dbListFormulas(saved.dataset_id).then((d) => setFormulas(d?.formulas || [])).catch(() => {});
      return saved;
    } catch (err) {
      console.warn(`Persisting "${stage}" stage failed (work continues unsaved):`, err);
      return null;
    }
  }, [
    empCol, mgrCol, fteCol, flcCol, jobTitleCol, countryCol,
    funcCol, subfuncCol, gradeCol, divisionCol, entityCol,
    startDateCol, basicPayCol, contractTypeCol, statusCol,
    datasetId, uploadedFileName, activeDatasetName,
  ]);

  const doLogout = (e) => {
    confirmLogout(e);
  };

  // --- Access error screens ---
  if (projectError) {
    const isNotAssigned = projectError.code === "not_assigned";
    const isExpired = projectError.code === "project_deadline_expired";
    const isInactive = projectError.code === "project_inactive";

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
            isNotAssigned ? "bg-amber-100" : isExpired ? "bg-red-100" : "bg-gray-100"
          }`}>
            <svg className={`w-8 h-8 ${isNotAssigned ? "text-amber-600" : isExpired ? "text-red-600" : "text-gray-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {isNotAssigned ? "Not Assigned" :
             isExpired ? "Deadline Expired" :
             isInactive ? "Project Inactive" :
             projectError.code === "not_found" ? "Project Not Found" :
             "Access Denied"}
          </h2>
          <p className="text-gray-500 mb-6">{projectError.message}</p>
          <button
            onClick={() => navigate("/projects")}
            className="px-6 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-md font-medium transition shadow-sm"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  // --- Loading ---
  if (!project) {
    return <WorkspaceLoader text="Loading project..." fullScreen={true} />;
  }

  const hasUnsavedChanges = (() => {
    const s = orgGuardRef.current;
    return !!(s?.inDbMode && s?.datasetId &&
      ((s?.changeLogLength ?? 0) > 0 || (s?.editMode && s?.lockAcquired)));
  });

  // Shared activate-dataset logic used by DataSourceSelector, header dropdown, and Org Chart picker
  const activateDataset = async (dataset, scenarios, scenarioId, records = null, cols = null) => {
    setDatasetSwitching(true);
    try {
      let rec = records;
      let columnsOut = cols;
      if (!rec) {
        const data = await dbGetDatasetRecords(dataset.id, scenarioId);
        rec = data.records || [];
        columnsOut = data.columns || (rec.length > 0 ? Object.keys(rec[0]) : []);
      }
      setDfRecords(rec);
      setValidatedDf(rec);
      setColumns(columnsOut);
      setDatasetId(dataset.id);
      setScenarios(scenarios);
      setActiveScenarioId(scenarioId);
      hydrateColumnsFromDataset(dataset);
      setPipelineStatus({
        cleanup: dataset.last_cleanup_at || null,
        validate: dataset.last_validate_at || null,
        rationalise: dataset.last_rationalise_at || null,
        hierarchy: dataset.last_hierarchy_at || null,
      });
      setColConfigCollapsed(false);
      const autoMapCols = await fillMissingColumnsFromAutoMap(dataset, columnsOut, rec);
      refreshColumnReadiness(autoMapCols || columnStateFromDataset(dataset));
      setDatasetStats(null);
      const scenarioName = scenarios.find((s) => s.id === scenarioId)?.name || "Baseline";
      setActiveDatasetLabel(dataset.name + " — " + scenarioName);
      setActiveDatasetName(dataset.name);
      setDataSource("saved");

      dbListFormulas(dataset.id)
        .then((data) => setFormulas(data?.formulas || []))
        .catch(() => setFormulas([]));
      dbListDatasets(false, false).then((d) => setSavedDatasets(d?.datasets || [])).catch(() => {});
    } finally {
      setDatasetSwitching(false);
    }
  };

  const switchScenario = async (scenarioId) => {
    if (!datasetId || scenarioId === activeScenarioId) return;
    setDatasetSwitching(true);
    try {
      const data = await dbGetDatasetRecords(datasetId, scenarioId);
      const records = data.records || [];
      const cols = data.columns || (records.length > 0 ? Object.keys(records[0]) : []);
      setDfRecords(records);
      setValidatedDf(records);
      setColumns(cols);
      setActiveScenarioId(scenarioId);
      setDatasetStats(null);
      const scenarioName = scenarios.find((s) => s.id === scenarioId)?.name || "Baseline";
      setActiveDatasetLabel((activeDatasetName || "Dataset") + " — " + scenarioName);
    } finally {
      setDatasetSwitching(false);
    }
  };

  const handleSwitchDataset = () => {
    setActiveModule("Upload");
  };

  // Canonical working dataset for all downstream analysis modules.
  // validatedDf is set after cleanup/validate; dfRecords is always kept current (incl. rationalisation).
  const workingDf = validatedDf || dfRecords;

  // --- CENTER PANE RENDER (same as old App.jsx) ---
  const renderActiveModule = () => {
    if (!dfRecords && activeModule !== "Upload" && activeModule !== "Org Chart" && activeModule !== "Activity Analysis" && activeModule !== "Ask OrgSight" && activeModule !== "Benchmarking") {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-6 shadow-lg">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-xl font-semibold text-brand-700 mb-1">No Data Loaded</p>
          <p className="text-sm text-brand-400">Upload data to begin analysis</p>
        </div>
      );
    }

    switch (activeModule) {
      case "Upload":
        return (
          <UploadAndPrepare
            onSmartUpload={handleSmartUpload}
            uploading={uploading}
            uploadStep={uploadStep}
            preprocessingSummary={preprocessingSummary}
            dfRecords={dfRecords}
            validatedDf={validatedDf}
            setValidatedDf={setValidatedDf}
            setDfRecords={setDfRecords}
            setColumns={setColumns}
            empCol={empCol}
            mgrCol={mgrCol}
            countryCol={countryCol}
            columns={columns}
            uploadedFileName={uploadedFileName}
            setUploadedFileName={setUploadedFileName}
            columnMappings={columnMappings}
            columnMappingMessage={columnMappingMessage}
            columnMappingRequiresAttention={columnMappingRequiresAttention}
            columnMappingSummary={columnMappingSummary}
            columnReadiness={columnReadiness}
            datasetId={datasetId}
            onDatasetPicked={({ dataset, scenarios: scs, activeScenarioId: sid }) =>
              activateDataset(dataset, scs, sid)
            }
            onPipelineComplete={(records) => persistPipelineStage(records, "validate")}
            onDatasetStatsChange={setDatasetStats}
            dataSource={dataSource}
            pipelineStatus={pipelineStatus}
            activeDatasetLabel={activeDatasetLabel}
            activeScenarioId={activeScenarioId}
            scenarios={scenarios}
            datasetSwitching={datasetSwitching}
          />
        );
      case "Rationalise":
        return (
          <Rationalise
            dfRecords={dfRecords}
            setDfRecords={setDfRecords}
            setValidatedDf={setValidatedDf}
            funcCol={funcCol}
            subfuncCol={subfuncCol}
            jobTitleCol={jobTitleCol}
            columns={columns}
            setColumns={setColumns}
            datasetId={datasetId}
            pipelineStatus={pipelineStatus}
            onApplySuccess={(records) => {
              setShowRatToast(true);
              persistPipelineStage(records, "rationalise");
            }}
          />
        );
      case "Hierarchy":
        return (
          <Hierarchy
            validatedDf={workingDf}
            setValidatedDf={setValidatedDf}
            setDfRecords={setDfRecords}
            empCol={empCol} mgrCol={mgrCol}
            fteCol={fteCol} flcCol={flcCol}
            jobTitleCol={jobTitleCol} countryCol={countryCol}
            formulas={formulas}
            datasetId={datasetId}
            onSaveStage={(records) => persistPipelineStage(records, "hierarchy")}
          />
        );
      case "Spans & Layers":
        return (
          <SpansLayers
            validatedDf={workingDf}
            setValidatedDf={setValidatedDf}
            empCol={empCol}
            mgrCol={mgrCol}
            fteCol={fteCol}
            flcCol={flcCol}
            funcCol={funcCol}
            jobTitleCol={jobTitleCol}
            datasetId={datasetId}
            onJumpToOrgChart={jumpToOrgChartNode}
          />
        );
      case "Crosstab":
        return <Crosstab df={workingDf} fteCol={fteCol} flcCol={flcCol} formulas={formulas} datasetId={datasetId} />;
      case "Formulas":
        return (
          <FormulaEditor
            datasetId={datasetId}
            columns={columns || (workingDf?.length ? Object.keys(workingDf[0]) : [])}
            validatedDf={workingDf}
            formulas={formulas}
            onFormulasChange={setFormulas}
          />
        );
      case "Org Chart":
        return (
          <OrgChart
            df={workingDf}
            empCol={empCol} mgrCol={mgrCol}
            fteCol={fteCol} flcCol={flcCol}
            jobTitleCol={jobTitleCol} countryCol={countryCol}
            funcCol={funcCol}
            datasetId={datasetId}
            scenarios={scenarios}
            activeScenarioId={activeScenarioId}
            setScenarios={setScenarios}
            setActiveScenarioId={setActiveScenarioId}
            onSwitchScenario={switchScenario}
            onActivateDataset={({ dataset, scenarios: scs, activeScenarioId: sid }) =>
              activateDataset(dataset, scs, sid)
            }
            setDatasetId={setDatasetId}
            setEmpCol={setEmpCol} setMgrCol={setMgrCol}
            setFteCol={setFteCol} setFlcCol={setFlcCol}
            setJobTitleCol={setJobTitleCol} setCountryCol={setCountryCol}
            onGuardStateChange={handleOrgGuardStateChange}
            formulas={formulas}
            initialFocusNodeId={focusNodeId}
            onFocusHandled={() => setFocusNodeId(null)}
          />
        );
      case "Activity Analysis":
        return <ActivityAnalysis key={activityNavKey} datasetId={datasetId} />;
      case "Benchmarking":
        return (
          <Benchmarking
            datasetId={datasetId}
            scenarioId={activeScenarioId}
            datasetName={activeDatasetName || uploadedFileName || "Dataset"}
          />
        );
      case "Ask OrgSight":
        return (
          <AskOrgSight
            projectId={pid}
            datasetId={datasetId}
            scenarioId={activeScenarioId}
            datasetName={activeDatasetName || uploadedFileName || "Dataset"}
            onNavigate={(target) => {
              const tabMap = {
                hierarchy: "Hierarchy",
                spans_layers: "Spans & Layers",
                crosstab: "Crosstab",
                org_chart: "Org Chart",
                scenarios: "Org Chart",
                activity: "Activity Analysis",
                upload: "Upload",
                benchmarking: "Benchmarking",
              };
              const tab = tabMap[target];
              if (tab) {
                if (tab === "Activity Analysis") setActivityNavKey((k) => k + 1);
                setActiveModule(tab);
              }
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* HEADER */}
      <header className="px-8 py-3 bg-brand-600 text-white border-b border-brand-700 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <AMLogo className="h-7" />
            <span className="h-5 w-px bg-white/30" />
            <button
              onClick={() => navigate("/projects")}
              className="text-white/90 hover:text-white text-sm font-medium transition"
            >
              OrgSight
            </button>
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-white font-semibold text-sm truncate" title={project.name}>
              {project.name}
            </span>
            {project.deadline && (
              <span className="hidden md:inline-flex items-center gap-1.5 ml-3 px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-white/90 border border-white/20">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Due {new Date(project.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
            {activeDatasetLabel && (
              <>
                <ActiveDatasetDropdown
                  label={activeDatasetName || uploadedFileName || "Dataset"}
                  savedDatasets={savedDatasets}
                  activeDatasetId={datasetId}
                  onActivateDataset={activateDataset}
                  hasUnsavedChanges={hasUnsavedChanges()}
                />
                
                <svg className="w-3.5 h-3.5 text-white/40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
                </svg>

                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 text-white border border-white/20 shadow-sm"
                  title={`Active Scenario: ${scenarios.find((s) => s.id === activeScenarioId)?.name || "Baseline"}${activeScenarioId ? ` (${activeScenarioId})` : ""}`}
                >
                  <svg className="w-3 h-3 text-brand-200 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7a3 3 0 100-6 3 3 0 000 6zM8 7V17M8 17a3 3 0 100 6 3 3 0 000-6zM8 12h8a3 3 0 003-3V7a3 3 0 10-6 0v2" />
                  </svg>
                  <span className="truncate max-w-[130px]">
                    {scenarios.find((s) => s.id === activeScenarioId)?.name || "Baseline"}
                  </span>
                  {activeScenarioId && (
                    <span className="font-mono text-[9px] text-white/50 flex-shrink-0 tabular-nums leading-none border border-white/20 rounded px-1 py-0.5 hidden sm:inline">
                      #{String(activeScenarioId).slice(0, 8)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                className="inline-flex items-center gap-2 px-4 py-2 bg-transparent border border-white/25 text-white hover:bg-white/10 hover:border-white/40 rounded-lg text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-white/30"
                title="Open Admin Panel"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Admin Panel
              </button>
            )}
            <button
              onClick={() => navigate("/projects")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-transparent border border-white/25 text-white hover:bg-white/10 hover:border-white/40 rounded-lg text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-white/30"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Switch Project
            </button>

            <div className="h-9 w-px bg-white/15"></div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-white text-brand-700 flex items-center justify-center text-sm font-semibold shadow-md">
                  {userInitials}
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
              onClick={doLogout}
              className="inline-flex items-center justify-center px-5 py-2 rounded-lg text-sm font-medium text-red-400 bg-red-500/5 border border-red-500/40 backdrop-blur-sm hover:bg-red-500/10 hover:border-red-500/60 hover:text-red-300 transition-all duration-150"
            >
              Logout
            </button>
          </div>
        </div>
      </header>


      {/* LOCK BANNER */}
      {lockHolder && !lockAcquired && !lockBannerDismissed && (
        <div className="px-8 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p className="text-sm text-amber-800 flex-1">
            <span className="font-semibold">{lockHolder}</span> is currently editing this project. Your changes may conflict. The lock will release when they leave or after 90 seconds of inactivity.
          </p>
          <button
            type="button"
            onClick={() => setLockBannerDismissed(true)}
            className="p-1 rounded-md text-amber-600 hover:text-amber-800 hover:bg-amber-100 transition-colors flex-shrink-0"
            aria-label="Dismiss lock warning"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* DEADLINE WARNING BANNER */}
      {project?.deadline_warning && (
        <div className="px-8 py-3 bg-red-50 border-b border-red-200 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-800">
            <span className="font-semibold">Deadline approaching:</span> This project expires in{" "}
            {project.hours_until_deadline <= 24
              ? `${Math.round(project.hours_until_deadline)} hours`
              : `${Math.round(project.hours_until_deadline / 24)} days`
            }. Contact your admin to extend the deadline if needed.
          </p>
        </div>
      )}

      {/* TOP PANE (GLOBAL CONTROLS) */}
      <div
        className="bg-white border-b border-gray-200"
        style={{ display: (activeModule === "Org Chart" || activeModule === "Activity Analysis" || activeModule === "Ask OrgSight" || activeModule === "Benchmarking") ? "none" : "block" }}
      >
        {/* Header row — always visible, acts as toggle */}
        <button
          onClick={() => setColConfigCollapsed((v) => !v)}
          className="w-full px-8 py-2.5 flex items-center gap-2.5 hover:bg-gray-50 transition-colors group"
        >
          <svg className="w-4 h-4 text-brand-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <h2 className="text-sm font-bold text-brand-800 uppercase tracking-wide flex-shrink-0">Column Configuration</h2>
          {/* Collapsed: single-line summary (no wrapping pills) */}
          {colConfigCollapsed && (() => {
            const mappedFields = [
              { label: "Employee", value: empCol },
              { label: "Manager", value: mgrCol },
              { label: "FTE", value: fteCol },
              { label: "FLC", value: flcCol },
              { label: "Country", value: countryCol },
              { label: "Job Title", value: jobTitleCol },
              { label: "Function", value: funcCol },
              { label: "Sub-Function", value: subfuncCol },
              { label: "Grade", value: gradeCol },
              { label: "Division", value: divisionCol },
              { label: "Entity", value: entityCol },
              { label: "Start Date", value: startDateCol },
              { label: "Basic Pay", value: basicPayCol },
              { label: "Contract", value: contractTypeCol },
              { label: "Status", value: statusCol },
            ].filter((f) => f.value);
            return (
              <div className="ml-2 flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                {columns ? (
                  <>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand-50 border border-brand-200 text-xs font-bold text-brand-700 whitespace-nowrap flex-shrink-0">
                      {mappedFields.length} mapped
                    </span>
                    <span className="text-slate-300 flex-shrink-0">·</span>
                    <span className="text-xs font-semibold text-slate-600 truncate text-left">
                      {mappedFields.length > 0
                        ? mappedFields.map((f) => f.label).join(" · ")
                        : "No columns mapped yet"}
                    </span>
                    <span className="text-xs font-semibold text-slate-400 whitespace-nowrap flex-shrink-0 ml-auto group-hover:text-brand-600 transition-colors">
                      Open to edit
                    </span>
                  </>
                ) : (
                  <span className="text-xs font-medium text-slate-400">Upload data to configure</span>
                )}
              </div>
            );
          })()}
          {!colConfigCollapsed && (
            <span className="ml-auto text-xs font-semibold text-slate-400 group-hover:text-brand-600 transition-colors flex-shrink-0">
              Collapse
            </span>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${colConfigCollapsed ? "-rotate-90" : "rotate-0"} ${colConfigCollapsed ? "" : "ml-1"}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Collapsible body */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: colConfigCollapsed ? "0px" : "480px",
            transition: "max-height 0.25s ease",
          }}
        >
          <div className="px-8 pb-4">
            {columns ? (() => {
              const confDot = (targetKey) => {
                const m = columnMappings?.[targetKey];
                if (!m?.source_column) return null;
                if (m.method === "alias_match" || m.method === "exact_match") return "bg-green-500";
                if (m.method === "llm" && m.confidence === "high") return "bg-green-500";
                if (m.method === "llm") return "bg-amber-400";
                return "bg-gray-400";
              };
              const mappingFields = [
                { label: "Employee", targetKey: "employee_id", value: empCol, set: setEmpCol, opt: false },
                { label: "Manager", targetKey: "manager_id", value: mgrCol, set: setMgrCol, opt: false },
                { label: "FTE", targetKey: "fte", value: fteCol, set: setFteCol, opt: false },
                { label: "FLC", targetKey: "flc", value: flcCol, set: setFlcCol, opt: false },
                { label: "Country", targetKey: "country", value: countryCol, set: setCountryCol, opt: true },
                { label: "Job Title", targetKey: "job_title", value: jobTitleCol, set: setJobTitleCol, opt: true },
                { label: "Function", targetKey: "function", value: funcCol, set: setFuncCol, opt: true },
                { label: "Sub-Function", targetKey: "subfunction", value: subfuncCol, set: setSubfuncCol, opt: true },
                { label: "Grade", targetKey: "grade", value: gradeCol, set: setGradeCol, opt: true },
                { label: "Division", targetKey: "division", value: divisionCol, set: setDivisionCol, opt: true },
                { label: "Entity", targetKey: "entity", value: entityCol, set: setEntityCol, opt: true },
                { label: "Start Date", targetKey: "start_date", value: startDateCol, set: setStartDateCol, opt: true },
                { label: "Basic Pay", targetKey: "basic_pay", value: basicPayCol, set: setBasicPayCol, opt: true },
                { label: "Contract", targetKey: "contract_type", value: contractTypeCol, set: setContractTypeCol, opt: true },
                { label: "Status", targetKey: "status", value: statusCol, set: setStatusCol, opt: true },
              ];
              const mappedCount = mappingFields.filter((f) => f.value).length;
              return (
                <div className="space-y-3">
                  <div className="rounded-lg border border-brand-100 bg-brand-50/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Current mappings</p>
                      <span className="text-[11px] font-bold text-brand-600">{mappedCount} of {mappingFields.length} set</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
                      {mappingFields.map((f) => {
                        const dot = confDot(f.targetKey);
                        return (
                          <div
                            key={f.targetKey}
                            className={`min-w-0 rounded-md border px-2 py-1.5 ${
                              f.value
                                ? "bg-white border-brand-100"
                                : "bg-white/70 border-dashed border-brand-200/80"
                            }`}
                          >
                            <div className="flex items-center gap-1 mb-1">
                              {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />}
                              <p className="text-[10px] font-bold uppercase tracking-wide text-brand-500 truncate">
                                {f.label}
                                {f.opt && <span className="text-slate-400 font-semibold normal-case tracking-normal"> (Opt)</span>}
                              </p>
                            </div>
                            <SearchableColumnSelect
                              value={f.value || ""}
                              options={columns}
                              onChange={(v) => f.set(v)}
                              placeholder="Select…"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {datasetId && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await dbUpdateColumnConfig(datasetId, {
                              emp_col: empCol || null, mgr_col: mgrCol || null, fte_col: fteCol || null,
                              flc_col: flcCol || null, job_title_col: jobTitleCol || null, country_col: countryCol || null,
                              func_col: funcCol || null, subfunc_col: subfuncCol || null, grade_col: gradeCol || null,
                              division_col: divisionCol || null, entity_col: entityCol || null, start_date_col: startDateCol || null,
                              basic_pay_col: basicPayCol || null, contract_type_col: contractTypeCol || null, status_col: statusCol || null,
                            });
                            refreshColumnReadinessFromWorkspace();
                            setConfigSaved(true);
                            setTimeout(() => { setConfigSaved(false); setColConfigCollapsed(true); }, 1500);
                          } catch (err) { console.error("Save config failed:", err); }
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-brand-500 rounded-lg hover:bg-brand-600 transition-colors"
                      >
                        {configSaved ? "Saved" : "Save Config"}
                      </button>
                      {configSaved && (
                        <span className="text-xs text-brand-600 font-semibold animate-pulse">Configuration saved</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })() : (
              <p className="text-sm text-gray-400 italic">Upload data to configure columns</p>
            )}
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANE */}
        <aside className="w-64 bg-white border-r border-gray-200 shadow-sm">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Modules</h3>
          </div>
          <nav className="p-3 space-y-1">
            {visibleModules.map((m) => {
              const isOrgChart = m.id === "Org Chart";
              const isAskOrgSight = m.id === "Ask OrgSight";
              const isBenchmarking = m.id === "Benchmarking";
              // Org Chart / Ask OrgSight / Benchmarking need Level/Span/Chain from
              // Hierarchy, not merely a dataset row (a dataset can now exist earlier,
              // right after Cleanup/Validate, before Hierarchy ever runs).
              const isMenuDisabled = (isOrgChart || isAskOrgSight || isBenchmarking) && !pipelineStatus.hierarchy;

              return (
                <button
                  key={m.id}
                  onClick={() => {
                    if (isMenuDisabled) return;
                    if (m.id === "Activity Analysis") setActivityNavKey((k) => k + 1);
                    setActiveModule(m.id);
                  }}
                  disabled={isMenuDisabled}
                  title={isMenuDisabled ? `Please run Hierarchy first to enable ${m.label}` : ""}
                  className={`group flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-md font-medium text-sm transition ${
                    activeModule === m.id
                      ? "bg-brand-500 text-white shadow-sm"
                      : isMenuDisabled
                      ? "opacity-40 cursor-not-allowed text-gray-400 hover:bg-transparent"
                      : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {m.icon}
                  <span>{m.label}</span>
                  {(isOrgChart || isAskOrgSight) && pipelineStatus.hierarchy && !visitedModules[m.id] && (
                    <span className={`ml-auto w-2 h-2 rounded-full shadow-sm transition-colors flex-shrink-0 ${
                      activeModule === m.id ? "bg-white" : "bg-brand-500 border border-brand-400/25"
                    }`} />
                  )}
                  {activeModule !== m.id && m.id === "Upload" && dfRecords && (pipelineStatus.cleanup || pipelineStatus.validate) && (
                    <span className="ml-auto w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center flex-shrink-0 animate-fadeInUp" title="Cleanup & Validation complete">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </span>
                  )}
                  {activeModule !== m.id && m.id === "Rationalise" && pipelineStatus.rationalise && (
                    <span className="ml-auto w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center flex-shrink-0 animate-fadeInUp" title="Rationalisation complete">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </span>
                  )}
                  {activeModule !== m.id && m.id === "Hierarchy" && pipelineStatus.hierarchy && (
                    <span className="ml-auto w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center flex-shrink-0 animate-fadeInUp" title="Hierarchy complete">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </span>
                  )}
                  {activeModule === m.id && (!isOrgChart && !isAskOrgSight || visitedModules[m.id]) && (
                    <svg className="w-4 h-4 ml-auto animate-fadeInUp" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* CENTER PANE */}
        <main className="flex-1 overflow-auto bg-gray-50">
          {(activeModule === "Org Chart" || activeModule === "Activity Analysis" || activeModule === "Spans & Layers" || activeModule === "Ask OrgSight" || activeModule === "Benchmarking") ? (
            <div className="h-full">{renderActiveModule()}</div>
          ) : (
            <div className="p-8">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 min-h-[calc(100vh-280px)]">
                {renderActiveModule()}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT PANE (collapsible) */}
        {!(activeModule === "Org Chart" || activeModule === "Activity Analysis" || activeModule === "Spans & Layers" || activeModule === "Rationalise" || activeModule === "Ask OrgSight" || activeModule === "Crosstab" || activeModule === "Benchmarking") && (
          rightPaneCollapsed ? (
            /* Collapsed: a clearly-visible tab stuck to the right edge — always
               clickable to bring the panel back, unlike the old 4px sliver. */
            <div className="flex-shrink-0 flex items-stretch py-6 pr-1">
              <button
                onClick={() => setRightPaneCollapsed(false)}
                title="Expand Export & Stats"
                className="group flex flex-col items-center gap-2 w-9 rounded-l-xl bg-white hover:bg-brand-50 border border-gray-200 border-r-0 shadow-md hover:shadow-lg py-4 transition-all duration-200"
              >
                <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-brand-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
                <span
                  className="text-[10px] font-semibold text-gray-500 group-hover:text-brand-600 uppercase tracking-wider"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  Export &amp; Stats
                </span>
                {datasetStats && (
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {(datasetStats.currentRows ?? datasetStats.baselineRows) > 999
                      ? "9k+"
                      : (datasetStats.currentRows ?? datasetStats.baselineRows)?.toLocaleString?.() ?? ""}
                  </span>
                )}
              </button>
            </div>
          ) : (
            <aside className="w-72 flex-shrink-0 bg-white border-l border-gray-200 shadow-sm flex flex-col animate-fadeInUp">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Export &amp; Stats</h3>
                <button
                  onClick={() => setRightPaneCollapsed(true)}
                  title="Collapse panel"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                <div className="space-y-3">
                  <ExportExcel df={workingDf} />
                </div>
                {datasetStats && (
                  <div className="mt-2 p-4 bg-gradient-to-br from-brand-50 to-white border border-brand-200 rounded-xl shadow-sm space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-brand-500/10 text-brand-600 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      </span>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Row Count</span>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-gray-500">Uploaded</span>
                      <span className="text-sm font-semibold text-gray-700">{datasetStats.uploadedRows?.toLocaleString() ?? "—"}</span>
                    </div>
                    {datasetStats.exclusionsRemoved > 0 && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-gray-500">Excluded (cleanup)</span>
                        <span className="text-sm font-semibold text-gray-700">−{datasetStats.exclusionsRemoved.toLocaleString()}</span>
                      </div>
                    )}
                    {datasetStats.filterRemovedTotal > 0 && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-gray-500">Removed (error filters)</span>
                        <span className="text-sm font-semibold text-red-600">−{datasetStats.filterRemovedTotal.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-brand-200 flex items-baseline justify-between">
                      <span className="text-xs font-semibold text-gray-600 uppercase">Remaining</span>
                      <span className="text-2xl font-bold text-brand-600">{(datasetStats.currentRows ?? datasetStats.baselineRows)?.toLocaleString()}</span>
                    </div>
                    {datasetStats.newIssuesAfterFilter > 0 && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        {datasetStats.newIssuesAfterFilter} row{datasetStats.newIssuesAfterFilter !== 1 ? "s" : ""} still flagged — see Upload &amp; Prepare for details.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )
        )}
      </div>

      <RationaliseToast
        visible={showRatToast}
        onUpdateConfig={() => {
          setFuncCol("Rationalised Function");
          setSubfuncCol("Rationalised Subfunction");
          setJobTitleCol("Rationalised Title");
          setColConfigCollapsed(false);
        }}
        onDismiss={() => setShowRatToast(false)}
      />
    </div>
  );
}
