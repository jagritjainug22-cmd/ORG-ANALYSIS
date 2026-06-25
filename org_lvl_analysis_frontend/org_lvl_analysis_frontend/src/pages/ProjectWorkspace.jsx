import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useConfirmLogout } from "../hooks/useConfirmLogout";
import { useWorkGuard } from "../contexts/WorkGuardContext";
import { setCurrentProjectId, fetchProjectDetail, orgchart, acquireLock, lockHeartbeat, releaseLock, dbPromoteScenario, dbResetScenario, releaseDatasetLock, dbListDatasets, dbGetDatasetRecords, dbListFormulas, smartUpload, autoMapColumns, autoMapColumnsWithFeedback, dbUpdateColumnConfig } from "../api/backend";
import ActiveDatasetDropdown from "../components/ActiveDatasetDropdown";
import FormulaEditor from "../components/FormulaEditor";
import WorkspaceLoader from "../components/WorkspaceLoader";

import UploadAndPrepare from "../components/UploadAndPrepare";
import Rationalise from "../components/Rationalise";
import Hierarchy from "../components/Hierarchy";
import SpansLayers from "../components/SpansLayers";
import Crosstab from "../components/Crosstab";
import OrgChart from "../components/OrgChart";
import ActivityAnalysis from "../components/ActivityAnalysis";
import ExportExcel from "../components/ExportExcel";
import AskOrgSight from "../components/AskOrgSight";
import RationaliseToast from "../components/RationaliseToast";

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
    id: "Formulas", label: "Formula Columns",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-2M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" /></svg>)
  },
  {
    id: "Ask OrgSight", label: "Ask OrgSight",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>)
  }
];

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirmLogout = useConfirmLogout();
  const pid = parseInt(projectId, 10);

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
  const [preprocessingSummary, setPreprocessingSummary] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");

  // --- UI STATE ---
  const [activeModule, setActiveModule] = useState("Upload");
  const [filteredRowCount, setFilteredRowCount] = useState(null);
  const [colConfigCollapsed, setColConfigCollapsed] = useState(false);
  const [showRatToast, setShowRatToast] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState({ cleanup: null, validate: null, rationalise: null });
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
            message: "Cannot reach the API at port 8001. Is the backend running?",
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

  const fillMissingColumnsFromAutoMap = useCallback(async (dataset, cols, records) => {
    const optionalDbFields = [
      "func_col", "subfunc_col", "grade_col", "division_col", "entity_col",
      "start_date_col", "basic_pay_col", "contract_type_col", "status_col",
    ];
    const needsAutoMap = optionalDbFields.some((f) => !dataset[f]);
    if (!needsAutoMap || !cols?.length || !records?.length) return;
    try {
      const mapRes = await autoMapColumnsWithFeedback(cols, records.slice(0, 10));
      setColumnMappings(mapRes.mappings);
      setColumnMappingMessage(mapRes.message);
      setColumnMappingRequiresAttention(mapRes.requires_attention);
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
      if (dataset.id) {
        await dbUpdateColumnConfig(dataset.id, {
          func_col: dataset.func_col || get("function") || null,
          subfunc_col: dataset.subfunc_col || get("subfunction") || null,
          grade_col: dataset.grade_col || get("grade") || null,
          division_col: dataset.division_col || get("division") || null,
          entity_col: dataset.entity_col || get("entity") || null,
          start_date_col: dataset.start_date_col || get("start_date") || null,
          basic_pay_col: dataset.basic_pay_col || get("basic_pay") || null,
          contract_type_col: dataset.contract_type_col || get("contract_type") || null,
          status_col: dataset.status_col || get("status") || null,
        });
      }
    } catch (err) {
      console.warn("Auto-map fallback for saved dataset failed:", err);
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
    setValidatedDf(null);
    setFilteredRowCount(null);
    
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
      setColumnMappingMessage(mapRes.message);
      setColumnMappingRequiresAttention(mapRes.requires_attention);
      setColumnMappingSummary(mapRes.mapping_summary || null);
      hydrateColumnSelections(mapRes.mappings);
      setColConfigCollapsed(false);

      setUploadedFileName(file.name);
      setActiveDatasetLabel(file.name);
      setActiveDatasetName(file.name);
    } catch (err) {
      console.error("Smart upload error:", err);
      alert(err.response?.data?.detail || "Failed to upload file. Please try again.");
    } finally {
      setUploading(false);
      setUploadStep("");
    }
  }, [hydrateColumnSelections]);

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
      });
      setColConfigCollapsed(false);
      await fillMissingColumnsFromAutoMap(dataset, columnsOut, rec);
      setFilteredRowCount(null);
      const scenarioName = scenarios.find((s) => s.id === scenarioId)?.name || "Baseline";
      setActiveDatasetLabel(dataset.name + " — " + scenarioName);
      setActiveDatasetName(dataset.name);
      
      // Perform core check on saved dataset
      const missingCore = [];
      if (!dataset.emp_col) missingCore.push("Employee ID");
      if (!dataset.mgr_col) missingCore.push("Manager ID");
      if (!dataset.fte_col) missingCore.push("FTE");
      if (!dataset.flc_col) missingCore.push("Fully Loaded Cost (FLC)");
      if (!dataset.country_col) missingCore.push("Country");
      if (!dataset.job_title_col) missingCore.push("Job Title");

      if (missingCore.length > 0) {
        setColumnMappingMessage(`Necessary column(s) [${missingCore.join(", ")}] are not mapped in this dataset. Please set them in the Column Configuration below.`);
        setColumnMappingRequiresAttention(true);
      } else {
        setColumnMappingMessage("All necessary columns mapped successfully.");
        setColumnMappingRequiresAttention(false);
      }

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
      setFilteredRowCount(null);
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
    if (!dfRecords && activeModule !== "Upload" && activeModule !== "Org Chart" && activeModule !== "Activity Analysis" && activeModule !== "Ask OrgSight") {
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
            datasetId={datasetId}
            onDatasetPicked={({ dataset, scenarios: scs, activeScenarioId: sid }) =>
              activateDataset(dataset, scs, sid)
            }
            onPipelineComplete={() =>
              setPipelineStatus(prev => ({
                ...prev,
                cleanup: new Date().toISOString(),
                validate: new Date().toISOString(),
              }))
            }
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
            onApplySuccess={() => {
              setShowRatToast(true);
              setPipelineStatus(prev => ({ ...prev, rationalise: new Date().toISOString() }));
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
            uploadedFileName={uploadedFileName}
            formulas={formulas}
            datasetId={datasetId}
            onBaselineSaved={({ datasetId: did, scenarios: scs, activeScenarioId: sid }) => {
              setDatasetId(did);
              setScenarios(scs);
              setActiveScenarioId(sid);
              // Load formulas for the newly created baseline
              dbListFormulas(did).then((d) => setFormulas(d?.formulas || [])).catch(() => {});
            }}
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
        return <ActivityAnalysis datasetId={datasetId} />;
      case "Ask OrgSight":
        return (
          <AskOrgSight
            projectId={pid}
            datasetId={datasetId}
            scenarioId={activeScenarioId}
            onNavigate={(target) => {
              const tabMap = {
                hierarchy: "Hierarchy",
                spans_layers: "Spans & Layers",
                crosstab: "Crosstab",
                org_chart: "Org Chart",
                scenarios: "Org Chart",
                activity: "Activity Analysis",
                upload: "Upload",
              };
              const tab = tabMap[target];
              if (tab) setActiveModule(tab);
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
            <span className="text-white font-bold text-xl tracking-tight">A&amp;M</span>
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-brand-700 hover:bg-white/90 rounded-md text-sm font-semibold transition transform hover:-translate-y-0.5 shadow-md border border-white/20 focus:outline-none focus:ring-2 focus:ring-brand-300"
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
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/90 rounded-md text-sm font-medium transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Switch Project
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-full text-sm font-medium text-white/90 border border-white/10">
              <div className="w-2 h-2 bg-brand-500 rounded-full"></div>
              <span>{user?.username}{user?.role === "admin" ? " (Admin)" : ""}</span>
            </div>
            <button
              onClick={doLogout}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-white/90 hover:text-white hover:bg-white/10 rounded-md text-sm font-medium transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </header>


      {/* LOCK BANNER */}
      {lockHolder && !lockAcquired && (
        <div className="px-8 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{lockHolder}</span> is currently editing this project. Your changes may conflict. The lock will release when they leave or after 90 seconds of inactivity.
          </p>
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
        style={{ display: (activeModule === "Org Chart" || activeModule === "Activity Analysis" || activeModule === "Ask OrgSight") ? "none" : "block" }}
      >
        {/* Header row — always visible, acts as toggle */}
        <button
          onClick={() => setColConfigCollapsed((v) => !v)}
          className="w-full px-8 py-3 flex items-center gap-2 hover:bg-gray-50 transition-colors group"
        >
            <svg className="w-4 h-4 text-brand-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Column Configuration</h2>
          {/* Collapsed summary pills */}
          {colConfigCollapsed && columns && (
            <div className="flex items-center gap-1.5 ml-3 flex-wrap">
              {[empCol, mgrCol, fteCol, flcCol, countryCol, jobTitleCol, funcCol, subfuncCol, gradeCol].filter(Boolean).map(c => (
                <span key={c} className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs font-medium border border-brand-200">{c}</span>
              ))}
            </div>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 ml-auto flex-shrink-0 transition-transform duration-200 ${colConfigCollapsed ? "-rotate-90" : "rotate-0"}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Collapsible body */}
        <div
          style={{
            overflow: "hidden",
            maxHeight: colConfigCollapsed ? "0px" : "300px",
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
              const sel = "w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all bg-white hover:border-gray-400";
              const ColSel = ({ label, targetKey, value, onChange, opt }) => (
                <div>
                  <label className="flex items-center gap-1 text-[11px] font-medium text-gray-600 mb-1">
                    {confDot(targetKey) && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${confDot(targetKey)}`} />}
                    {label} {opt && <span className="text-gray-400">(Opt)</span>}
                  </label>
                  <select className={sel} value={value} onChange={onChange}>
                    <option value="">Select...</option>
                    {columns.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              );
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-6 gap-3">
                    <ColSel label="Employee" targetKey="employee_id" value={empCol} onChange={e => setEmpCol(e.target.value)} />
                    <ColSel label="Manager" targetKey="manager_id" value={mgrCol} onChange={e => setMgrCol(e.target.value)} />
                    <ColSel label="FTE" targetKey="fte" value={fteCol} onChange={e => setFteCol(e.target.value)} />
                    <ColSel label="FLC" targetKey="flc" value={flcCol} onChange={e => setFlcCol(e.target.value)} />
                    <ColSel label="Country" targetKey="country" value={countryCol} onChange={e => setCountryCol(e.target.value)} opt />
                    <ColSel label="Job Title" targetKey="job_title" value={jobTitleCol} onChange={e => setJobTitleCol(e.target.value)} opt />
                  </div>
                  <div className="grid grid-cols-9 gap-3">
                    <ColSel label="Function" targetKey="function" value={funcCol} onChange={e => setFuncCol(e.target.value)} opt />
                    <ColSel label="Sub-Function" targetKey="subfunction" value={subfuncCol} onChange={e => setSubfuncCol(e.target.value)} opt />
                    <ColSel label="Grade" targetKey="grade" value={gradeCol} onChange={e => setGradeCol(e.target.value)} opt />
                    <ColSel label="Division" targetKey="division" value={divisionCol} onChange={e => setDivisionCol(e.target.value)} opt />
                    <ColSel label="Entity" targetKey="entity" value={entityCol} onChange={e => setEntityCol(e.target.value)} opt />
                    <ColSel label="Start Date" targetKey="start_date" value={startDateCol} onChange={e => setStartDateCol(e.target.value)} opt />
                    <ColSel label="Basic Pay" targetKey="basic_pay" value={basicPayCol} onChange={e => setBasicPayCol(e.target.value)} opt />
                    <ColSel label="Contract" targetKey="contract_type" value={contractTypeCol} onChange={e => setContractTypeCol(e.target.value)} opt />
                    <ColSel label="Status" targetKey="status" value={statusCol} onChange={e => setStatusCol(e.target.value)} opt />
                  </div>
                  {datasetId && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                      <button
                        onClick={async () => {
                          try {
                            await dbUpdateColumnConfig(datasetId, {
                              emp_col: empCol || null, mgr_col: mgrCol || null, fte_col: fteCol || null,
                              flc_col: flcCol || null, job_title_col: jobTitleCol || null, country_col: countryCol || null,
                              func_col: funcCol || null, subfunc_col: subfuncCol || null, grade_col: gradeCol || null,
                              division_col: divisionCol || null, entity_col: entityCol || null, start_date_col: startDateCol || null,
                              basic_pay_col: basicPayCol || null, contract_type_col: contractTypeCol || null, status_col: statusCol || null,
                            });
                            setConfigSaved(true);
                            setTimeout(() => { setConfigSaved(false); setColConfigCollapsed(true); }, 1500);
                          } catch (e) { console.error("Save config failed:", e); }
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-brand-500 rounded-lg hover:bg-brand-600 transition-colors"
                      >
                        {configSaved ? "Saved" : "Save Config"}
                      </button>
                      {configSaved && (
                        <span className="text-xs text-brand-600 font-medium animate-pulse">Configuration saved</span>
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
            {MODULES.map((m) => {
              const isOrgChart = m.id === "Org Chart";
              const isAskOrgSight = m.id === "Ask OrgSight";
              const isMenuDisabled = (isOrgChart || isAskOrgSight) && !datasetId;

              return (
                <button
                  key={m.id}
                  onClick={() => !isMenuDisabled && setActiveModule(m.id)}
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
                  {(isOrgChart || isAskOrgSight) && datasetId && !visitedModules[m.id] && (
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
          {(activeModule === "Org Chart" || activeModule === "Activity Analysis" || activeModule === "Spans & Layers" || activeModule === "Ask OrgSight") ? (
            <div className="h-full">{renderActiveModule()}</div>
          ) : (
            <div className="p-8">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 min-h-[calc(100vh-280px)]">
                {renderActiveModule()}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT PANE */}
        <aside
          className="w-72 bg-white border-l border-gray-200 shadow-sm"
          style={{ display: (activeModule === "Org Chart" || activeModule === "Activity Analysis" || activeModule === "Spans & Layers" || activeModule === "Rationalise" || activeModule === "Ask OrgSight") ? "none" : "block" }}
        >
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Export & Stats</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-3">
              <ExportExcel df={workingDf} />
            </div>
            {filteredRowCount !== null && (
              <div className="mt-6 p-4 bg-brand-50 border border-brand-200 rounded-md">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="text-xs font-semibold text-gray-600 uppercase">Row Count</span>
                </div>
                <p className="text-2xl font-bold text-brand-600">{filteredRowCount.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">rows after filtering</p>
              </div>
            )}
          </div>
        </aside>
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
