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
} from "../api/backend";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  buildIndex,
  computeSubtreeStats,
  layoutTree,
  stepPath,
  collectDescendants,
  autoCollapseAtDepth,
  isSignificantMove,
  fmtCompactCurrency,
  fmtNumber,
} from "./orgchart/orgChartLayout";
import { AM } from "./orgchart/orgChartTheme";
import OrgNodeCard from "./orgchart/OrgNodeCard";
import OrgDetailPanel from "./orgchart/OrgDetailPanel";
import OrgImpactStrip from "./orgchart/OrgImpactStrip";
import OrgScenarioBar from "./orgchart/OrgScenarioBar";
import OrgCompareModal from "./orgchart/OrgCompareModal";
import OrgAddChildModal from "./orgchart/OrgAddChildModal";
import OrgMoveConfirmModal from "./orgchart/OrgMoveConfirmModal";
import SavedDatasetPicker from "./orgchart/SavedDatasetPicker";

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
  datasetId,
  scenarios,
  activeScenarioId,
  setScenarios,
  setActiveScenarioId,
  setDatasetId,
  setEmpCol,
  setMgrCol,
  setFteCol,
  setFlcCol,
  setJobTitleCol,
  setCountryCol,
}) {
  const inDbMode = !!(datasetId && activeScenarioId);
  const hasLegacyDf = !!(df && df.length);

  // Working records: the canonical employee list (after DB load OR from prop)
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [changeLog, setChangeLog] = useState([]);

  // Dataset lock state
  const [lockInfo, setLockInfo] = useState(null); // { holder, holder_id, last_heartbeat } when locked by other
  const [lockAcquired, setLockAcquired] = useState(false);
  const lockHeartbeatRef = useRef(null);
  const [lockToast, setLockToast] = useState(null); // transient toast message

  // UI state
  const [editMode, setEditMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [maxDepth, setMaxDepth] = useState(2);
  const [zoomLabel, setZoomLabel] = useState(1);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

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
  const skipDropAnimRef = useRef(false);

  // Modals
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [addChildFor, setAddChildFor] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

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
      setRecords(scResp.records || []);
      setSummary(scResp.summary || null);
      setChangeLog(logResp.changes || []);
    } catch (e) {
      console.error("Failed to load scenario:", e);
      setError(e.message || "Failed to load scenario from database.");
    } finally {
      setLoading(false);
    }
  }, [inDbMode, activeScenarioId]);

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
    if (!records) return { byId: new Map(), childrenByParent: new Map(), roots: [] };
    return buildIndex(records, idOf, parentOf);
  }, [records, idOf, parentOf]);

  // Auto-collapse nodes at depth >= maxDepth for the level filter
  useEffect(() => {
    if (!index.roots.length) return;
    if (maxDepth === 0) {
      setCollapsed(new Set());
      return;
    }
    const autoSet = autoCollapseAtDepth(index.roots, index.childrenByParent, maxDepth);
    setCollapsed(autoSet);
  }, [maxDepth, index]);

  const stats = useMemo(() => {
    if (!records) return new Map();
    return computeSubtreeStats(records, idOf, parentOf, { fteOf, flcOf, flaggedOf });
  }, [records, idOf, parentOf, fteOf, flcOf, flaggedOf]);

  // Hidden ids from search + department filter
  const hidden = useMemo(() => {
    const out = new Set();
    if (!records || (!search.trim() && !departmentFilter)) return out;

    const term = search.trim().toLowerCase();
    const matchesEmp = (r) => {
      if (departmentFilter) {
        const dept = r.Division || r.Department || r["Org Unit"] || "";
        if (String(dept) !== departmentFilter) return false;
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

    // Visible set = matches + ancestors + descendants of matches
    const visible = new Set();
    const matched = records.filter(matchesEmp);
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
    return out;
  }, [records, search, departmentFilter, empCol, jobTitleCol, countryCol, idOf, parentOf, index]);

  const layout = useMemo(() => {
    if (!records || !records.length) return { nodes: new Map(), width: 0, height: 0 };
    return layoutTree({
      rootIds: index.roots,
      childrenByParent: index.childrenByParent,
      collapsed,
      hidden,
      maxDepth,
    });
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

  const selectedRecord = useMemo(() => {
    if (!selectedId || !records) return null;
    return records.find((r) => String(idOf(r)) === String(selectedId));
  }, [selectedId, records, idOf]);

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
    if (!inDbMode) return;
    try {
      const resp = await dbCall();
      if (resp?.summary) setSummary(resp.summary);
      const log = await dbGetChangeLog(activeScenarioId);
      setChangeLog(log.changes || []);
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

  const handleEdit = async (empId, updates) => {
    await applyAndPersist(
      (recs) =>
        recs.map((r) =>
          String(idOf(r)) === String(empId) ? { ...r, ...updates } : r
        ),
      () => dbEditEmployee(activeScenarioId, empId, updates)
    );
  };

  const handleFlag = async (empId, flagged) => {
    const subtree = collectDescendants(String(empId), index.childrenByParent);
    await applyAndPersist(
      (recs) =>
        recs.map((r) =>
          subtree.has(String(idOf(r)))
            ? { ...r, is_flagged_removed: flagged }
            : r
        ),
      () => dbFlagEmployee(activeScenarioId, empId, flagged)
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
    };
    if (fteCol) synthesized[fteCol] = payload.fte;
    if (flcCol) synthesized[flcCol] = payload.flc;

    await applyAndPersist(
      (recs) => [...recs, synthesized],
      () => dbAddEmployee(activeScenarioId, payload)
    );
    setAddChildFor(null);
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

    dragDescendantsRef.current = collectDescendants(empId, index.childrenByParent);
    dragOldParentLevelRef.current = oldLevel;
    setDragOldParentLevel(oldLevel);
    setActiveDragId(empId);
  }, [index]);

  const handleDndEnd = useCallback((event) => {
    const { active, over } = event;
    const srcId = String(active.id);

    if (!over) {
      skipDropAnimRef.current = false;
      setActiveDragId(null);
      setDragOldParentLevel(null);
      dragDescendantsRef.current = new Set();
      dragOldParentLevelRef.current = null;
      return;
    }

    const targetId = String(over.id);
    const targetNode = index.byId.get(targetId);
    const targetLevel = targetNode ? Number(targetNode.Level) || 0 : 0;
    const oldParentLevel = dragOldParentLevelRef.current ?? 0;

    if (
      srcId === targetId ||
      dragDescendantsRef.current.has(targetId) ||
      targetLevel > oldParentLevel
    ) {
      skipDropAnimRef.current = false;
      setActiveDragId(null);
      setDragOldParentLevel(null);
      dragDescendantsRef.current = new Set();
      dragOldParentLevelRef.current = null;
      return;
    }

    skipDropAnimRef.current = true;
    const result = isSignificantMove(srcId, targetId, index);
    const descCopy = new Set(dragDescendantsRef.current);
    dragDescendantsRef.current = new Set();
    dragOldParentLevelRef.current = null;

    if (result.significant) {
      setPendingMove({ srcId, targetId, reasons: result.reasons });
      setActiveDragId(null);
      setDragOldParentLevel(null);
    } else {
      setActiveDragId(null);
      setDragOldParentLevel(null);
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

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom((z) => z * factor);
  };

  const centerOnRoot = useCallback(() => {
    const firstRootId = index.roots[0];
    if (!firstRootId) return;
    const rootPos = layout.nodes.get(firstRootId);
    if (!rootPos || !viewportRef.current) return;

    const vw = viewportRef.current.clientWidth || 1200;
    const DEFAULT_ZOOM = 0.75;
    const widthToFit = Math.max(layout.width, 800);
    const fitZoom = (vw - 80) / widthToFit;
    const initialZoom = Math.max(0.3, Math.min(DEFAULT_ZOOM, fitZoom));

    zoomRef.current = initialZoom;
    panRef.current = {
      x: vw / 2 - (rootPos.x + CARD_WIDTH / 2 + 40) * initialZoom,
      y: 20,
    };
    setZoomLabel(initialZoom);
    applyTransform();
  }, [index.roots, layout, applyTransform]);

  // Auto-center on root whenever layout is computed for a new dataset/scenario.
  // Uses rAF to ensure the viewport has been painted and clientWidth is accurate.
  useEffect(() => {
    if (!records || !records.length || !layout.nodes.size) return;
    if (!viewportRef.current) return;
    if (hasAutoCenteredRef.current) return;
    hasAutoCenteredRef.current = true;

    requestAnimationFrame(() => centerOnRoot());
  }, [records, layout, centerOnRoot]);

  // Reset hasAutoCentered when scenario / dataset changes so the new dataset
  // gets auto-centered too.
  useEffect(() => {
    hasAutoCenteredRef.current = false;
  }, [datasetId, activeScenarioId]);

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

  // --------------------------------------------------------------------
  // Scenario actions (Phase 5)
  // --------------------------------------------------------------------

  const handleCreateScenario = async (name, sourceScenarioId) => {
    if (!datasetId) return;
    try {
      const resp = await dbCreateScenario(datasetId, {
        name,
        description: "",
        sourceScenarioId,
      });
      const newScenario = resp.scenario;
      setScenarios?.([...(scenarios || []), newScenario]);
      setActiveScenarioId?.(newScenario.id);
    } catch (e) {
      setError(e.message || "Failed to create scenario.");
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
        <p style={{ fontSize: 14, color: AM.textMuted }}>Loading org chart…</p>
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 600,
        background: AM.bg,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
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

      {/* Header bar -- single compact line */}
      <div
        style={{
          background: AM.navy,
          color: AM.white,
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
          flexWrap: "nowrap",
          overflowX: "auto",
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

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          style={{
            background: "#0a3366",
            border: "1px solid #1a4d7a",
            color: AM.white,
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            outline: "none",
            width: 180,
          }}
        />
        {departments.length > 0 && (
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            style={{
              background: "#0a3366",
              border: "1px solid #1a4d7a",
              color: AM.white,
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
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
          }}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>L1–L{n}</option>
          ))}
          <option value={0}>All levels</option>
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
          <ZoomBtn onClick={() => setZoom((z) => z / 1.15)} title="Zoom out">−</ZoomBtn>
          <span style={{ fontSize: 11, color: AM.white, width: 42, textAlign: "center", fontFamily: "'IBM Plex Mono', monospace" }}>
            {(zoomLabel * 100).toFixed(0)}%
          </span>
          <ZoomBtn onClick={() => setZoom((z) => z * 1.15)} title="Zoom in">+</ZoomBtn>
          <ZoomBtn onClick={fitToView} title="Fit tree to view">⤢</ZoomBtn>
          <ZoomBtn
            onClick={centerOnRoot}
            title="Center on root (75%)"
          >
            ⌂
          </ZoomBtn>
        </div>

        <div style={{ position: "relative" }}>
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
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: AM.white,
                borderRadius: 8,
                boxShadow: "0 12px 28px rgba(1,36,74,0.18)",
                border: `1px solid ${AM.border}`,
                minWidth: 220,
                overflow: "hidden",
                zIndex: 20,
              }}
            >
              {inDbMode ? (
                <>
                  <ExportItem
                    label="Editable PPT (.pptx)"
                    desc="SVG → EMF via Inkscape, editable shapes"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      dbExportPpt(activeScenarioId, s?.name || "scenario").catch((e) =>
                        setError(e.response?.data?.detail || e.message || "Failed to export.")
                      );
                      setExportMenuOpen(false);
                    }}
                  />
                  <ExportItem
                    label="PDF"
                    desc="Single-page visual snapshot"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      dbExportPdf(activeScenarioId, s?.name || "scenario").catch((e) =>
                        setError(e.response?.data?.detail || e.message || "Failed to export.")
                      );
                      setExportMenuOpen(false);
                    }}
                  />
                  <ExportItem
                    label="SVG"
                    desc="Raw vector file"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      dbExportSvg(activeScenarioId, s?.name || "scenario").catch((e) =>
                        setError(e.response?.data?.detail || e.message || "Failed to export.")
                      );
                      setExportMenuOpen(false);
                    }}
                  />
                  <ExportItem
                    label="Change summary (Excel)"
                    desc="Before vs After + change log"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      dbExportChanges(activeScenarioId, s?.name || "scenario").catch((e) =>
                        setError(e.message || "Failed to export.")
                      );
                      setExportMenuOpen(false);
                    }}
                  />
                  <ExportItem
                    label="Current records (Excel)"
                    desc="Full To-Be roster"
                    onClick={() => {
                      const s = (scenarios || []).find((x) => x.id === activeScenarioId);
                      dbExportRecords(activeScenarioId, s?.name || "scenario").catch((e) =>
                        setError(e.message || "Failed to export.")
                      );
                      setExportMenuOpen(false);
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
          onSwitch={setActiveScenarioId}
          onCreate={handleCreateScenario}
          onRename={handleRenameScenario}
          onDelete={handleDeleteScenario}
          onPromote={handlePromote}
          onCompare={openCompare}
          onReset={handleReset}
          onUndo={handleUndo}
        />
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

      {/* Global card hover style (single instance instead of per-card) */}
      <style>{`.org-node-card:hover .org-node-toolbar{opacity:1;pointer-events:auto}`}</style>

      {/* Body: canvas + detail panel (panel floats so it never squeezes the canvas) */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 400, position: "relative" }}>
        <div
          ref={viewportRef}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
          onWheel={onWheel}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            cursor: "grab",
            background: `radial-gradient(circle at 20px 20px, #e2e8ee 1px, transparent 1px)`,
            backgroundSize: "30px 30px",
          }}
          onClick={(e) => {
            if (!e.target.closest(".org-node-card")) setSelectedId(null);
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
              {index.roots.concat(
                Array.from(index.childrenByParent.keys())
              ).map((parentId) => {
                const pPos = layout.nodes.get(parentId);
                if (!pPos) return null;
                const kids = (index.childrenByParent.get(parentId) || []);
                const visibleKids = kids.filter((cid) => layout.nodes.get(cid));
                if (!visibleKids.length) return null;
                const childPositions = visibleKids.map((cid) => layout.nodes.get(cid));
                const d = stepPath(pPos, childPositions);
                if (!d) return null;
                return (
                  <path
                    key={`conn-${parentId}`}
                    d={d}
                    stroke={AM.navy}
                    strokeOpacity={0.4}
                    strokeWidth={1.5}
                    fill="none"
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>

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
                  editMode={editMode}
                  empCol={empCol}
                  jobTitleCol={jobTitleCol}
                  fteCol={fteCol}
                  flcCol={flcCol}
                  countryCol={countryCol}
                  onSelect={setSelectedId}
                  onStartEdit={(eid) => setSelectedId(eid)}
                  onFlagToggle={handleFlag}
                  onAddChild={(eid) => setAddChildFor(eid)}
                  onCollapseToggle={(eid) => {
                    setCollapsed((prev) => {
                      const n = new Set(prev);
                      n.has(eid) ? n.delete(eid) : n.add(eid);
                      return n;
                    });
                  }}
                  collapsed={isCollapsed}
                  hasChildren={kids.length > 0}
                  hiddenCount={hiddenCount}
                  activeDragId={activeDragId}
                  dragDescendants={dragDescendantsRef.current}
                  dragOldParentLevel={dragOldParentLevel}
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
            onClose={() => setSelectedId(null)}
            onSave={handleEdit}
            onFlagToggle={handleFlag}
          />
        )}
      </div>

      <OrgImpactStrip summary={summary} changes={changeLog} />

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
      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>
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
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    padding: 40,
    textAlign: "center",
  };
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
