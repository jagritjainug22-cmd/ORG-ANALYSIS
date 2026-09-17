import { useState, useEffect, useCallback, useMemo } from "react";

/**
 * Shared "ignore validation issue" state — used by the ValidationSidebar
 * (list + ignore all), the OrgDetailPanel (per-card ignore), and the
 * BulkActionBar (multi-select clear). Ignored issues are remembered per
 * dataset/scenario in localStorage so the chart stays "clean" across reloads
 * without requiring the underlying data problem to actually be fixed.
 *
 * Nothing is deleted — ignoring only affects what's *displayed* (badges,
 * counts, banners). `restoreAll` brings everything back.
 */
export function issueKey(empId, issue) {
  return `${empId}::${issue.type}::${issue.description}`;
}

export function useIgnoredIssues(storageKey = "default") {
  const lsKey = `orgchart_ignored_issues::${storageKey}`;
  const [ignoredKeys, setIgnoredKeys] = useState(() => new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      setIgnoredKeys(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setIgnoredKeys(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey]);

  const persist = useCallback((nextSet) => {
    setIgnoredKeys(nextSet);
    try {
      localStorage.setItem(lsKey, JSON.stringify([...nextSet]));
    } catch {
      /* ignore storage failures (e.g. private mode / quota) */
    }
  }, [lsKey]);

  const isIgnored = useCallback(
    (empId, issue) => ignoredKeys.has(issueKey(empId, issue)),
    [ignoredKeys]
  );

  const ignoreIssue = useCallback((empId, issue) => {
    setIgnoredKeys((prev) => {
      const next = new Set(prev);
      next.add(issueKey(empId, issue));
      try { localStorage.setItem(lsKey, JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }, [lsKey]);

  /** pairs: Array<{ empId, issue }> */
  const ignoreMany = useCallback((pairs) => {
    setIgnoredKeys((prev) => {
      const next = new Set(prev);
      for (const { empId, issue } of pairs) next.add(issueKey(empId, issue));
      try { localStorage.setItem(lsKey, JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }, [lsKey]);

  const restoreIssue = useCallback((empId, issue) => {
    setIgnoredKeys((prev) => {
      const next = new Set(prev);
      next.delete(issueKey(empId, issue));
      try { localStorage.setItem(lsKey, JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }, [lsKey]);

  const restoreAll = useCallback(() => persist(new Set()), [persist]);

  /**
   * Given the raw nodeIssuesMap (empId -> Issue[] without empId attached),
   * returns a new Map with ignored issues stripped out — the single source
   * of truth every consumer (sidebar, node badges, detail panel) should
   * render from so "ignore" actually makes the chart look clean everywhere.
   */
  const filterIssuesMap = useCallback((nodeIssuesMap) => {
    if (!nodeIssuesMap || nodeIssuesMap.size === 0 || ignoredKeys.size === 0) return nodeIssuesMap;
    const next = new Map();
    for (const [empId, issues] of nodeIssuesMap) {
      const visible = issues.filter((issue) => !ignoredKeys.has(issueKey(empId, issue)));
      if (visible.length > 0) next.set(empId, visible);
    }
    return next;
  }, [ignoredKeys]);

  return { ignoredKeys, isIgnored, ignoreIssue, ignoreMany, restoreIssue, restoreAll, filterIssuesMap };
}

/**
 * Convenience hook: derives the visible (non-ignored) issues map from a raw
 * nodeIssuesMap + the ignore state. Memoized so it only recomputes when the
 * underlying map or ignore set actually changes.
 */
export function useVisibleIssuesMap(nodeIssuesMap, filterIssuesMap) {
  return useMemo(() => filterIssuesMap(nodeIssuesMap), [nodeIssuesMap, filterIssuesMap]);
}
