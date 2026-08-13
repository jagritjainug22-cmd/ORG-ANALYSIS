import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  dbGetScenario,
  dbGetChangeLog,
  dbMoveEmployee,
  dbEditEmployee,
  dbAddEmployee,
  dbCloneEmployee,
  dbFlagEmployee,
  dbCreateScenario,
  dbRenameScenario,
  dbDeleteScenario,
  dbPromoteScenario,
  dbCompareScenarios,
  dbResetScenario,
  dbUndoLastChange,
  dbExportChanges,
  dbExportRecords,
  dbExportPpt,
  dbExportPdf,
  dbExportSvg,
  acquireDatasetLock,
  datasetLockHeartbeat,
  releaseDatasetLock,
  getDatasetLockStatus,
  handleLockConflict,
  dbGetDatasetRecentChanges,
  dbMarkDatasetSeen,
  dbListRateCards,
  dbGetDatasetColumns,
  dbPreviewRateCard,
  dbGenerateRateCard,
  dbPatchRateCardRow,
  dbSetScenarioRateCard,
  dbLookupRateCardCost,
  dbValidateScenario,
  dbBulkFlag,
  dbBulkEditProperty,
  dbBulkMove,
  dbGetUiPref,
  dbSetUiPref,
} from "../api/backend";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  HORIZONTAL_GAP,
  buildIndex,
  computeSubtreeStats,
  layoutTree,
  stepPath,
  collectDescendants,
  autoCollapseAtDepth,
  isSignificantMove,
  isSameLevelDrop,
  fmtCompactCurrency,
  fmtNumber,
} from "./orgchart/orgChartLayout";
import { AM } from "./orgchart/orgChartTheme";
import OrgNodeCard from "./orgchart/OrgNodeCard";
import OrgDetailPanel from "./orgchart/OrgDetailPanel";
import OrgImpactStrip from "./orgchart/OrgImpactStrip";
import OrgScenarioBar from "./orgchart/OrgScenarioBar";
import BulkActionBar from "./orgchart/BulkActionBar";
import ValidationSidebar from "./orgchart/ValidationSidebar";
import { validateRecordsClient } from "./orgchart/validateScenarioClient";
import { useIgnoredIssues, useVisibleIssuesMap } from "./orgchart/useIgnoredIssues";
import OrgCompareModal from "./orgchart/OrgCompareModal";
import OrgAddChildModal from "./orgchart/OrgAddChildModal";
import OrgMoveConfirmModal from "./orgchart/OrgMoveConfirmModal";
import SavedDatasetPicker from "./orgchart/SavedDatasetPicker";
import OrgActivityPanel from "./orgchart/OrgActivityPanel";
import OrgChartLoadingOverlay from "./orgchart/OrgChartLoadingOverlay";
import { FOCUS_ZOOM, ROOT_ENTRY_ZOOM, computeFocusPan } from "./orgchart/orgChartFocus";
import { rankSearchMatches } from "./orgchart/orgChartSearch";
import OrgChartHelp from "./orgchart/OrgChartHelp";
import OrgExportModal from "./orgchart/OrgExportModal";

/**
 * OrgSight 2.0 -- interactive org chart.
 *
 * Two modes:
 *   - DB mode (datasetId + activeScenarioId provided): records loaded from
 *     SQLite via /db/scenarios/:id. All mutations (move/edit/flag/add) are
 *     persisted through the DB API and the local state is updated optimistically.
 *   - Legacy mode: uses the in-memory `df` prop. Mutations work locally only.
 */
