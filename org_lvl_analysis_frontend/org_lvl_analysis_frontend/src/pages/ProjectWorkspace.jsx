import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useConfirmLogout } from "../hooks/useConfirmLogout";
import { useWorkGuard } from "../contexts/WorkGuardContext";
import { setCurrentProjectId, fetchProjectDetail, cleanup, crosstab, orgchart, spansLayers, acquireLock, lockHeartbeat, releaseLock, dbPromoteScenario, dbResetScenario, releaseDatasetLock, dbListDatasets, dbGetDatasetRecords, dbListFormulas } from "../api/backend";
import ActiveDatasetDropdown from "../components/ActiveDatasetDropdown";
import FormulaEditor from "../components/FormulaEditor";

import Upload from "../components/Upload";
import DataSourceSelector from "../components/DataSourceSelector";
import Cleanup from "../components/Cleanup";
import Validate from "../components/Validate";
import FilterErrors from "../components/FilterErrors";
import Hierarchy from "../components/Hierarchy";
import SpansLayers from "../components/SpansLayers";
import Crosstab from "../components/Crosstab";
import OrgChart from "../components/OrgChart";
import ActivityAnalysis from "../components/ActivityAnalysis";
import ExportExcel from "../components/ExportExcel";

const MODULES = [
  {
    id: "Upload", label: "Upload Data",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>)
  },
  {
    id: "Cleanup", label: "Cleanup",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>)
  },
  {
    id: "Validate", label: "Validate",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>)
  },
  {
    id: "Filter Errors", label: "Filter Errors",
    icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>)
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

  // --- UI STATE ---
  const [activeModule, setActiveModule] = useState("Upload");
  const [filteredRowCount, setFilteredRowCount] = useState(null);
  const [colConfigCollapsed, setColConfigCollapsed] = useState(false);
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
    dbListDatasets(false, true)
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
      const res = await orgchart(validatedDf, empCol, mgrCol);
      setTreeData(res);
      setErrorMsg(null);
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to generate org chart.");
    }
  };

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
            className="px-6 py-2.5 bg-am-500 hover:bg-am-600 text-white rounded-md font-medium transition shadow-sm"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  // --- Loading ---
  if (!project) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-am-100 border-t-am-500 rounded-full animate-spin"></div>
          <p className="text-gray-500 text-sm">Loading project...</p>
        </div>
      </div>
    );
  }

  const hasUnsavedChanges = (() => {
    const s = orgGuardRef.current;
    return !!(s?.inDbMode && s?.datasetId &&
      ((s?.changeLogLength ?? 0) > 0 || (s?.editMode && s?.lockAcquired)));
  });

  // Shared activate-dataset logic used by both DataSourceSelector and header dropdown
  const activateDataset = async (dataset, scenarios, scenarioId) => {
    setDatasetSwitching(true);
    try {
      const data = await dbGetDatasetRecords(dataset.id, scenarioId);
      const records = data.records || [];
      const cols = data.columns || (records.length > 0 ? Object.keys(records[0]) : []);
      setDfRecords(records);
      setValidatedDf(records);
      setColumns(cols);
      setDatasetId(dataset.id);
      setScenarios(scenarios);
      setActiveScenarioId(scenarioId);
      setEmpCol(dataset.emp_col || "");
      setMgrCol(dataset.mgr_col || "");
      if (dataset.fte_col) setFteCol(dataset.fte_col);
      if (dataset.flc_col) setFlcCol(dataset.flc_col);
      if (dataset.job_title_col) setJobTitleCol(dataset.job_title_col);
      if (dataset.country_col) setCountryCol(dataset.country_col);
      setFilteredRowCount(null);
      const scenarioName = scenarios.find((s) => s.id === scenarioId)?.name || "Baseline";
      setActiveDatasetLabel(dataset.name + " — " + scenarioName);
      setActiveDatasetName(dataset.name);
      // Load formula columns for this dataset
      dbListFormulas(dataset.id)
        .then((data) => setFormulas(data?.formulas || []))
        .catch(() => setFormulas([]));
      // Refresh the cached list so any new scenarios show up
      dbListDatasets(false, true).then((d) => setSavedDatasets(d?.datasets || [])).catch(() => {});
    } finally {
      setDatasetSwitching(false);
    }
  };

  const handleSwitchDataset = () => {
    setActiveModule("Upload");
  };

  // --- CENTER PANE RENDER (same as old App.jsx) ---
  const renderActiveModule = () => {
    if (!dfRecords && activeModule !== "Upload" && activeModule !== "Org Chart" && activeModule !== "Activity Analysis") {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-lg font-medium">No Data Loaded</p>
          <p className="text-sm mt-1">Upload data to begin analysis</p>
        </div>
      );
    }

    switch (activeModule) {
      case "Upload":
        return (
          <DataSourceSelector
            setDfRecords={(df) => {
              setDfRecords(df);
              setValidatedDf(null);
              setFilteredRowCount(null);
              setDatasetId(null);
              setScenarios([]);
              setActiveScenarioId(null);
              setActiveDatasetLabel(null);
              setActiveDatasetName(null);
              // Re-fetch dataset list so any new baselines appear in the header dropdown
              dbListDatasets(false, true).then((d) => setSavedDatasets(d?.datasets || [])).catch(() => {});
            }}
            setValidatedDf={setValidatedDf}
            setColumns={setColumns}
            setUploadedFileName={(name) => {
              setUploadedFileName(name);
              setActiveDatasetLabel(name || null);
              setActiveDatasetName(name || null);
            }}
            onDatasetPicked={({ dataset, scenarios: scs, activeScenarioId: sid }) => {
              // activateDataset handles all state hydration including dfRecords, columns, column mappings
              activateDataset(dataset, scs, sid);
              // Refresh the cached dataset list
              dbListDatasets(false, true).then((d) => setSavedDatasets(d?.datasets || [])).catch(() => {});
            }}
          />
        );
      case "Cleanup":
        return (
          <Cleanup
            df={dfRecords}
            setDf={(df) => { setValidatedDf(df); setFilteredRowCount(null); }}
            countryCol={countryCol}
            backendCall={cleanup}
          />
        );
      case "Validate":
        return (
          <Validate
            dfRecords={validatedDf || dfRecords}
            columns={columns}
            empCol={empCol} setEmpCol={setEmpCol}
            mgrCol={mgrCol} setMgrCol={setMgrCol}
            jobTitleCol={jobTitleCol}
            setValidatedDf={setValidatedDf}
          />
        );
      case "Filter Errors":
        return (
          <FilterErrors
            validatedDf={validatedDf}
            setValidatedDf={setValidatedDf}
            empCol={empCol}
            mgrCol={mgrCol}
          />
        );
      case "Hierarchy":
        return (
          <Hierarchy
            validatedDf={validatedDf}
            setValidatedDf={setValidatedDf}
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
            validatedDf={validatedDf}
            setValidatedDf={setValidatedDf}
            fteCol={fteCol} flcCol={flcCol}
            backendCall={spansLayers}
          />
        );
      case "Crosstab":
        return <Crosstab df={validatedDf} fteCol={fteCol} flcCol={flcCol} formulas={formulas} datasetId={datasetId} />;
      case "Formulas":
        return (
          <FormulaEditor
            datasetId={datasetId}
            columns={columns || (validatedDf?.length ? Object.keys(validatedDf[0]) : [])}
            validatedDf={validatedDf}
            formulas={formulas}
            onFormulasChange={setFormulas}
          />
        );
      case "Org Chart":
        return (
          <OrgChart
            df={validatedDf}
            empCol={empCol} mgrCol={mgrCol}
            fteCol={fteCol} flcCol={flcCol}
            jobTitleCol={jobTitleCol} countryCol={countryCol}
            datasetId={datasetId}
            scenarios={scenarios}
            activeScenarioId={activeScenarioId}
            setScenarios={setScenarios}
            setActiveScenarioId={setActiveScenarioId}
            setDatasetId={setDatasetId}
            setEmpCol={setEmpCol} setMgrCol={setMgrCol}
            setFteCol={setFteCol} setFlcCol={setFlcCol}
            setJobTitleCol={setJobTitleCol} setCountryCol={setCountryCol}
            onGuardStateChange={handleOrgGuardStateChange}
            formulas={formulas}
          />
        );
      case "Activity Analysis":
        return <ActivityAnalysis datasetId={datasetId} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* HEADER */}
      <header className="px-8 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-am-500 font-bold text-xl tracking-tight">A&amp;M</span>
            <span className="h-5 w-px bg-gray-300" />
            <button
              onClick={() => navigate("/projects")}
              className="text-gray-500 hover:text-am-600 text-sm font-medium transition"
            >
              OrgSight
            </button>
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 font-semibold text-sm truncate" title={project.name}>
              {project.name}
            </span>
            {project.deadline && (
              <span className="hidden md:inline-flex items-center gap-1.5 ml-3 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Due {new Date(project.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
            {activeDatasetLabel && (
              <ActiveDatasetDropdown
                label={activeDatasetLabel}
                savedDatasets={savedDatasets}
                activeDatasetId={datasetId}
                onActivateDataset={activateDataset}
                hasUnsavedChanges={hasUnsavedChanges()}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                className="inline-flex items-center gap-2 px-3 py-1.5 border border-am-500 text-am-600 hover:bg-am-50 rounded-md text-sm font-medium transition"
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
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Switch Project
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full text-sm font-medium text-gray-700">
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              <span>{user?.username}{user?.role === "admin" ? " (Admin)" : ""}</span>
            </div>
            <button
              onClick={doLogout}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md text-sm font-medium transition"
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
        style={{ display: (activeModule === "Org Chart" || activeModule === "Activity Analysis") ? "none" : "block" }}
      >
        {/* Header row — always visible, acts as toggle */}
        <button
          onClick={() => setColConfigCollapsed((v) => !v)}
          className="w-full px-8 py-3 flex items-center gap-2 hover:bg-gray-50 transition-colors group"
        >
          <svg className="w-4 h-4 text-am-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Column Configuration</h2>
          {/* Collapsed summary pills */}
          {colConfigCollapsed && columns && (
            <div className="flex items-center gap-1.5 ml-3 flex-wrap">
              {empCol && <span className="px-2 py-0.5 bg-am-50 text-am-700 rounded text-xs font-medium border border-am-200">{empCol}</span>}
              {mgrCol && <span className="px-2 py-0.5 bg-am-50 text-am-700 rounded text-xs font-medium border border-am-200">{mgrCol}</span>}
              {fteCol && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{fteCol}</span>}
              {flcCol && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{flcCol}</span>}
              {countryCol && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{countryCol}</span>}
              {jobTitleCol && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{jobTitleCol}</span>}
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
            maxHeight: colConfigCollapsed ? "0px" : "200px",
            transition: "max-height 0.25s ease",
          }}
        >
          <div className="px-8 pb-4">
            {columns ? (
              <div className="grid grid-cols-6 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Employee Column</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all bg-white hover:border-gray-400" value={empCol} onChange={(e) => setEmpCol(e.target.value)}>
                    <option value="">Select column...</option>
                    {columns.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Manager Column</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all bg-white hover:border-gray-400" value={mgrCol} onChange={(e) => setMgrCol(e.target.value)}>
                    <option value="">Select column...</option>
                    {columns.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">FTE Column</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all bg-white hover:border-gray-400" value={fteCol} onChange={(e) => setFteCol(e.target.value)}>
                    <option value="">Select column...</option>
                    {columns.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">FLC Column</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all bg-white hover:border-gray-400" value={flcCol} onChange={(e) => setFlcCol(e.target.value)}>
                    <option value="">Select column...</option>
                    {columns.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Country Column <span className="text-gray-400">(Optional)</span></label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all bg-white hover:border-gray-400" value={countryCol} onChange={(e) => setCountryCol(e.target.value)}>
                    <option value="">Select column...</option>
                    {columns.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Job Title Column <span className="text-gray-400">(Optional)</span></label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition-all bg-white hover:border-gray-400" value={jobTitleCol} onChange={(e) => setJobTitleCol(e.target.value)}>
                    <option value="">Select column...</option>
                    {columns.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            ) : (
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
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`group flex items-center gap-3 w-full text-left px-4 py-2.5 rounded-md font-medium text-sm transition ${
                  activeModule === m.id
                    ? "bg-am-500 text-white shadow-sm"
                    : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {m.icon}
                <span>{m.label}</span>
                {activeModule === m.id && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* CENTER PANE */}
        <main className="flex-1 overflow-auto bg-gray-50">
          {(activeModule === "Org Chart" || activeModule === "Activity Analysis") ? (
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
          style={{ display: (activeModule === "Org Chart" || activeModule === "Activity Analysis") ? "none" : "block" }}
        >
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Export & Stats</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-3">
              <ExportExcel df={validatedDf} />
            </div>
            {filteredRowCount !== null && (
              <div className="mt-6 p-4 bg-am-50 border border-am-200 rounded-md">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-4 h-4 text-am-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="text-xs font-semibold text-gray-600 uppercase">Row Count</span>
                </div>
                <p className="text-2xl font-bold text-am-600">{filteredRowCount.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">rows after filtering</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
