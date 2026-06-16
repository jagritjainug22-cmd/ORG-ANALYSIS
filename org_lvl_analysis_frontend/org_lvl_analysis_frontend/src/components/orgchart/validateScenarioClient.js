/**
 * Client-side scenario validation.
 *
 * Runs entirely in-browser on the optimistic records array after each
 * mutation — no API call needed.
 *
 * Returns a Map<empId:string, Issue[]> where each Issue is:
 *   { type, severity, description, relatedEmpIds }
 *
 * Severity values: "error" | "warning"
 */

/**
 * @param {Array}  records  - OrgChart records array (with __emp_id, __mgr_id,
 *                            is_flagged_removed, is_added fields)
 * @param {Object} opts
 * @param {string} opts.empCol - column key for employee ID (fallback)
 * @param {string} opts.mgrCol - column key for manager ID (fallback)
 * @returns {Map<string, Array>}
 */
export function validateRecordsClient(records, { empCol, mgrCol } = {}) {
  const issuesMap = new Map(); // empId -> Issue[]

  const addIssue = (empId, type, severity, description, relatedEmpIds = []) => {
    const key = String(empId);
    if (!issuesMap.has(key)) issuesMap.set(key, []);
    issuesMap.get(key).push({ type, severity, description, relatedEmpIds });
  };

  if (!records || records.length === 0) return issuesMap;

  // Build lookup structures
  const allById = new Map();          // all records by empId
  const flaggedIds = new Set();
  const addedIds = new Set();

  for (const r of records) {
    const eid = String(r.__emp_id ?? r[empCol] ?? "");
    if (!eid) continue;
    allById.set(eid, r);
    if (r.is_flagged_removed) flaggedIds.add(eid);
    if (r.is_added) addedIds.add(eid);
  }

  const activeIds = new Set([...allById.keys()].filter((id) => !flaggedIds.has(id)));

  // --- Check 1: Duplicate IDs (among all active records) ---
  const seenIds = new Set();
  const dupIds = new Set();
  for (const id of activeIds) {
    if (seenIds.has(id)) dupIds.add(id);
    seenIds.add(id);
  }
  for (const id of dupIds) {
    addIssue(id, "duplicate_id", "error", `Duplicate employee ID "${id}"`, []);
  }

  // --- Check 2-6: per-record checks ---
  for (const r of records) {
    const eid = String(r.__emp_id ?? r[empCol] ?? "");
    if (!eid) continue;

    const mgrId = r.__mgr_id != null ? String(r.__mgr_id) : (r[mgrCol] != null ? String(r[mgrCol]) : "");
    const isFlagged = flaggedIds.has(eid);
    const isAdded = addedIds.has(eid);
    const isActive = activeIds.has(eid);

    // Check 2: Closed manager still has active direct reports
    if (isFlagged) {
      const activeReports = records.filter((c) => {
        const cid = String(c.__emp_id ?? c[empCol] ?? "");
        const cmgr = c.__mgr_id != null ? String(c.__mgr_id) : (c[mgrCol] != null ? String(c[mgrCol]) : "");
        return cmgr === eid && activeIds.has(cid);
      });
      if (activeReports.length > 0) {
        const relIds = activeReports.map((c) => String(c.__emp_id ?? c[empCol] ?? ""));
        addIssue(
          eid,
          "closed_manager_has_reports",
          "error",
          `Closed position has ${activeReports.length} open direct report${activeReports.length !== 1 ? "s" : ""}`,
          relIds
        );
      }
    }

    // Check 3: Orphaned position — mgr_id points to flagged or missing record
    if (isActive && mgrId) {
      const mgrRec = allById.get(mgrId);
      if (!mgrRec) {
        addIssue(
          eid,
          "orphaned_position",
          "error",
          `Manager ID "${mgrId}" does not exist in the dataset`,
          [mgrId]
        );
      } else if (flaggedIds.has(mgrId)) {
        addIssue(
          eid,
          "orphaned_position",
          "error",
          `Reports to closed position "${mgrId}"`,
          [mgrId]
        );
      }
    }

    // Check 4: Self-report
    if (isActive && mgrId && mgrId === eid) {
      addIssue(eid, "self_report", "error", "Position reports to itself", []);
    }

    // Check 5 (missing change reason): flagged or added with no reason
    if (isFlagged || isAdded) {
      const reason = (r["Change Reason"] || r["change_reason"] || "").toString().trim();
      if (!reason) {
        addIssue(
          eid,
          "missing_change_reason",
          "warning",
          `${isFlagged ? "Closed" : "Added"} position has no Change Reason`,
          []
        );
      }
    }
  }

  // --- Check 6: Circular references (only on active records) ---
  const mgrMapActive = new Map();
  for (const r of records) {
    const eid = String(r.__emp_id ?? r[empCol] ?? "");
    if (!activeIds.has(eid)) continue;
    const mgrId = r.__mgr_id != null ? String(r.__mgr_id) : (r[mgrCol] != null ? String(r[mgrCol]) : "");
    if (mgrId && activeIds.has(mgrId)) mgrMapActive.set(eid, mgrId);
  }

  const circularIds = detectCycles(mgrMapActive);
  for (const id of circularIds) {
    // Avoid duplicate if already has a circular issue
    const existing = issuesMap.get(id) || [];
    if (!existing.some((i) => i.type === "circular_reference")) {
      addIssue(id, "circular_reference", "error", "Part of a circular reporting chain", []);
    }
  }

  return issuesMap;
}

/**
 * Detect all node IDs that are part of a cycle in the manager map.
 * Uses DFS with a "currently visiting" set.
 * @param {Map<string, string>} mgrMap  empId -> mgrId
 * @returns {Set<string>}
 */
function detectCycles(mgrMap) {
  const cycleNodes = new Set();
  const confirmed = new Set(); // confirmed no cycle from this node

  for (const start of mgrMap.keys()) {
    if (confirmed.has(start) || cycleNodes.has(start)) continue;

    const path = [];       // ordered walk
    const visiting = new Map(); // node -> index in path

    let curr = start;
    while (curr && mgrMap.has(curr)) {
      if (confirmed.has(curr)) break; // safe tail

      if (visiting.has(curr)) {
        // Found the cycle entry point — mark everything from that index onward
        const cycleStart = visiting.get(curr);
        for (let i = cycleStart; i < path.length; i++) {
          cycleNodes.add(path[i]);
        }
        cycleNodes.add(curr); // the repeated node itself
        break;
      }

      visiting.set(curr, path.length);
      path.push(curr);
      curr = mgrMap.get(curr);
    }

    // Everything we walked that isn't in a cycle is confirmed safe
    for (const n of path) {
      if (!cycleNodes.has(n)) confirmed.add(n);
    }
  }

  return cycleNodes;
}

/**
 * Convenience: flatten issuesMap into a sorted array for the sidebar.
 * @param {Map} issuesMap
 * @returns {Array<{empId, type, severity, description, relatedEmpIds}>}
 */
export function flattenIssues(issuesMap) {
  const out = [];
  for (const [empId, issues] of issuesMap) {
    for (const issue of issues) {
      out.push({ empId, ...issue });
    }
  }
  // Errors first, then warnings; stable sort
  out.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });
  return out;
}