export default function OrgChart({
  df,
  empCol,
  mgrCol,
  fteCol,
  flcCol,
  jobTitleCol,
  countryCol,
  funcCol,
  datasetId,
  scenarios,
  activeScenarioId,
  setScenarios,
  setActiveScenarioId,
  onSwitchScenario,
  onActivateDataset,
  setDatasetId,
  setEmpCol,
  setMgrCol,
  setFteCol,
  setFlcCol,
  setJobTitleCol,
  setCountryCol,
  onGuardStateChange,
  formulas = [],
  initialFocusNodeId = null,
  onFocusHandled,
}) {
  const inDbMode = !!(datasetId && activeScenarioId);
  const hasLegacyDf = !!(df && df.length);

  // Working records: the canonical employee list (after DB load OR from prop)
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scenarioSwitching, setScenarioSwitching] = useState(false);
  const [switchingScenarioName, setSwitchingScenarioName] = useState("");
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [changeLog, setChangeLog] = useState([]);

  // Dataset lock state
  const [lockInfo, setLockInfo] = useState(null); // { holder, holder_id, last_heartbeat } when locked by other
  const [lockAcquired, setLockAcquired] = useState(false);
  const lockAcquiredRef = useRef(false); // ref mirror so visibility handler can read current value
  const lockHeartbeatRef = useRef(null);
  const [lockToast, setLockToast] = useState(null); // transient toast message

  // UI state
  const [editMode, setEditMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState(() => new Set());
  const [nodeIssuesMap, setNodeIssuesMap] = useState(() => new Map());
  const ignoreStorageKey = inDbMode ? `${datasetId}:${activeScenarioId}` : "legacy";
  const { ignoreIssue, ignoreMany, restoreAll, filterIssuesMap } = useIgnoredIssues(ignoreStorageKey);
  const visibleIssuesMap = useVisibleIssuesMap(nodeIssuesMap, filterIssuesMap);
  const ignoredIssueCount = useMemo(() => {
    let total = 0;
    for (const issues of nodeIssuesMap.values()) total += issues.length;
    for (const issues of visibleIssuesMap.values()) total -= issues.length;
    return total;
  }, [nodeIssuesMap, visibleIssuesMap]);
  const [cycleGroups, setCycleGroups] = useState(() => []);
  const [clonePromptFor, setClonePromptFor] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [maxDepth, setMaxDepth] = useState(2);
  const [zoomLabel, setZoomLabel] = useState(1);
  const [search, setSearch] = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [functionFilter, setFunctionFilter] = useState("");

  // dnd-kit sensors: PointerSensor (mouse) + TouchSensor (mobile).
  // distance: 5 prevents accidental drags during card clicks.
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { distance: 5 } });
  const dndSensors = useSensors(pointerSensor, touchSensor);

  const dropAnimationConfig = useMemo(() => ({
    duration: 250,
    easing: "ease-out",
    keyframes({ transform }) {
      if (skipDropAnimRef.current) {
        return [{ opacity: 1 }, { opacity: 0 }];
      }
      return [
        { transform: transform.initial },
        { transform: transform.final },
      ];
    },
  }), []);

  // Pan is held in a ref + applied via DOM transform so dragging doesn't
  // re-render 4000+ React cards on every mouse move.
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const stageRef = useRef(null);
  const viewportRef = useRef(null);
  const hasAutoCenteredRef = useRef(false);
  const cameraToNodeRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const focusHandledRef = useRef(null);
  const pendingCollapseNodeRef = useRef(null);

  const applyTransform = useCallback(() => {
    if (!stageRef.current) return;
    stageRef.current.style.transform =
      `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
  }, []);

  // Drag state -- dnd-kit based
  const [activeDragId, setActiveDragId] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);
  const dragDescendantsRef = useRef(new Set());
  // dragOldParentLevelRef and dragOldParentLevel are mirrors: the ref gives
  // synchronous access in handleDndEnd; the state triggers card re-renders.
  const dragOldParentLevelRef = useRef(null);
  const [dragOldParentLevel, setDragOldParentLevel] = useState(null);
  // Level of the node being dragged (used for same-level drop detection)
  const dragSrcLevelRef = useRef(null);
  const [dragSrcLevel, setDragSrcLevel] = useState(null);
  const skipDropAnimRef = useRef(false);

  // Last edited/moved node -- used to refocus camera after layout recalculates
  const lastEditedIdRef = useRef(null);

  // Help tooltip: always mounted (collapsed pill by default) so it's never
  // missing; auto-expands once we confirm from the DB that this user hasn't
  // dismissed it before. Starting `false` (collapsed, not hidden) means the
  // affordance is visible immediately, even before the DB check resolves.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpAutoExpandDoneRef = useRef(false);

  // View-only hint: dismissible per view-mode session. Reappears the next
  // time the user exits Edit Mode (fresh reminder), not permanently hidden.
  const [viewOnlyHintDismissed, setViewOnlyHintDismissed] = useState(false);
  useEffect(() => {
    if (editMode) setViewOnlyHintDismissed(false);
  }, [editMode]);

  // Modals
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [addChildFor, setAddChildFor] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingLabel, setExportingLabel] = useState(null); // e.g. "PowerPoint – Summary"
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const exportBtnRef = useRef(null);
  const searchWrapRef = useRef(null);

  // Activity feed (recent changes since user's last visit)
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityChanges, setActivityChanges] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityMeta, setActivityMeta] = useState({
    unseen_count: 0,
    last_seen_at: null,
    contributors: [],
    action_counts: {},
  });
  const [activityBannerVisible, setActivityBannerVisible] = useState(false);
  const activityBannerTimerRef = useRef(null);

  const [rateCards, setRateCards] = useState([]);
  const [datasetColumns, setDatasetColumns] = useState([]);
  const [datasetColumnMeta, setDatasetColumnMeta] = useState({});

  // Mouse-drag pan state (separate from the transform ref)
  const dragStateRef = useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

  // --------------------------------------------------------------------
  // Data loading
  // --------------------------------------------------------------------

  const reloadScenario = useCallback(async () => {
    if (!inDbMode) return;
    setLoading(true);
    setError(null);
    try {
      const [scResp, logResp] = await Promise.all([
        dbGetScenario(activeScenarioId),
        dbGetChangeLog(activeScenarioId),
      ]);
      const loaded = scResp.records || [];
      setRecords(loaded);
      setSummary(scResp.summary || null);
      setChangeLog(logResp.changes || []);
      const { issuesMap, cycleGroups: cg } = validateRecordsClient(loaded, { empCol, mgrCol, jobTitleCol });
      setNodeIssuesMap(issuesMap);
      setCycleGroups(cg);
    } catch (e) {
      console.error("Failed to load scenario:", e);
      setError(e.message || "Failed to load scenario from database.");
    } finally {
      setLoading(false);
      setScenarioSwitching(false);
      setSwitchingScenarioName("");
    }
  }, [inDbMode, activeScenarioId]);

  const handleScenarioSwitch = useCallback(async (scenarioId) => {
    if (!inDbMode || scenarioId === activeScenarioId) return;
    const target = (scenarios || []).find((s) => s.id === scenarioId);
    setSwitchingScenarioName(target?.name || "scenario");
    setScenarioSwitching(true);
    hasAutoCenteredRef.current = false;
    setSelectedId(null);
    setFocusedNodeId(null);
    try {
      if (onSwitchScenario) {
        await onSwitchScenario(scenarioId);
      } else {
        setActiveScenarioId?.(scenarioId);
      }
    } catch (e) {
      setScenarioSwitching(false);
      setSwitchingScenarioName("");
      setError(e.message || "Failed to switch scenario.");
    }
  }, [inDbMode, activeScenarioId, scenarios, onSwitchScenario, setActiveScenarioId]);

  const isScenarioBusy = loading || scenarioSwitching;

  useEffect(() => {
    if (inDbMode) {
      reloadScenario();
    } else if (df && df.length) {
      // Legacy mode: synthesize records that look like scenario_records
      const synthesized = df.map((r) => ({
        ...r,
        __emp_id: String(r[empCol] ?? ""),
        __mgr_id: r[mgrCol] != null ? String(r[mgrCol]) : null,
        is_flagged_removed: false,
        is_added: false,
      }));
      setRecords(synthesized);
      setSummary(buildLocalSummary(synthesized, fteCol, flcCol));
      setChangeLog([]);
    } else {
      setRecords([]);
      setSummary(null);
    }
  }, [inDbMode, reloadScenario, df, empCol, mgrCol, fteCol, flcCol]);

  // --------------------------------------------------------------------
  // Dataset lock: check status on dataset load, cleanup on unmount
  // --------------------------------------------------------------------

  const checkLockStatus = useCallback(async () => {
    if (!datasetId) return;
    try {
      const status = await getDatasetLockStatus(datasetId);
      if (status.locked && !status.is_mine) {
        setLockInfo({ holder: status.holder, holder_id: status.holder_id, last_heartbeat: status.last_heartbeat });
        setLockAcquired(false);
        setEditMode(false);
      } else if (status.locked && status.is_mine) {
        setLockInfo(null);
        setLockAcquired(true);
      } else {
        setLockInfo(null);
        setLockAcquired(false);
      }
    } catch {
      setLockInfo(null);
    }
  }, [datasetId]);

  useEffect(() => {
    if (inDbMode && datasetId) {
      checkLockStatus();
    }
    return () => {
      // Release lock and stop heartbeat on unmount
      if (lockHeartbeatRef.current) clearInterval(lockHeartbeatRef.current);
      if (datasetId && lockAcquired) {
        releaseDatasetLock(datasetId).catch(() => {});
      }
    };
  }, [datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the ref in sync so the visibility handler below always sees the latest value
  useEffect(() => { lockAcquiredRef.current = lockAcquired; }, [lockAcquired]);

  // Fire an immediate dataset-lock heartbeat when the user returns to this tab so
  // the 90s TTL doesn't expire while the browser throttles background intervals.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && lockAcquiredRef.current && datasetId) {
        datasetLockHeartbeat(datasetId).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId) {
      setRateCards([]);
      setDatasetColumns([]);
      return;
    }
    (async () => {
      try {
        const [rcResp, colResp] = await Promise.all([
          dbListRateCards(datasetId),
          dbGetDatasetColumns(datasetId),
        ]);
        setRateCards(rcResp.rate_cards || []);
        setDatasetColumns(colResp.columns || []);
        setDatasetColumnMeta(colResp.column_meta || {});
      } catch (e) {
        console.warn("Failed to load rate card metadata:", e);
      }
    })();
  }, [datasetId]);

  const activeScenario = useMemo(
    () => (scenarios || []).find((s) => s.id === activeScenarioId) || null,
    [scenarios, activeScenarioId]
  );

  const activeRateCardMeta = useMemo(
    () => rateCards.find((rc) => rc.id === activeScenario?.rate_card_id) || null,
    [rateCards, activeScenario]
  );

  const rateCardPropertyCols = activeRateCardMeta?.property_cols || [];

  const dimensionColumns = useMemo(() => {
    const meta = datasetColumnMeta || {};
    const cols = datasetColumns || [];
    const dims = cols.filter((c) => meta[c]?.is_dimension);
    if (cols.includes("Level") && !dims.includes("Level")) {
      return ["Level", ...dims];
    }
    return dims;
  }, [datasetColumns, datasetColumnMeta]);

  const handleExportChanges = useCallback(() => {
    const s = (scenarios || []).find((x) => x.id === activeScenarioId);
    dbExportChanges(activeScenarioId, s?.name || "scenario").catch((e) =>
      setError(e.message || "Failed to export.")
    );
  }, [activeScenarioId, scenarios]);

  /** Wraps any export promise with a loading toast. */
  const runExport = useCallback((label, promiseFn) => {
    setExportingLabel(label);
    setExportMenuOpen(false);
    promiseFn()
      .catch((e) => setError(e.response?.data?.detail || e.message || "Export failed."))
      .finally(() => setExportingLabel(null));
  }, []);

  const lookupRateCardForValues = useCallback(async (values) => {
    if (!activeScenarioId || !activeScenario?.rate_card_id) return null;
    try {
      const resp = await dbLookupRateCardCost(activeScenarioId, values);
      return resp.lookup;
    } catch {
      return null;
    }
  }, [activeScenarioId, activeScenario?.rate_card_id]);

  // ----- Activity feed: fetch unseen changes when dataset is (re)opened -----
  const fetchActivity = useCallback(async () => {
    if (!datasetId) return;
    setActivityLoading(true);
    try {
      const data = await dbGetDatasetRecentChanges(datasetId, { limit: 60 });
      setActivityChanges(data.changes || []);
      setActivityMeta({
        unseen_count: data.unseen_count || 0,
        last_seen_at: data.last_seen_at || null,
        contributors: data.contributors || [],
        action_counts: data.action_counts || {},
      });
      return data;
    } catch (e) {
      console.warn("Failed to load activity feed:", e);
      return null;
    } finally {
      setActivityLoading(false);
    }
  }, [datasetId]);

  // Check whether this user has already dismissed the help tooltip before.
  // If not (first visit), auto-expand it. The collapsed pill is already
  // visible regardless -- this only decides whether to auto-open the panel.
  useEffect(() => {
    if (!inDbMode || helpAutoExpandDoneRef.current) return;
    dbGetUiPref("org_chart_help_dismissed")
      .then((val) => {
        if (val !== "1" && !helpAutoExpandDoneRef.current) {
          helpAutoExpandDoneRef.current = true;
          setHelpOpen(true);
        }
      })
      .catch(() => {}); // network hiccup: keep the collapsed pill, don't force-open
  }, [inDbMode]);

  const handleHelpDismiss = useCallback(() => {
    helpAutoExpandDoneRef.current = true;
    setHelpOpen(false);
    if (inDbMode) {
      dbSetUiPref("org_chart_help_dismissed", "1").catch(() => {});
    }
  }, [inDbMode]);

  // On dataset open: load activity, surface banner if there are unseen changes
  useEffect(() => {
    if (!inDbMode || !datasetId) return;
    let cancelled = false;
    fetchActivity().then((data) => {
      if (cancelled || !data) return;
      // Show the banner whenever there are changes the current user hasn't
      // acknowledged (self-authored edits are excluded server-side). First-time
      // visits also get the banner -- acts as a "here's what's been happening"
      // welcome rather than staying invisible.
      if (data.unseen_count > 0) {
        setActivityBannerVisible(true);
        if (activityBannerTimerRef.current) clearTimeout(activityBannerTimerRef.current);
        activityBannerTimerRef.current = setTimeout(() => {
          setActivityBannerVisible(false);
        }, 12000);
      }
    });
    return () => {
      cancelled = true;
      if (activityBannerTimerRef.current) clearTimeout(activityBannerTimerRef.current);
    };
  }, [inDbMode, datasetId, fetchActivity]);

  const dismissActivityBanner = useCallback(() => {
    setActivityBannerVisible(false);
    if (activityBannerTimerRef.current) clearTimeout(activityBannerTimerRef.current);
    if (datasetId) {
      dbMarkDatasetSeen(datasetId)
        .then((resp) => {
          setActivityMeta((m) => ({ ...m, unseen_count: 0, last_seen_at: resp.last_seen || m.last_seen_at }));
          // Mark every loaded change as seen locally so the panel reflects it.
          setActivityChanges((cs) => cs.map((c) => ({ ...c, is_unseen: false })));
        })
        .catch(() => {});
    }
  }, [datasetId]);

  const openActivityPanel = useCallback(() => {
    setActivityOpen(true);
    setActivityBannerVisible(false);
    if (activityBannerTimerRef.current) clearTimeout(activityBannerTimerRef.current);
    // Mark seen when panel is opened (after a tiny delay so the user sees the
    // highlighted unseen section first).
    if (datasetId && activityMeta.unseen_count > 0) {
      setTimeout(() => {
        dbMarkDatasetSeen(datasetId)
          .then((resp) => {
            setActivityMeta((m) => ({ ...m, unseen_count: 0, last_seen_at: resp.last_seen || m.last_seen_at }));
          })
          .catch(() => {});
      }, 800);
    }
  }, [datasetId, activityMeta.unseen_count]);

  const startHeartbeat = useCallback(() => {
    if (lockHeartbeatRef.current) clearInterval(lockHeartbeatRef.current);
    lockHeartbeatRef.current = setInterval(async () => {
      if (!datasetId) return;
      try {
        const result = await datasetLockHeartbeat(datasetId);
        if (result.status === "lost") {
          clearInterval(lockHeartbeatRef.current);
          lockHeartbeatRef.current = null;
          setLockAcquired(false);
          setEditMode(false);
          setLockInfo({ holder: result.holder, holder_id: result.holder_id, last_heartbeat: null });
          setLockToast(`${result.holder} took the lock. Switched to read-only.`);
          setTimeout(() => setLockToast(null), 5000);
        }
      } catch {
        // heartbeat failed -- try re-acquire via handleLockConflict pattern
        try {
          const reacquire = await acquireDatasetLock(datasetId);
          if (!reacquire.acquired) {
            clearInterval(lockHeartbeatRef.current);
            lockHeartbeatRef.current = null;
            setLockAcquired(false);
            setEditMode(false);
            setLockInfo({ holder: reacquire.holder, holder_id: reacquire.holder_id, last_heartbeat: reacquire.last_heartbeat });
            setLockToast(`${reacquire.holder} took the lock. Switched to read-only.`);
            setTimeout(() => setLockToast(null), 5000);
          }
        } catch {
          // silently ignore -- next heartbeat will retry
        }
      }
    }, 20_000);
  }, [datasetId]);

  const toggleEditMode = useCallback(async () => {
    if (!inDbMode) {
      setEditMode((v) => !v);
      return;
    }

    if (editMode) {
      // Exiting edit mode -- release the lock
      setEditMode(false);
      setLockAcquired(false);
      if (lockHeartbeatRef.current) {
        clearInterval(lockHeartbeatRef.current);
        lockHeartbeatRef.current = null;
      }
      await releaseDatasetLock(datasetId).catch(() => {});
      return;
    }

    // Entering edit mode -- acquire the lock
    try {
      const result = await acquireDatasetLock(datasetId);
      if (result.acquired) {
        setEditMode(true);
        setLockAcquired(true);
        setLockInfo(null);
        startHeartbeat();
      } else {
        setLockInfo({ holder: result.holder, holder_id: result.holder_id, last_heartbeat: result.last_heartbeat });
        setLockToast(`${result.holder} is currently editing this dataset.`);
        setTimeout(() => setLockToast(null), 5000);
      }
    } catch {
      setLockToast("Failed to acquire edit lock.");
      setTimeout(() => setLockToast(null), 5000);
    }
  }, [inDbMode, editMode, datasetId, startHeartbeat]);

  const isLockedByOther = !!(lockInfo && !lockAcquired);

  // --------------------------------------------------------------------
  // Derived: index, stats, layout
  // --------------------------------------------------------------------

  const idOf = useCallback(
    (r) => r.__emp_id ?? r[empCol],
    [empCol]
  );
  const parentOf = useCallback(
    (r) => (r.__mgr_id !== undefined ? r.__mgr_id : r[mgrCol]),
    [mgrCol]
  );
  const fteOf = useCallback(
    (r) => (fteCol ? Number(r[fteCol] || 0) : 0),
    [fteCol]
  );
  const flcOf = useCallback(
    (r) => (flcCol ? Number(r[flcCol] || 0) : 0),
    [flcCol]
  );
  const flaggedOf = useCallback((r) => !!r.is_flagged_removed, []);

  const index = useMemo(() => {
    if (!records) {
      return { byId: new Map(), childrenByParent: new Map(), roots: [], brokenRefs: [] };
    }
    return buildIndex(records, idOf, parentOf);
  }, [records, idOf, parentOf]);

  // Auto-collapse nodes at depth >= maxDepth for the level filter.
  // Include brokenRefs so data-issue subtrees respect the same depth cap.
  useEffect(() => {
    const autoRoots = [...index.roots, ...(index.brokenRefs || [])];
    if (!autoRoots.length) return;
    if (maxDepth === 0) {
      setCollapsed(new Set());
      return;
    }
    const autoSet = autoCollapseAtDepth(autoRoots, index.childrenByParent, maxDepth);
    setCollapsed(autoSet);
  }, [maxDepth, index]);

  const stats = useMemo(() => {
    if (!records) return new Map();
    return computeSubtreeStats(records, idOf, parentOf, { fteOf, flcOf, flaggedOf });
  }, [records, idOf, parentOf, fteOf, flcOf, flaggedOf]);

  // Build the list of L1 function heads (direct children of roots) for the export modal.
  const l1Functions = useMemo(() => {
    if (!index.roots.length) return [];
    const fns = [];
    for (const rootId of index.roots) {
      for (const kidId of (index.childrenByParent.get(rootId) || [])) {
        const rec = index.byId.get(kidId);
        if (!rec) continue;
        const title = (jobTitleCol ? String(rec[jobTitleCol] || "") : "") || String(rec["Job Title"] || kidId);
        const hc = stats.get(kidId)?.headcount ?? 0;
        fns.push({ id: kidId, title, headcount: hc });
      }
    }
    return fns;
  }, [index, jobTitleCol, stats]);

  // Hidden ids from search + department + job title + function filters; ranked search matches
  const { hidden, searchMatches } = useMemo(() => {
    const out = new Set();
    const emptyMatches = [];
    if (!records || (!search.trim() && !departmentFilter && !jobTitleFilter && !functionFilter)) {
      return { hidden: out, searchMatches: emptyMatches };
    }

    const term = search.trim().toLowerCase();
    const matchesEmp = (r) => {
      if (departmentFilter) {
        const dept = r.Division || r.Department || r["Org Unit"] || "";
        if (String(dept) !== departmentFilter) return false;
      }
      if (jobTitleFilter) {
        const title = (jobTitleCol && r[jobTitleCol]) || r["Job Title"] || "";
        if (String(title) !== jobTitleFilter) return false;
      }
      if (functionFilter) {
        const func = (funcCol && r[funcCol]) || r["Function"] || "";
        if (String(func) !== functionFilter) return false;
      }
      if (term) {
        const haystack = [
          r[empCol],
          r[jobTitleCol],
          r[countryCol],
          r["Job Title"],
          r["Division"],
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    };

    const matched = records.filter(matchesEmp);
    const rankedMatches = term
      ? rankSearchMatches(matched, term, { empCol, jobTitleCol, countryCol })
      : emptyMatches;

    // Visible set = matches + ancestors + descendants of matches
    const visible = new Set();
    matched.forEach((r) => {
      const id = String(idOf(r));
      visible.add(id);
      // Ancestors
      let cur = id;
      const guard = new Set();
      while (cur && !guard.has(cur)) {
        guard.add(cur);
        const node = index.byId.get(cur);
        if (!node) break;
        const p = parentOf(node);
        const pid = p != null ? String(p) : null;
        if (!pid) break;
        visible.add(pid);
        cur = pid;
      }
      // Descendants
      const queue = [id];
      while (queue.length) {
        const x = queue.shift();
        (index.childrenByParent.get(x) || []).forEach((c) => {
          visible.add(c);
          queue.push(c);
        });
      }
    });

    records.forEach((r) => {
      const id = String(idOf(r));
      if (!visible.has(id)) out.add(id);
    });
    return { hidden: out, searchMatches: rankedMatches };
  }, [records, search, departmentFilter, jobTitleFilter, functionFilter, empCol, jobTitleCol, funcCol, countryCol, idOf, parentOf, index]);

  const layout = useMemo(() => {
    if (!records || !records.length) return { nodes: new Map(), width: 0, height: 0, childRowsInfo: new Map() };

    const layoutOpts = {
      childrenByParent: index.childrenByParent,
      collapsed,
      hidden,
      maxDepth,
    };

    // Main tree: only true top-of-house roots (no manager listed).
    const result = layoutTree({
      rootIds: index.roots,
      ...layoutOpts,
    });

    // Reachable from the main tree (ignore collapse/hidden — full structural reach).
    const bfsReachable = (startIds) => {
      const reachable = new Set();
      const queue = [...startIds];
      while (queue.length) {
        const id = queue.shift();
        if (reachable.has(id)) continue;
        reachable.add(id);
        for (const child of index.childrenByParent.get(id) || []) {
          queue.push(child);
        }
      }
      return reachable;
    };

    const reachableFromMain = bfsReachable(index.roots);

    // Broken manager refs: manager id present but not in dataset. Lay these out
    // as their own subtrees in a data-issues lane below the main tree so they
    // don't scatter across the top of the canvas as fake L1 roots.
    const brokenRootIds = (index.brokenRefs || []).filter((id) => !reachableFromMain.has(id));
    let issuesBottom = result.height;

    if (brokenRootIds.length) {
      const issuesLayout = layoutTree({
        rootIds: brokenRootIds,
        ...layoutOpts,
      });
      const yOffset = (result.height || 0) + CARD_HEIGHT + 80;
      issuesLayout.nodes.forEach((pos, id) => {
        result.nodes.set(id, {
          ...pos,
          y: pos.y + yOffset,
          isDataIssue: true,
        });
      });
      result.width = Math.max(result.width, issuesLayout.width);
      result.height = yOffset + issuesLayout.height;
      issuesBottom = result.height;
      // Merge childRowsInfo if present
      if (issuesLayout.childRowsInfo) {
        issuesLayout.childRowsInfo.forEach((v, k) => {
          result.childRowsInfo.set(k, v);
        });
      }
    }

    // True cycle-orphans: still unreachable after including broken-ref trees.
    // Flat-place them (no meaningful parent-child connectors).
    const reachableFromMainAndBroken = bfsReachable([
      ...index.roots,
      ...brokenRootIds,
    ]);
    const cycleOrphanIds = [];
    for (const id of index.byId.keys()) {
      if (!reachableFromMainAndBroken.has(id) && !result.nodes.has(id)) {
        cycleOrphanIds.push(id);
      }
    }

    if (cycleOrphanIds.length) {
      const yOffset = issuesBottom + CARD_HEIGHT + 80;
      let xCursor = 0;
      for (const id of cycleOrphanIds) {
        result.nodes.set(id, {
          x: xCursor,
          y: yOffset,
          depth: -1,
          isCycleOrphan: true,
          isDataIssue: true,
        });
        xCursor += CARD_WIDTH + HORIZONTAL_GAP;
      }
      result.width = Math.max(result.width, xCursor - HORIZONTAL_GAP);
      result.height = yOffset + CARD_HEIGHT;
    }

    return result;
  }, [records, index, collapsed, hidden, maxDepth]);

  // Departments for the filter dropdown
  const departments = useMemo(() => {
    if (!records) return [];
    const set = new Set();
    records.forEach((r) => {
      const d = r.Division || r.Department || r["Org Unit"];
      if (d) set.add(String(d));
    });
    return Array.from(set).sort();
  }, [records]);

  // Unique job titles for the filter dropdown
  const jobTitles = useMemo(() => {
    if (!records) return [];
    const set = new Set();
    records.forEach((r) => {
      const t = (jobTitleCol && r[jobTitleCol]) || r["Job Title"];
      if (t) set.add(String(t));
    });
    return Array.from(set).sort();
  }, [records, jobTitleCol]);

  // Unique functions for the filter dropdown
  const functions = useMemo(() => {
    if (!records) return [];
    const set = new Set();
    records.forEach((r) => {
      const f = (funcCol && r[funcCol]) || r["Function"];
      if (f) set.add(String(f));
    });
    return Array.from(set).sort();
  }, [records, funcCol]);

  const selectedRecord = useMemo(() => {
    if (!selectedId || !records) return null;
    return records.find((r) => String(idOf(r)) === String(selectedId));
  }, [selectedId, records, idOf]);

  const existingEmpIds = useMemo(
    () => (records || []).map((r) => String(idOf(r))),
    [records, idOf]
  );

  const mutationStates = useMemo(() => {
    const map = new Map();
    if (!records) return map;
    const logByEmp = new Map();
    for (const c of changeLog || []) {
      if (!c.emp_id) continue;
      if (!logByEmp.has(c.emp_id)) logByEmp.set(c.emp_id, []);
      logByEmp.get(c.emp_id).push(c);
    }
    for (const r of records) {
      const eid = String(idOf(r));
      const logs = logByEmp.get(eid) || [];
      map.set(eid, {
        added: !!r.is_added,
        flagged: !!r.is_flagged_removed,
        moved: logs.some((c) => c.action === "move"),
        edited: logs.some((c) => c.action === "edit"),
        cloned: logs.some((c) => c.action === "clone"),
      });
    }
    return map;
  }, [records, changeLog, idOf]);

  // --------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------

  // Optimistic local apply with 423 lock-conflict handling.
  const applyAndPersist = async (localUpdater, dbCall) => {
    if (isLockedByOther) return; // client-side guard

    const snapshot = records;
    const next = localUpdater(snapshot);
    setRecords(next);
    setSummary(buildLocalSummary(next, fteCol, flcCol));
    const { issuesMap, cycleGroups: cg } = validateRecordsClient(next, { empCol, mgrCol, jobTitleCol });
    setNodeIssuesMap(issuesMap);
    setCycleGroups(cg);
    if (!inDbMode) return;
    try {
      const resp = await dbCall();
      if (resp?.summary) setSummary(resp.summary);
      const log = await dbGetChangeLog(activeScenarioId);
      setChangeLog(log.changes || []);
      // Keep the activity feed fresh after each successful mutation.
      fetchActivity();
    } catch (e) {
      // Three-state 423 handler: reacquire / lost / generic error
      if (e?.response?.status === 423) {
        try {
          const conflict = await handleLockConflict(e, datasetId);
          if (conflict.state === "reacquired") {
            // Re-acquired successfully -- retry the mutation transparently
            startHeartbeat();
            setLockAcquired(true);
            try {
              const resp = await dbCall();
              if (resp?.summary) setSummary(resp.summary);
              const log = await dbGetChangeLog(activeScenarioId);
              setChangeLog(log.changes || []);
              return;
            } catch (retryErr) {
              console.error("Retry after re-acquire failed.", retryErr);
            }
          }
          // Lost the lock
          if (lockHeartbeatRef.current) {
            clearInterval(lockHeartbeatRef.current);
            lockHeartbeatRef.current = null;
          }
          setLockAcquired(false);
          setEditMode(false);
          setLockInfo({ holder: conflict.holder, holder_id: conflict.holderId, last_heartbeat: null });
          setLockToast(`${conflict.holder} took the lock while you were away. Switched to read-only.`);
          setTimeout(() => setLockToast(null), 6000);
        } catch {
          // handleLockConflict re-threw -- not a 423 after all
        }
      } else {
        console.error("DB write failed; rolling back.", e);
        setError(e.message || "Failed to persist change.");
      }
      setRecords(snapshot);
      setSummary(buildLocalSummary(snapshot, fteCol, flcCol));
    }
  };

  const handleMove = async (empId, newMgrId) => {
    lastEditedIdRef.current = String(empId);
    await applyAndPersist(
      (recs) =>
        recs.map((r) =>
          String(idOf(r)) === String(empId)
            ? { ...r, __mgr_id: newMgrId == null ? null : String(newMgrId), [mgrCol]: newMgrId }
            : r
        ),
      () => dbMoveEmployee(activeScenarioId, empId, newMgrId)
    );
  };

  const handleEdit = async (empId, updates, effectiveDate = null) => {
    await applyAndPersist(
      (recs) =>
        recs.map((r) => {
          if (String(idOf(r)) !== String(empId)) return r;
          const next = { ...r, ...updates };
          if (flcCol && Object.prototype.hasOwnProperty.call(updates, flcCol)) {
            next.__rate_card_derived = false;
          }
          return next;
        }),
      () => dbEditEmployee(activeScenarioId, empId, updates, effectiveDate)
    );
  };

  const handleFlag = async (empId, flagged, effectiveDate = null) => {
    lastEditedIdRef.current = String(empId);
    const subtree = collectDescendants(String(empId), index.childrenByParent);
    await applyAndPersist(
      (recs) =>
        recs.map((r) =>
          subtree.has(String(idOf(r)))
            ? { ...r, is_flagged_removed: flagged }
            : r
        ),
      () => dbFlagEmployee(activeScenarioId, empId, flagged, effectiveDate)
    );
  };

  const handleApplyRateCard = async (empId) => {
    const record = records?.find((r) => String(idOf(r)) === String(empId));
    if (!record || !flcCol) return;
    const values = {};
    rateCardPropertyCols.forEach((col) => {
      values[col] = record[col];
    });
    const lookup = await lookupRateCardForValues(values);
    if (lookup?.cost == null) {
      setError("No rate card match for this property combination.");
      return;
    }
    const updates = { [flcCol]: lookup.cost };
    await applyAndPersist(
      (recs) =>
        recs.map((r) =>
          String(idOf(r)) === String(empId)
            ? { ...r, [flcCol]: lookup.cost, __rate_card_derived: true }
            : r
        ),
      () => dbEditEmployee(activeScenarioId, empId, updates)
    );
  };

  const handleAddChild = async (payload) => {
    const synthesized = {
      ...payload.record,
      __emp_id: payload.emp_id,
      __mgr_id: payload.mgr_id,
      is_flagged_removed: false,
      is_added: true,
      Level: payload.level,
      __rate_card_derived: !!payload.rate_card_derived,
    };
    if (fteCol) synthesized[fteCol] = payload.fte;
    if (flcCol) synthesized[flcCol] = payload.flc;

    await applyAndPersist(
      (recs) => [...recs, synthesized],
      () => dbAddEmployee(activeScenarioId, payload)
    );
    setAddChildFor(null); // effective_date forwarded via payload.effective_date
  };

  const handleClone = async (sourceEmpId, newEmpId, effectiveDate = null) => {
    if (!inDbMode) return;
    const source = records.find((r) => String(idOf(r)) === String(sourceEmpId));
    if (!source) return;

    const mgrId = source.__mgr_id ?? source[mgrCol] ?? null;
    const synthesized = {
      ...source,
      __emp_id: newEmpId,
      __mgr_id: mgrId,
      is_flagged_removed: false,
      is_added: true,
    };
    if (empCol) synthesized[empCol] = newEmpId;
    if (mgrCol && mgrId != null) synthesized[mgrCol] = mgrId;

    await applyAndPersist(
      (recs) => [...recs, synthesized],
      () =>
        dbCloneEmployee(activeScenarioId, {
          source_emp_id: sourceEmpId,
          new_emp_id: newEmpId,
          new_mgr_id: mgrId,
          effective_date: effectiveDate || null,
        })
    );
    setSelectedId(newEmpId);
  };

  const openCloneFor = (empId) => {
    setSelectedId(empId);
    setClonePromptFor(String(empId));
  };

  // --------------------------------------------------------------------
  // Drag-and-drop handlers (dnd-kit)
  // --------------------------------------------------------------------

  const handleDndStart = useCallback((event) => {
    const empId = String(event.active.id);
    const node = index.byId.get(empId);
    const oldMgr = node?.__mgr_id
      ? index.byId.get(String(node.__mgr_id))
      : null;
    const oldLevel = oldMgr ? Number(oldMgr.Level) || 0 : 0;
    const srcLevel = Number(node?.Level) || 0;

    dragDescendantsRef.current = collectDescendants(empId, index.childrenByParent);
    dragOldParentLevelRef.current = oldLevel;
    dragSrcLevelRef.current = srcLevel;
    setDragOldParentLevel(oldLevel);
    setDragSrcLevel(srcLevel);
    setActiveDragId(empId);
  }, [index]);

  const handleDndEnd = useCallback((event) => {
    const { active, over } = event;
    const srcId = String(active.id);

    if (!over) {
      skipDropAnimRef.current = false;
      setActiveDragId(null);
      setDragOldParentLevel(null);
      setDragSrcLevel(null);
      dragDescendantsRef.current = new Set();
      dragOldParentLevelRef.current = null;
      dragSrcLevelRef.current = null;
      return;
    }

    const targetId = String(over.id);
    const targetNode = index.byId.get(targetId);
    const targetLevel = targetNode ? Number(targetNode.Level) || 0 : 0;
    const oldParentLevel = dragOldParentLevelRef.current ?? 0;
    const srcLevel = dragSrcLevelRef.current ?? 0;
    const isSameLvl = isSameLevelDrop(targetLevel, oldParentLevel, srcLevel);

    // Block: self-drop, dropping onto own descendant, or true downward (not same-level)
    if (
      srcId === targetId ||
      dragDescendantsRef.current.has(targetId) ||
      (targetLevel > oldParentLevel && !isSameLvl)
    ) {
      skipDropAnimRef.current = false;
      setActiveDragId(null);
      setDragOldParentLevel(null);
      setDragSrcLevel(null);
      dragDescendantsRef.current = new Set();
      dragOldParentLevelRef.current = null;
      dragSrcLevelRef.current = null;
      return;
    }

    skipDropAnimRef.current = true;
    const result = isSignificantMove(srcId, targetId, index);
    dragDescendantsRef.current = new Set();
    dragOldParentLevelRef.current = null;
    dragSrcLevelRef.current = null;

    if (result.significant) {
      setPendingMove({ srcId, targetId, reasons: result.reasons });
      setActiveDragId(null);
      setDragOldParentLevel(null);
      setDragSrcLevel(null);
    } else {
      setActiveDragId(null);
      setDragOldParentLevel(null);
      setDragSrcLevel(null);
      handleMove(srcId, targetId);
    }
  }, [index, handleMove]);

  // --------------------------------------------------------------------
  // Pan / zoom handlers
  // --------------------------------------------------------------------

  const onCanvasMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".org-node-card")) return;
    dragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
    };
    if (viewportRef.current) viewportRef.current.style.cursor = "grabbing";
  };
  const onCanvasMouseMove = (e) => {
    if (!dragStateRef.current.dragging) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    panRef.current = {
      x: dragStateRef.current.startPanX + dx,
      y: dragStateRef.current.startPanY + dy,
    };
    applyTransform();
  };
  const onCanvasMouseUp = () => {
    dragStateRef.current.dragging = false;
    if (viewportRef.current) viewportRef.current.style.cursor = "grab";
  };
  const setZoom = useCallback((nextOrFn) => {
    const next = typeof nextOrFn === "function" ? nextOrFn(zoomRef.current) : nextOrFn;
    const clamped = Math.max(0.1, Math.min(2.5, next));
    zoomRef.current = clamped;
    applyTransform();
    setZoomLabel(clamped);
  }, [applyTransform]);

  // Zoom anchored to a screen-space point (anchorX, anchorY) so that world
  // point under the anchor stays fixed. Used by +/- buttons (viewport center)
  // and Ctrl+scroll (cursor position).
  const setZoomAt = useCallback((nextOrFn, anchorX, anchorY) => {
    const oldZoom = zoomRef.current;
    const next = typeof nextOrFn === "function" ? nextOrFn(oldZoom) : nextOrFn;
    const newZoom = Math.max(0.1, Math.min(2.5, next));
    // Adjust pan so the world point under anchor stays fixed:
    //   panNew = anchor - (anchor - panOld) * (newZoom / oldZoom)
    const ratio = newZoom / oldZoom;
    panRef.current = {
      x: anchorX - (anchorX - panRef.current.x) * ratio,
      y: anchorY - (anchorY - panRef.current.y) * ratio,
    };
    zoomRef.current = newZoom;
    applyTransform();
    setZoomLabel(newZoom);
  }, [applyTransform]);

  const setPan = useCallback((x, y) => {
    panRef.current = { x, y };
    applyTransform();
  }, [applyTransform]);

  // Side-button pan step: shift the stage by a fixed pixel amount so users
  // can scroll wide trees without click-dragging. dx/dy are in screen pixels.
  const panBy = useCallback((dx, dy) => {
    panRef.current = {
      x: panRef.current.x + dx,
      y: panRef.current.y + dy,
    };
    applyTransform();
  }, [applyTransform]);

  const parentMap = useMemo(() => {
    const map = new Map();
    if (!records) return map;
    records.forEach((r) => {
      const id = String(r.__emp_id ?? r[empCol] ?? "");
      const pid = r.__mgr_id ?? r[mgrCol];
      if (id && pid != null && pid !== "") map.set(id, String(pid));
    });
    return map;
  }, [records, empCol, mgrCol]);

  const uncollapseAncestorsOf = useCallback((targetId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      let curr = String(targetId);
      const guard = new Set();
      while (parentMap.has(curr) && !guard.has(curr)) {
        guard.add(curr);
        const parent = parentMap.get(curr);
        next.delete(parent);
        curr = parent;
      }
      return next;
    });
  }, [parentMap]);

  // Core camera move: pan + zoom to a node. Does NOT select or highlight.
  // Returns true if the node was found in the layout.
  const cameraToNode = useCallback((empId, { zoom = FOCUS_ZOOM } = {}) => {
    const pos = layout.nodes.get(String(empId));
    if (!pos || !viewportRef.current) return false;

    const vw = viewportRef.current.clientWidth || 1200;
    const vh = viewportRef.current.clientHeight || 800;
    zoomRef.current = zoom;
    setZoomLabel(zoom);

    const { panX, panY } = computeFocusPan(pos, { width: vw, height: vh }, zoom);
    panRef.current = { x: panX, y: panY };
    applyTransform();
    return true;
  }, [layout, applyTransform]);
  // Keep ref always pointing at the latest cameraToNode so RAF callbacks
  // that fire after a re-render (e.g. auto-collapse) use the correct layout.
  cameraToNodeRef.current = cameraToNode;

  // Full focus: camera + gold highlight + detail panel.
  // Used for "View in OrgSight" and search selection.
  const focusOnNode = useCallback((empId, { zoom = FOCUS_ZOOM } = {}) => {
    if (!cameraToNode(empId, { zoom })) return false;
    const id = String(empId);
    setSelectedId(id);
    setFocusedNodeId(id);
    return true;
  }, [cameraToNode]);

  // navigateToNode: uncollapse ancestors, wait for layout, then execute.
  // mode: "camera" | "focus" (default)
  const navigateToNode = useCallback((empId, { zoom = FOCUS_ZOOM, mode = "focus", onComplete } = {}) => {
    const id = String(empId);
    pendingFocusRef.current = { id, zoom, mode, onComplete };
    uncollapseAncestorsOf(id);
  }, [uncollapseAncestorsOf]);

  // After uncollapse / filter layout settles, execute the pending navigation.
  // We keep the pending item alive until the target node appears in the layout
  // (it may take multiple render cycles if ancestors were deeply collapsed).
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;

    if (!layout.nodes.has(pending.id)) {
      // Target not visible yet — uncollapse ancestors again in case the first
      // call happened before layout was fully computed.
      uncollapseAncestorsOf(pending.id);
      return;
    }

    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (pending.mode === "camera") {
          cameraToNode(pending.id, { zoom: pending.zoom });
        } else {
          focusOnNode(pending.id, { zoom: pending.zoom });
        }
        pending.onComplete?.();
      }, 150);
    });
  }, [layout, collapsed, cameraToNode, focusOnNode, uncollapseAncestorsOf]);

  // After a collapse/expand toggle, pan the camera back to the toggled node so the
  // user doesn't get disoriented when the tree reflows around them.
  useEffect(() => {
    const eid = pendingCollapseNodeRef.current;
    if (!eid) return;
    if (!layout.nodes.has(eid)) return;
    pendingCollapseNodeRef.current = null;
    requestAnimationFrame(() => {
      setTimeout(() => {
        cameraToNode(eid);
      }, 150);
    });
  }, [layout, cameraToNode]);

  // "View in OrgSight" from Spans & Layers: filter tree + full focus + detail panel.
  useEffect(() => {
    if (!initialFocusNodeId || !records?.length) return;
    const targetId = String(initialFocusNodeId);
    if (focusHandledRef.current === targetId) return;
    focusHandledRef.current = targetId;

    // Find the record so we can set the search to filter the tree to their branch.
    const rec = records.find((r) => String(r.__emp_id ?? r[empCol] ?? "") === targetId);
    if (rec) {
      const name = String(rec[empCol] ?? targetId);
      setSearch(name);
      setSearchDropdownOpen(false);
    }

    // Navigate (uncollapse ancestors) and open the detail panel.
    navigateToNode(targetId, { mode: "focus", onComplete: onFocusHandled });
  }, [initialFocusNodeId, records, empCol, navigateToNode, onFocusHandled]);

  useEffect(() => {
    if (!initialFocusNodeId) focusHandledRef.current = null;
  }, [initialFocusNodeId]);

  // Reset search match index when query or filters change.
  // Clear focused node when search is cleared.
  useEffect(() => {
    if (!search.trim()) {
      setFocusedNodeId(null);
      setSearchDropdownOpen(false);
    }
  }, [search]);

  // Select a match from the dropdown: full focus (camera + highlight + panel).
  const selectSearchMatch = useCallback((match) => {
    setSearch(match.label);
    setSearchDropdownOpen(false);
    navigateToNode(match.id, { mode: "focus" });
  }, [navigateToNode]);

  const onWheelLogic = useCallback((e) => {
    // Always zoom on wheel scroll (no Ctrl required).
    // Use smaller factor for trackpad (deltaMode 0 with small deltas) vs mouse wheel.
    e.preventDefault();
    const isTrackpad = Math.abs(e.deltaY) < 50 && e.deltaMode === 0;
    const factor = e.deltaY < 0
      ? (isTrackpad ? 1.04 : 1.12)
      : (isTrackpad ? 1 / 1.04 : 1 / 1.12);
    const rect = viewportRef.current?.getBoundingClientRect();
    const anchorX = rect ? e.clientX - rect.left : viewportRef.current?.clientWidth / 2 ?? 600;
    const anchorY = rect ? e.clientY - rect.top : viewportRef.current?.clientHeight / 2 ?? 400;
    setZoomAt((z) => z * factor, anchorX, anchorY);
  }, [setZoomAt]);

  // Attach wheel listener as non-passive so preventDefault() actually prevents
  // browser scroll/page-zoom. React's onWheel synthetic event is passive in some builds.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheelLogic, { passive: false });
    return () => el.removeEventListener("wheel", onWheelLogic);
  }, [onWheelLogic]);

  // Keep the React synthetic onWheel for completeness (no-op body; the native handler does the work)
  const onWheel = undefined;

  // Home button: move camera to root, no selection change.
  const centerOnRoot = useCallback(() => {
    const firstRootId = index.roots[0];
    if (!firstRootId) return;
    navigateToNode(firstRootId, { zoom: ROOT_ENTRY_ZOOM, mode: "camera" });
  }, [index.roots, navigateToNode]);

  // On first load (manual open): camera-only, no highlight, no detail panel.
  useEffect(() => {
    if (!records || !records.length || !layout.nodes.size) return;
    if (!viewportRef.current) return;
    if (hasAutoCenteredRef.current) return;
    if (initialFocusNodeId) return;
    if (search.trim()) return;

    const firstRootId = index.roots[0];
    if (!firstRootId) return;

    hasAutoCenteredRef.current = true;
    const capturedRootId = firstRootId;
    requestAnimationFrame(() => {
      cameraToNodeRef.current(capturedRootId, { zoom: ROOT_ENTRY_ZOOM });
    });
  }, [records, layout, index.roots, initialFocusNodeId, search, cameraToNode]);

  // Reset hasAutoCentered when scenario / dataset changes so the new dataset
  // gets auto-centered too.
  useEffect(() => {
    hasAutoCenteredRef.current = false;
  }, [datasetId, activeScenarioId]);

  // After a move/flag the layout recomputes. Once the target node appears in the
  // updated layout, gently pan the camera to keep it in view without changing zoom.
  useEffect(() => {
    const targetId = lastEditedIdRef.current;
    if (!targetId || !layout.nodes.has(targetId)) return;
    lastEditedIdRef.current = null;
    requestAnimationFrame(() => {
      cameraToNodeRef.current?.(targetId, { zoom: zoomRef.current });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Re-center viewport when dropdown filters change so the user isn't left
  // staring at empty space after the tree shrinks/moves.
  const prevFiltersRef = useRef({ departmentFilter, jobTitleFilter, functionFilter });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const changed =
      prev.departmentFilter !== departmentFilter ||
      prev.jobTitleFilter !== jobTitleFilter ||
      prev.functionFilter !== functionFilter;
    prevFiltersRef.current = { departmentFilter, jobTitleFilter, functionFilter };
    if (!changed) return;

    if (!layout.nodes.size) return;

    requestAnimationFrame(() => {
      if (!departmentFilter && !jobTitleFilter && !functionFilter) {
        const firstRootId = index.roots[0];
        if (firstRootId) cameraToNodeRef.current(firstRootId, { zoom: ROOT_ENTRY_ZOOM });
      } else {
        if (!viewportRef.current || !layout.width || !layout.height) return;
        const vw = viewportRef.current.clientWidth;
        const vh = viewportRef.current.clientHeight || 600;
        const z = Math.min((vw - 60) / layout.width, (vh - 60) / layout.height, 1);
        const newZoom = Math.max(0.05, z);
        zoomRef.current = newZoom;
        panRef.current = { x: (vw - layout.width * newZoom) / 2, y: 20 };
        setZoomLabel(newZoom);
        applyTransform();
      }
    });
  }, [departmentFilter, jobTitleFilter, functionFilter, layout, index.roots, applyTransform]);

  // Ctrl+Z keyboard shortcut for undo
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && inDbMode) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inDbMode, activeScenarioId]);

  // Fit-to-view: scale + pan to show the entire tree at once.
  const fitToView = useCallback(() => {
    if (!viewportRef.current || !layout.width || !layout.height) return;
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight || 600;
    const z = Math.min((vw - 60) / layout.width, (vh - 60) / layout.height, 1);
    const newZoom = Math.max(0.05, z);
    zoomRef.current = newZoom;
    panRef.current = {
      x: (vw - layout.width * newZoom) / 2,
      y: 20,
    };
    setZoomLabel(newZoom);
    applyTransform();
  }, [layout, applyTransform]);

  // Keyboard shortcuts for pan (Shift+Arrow) and zoom (Z / Shift+Z / X).
  // Skipped when focus is inside any text input so typing isn't intercepted.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;

      const PAN_STEP = 200;

      switch (e.key) {
        case "ArrowUp":
          if (e.shiftKey) { e.preventDefault(); panBy(0, PAN_STEP); }
          break;
        case "ArrowDown":
          if (e.shiftKey) { e.preventDefault(); panBy(0, -PAN_STEP); }
          break;
        case "ArrowLeft":
          if (e.shiftKey) { e.preventDefault(); panBy(PAN_STEP, 0); }
          break;
        case "ArrowRight":
          if (e.shiftKey) { e.preventDefault(); panBy(-PAN_STEP, 0); }
          break;
        case "z":
        case "Z": {
          if (e.ctrlKey || e.metaKey) break; // leave Ctrl+Z for undo
          e.preventDefault();
          const vw = viewportRef.current?.clientWidth ?? 1200;
          const vh = viewportRef.current?.clientHeight ?? 800;
          e.shiftKey
            ? setZoomAt((z) => z / 1.15, vw / 2, vh / 2)
            : setZoomAt((z) => z * 1.15, vw / 2, vh / 2);
          break;
        }
        case "x":
        case "X":
          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); fitToView(); }
          break;
        case "h":
        case "H":
          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); centerOnRoot(); }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panBy, setZoomAt, fitToView, centerOnRoot]);

  // --------------------------------------------------------------------
  // Scenario actions (Phase 5)
  // --------------------------------------------------------------------

  const handleCreateScenario = async (name, sourceScenarioId, rateCardId = null, rateCardQuartile = "p50") => {
    if (!datasetId) return;
    try {
      const resp = await dbCreateScenario(datasetId, {
        name,
        description: "",
        sourceScenarioId,
        rateCardId,
        rateCardQuartile,
      });
      const newScenario = resp.scenario;
      setScenarios?.([...(scenarios || []), newScenario]);
      setActiveScenarioId?.(newScenario.id);
    } catch (e) {
      setError(e.message || "Failed to create scenario.");
    }
  };

  const handleRateCardCreated = (rateCard) => {
    if (!rateCard?.id) return;
    setRateCards((prev) => {
      const exists = prev.some((rc) => rc.id === rateCard.id);
      if (exists) {
        return prev.map((rc) => (rc.id === rateCard.id ? { ...rc, ...rateCard } : rc));
      }
      return [rateCard, ...prev];
    });
  };

  const handleScenarioRateCardChange = async (scenarioId, rateCardId, quartile) => {
    try {
      const resp = await dbSetScenarioRateCard(scenarioId, {
        rate_card_id: rateCardId,
        rate_card_quartile: quartile,
      });
      const updated = resp.scenario;
      setScenarios?.((scenarios || []).map((s) => (s.id === scenarioId ? { ...s, ...updated } : s)));
    } catch (e) {
      setError(e.message || "Failed to update rate card settings.");
    }
  };

  const handleRenameScenario = async (id, name) => {
    try {
      const resp = await dbRenameScenario(id, { name });
      setScenarios?.((scenarios || []).map((s) => (s.id === id ? resp.scenario : s)));
    } catch (e) {
      setError(e.message || "Failed to rename scenario.");
    }
  };

  const handleDeleteScenario = async (id) => {
    try {
      await dbDeleteScenario(id);
      const filtered = (scenarios || []).filter((s) => s.id !== id);
      setScenarios?.(filtered);
      if (id === activeScenarioId) {
        const baseline = filtered.find((s) => s.name === "Baseline") || filtered[0];
        if (baseline) setActiveScenarioId?.(baseline.id);
      }
    } catch (e) {
      setError(e.message || "Failed to delete scenario.");
    }
  };

  const handlePromote = async (id) => {
    try {
      await dbPromoteScenario(id);
      setScenarios?.((scenarios || []).map((s) => ({ ...s, is_promoted: s.id === id })));
      await reloadScenario();
    } catch (e) {
      setError(e.message || "Failed to promote scenario.");
    }
  };

  const handleReset = async (id) => {
    if (!inDbMode) return;
    try {
      await dbResetScenario(id);
      await reloadScenario();
    } catch (e) {
      setError(e.message || "Failed to reset scenario.");
    }
  };

  const handleUndo = async () => {
    if (!inDbMode) return;
    try {
      const resp = await dbUndoLastChange(activeScenarioId);
      if (resp.status === "nothing_to_undo") return;
      if (resp.summary) setSummary(resp.summary);
      await reloadScenario();
    } catch (e) {
      setError(e.message || "Failed to undo.");
    }
  };

  useEffect(() => {
    if (!onGuardStateChange) return;
    const active = (scenarios || []).find((s) => s.id === activeScenarioId);
    onGuardStateChange({
      inDbMode,
      datasetId,
      activeScenarioId,
      scenarioName: active?.name || null,
      changeLogLength: changeLog?.length ?? 0,
      editMode,
      lockAcquired,
    });
  }, [
    onGuardStateChange,
    inDbMode,
    datasetId,
    activeScenarioId,
    scenarios,
    changeLog,
    editMode,
    lockAcquired,
  ]);

  const openCompare = async () => {
    if (!datasetId) return;
    try {
      const data = await dbCompareScenarios(datasetId);
      setComparison(data);
      setCompareOpen(true);
    } catch (e) {
      setError(e.message || "Failed to load comparison.");
    }
  };

  // --------------------------------------------------------------------
  // Empty / loading states
  // --------------------------------------------------------------------

  // Show the dataset picker when there's no data at all -- this covers the
  // "refreshed the page mid-session" case and the "first visit" case.
  const showPicker = !inDbMode && !hasLegacyDf;
  if (showPicker) {
    return (
      <SavedDatasetPicker
        onPick={({ dataset, scenarios: scs, activeScenarioId: sid }) => {
          if (onActivateDataset) {
            onActivateDataset({ dataset, scenarios: scs, activeScenarioId: sid });
            return;
          }
          setDatasetId?.(dataset.id);
          setScenarios?.(scs);
          setActiveScenarioId?.(sid);
          setEmpCol?.(dataset.emp_col || empCol);
          setMgrCol?.(dataset.mgr_col || mgrCol);
          if (dataset.fte_col) setFteCol?.(dataset.fte_col);
          if (dataset.flc_col) setFlcCol?.(dataset.flc_col);
          if (dataset.job_title_col) setJobTitleCol?.(dataset.job_title_col);
          if (dataset.country_col) setCountryCol?.(dataset.country_col);
        }}
      />
    );
  }

  if (!records) {
    return (
      <div style={emptyStyle()}>
        <style>{`
          @keyframes glowPulse {
            0%, 100% { filter: drop-shadow(0 0 2px rgba(10, 63, 134, 0.4)); opacity: 0.8; }
            50% { filter: drop-shadow(0 0 8px rgba(1, 36, 74, 0.8)); opacity: 1; }
          }
          @keyframes dataFlow {
            0% { stroke-dashoffset: 24; }
            100% { stroke-dashoffset: 0; }
          }
          @keyframes pulseScale {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.08); }
          }
        `}</style>
        <div className="flex flex-col items-center justify-center space-y-6 max-w-sm mx-auto">
          {/* Holographic Glowing SVG Org Tree */}
          <div className="relative w-32 h-28 animate-[pulseScale_3s_ease-in-out_infinite] flex items-center justify-center">
            {/* Ambient Background Glow */}
            <div className="absolute inset-0 bg-[#0a3f86]/5 rounded-full blur-xl transform scale-75" />
            
            <svg className="w-full h-full relative z-10" viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Glow Filter */}
              <defs>
                <filter id="brand-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Connecting Lines with flow dash animation */}
              {/* L1 to L2 */}
              <line x1="50" y1="15" x2="25" y2="45" stroke="#0a3f86" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 6" className="animate-[dataFlow_1.2s_linear_infinite]" filter="url(#brand-glow)" />
              <line x1="50" y1="15" x2="75" y2="45" stroke="#0a3f86" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 6" className="animate-[dataFlow_1.2s_linear_infinite]" filter="url(#brand-glow)" />
              
              {/* L2 to L3 */}
              <line x1="25" y1="45" x2="12" y2="70" stroke="#74a9e7" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 4" className="animate-[dataFlow_1.8s_linear_infinite]" />
              <line x1="25" y1="45" x2="38" y2="70" stroke="#74a9e7" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 4" className="animate-[dataFlow_1.8s_linear_infinite]" />
              <line x1="75" y1="45" x2="62" y2="70" stroke="#74a9e7" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 4" className="animate-[dataFlow_1.8s_linear_infinite]" />
              <line x1="75" y1="45" x2="88" y2="70" stroke="#74a9e7" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 4" className="animate-[dataFlow_1.8s_linear_infinite]" />

              {/* L1 Root Node (Executive) - Glowing dark navy with gold stroke */}
              <circle cx="50" cy="15" r="8" fill="#01244a" stroke="#c5a84a" strokeWidth="2" className="animate-[glowPulse_2s_infinite]" filter="url(#brand-glow)" />
              <circle cx="50" cy="15" r="3" fill="#c5a84a" />

              {/* L2 Branch Nodes (VP/Director) - Glowing sapphire blue with navy stroke */}
              <circle cx="25" cy="45" r="6.5" fill="#0a3f86" stroke="#01244a" strokeWidth="1.5" className="animate-[glowPulse_2s_infinite]" style={{ animationDelay: "250ms" }} filter="url(#brand-glow)" />
              <circle cx="25" cy="45" r="2" fill="#dee7f0" />
              
              <circle cx="75" cy="45" r="6.5" fill="#0a3f86" stroke="#01244a" strokeWidth="1.5" className="animate-[glowPulse_2s_infinite]" style={{ animationDelay: "250ms" }} filter="url(#brand-glow)" />
              <circle cx="75" cy="45" r="2" fill="#dee7f0" />

              {/* L3 Leaf Nodes (Manager/Staff) - Soft grey-blue with light blue stroke */}
              <circle cx="12" cy="70" r="4.5" fill="#dee7f0" stroke="#74a9e7" strokeWidth="1" className="animate-[glowPulse_2s_infinite]" style={{ animationDelay: "500ms" }} />
              <circle cx="38" cy="70" r="4.5" fill="#dee7f0" stroke="#74a9e7" strokeWidth="1" className="animate-[glowPulse_2s_infinite]" style={{ animationDelay: "500ms" }} />
              <circle cx="62" cy="70" r="4.5" fill="#dee7f0" stroke="#74a9e7" strokeWidth="1" className="animate-[glowPulse_2s_infinite]" style={{ animationDelay: "500ms" }} />
              <circle cx="88" cy="70" r="4.5" fill="#dee7f0" stroke="#74a9e7" strokeWidth="1" className="animate-[glowPulse_2s_infinite]" style={{ animationDelay: "500ms" }} />
            </svg>
          </div>
          
          {/* Typography */}
          <div className="text-center space-y-1.5">
            <h3 className="text-sm font-semibold text-[#01244a] tracking-wide animate-pulse">
              Structuring Organisation Data...
            </h3>
            <p className="text-xs text-gray-400">
              Calibrating reporting lines, levels, and scenario details
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div style={emptyStyle()}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: AM.navy }}>No data yet</h3>
        <p style={{ fontSize: 13, color: AM.textMuted, marginTop: 8 }}>
          Run the Hierarchy step to build the org chart, then come back here to start modelling.
        </p>
      </div>
    );
  }

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------

  const totalHeadcount = summary?.current?.headcount ?? records.filter((r) => !r.is_flagged_removed).length;
  const totalFte = summary?.current?.total_fte ?? records.filter((r) => !r.is_flagged_removed).reduce((s, r) => s + (fteCol ? Number(r[fteCol] || 0) : 0), 0);
  const totalCost = summary?.current?.total_cost ?? records.filter((r) => !r.is_flagged_removed).reduce((s, r) => s + (flcCol ? Number(r[flcCol] || 0) : 0), 0);

  // Viewport-relative positions for fixed-position dropdowns (immune to overflow clipping).
  const searchRect = searchWrapRef.current?.getBoundingClientRect() ?? null;
  const exportRect = exportBtnRef.current?.getBoundingClientRect() ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 600,
        background: AM.bg,
        fontFamily: "Inter, system-ui, sans-serif",
        position: fullscreen ? "fixed" : "relative",
        borderRadius: fullscreen ? 0 : 12,
        overflow: "hidden",
        border: fullscreen ? "none" : `1px solid ${AM.border}`,
        ...(fullscreen ? { inset: 0, zIndex: 100 } : {}),
      }}
    >
      {/* Lock banner -- shown when another user holds the edit lock */}
      {isLockedByOther && (
        <div
          style={{
            background: "#fef3c7",
            borderBottom: "1px solid #f59e0b",
            padding: "10px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 13,
            color: "#92400e",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16 }}>&#128274;</span>
          <span style={{ flex: 1 }}>
            <strong>{lockInfo.holder}</strong> is editing this dataset.
            {lockInfo.last_heartbeat && (
              <span style={{ marginLeft: 6, color: "#b45309" }}>
                Last activity: {formatTimeSince(lockInfo.last_heartbeat)}
              </span>
            )}
            <span style={{ marginLeft: 4 }}> You have read-only access.</span>
          </span>
          <button
            onClick={checkLockStatus}
            style={{
              background: "#f59e0b",
              color: "#78350f",
              border: "none",
              borderRadius: 10,
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.3px",
              textTransform: "uppercase",
            }}
          >
            Refresh Status
          </button>
        </div>
      )}

      {/* Toast notification for lock events */}
      {lockToast && (
        <div
          style={{
            background: "#dc2626",
            color: "#fff",
            padding: "8px 20px",
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {lockToast}
        </div>
      )}

      {/* Auto-dismiss activity banner -- briefly summarises unseen changes */}
      {activityBannerVisible && activityMeta.unseen_count > 0 && (
        <div
          style={{
            background: "linear-gradient(90deg, rgba(197,168,74,0.18), rgba(197,168,74,0.06))",
            borderBottom: `1px solid ${AM.gold}`,
            padding: "10px 20px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 13,
            color: AM.navy,
            flexShrink: 0,
            animation: "orgsight-slide-down 0.35s ease-out",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: AM.gold,
              color: AM.navy,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {activityMeta.unseen_count}
          </span>
          <span style={{ flex: 1 }}>
            <strong>{activityMeta.unseen_count} change{activityMeta.unseen_count === 1 ? "" : "s"}</strong>{" "}
            since your last visit
            {summariseActivity(activityMeta.action_counts, activityMeta.contributors) && (
              <span style={{ color: AM.textSecondary, marginLeft: 8 }}>
                — {summariseActivity(activityMeta.action_counts, activityMeta.contributors)}
              </span>
            )}
          </span>
          <button
            onClick={openActivityPanel}
            style={{
              background: AM.navy,
              color: AM.white,
              border: "none",
              borderRadius: 12,
              padding: "5px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.4px",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            View
          </button>
          <button
            onClick={dismissActivityBanner}
            aria-label="Dismiss"
            style={{
              background: "transparent",
              border: "none",
              color: AM.textSecondary,
              cursor: "pointer",
              fontSize: 18,
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header bar -- single compact line */}
      <div
        className="org-toolbar-scroll"
        style={{
          background: AM.navy,
          color: AM.white,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          flexWrap: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          position: "relative",
          zIndex: 50,
          minHeight: 44,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 5,
            background: AM.gold,
            color: AM.navy,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: "-0.5px",
            flexShrink: 0,
          }}
        >
          A
        </div>

        <div style={{ display: "flex", gap: 14, marginLeft: 8, flexShrink: 0, alignItems: "center" }}>
          <Stat label="Headcount" value={fmtNumber(totalHeadcount)} />
          <Stat label="FTE" value={fmtNumber(Number(totalFte).toFixed(1))} />
          <Stat label="Cost" value={fmtCompactCurrency(totalCost)} />
        </div>

        <div style={{ flex: 1 }} />

        {/* Search typeahead */}
        <div ref={searchWrapRef} style={{ position: "relative", flexShrink: 1, minWidth: 0 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={1.8}
              style={{ position: "absolute", left: 9, width: 13, height: 13, pointerEvents: "none", flexShrink: 0 }}
            >
              <circle cx="8.5" cy="8.5" r="5.5" />
              <line x1="13" y1="13" x2="17" y2="17" />
            </svg>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value.trim()) setSearchDropdownOpen(true);
              }}
              onFocus={() => { if (search.trim()) setSearchDropdownOpen(true); }}
              onBlur={() => setTimeout(() => setSearchDropdownOpen(false), 180)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearch(""); setSearchDropdownOpen(false); }
                if (e.key === "Enter" && searchMatches.length > 0) {
                  e.preventDefault();
                  selectSearchMatch(searchMatches[0]);
                }
              }}
              placeholder="Search people…"
              style={{
                background: "#0a3366",
                border: `1px solid ${search.trim() && searchMatches.length === 0 ? "rgba(220,38,38,0.6)" : "#1a4d7a"}`,
                color: AM.white,
                borderRadius: 6,
                padding: "6px 28px 6px 28px",
                fontSize: 12,
                outline: "none",
                width: 160,
                minWidth: 90,
                flexShrink: 1,
              }}
            />
            {search.trim() && (
              <button
                onMouseDown={(e) => { e.preventDefault(); setSearch(""); setSearchDropdownOpen(false); setFocusedNodeId(null); }}
                style={{
                  position: "absolute",
                  right: 8,
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                }}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {searchDropdownOpen && searchMatches.length > 0 && (
            <div
              style={{
                position: "fixed",
                top: searchRect ? searchRect.bottom + 4 : 60,
                left: searchRect ? searchRect.left : 0,
                minWidth: searchRect ? searchRect.width : 240,
                maxWidth: 320,
                maxHeight: 280,
                overflowY: "auto",
                background: AM.white,
                border: `1px solid ${AM.border}`,
                borderRadius: 8,
                boxShadow: "0 8px 28px rgba(1,36,74,0.16)",
                zIndex: 9999,
              }}
            >
              {searchMatches.slice(0, 12).map((match) => {
                const jobTitle = (jobTitleCol && match.record[jobTitleCol]) || match.record["Job Title"] || "";
                const dept = match.record.Division || match.record.Department || "";
                return (
                  <button
                    key={match.id}
                    onMouseDown={(e) => { e.preventDefault(); selectSearchMatch(match); }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      padding: "8px 12px",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderBottom: `1px solid ${AM.borderLight}`,
                      cursor: "pointer",
                      fontFamily: "Inter, system-ui, sans-serif",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = AM.blueLight)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          background: AM.navyLight,
                          color: AM.white,
                          borderRadius: 3,
                          padding: "1px 5px",
                          letterSpacing: "0.3px",
                          flexShrink: 0,
                        }}
                      >
                        L{match.level}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: AM.navy }}>{match.label}</span>
                      <span style={{ fontSize: 10, color: AM.textMuted, fontFamily: "monospace", marginLeft: "auto" }}>{match.id}</span>
                    </div>
                    {(jobTitle || dept) && (
                      <div style={{ fontSize: 10, color: AM.textSecondary, marginTop: 2 }}>
                        {[jobTitle, dept].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </button>
                );
              })}
              {searchMatches.length > 12 && (
                <div style={{ padding: "6px 12px", fontSize: 10, color: AM.textMuted, textAlign: "center" }}>
                  {searchMatches.length - 12} more — refine your search
                </div>
              )}
            </div>
          )}
          {search.trim() && searchMatches.length === 0 && (
            <div style={{ position: "fixed", top: searchRect ? searchRect.bottom + 4 : 60, left: searchRect ? searchRect.left : 0, minWidth: searchRect ? searchRect.width : 180, padding: "7px 12px", background: AM.white, border: `1px solid ${AM.border}`, borderRadius: 8, fontSize: 11, color: AM.textMuted, zIndex: 9999 }}>
              No matches
            </div>
          )}
        </div>
        {departments.length > 0 && (
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            title="Filter by department"
            style={{
              background: "#0a3366",
              border: "1px solid #1a4d7a",
              color: AM.white,
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 11,
              outline: "none",
              maxWidth: 120,
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            <option value="">Dept ▾</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        {jobTitles.length > 0 && (
          <select
            value={jobTitleFilter}
            onChange={(e) => setJobTitleFilter(e.target.value)}
            title="Filter by job title"
            style={{
              background: "#0a3366",
              border: "1px solid #1a4d7a",
              color: AM.white,
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 11,
              outline: "none",
              maxWidth: 130,
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            <option value="">Title ▾</option>
            {jobTitles.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        {functions.length > 0 && (
          <select
            value={functionFilter}
            onChange={(e) => setFunctionFilter(e.target.value)}
            title="Filter by function"
            style={{
              background: "#0a3366",
              border: "1px solid #1a4d7a",
              color: AM.white,
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 11,
              outline: "none",
              maxWidth: 120,
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            <option value="">Func ▾</option>
            {functions.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}
        <select
          value={maxDepth}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMaxDepth(v);
            hasAutoCenteredRef.current = false;
          }}
          title="Show levels"
          style={{
            background: "#0a3366",
            border: "1px solid #1a4d7a",
            color: AM.white,
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 12,
            outline: "none",
            flexShrink: 0,
          }}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>L1–L{n}</option>
          ))}
          <option value={0}>All levels</option>
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6, flexShrink: 0 }}>
          <ZoomBtn
            onClick={() => {
              const vw = viewportRef.current?.clientWidth ?? 1200;
              const vh = viewportRef.current?.clientHeight ?? 800;
              setZoomAt((z) => z / 1.15, vw / 2, vh / 2);
            }}
            title="Zoom out"
          >−</ZoomBtn>
          <span style={{ fontSize: 11, color: AM.white, width: 42, textAlign: "center", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 600, whiteSpace: "nowrap" }}>
            {(zoomLabel * 100).toFixed(0)}%
          </span>
          <ZoomBtn
            onClick={() => {
              const vw = viewportRef.current?.clientWidth ?? 1200;
              const vh = viewportRef.current?.clientHeight ?? 800;
              setZoomAt((z) => z * 1.15, vw / 2, vh / 2);
            }}
            title="Zoom in"
          >+</ZoomBtn>
          <ZoomBtn onClick={fitToView} title="Fit tree to view [X]">⤢</ZoomBtn>
          <ZoomBtn
            onClick={centerOnRoot}
            title="Center on root [H]"
          >
            ⌂
          </ZoomBtn>
        </div>

        <div ref={exportBtnRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setExportMenuOpen((v) => !v)}
            style={{
              background: "transparent",
              color: AM.white,
              border: "1px solid #1a4d7a",
              borderRadius: 14,
              padding: "5px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.4px",
              cursor: "pointer",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            Export
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {exportMenuOpen && (
            <div
              onMouseLeave={() => setExportMenuOpen(false)}
              style={{
                position: "fixed",
                top: exportRect ? exportRect.bottom + 6 : 60,
                right: exportRect ? window.innerWidth - exportRect.right : 16,
                background: AM.white,
                borderRadius: 8,
                boxShadow: "0 12px 28px rgba(1,36,74,0.18)",
                border: `1px solid ${AM.border}`,
                minWidth: 260,
                maxHeight: 460,
                overflowY: "auto",
                zIndex: 9999,
              }}
            >
              {inDbMode ? (
                <>
                  <ExportGroupLabel label="PowerPoint (.pptx)" />
                  <ExportItem
                    label="Export PowerPoint…"
                    desc="Choose scope and detail level"
                    onClick={() => {
                      setExportMenuOpen(false);
                      setExportModalOpen(true);
                    }}
                  />
                  <ExportGroupLabel label="PDF" />
                  <ExportItem
                    label="Overview"
                    desc="L1-L2 visual chart"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      runExport("PDF – Overview", () => dbExportPdf(activeScenarioId, s?.name || "scenario", "overview"));
                    }}
                  />
                  <ExportItem
                    label="Summary"
                    desc="Overview + subtree pages per L1 report"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      runExport("PDF – Summary", () => dbExportPdf(activeScenarioId, s?.name || "scenario", "summary"));
                    }}
                  />
                  <ExportGroupLabel label="Other Formats" />
                  <ExportItem
                    label="SVG"
                    desc="Raw vector file"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      runExport("SVG", () => dbExportSvg(activeScenarioId, s?.name || "scenario"));
                    }}
                  />
                  <ExportItem
                    label="Change Summary (Excel)"
                    desc="Summary + change log + breakdown by dimension"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      runExport("Excel – Change Summary", () => dbExportChanges(activeScenarioId, s?.name || "scenario"));
                    }}
                  />
                  <ExportItem
                    label="Current Records (Excel)"
                    desc="Full To-Be roster"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      runExport("Excel – Current Records", () => dbExportRecords(activeScenarioId, s?.name || "scenario"));
                    }}
                  />
                </>
              ) : (
                <div style={{ padding: 14, fontSize: 11, color: AM.textMuted }}>
                  Run Hierarchy first to enable scenario exports.
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={toggleEditMode}
          disabled={isLockedByOther}
          title={isLockedByOther ? `Locked by ${lockInfo?.holder}` : editMode ? "Exit edit mode" : "Enter edit mode"}
          style={{
            background: editMode ? AM.gold : isLockedByOther ? "#374151" : "transparent",
            color: editMode ? AM.navy : isLockedByOther ? "#6b7280" : AM.white,
            border: `1px solid ${editMode ? AM.gold : isLockedByOther ? "#4b5563" : "#1a4d7a"}`,
            borderRadius: 14,
            padding: "5px 14px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.4px",
            cursor: isLockedByOther ? "not-allowed" : "pointer",
            textTransform: "uppercase",
            opacity: isLockedByOther ? 0.6 : 1,
          }}
        >
          {isLockedByOther ? `Locked by ${lockInfo?.holder}` : editMode ? "Edit Mode On" : "Edit Mode"}
        </button>
        <button
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen canvas"}
          style={{
            background: fullscreen ? AM.gold : "transparent",
            color: fullscreen ? AM.navy : AM.white,
            border: `1px solid ${fullscreen ? AM.gold : "#1a4d7a"}`,
            borderRadius: 14,
            padding: "5px 10px",
            fontSize: 13,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          {fullscreen ? "✕" : "⛶"}
        </button>
      </div>

      {/* Scenario bar (only in DB mode) */}
      {inDbMode && (
        <OrgScenarioBar
          scenarios={scenarios || []}
          activeScenarioId={activeScenarioId}
          onSwitch={handleScenarioSwitch}
          switching={isScenarioBusy}
          switchingScenarioName={switchingScenarioName}
          onCreate={handleCreateScenario}
          onRename={handleRenameScenario}
          onDelete={handleDeleteScenario}
          onPromote={handlePromote}
          onCompare={openCompare}
          onReset={handleReset}
          onUndo={handleUndo}
          onActivity={() => (activityOpen ? setActivityOpen(false) : openActivityPanel())}
          activityUnseenCount={activityMeta.unseen_count}
          activityActive={activityOpen}
          datasetId={datasetId}
          flcCol={flcCol}
          datasetColumns={datasetColumns}
          datasetColumnMeta={datasetColumnMeta}
          rateCards={rateCards}
          onRateCardCreated={handleRateCardCreated}
          onScenarioRateCardChange={handleScenarioRateCardChange}
          dbPreviewRateCard={dbPreviewRateCard}
          dbGenerateRateCard={dbGenerateRateCard}
          dbPatchRateCardRow={dbPatchRateCardRow}
          dbSetScenarioRateCard={dbSetScenarioRateCard}
          onValidate={inDbMode && activeScenarioId
            ? async () => {
                const result = await dbValidateScenario(activeScenarioId);
                const serverIssues = result?.issues ?? [];
                // Merge server-side issues into the client-side map
                setNodeIssuesMap((prev) => {
                  const next = new Map(prev);
                  for (const issue of serverIssues) {
                    const key = String(issue.emp_id);
                    const existing = next.get(key) || [];
                    const duplicate = existing.some(
                      (e) => e.type === issue.issue_type
                    );
                    if (!duplicate) {
                      next.set(key, [
                        ...existing,
                        {
                          type: issue.issue_type,
                          severity: issue.severity,
                          description: issue.description,
                          relatedEmpIds: issue.related_emp_ids || [],
                        },
                      ]);
                    }
                  }
                  return next;
                });
                return result;
              }
            : undefined}
          onJumpToNode={navigateToNode}
        />
      )}

      {/* Export loading toast */}
      {exportingLabel && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: AM.navy,
            color: AM.white,
            padding: "9px 18px",
            fontSize: 12,
            fontWeight: 500,
            flexShrink: 0,
            borderBottom: `1px solid rgba(255,255,255,0.08)`,
          }}
        >
          {/* spinner */}
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke={AM.gold}
            strokeWidth={2.5}
            style={{ flexShrink: 0, animation: "orgScenarioSpin 0.9s linear infinite" }}
          >
            <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
            <path d="M12 2 a10 10 0 0 1 10 10" />
          </svg>
          <span>
            Exporting <strong style={{ color: AM.gold }}>{exportingLabel}</strong> — preparing your file…
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            background: AM.dangerLight,
            color: AM.danger,
            padding: "8px 20px",
            fontSize: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "transparent", border: "none", color: AM.danger, cursor: "pointer", fontWeight: 700 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Global card hover style + activity feed animations */}
      <style>{`
        .org-node-card:hover .org-node-toolbar{opacity:1;pointer-events:auto}
        @keyframes orgsight-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(197,168,74,0.6); }
          50% { transform: scale(1.1); box-shadow: 0 0 0 5px rgba(197,168,74,0); }
        }
        @keyframes orgsight-slide-down {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Body: canvas + detail panel (panel floats so it never squeezes the canvas) */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 400, position: "relative" }}>
        {isScenarioBusy && (
          <OrgChartLoadingOverlay
            message={switchingScenarioName ? `Switching to ${switchingScenarioName}…` : "Loading scenario…"}
            submessage="Fetching org structure and scenario changes from the server"
          />
        )}
        <div
          ref={viewportRef}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            cursor: "grab",
            background: `radial-gradient(circle at 20px 20px, #e2e8ee 1px, transparent 1px)`,
            backgroundSize: "30px 30px",
          }}
          onClick={(e) => {
            if (
              !e.target.closest(".org-node-card") &&
              !e.target.closest(".bulk-action-bar")
            ) {
              setSelectedId(null);
              setMultiSelectedIds(new Set());
            }
          }}
        >
          <DndContext
            sensors={dndSensors}
            onDragStart={handleDndStart}
            onDragEnd={handleDndEnd}
          >
          <div
            ref={stageRef}
            style={{
              transform: `translate(0px, 0px) scale(1)`,
              transformOrigin: "0 0",
              width: Math.max(layout.width + 100, 800),
              height: Math.max(layout.height + 100, 600),
              position: "relative",
              willChange: "transform",
              padding: 40,
            }}
          >
            {/* Connectors layer -- step-line paths whose endpoints land on each
                card's incoming/outgoing port dots. Skipping the previous arrow
                marker because the port dots themselves are now the visual
                termination indicators. */}
            <svg
              width={layout.width + 100}
              height={layout.height + 100}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                pointerEvents: "none",
              }}
            >
              {/* childrenByParent already includes every node (roots included).
                  Do NOT concat roots again — duplicate keys make React leave
                  stale/doubled connector paths after filter/collapse updates. */}
              {Array.from(index.childrenByParent.keys()).map((parentId) => {
                const pPos = layout.nodes.get(parentId);
                if (!pPos) return null;
                // Skip connectors from/to cycle-orphan nodes — they have no
                // meaningful parent-child relationship to draw in the layout.
                if (pPos.isCycleOrphan) return null;
                const kids = (index.childrenByParent.get(parentId) || []);
                const visibleKids = kids.filter((cid) => {
                  const cp = layout.nodes.get(cid);
                  return cp && !cp.isCycleOrphan;
                });
                if (!visibleKids.length) return null;
                const childPositions = visibleKids.map((cid) => layout.nodes.get(cid));
                const d = stepPath(pPos, childPositions);
                if (!d) return null;
                return (
                  <path
                    key={`conn-${parentId}`}
                    d={d}
                    stroke={AM.navy}
                    strokeOpacity={0.65}
                    strokeWidth={1.5}
                    fill="none"
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>

            {/* Separator label for data-issue nodes (broken manager refs / cycles) */}
            {(() => {
              let laneTopY = Infinity;
              let hasBroken = false;
              let hasCycle = false;
              layout.nodes.forEach((pos, id) => {
                if (!pos?.isDataIssue && !pos?.isCycleOrphan) return;
                if (pos.y < laneTopY) laneTopY = pos.y;
                if (pos.isCycleOrphan) hasCycle = true;
                else if ((index.brokenRefs || []).includes(id)) hasBroken = true;
              });
              if (!Number.isFinite(laneTopY)) return null;
              let label = "⚠ Circular reference — fix the reporting chain to place these nodes in the tree";
              if (hasBroken && hasCycle) {
                label = "⚠ Data issues — broken manager references and circular reporting chains";
              } else if (hasBroken) {
                label = "⚠ Broken manager reference — manager id not found in dataset";
              }
              return (
                <div
                  key="data-issue-label"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: laneTopY - 36,
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    pointerEvents: "none",
                  }}
                >
                  <div style={{
                    background: "#fef2f2",
                    border: "1px dashed #fca5a5",
                    borderRadius: 8,
                    padding: "4px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#dc2626",
                    fontFamily: "Inter, system-ui, sans-serif",
                    whiteSpace: "nowrap",
                  }}>
                    {label}
                  </div>
                </div>
              );
            })()}

            {/* Cards layer -- only render nodes in the layout */}
            {records.map((rec) => {
              const id = String(idOf(rec));
              const pos = layout.nodes.get(id);
              if (!pos) return null;
              const kids = index.childrenByParent.get(id) || [];
              const isCollapsed = collapsed.has(id);
              const hiddenCount = isCollapsed && stats.get(id)
                ? stats.get(id).headcount - 1
                : 0;
              return (
                <OrgNodeCard
                  key={id}
                  record={rec}
                  position={pos}
                  stats={stats.get(id)}
                  selected={selectedId === id}
                  focused={focusedNodeId === id}
                  isMultiSelected={multiSelectedIds.has(id)}
                  issues={visibleIssuesMap.get(id) || null}
                  editMode={editMode}
                  empCol={empCol}
                  jobTitleCol={jobTitleCol}
                  fteCol={fteCol}
                  flcCol={flcCol}
                  countryCol={countryCol}
                  onSelect={(eid, e) => {
                    if (e?.shiftKey) {
                      setMultiSelectedIds((prev) => {
                        const next = new Set(prev);
                        next.has(eid) ? next.delete(eid) : next.add(eid);
                        return next;
                      });
                    } else {
                      setMultiSelectedIds(new Set());
                      setSelectedId(eid);
                      setFocusedNodeId(null); // manual click clears programmatic highlight
                    }
                  }}
                  onStartEdit={(eid) => setSelectedId(eid)}
                  onFlagToggle={handleFlag}
                  onAddChild={(eid) => setAddChildFor(eid)}
                  onClone={openCloneFor}
                  onCollapseToggle={(eid) => {
                    setCollapsed((prev) => {
                      const n = new Set(prev);
                      n.has(eid) ? n.delete(eid) : n.add(eid);
                      return n;
                    });
                    pendingCollapseNodeRef.current = eid;
                  }}
                  collapsed={isCollapsed}
                  hasChildren={kids.length > 0}
                  hiddenCount={hiddenCount}
                  activeDragId={activeDragId}
                  dragDescendants={dragDescendantsRef.current}
                  dragOldParentLevel={dragOldParentLevel}
                  dragSrcLevel={dragSrcLevel}
                  mutationState={mutationStates.get(id)}
                />
              );
            })}
          </div>

          <DragOverlay dropAnimation={dropAnimationConfig}>
            {activeDragId && index.byId.get(activeDragId) ? (
              <div style={{
                opacity: 0.8,
                transform: "scale(1.03) rotate(2deg)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
                pointerEvents: "none",
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
              }}>
                <OrgNodeCard
                  record={index.byId.get(activeDragId)}
                  position={{ x: 0, y: 0 }}
                  stats={stats.get(activeDragId)}
                  selected={false}
                  editMode={false}
                  empCol={empCol}
                  jobTitleCol={jobTitleCol}
                  fteCol={fteCol}
                  flcCol={flcCol}
                  countryCol={countryCol}
                  collapsed={false}
                  hasChildren={false}
                  hiddenCount={0}
                  activeDragId={null}
                  dragDescendants={null}
                  dragOldParentLevel={null}
                />
              </div>
            ) : null}
          </DragOverlay>
          </DndContext>

          {/* Inline validation sidebar — navigation only; fix UI is in the detail panel */}
          <ValidationSidebar
            nodeIssuesMap={visibleIssuesMap}
            onJumpToNode={navigateToNode}
            ignoredCount={ignoredIssueCount}
            onIgnoreIssue={ignoreIssue}
            onIgnoreMany={ignoreMany}
            onRestoreAll={restoreAll}
          />

          {/* Bulk action bar — floats at bottom when multi-select is active */}
          <BulkActionBar
            multiSelectedIds={multiSelectedIds}
            onClearSelection={() => setMultiSelectedIds(new Set())}
            onBulkFlag={async (empIds, flagged) => {
              if (!activeScenarioId) return;
              await dbBulkFlag(activeScenarioId, empIds, flagged);
              await reloadScenario();
            }}
            onBulkEditProperty={async (empIds, field, value) => {
              if (!activeScenarioId) return;
              await dbBulkEditProperty(activeScenarioId, empIds, field, value);
              await reloadScenario();
            }}
            onBulkMove={async (empIds, newMgrId) => {
              // Optimistic update then persist — validation reruns automatically via applyAndPersist
              await applyAndPersist(
                (recs) =>
                  recs.map((r) => {
                    const rid = String(r.__emp_id ?? r[empCol] ?? "");
                    return empIds.includes(rid)
                      ? { ...r, __mgr_id: String(newMgrId), [mgrCol]: newMgrId }
                      : r;
                  }),
                () => dbBulkMove(activeScenarioId, empIds, newMgrId)
              );
            }}
            onBulkIgnoreIssues={(empIds) => {
              const pairs = [];
              for (const eid of empIds) {
                for (const issue of visibleIssuesMap.get(eid) || []) {
                  pairs.push({ empId: eid, issue });
                }
              }
              if (pairs.length) ignoreMany(pairs);
            }}
            nodeIssuesMap={visibleIssuesMap}
            allRecords={records}
            empCol={empCol}
            jobTitleCol={jobTitleCol}
            editMode={editMode}
          />

          {/* Help tooltip — collapsible shortcuts & edit guide. Always mounted
              (collapsed pill or expanded panel) so it never fully disappears. */}
          <OrgChartHelp
            open={helpOpen}
            onOpenChange={setHelpOpen}
            onDismiss={handleHelpDismiss}
          />

          {/* View-only hint — shown whenever Edit Mode is off, so users know
              how to start moving/flagging/editing FTEs. Small, top-right, dismissible. */}
          {!editMode && !isLockedByOther && !viewOnlyHintDismissed && (
            <div
              style={{
                position: "absolute",
                top: 12,
                right: 16,
                zIndex: 90,
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 6px 4px 10px",
                borderRadius: 16,
                border: `1px solid ${AM.border}`,
                background: "rgba(255,255,255,0.92)",
                boxShadow: "0 2px 8px rgba(1,36,74,0.10)",
                backdropFilter: "blur(4px)",
              }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggleEditMode(); }}
                title="Click to enter Edit Mode"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: "transparent",
                  border: "none",
                  color: AM.navy,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                  whiteSpace: "nowrap",
                }}
              >
                <span aria-hidden style={{ fontSize: 11 }}>🔒</span>
                View-only — click <strong>Edit Mode</strong> to edit
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setViewOnlyHintDismissed(true); }}
                title="Dismiss"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: 13,
                  lineHeight: 1,
                  padding: "0 2px",
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Floating pan controls. Each click shifts the stage by a fixed
              screen-pixel amount so users can scroll wide / tall trees
              without click-dragging. */}
          <PanButton
            direction="left"
            onClick={() => panBy(240, 0)}
            style={{ left: 12, top: "50%", transform: "translateY(-50%)" }}
          />
          <PanButton
            direction="right"
            onClick={() => panBy(-240, 0)}
            style={{ right: 12, top: "50%", transform: "translateY(-50%)" }}
          />
          <PanButton
            direction="up"
            onClick={() => panBy(0, 200)}
            style={{ left: "50%", top: 12, transform: "translateX(-50%)" }}
          />
          <PanButton
            direction="down"
            onClick={() => panBy(0, -200)}
            style={{ left: "50%", bottom: 12, transform: "translateX(-50%)" }}
          />
        </div>

        {selectedRecord && (
          <OrgDetailPanel
            record={selectedRecord}
            empCol={empCol}
            mgrCol={mgrCol}
            jobTitleCol={jobTitleCol}
            fteCol={fteCol}
            flcCol={flcCol}
            countryCol={countryCol}
            editMode={editMode}
            onClose={() => {
              setSelectedId(null);
              setClonePromptFor(null);
            }}
            onSave={handleEdit}
            onFlagToggle={handleFlag}
            onClone={handleClone}
            existingEmpIds={existingEmpIds}
            autoStartClone={clonePromptFor === String(idOf(selectedRecord))}
            onAutoCloneConsumed={() => setClonePromptFor(null)}
            rateCardActive={!!activeScenario?.rate_card_id}
            onApplyRateCard={handleApplyRateCard}
            issues={visibleIssuesMap.get(String(idOf(selectedRecord))) || null}
            onIgnoreIssue={(issue) => ignoreIssue(String(idOf(selectedRecord)), issue)}
            cycleGroups={cycleGroups}
            records={records}
            onMoveEmployee={handleMove}
            onEditEmployee={handleEdit}
            formulas={formulas}
            mutationState={mutationStates.get(String(idOf(selectedRecord)))}
          />
        )}

        <OrgActivityPanel
          open={activityOpen}
          changes={activityChanges}
          scenarios={scenarios || []}
          lastSeenAt={activityMeta.last_seen_at}
          unseenCount={activityMeta.unseen_count}
          loading={activityLoading}
          records={records}
          empCol={empCol}
          jobTitleCol={jobTitleCol}
          onClose={() => setActivityOpen(false)}
        />
      </div>

      <OrgImpactStrip
        summary={summary}
        changes={changeLog}
        scenarioId={inDbMode ? activeScenarioId : null}
        dimensionColumns={dimensionColumns}
        onExportChanges={inDbMode ? handleExportChanges : null}
      />

      <OrgCompareModal
        open={compareOpen}
        comparison={comparison}
        onClose={() => setCompareOpen(false)}
      />
      {addChildFor && (
        <OrgAddChildModal
          open
          parentRecord={records.find((r) => String(idOf(r)) === String(addChildFor)) || {}}
          empCol={empCol}
          mgrCol={mgrCol}
          jobTitleCol={jobTitleCol}
          fteCol={fteCol}
          flcCol={flcCol}
          countryCol={countryCol}
          rateCardPropertyCols={rateCardPropertyCols}
          onLookupRateCard={lookupRateCardForValues}
          onClose={() => setAddChildFor(null)}
          onSubmit={handleAddChild}
        />
      )}
      {pendingMove && (
        <OrgMoveConfirmModal
          srcNode={index.byId.get(pendingMove.srcId)}
          targetNode={index.byId.get(pendingMove.targetId)}
          reasons={pendingMove.reasons}
          empCol={empCol}
          onConfirm={() => {
            const { srcId, targetId } = pendingMove;
            setPendingMove(null);
            handleMove(srcId, targetId);
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
      <OrgExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        onExport={({ detail, scope, rootId }) => {
          const s = (scenarios || []).find((x) => x.id === activeScenarioId);
          const label = `PowerPoint – ${detail.charAt(0).toUpperCase() + detail.slice(1)}`;
          runExport(label, () => dbExportPpt(activeScenarioId, s?.name || "scenario", detail, scope, rootId));
        }}
        scenarioName={(scenarios || []).find((x) => x.id === activeScenarioId)?.name || ""}
        l1Functions={l1Functions}
        focusedNodeId={selectedId || focusedNodeId}
        focusedNodeTitle={(() => {
          const nid = selectedId || focusedNodeId;
          if (!nid) return null;
          const rec = index.byId.get(nid);
          if (!rec) return null;
          return (jobTitleCol ? String(rec[jobTitleCol] || "") : "") || String(rec["Job Title"] || nid);
        })()}
      />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
      <span
        style={{
          fontSize: 9,
          color: "#a8c0d8",
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "Inter, system-ui, sans-serif" }}>
        {value}
      </span>
    </div>
  );
}

function ZoomBtn({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "#0a3366",
        border: "1px solid #1a4d7a",
        color: AM.white,
        width: 26,
        height: 26,
        borderRadius: 5,
        fontSize: 13,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function PanButton({ direction, onClick, style }) {
  const arrows = { left: "‹", right: "›", up: "‹", down: "›" };
  const titles = {
    left: "Scroll left",
    right: "Scroll right",
    up: "Scroll up",
    down: "Scroll down",
  };
  const rotation =
    direction === "up" || direction === "down" ? "rotate(90deg)" : "none";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={titles[direction]}
      style={{
        position: "absolute",
        zIndex: 5,
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: "rgba(1,36,74,0.78)",
        color: "#ffffff",
        border: "1px solid rgba(255,255,255,0.18)",
        boxShadow: "0 4px 12px rgba(1,36,74,0.25)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        lineHeight: 1,
        padding: 0,
        fontWeight: 600,
        transition: "background 0.15s, transform 0.15s",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(1,36,74,0.95)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(1,36,74,0.78)";
      }}
    >
      <span
        style={{
          display: "inline-block",
          transform: rotation,
          marginTop: direction === "left" || direction === "right" ? -2 : 0,
        }}
      >
        {arrows[direction]}
      </span>
    </button>
  );
}

function ExportItem({ label, desc, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "10px 14px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        borderBottom: `1px solid ${AM.borderLight}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = AM.borderLight; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: AM.textPrimary }}>{label}</div>
      <div style={{ fontSize: 10, color: AM.textMuted, marginTop: 2 }}>{desc}</div>
    </button>
  );
}

function ExportGroupLabel({ label }) {
  return (
    <div
      style={{
        padding: "8px 14px 4px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: AM.navy,
        borderBottom: `1px solid ${AM.borderLight}`,
        background: "#f4f6f9",
      }}
    >
      {label}
    </div>
  );
}

function emptyStyle() {
  return {
    height: "100%",
    minHeight: 400,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    background: AM.bg,
    borderRadius: 12,
    border: `1px solid ${AM.border}`,
    fontFamily: "Inter, system-ui, sans-serif",
    padding: 40,
    textAlign: "center",
  };
}

/**
 * Build a one-line summary "3 moves, 2 edits -- John, Sarah" for the banner.
 */
function summariseActivity(actionCounts, contributors) {
  const parts = [];
  const labels = {
    move: ["move", "moves"],
    edit: ["edit", "edits"],
    add: ["addition", "additions"],
    flag_remove: ["flag", "flags"],
    delete: ["deletion", "deletions"],
    unflag_restore: ["restore", "restores"],
    reset: ["reset", "resets"],
  };
  Object.entries(actionCounts || {}).forEach(([action, count]) => {
    if (!count) return;
    const [sg, pl] = labels[action] || [action, action];
    parts.push(`${count} ${count === 1 ? sg : pl}`);
  });
  const names = (contributors || []).slice(0, 3).map((c) => c.username).filter(Boolean);
  const remainder = (contributors || []).length - names.length;
  const byClause = names.length
    ? ` by ${names.join(", ")}${remainder > 0 ? ` +${remainder}` : ""}`
    : "";
  if (parts.length === 0 && !byClause) return "";
  return `${parts.join(", ")}${byClause}`;
}

/**
 * Format an ISO timestamp as a relative "time since" string.
 */
function formatTimeSince(isoTimestamp) {
  if (!isoTimestamp) return "";
  try {
    const then = new Date(isoTimestamp + (isoTimestamp.endsWith("Z") ? "" : "Z"));
    const now = new Date();
    const diffMs = now - then;
    const diffSec = Math.max(0, Math.round(diffMs / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    return `${diffHr}h ago`;
  } catch {
    return "";
  }
}

/**
 * Build a baseline-equivalent summary for legacy in-memory mode so the impact
 * strip still shows live totals (deltas will be zero because there's no
 * persisted baseline to diff against).
 */
function buildLocalSummary(records, fteCol, flcCol) {
  const active = records.filter((r) => !r.is_flagged_removed);
  const flagged = records.filter((r) => r.is_flagged_removed);
  const sumF = (rows, col) =>
    col ? rows.reduce((s, r) => s + Number(r[col] || 0), 0) : 0;
  const cur = {
    headcount: active.length,
    total_fte: sumF(active, fteCol),
    total_cost: sumF(active, flcCol),
  };
  return {
    current: cur,
    baseline: cur,
    flagged_removed: {
      count: flagged.length,
      fte: sumF(flagged, fteCol),
      cost: sumF(flagged, flcCol),
    },
    delta: { headcount: 0, fte: 0, cost: 0 },
    change_count: 0,
  };
}
