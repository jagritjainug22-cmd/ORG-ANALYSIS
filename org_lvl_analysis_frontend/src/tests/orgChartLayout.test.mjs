/**
 * Unit tests for orgChartLayout pure functions:
 *   - isDownwardDrop
 *   - isSignificantMove
 *   - computeSubtreeStats (with flagged nodes)
 *   - handleFlag cascade at data layer (collectDescendants)
 *
 * Run: node --experimental-vm-modules src/tests/orgChartLayout.test.mjs
 */

import {
  buildIndex,
  collectDescendants,
  computeSubtreeStats,
  isDownwardDrop,
  isSignificantMove,
  SIGNIFICANT_MOVE_SUBTREE_SIZE,
  SIGNIFICANT_MOVE_LEVEL_DELTA,
} from "../components/orgchart/orgChartLayout.js";

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// 16-node fixture (used for multi-reason and cascade tests)
// ---------------------------------------------------------------------------

function make16NodeFixture() {
  return [
    { __emp_id: "CEO", __mgr_id: null, Level: 1, Department: "Exec", FLC: 500000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "VP-Eng", __mgr_id: "CEO", Level: 2, Department: "Engineering", FLC: 300000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dir-FE", __mgr_id: "VP-Eng", Level: 3, Department: "Engineering", FLC: 200000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev1", __mgr_id: "Dir-FE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev2", __mgr_id: "Dir-FE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev3", __mgr_id: "Dir-FE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev8", __mgr_id: "Dir-FE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dir-BE", __mgr_id: "VP-Eng", Level: 3, Department: "Engineering", FLC: 200000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev4", __mgr_id: "Dir-BE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev5", __mgr_id: "Dir-BE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev6", __mgr_id: "Dir-BE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Dev7", __mgr_id: "Dir-BE", Level: 4, Department: "Engineering", FLC: 100000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "VP-Sales", __mgr_id: "CEO", Level: 2, Department: "Sales", FLC: 300000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Mgr-East", __mgr_id: "VP-Sales", Level: 3, Department: "Sales", FLC: 150000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Rep1", __mgr_id: "Mgr-East", Level: 4, Department: "Sales", FLC: 80000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "Mgr-West", __mgr_id: "VP-Sales", Level: 3, Department: "Sales", FLC: 150000, FTE: 1, is_flagged_removed: false },
    { __emp_id: "CFO", __mgr_id: "CEO", Level: 2, Department: "Finance", FLC: 350000, FTE: 1, is_flagged_removed: false },
  ];
}

const idOf = (r) => r.__emp_id;
const parentOf = (r) => r.__mgr_id;

// ===========================================================================
// 12a: isDownwardDrop
// ===========================================================================
console.log("\n--- isDownwardDrop ---");

assert(isDownwardDrop(3, 3) === false, "same level (3,3) => false");
assert(isDownwardDrop(2, 3) === false, "upward (2,3) => false");
assert(isDownwardDrop(4, 3) === true, "downward (4,3) => true");
assert(isDownwardDrop(1, 1) === false, "same level at top (1,1) => false");
assert(isDownwardDrop(0, 0) === false, "both zero => false");
assert(isDownwardDrop(7, 1) === true, "big downward (7,1) => true");
assert(isDownwardDrop(1, 7) === false, "big upward (1,7) => false");

// ===========================================================================
// 12a: isSignificantMove
// ===========================================================================
console.log("\n--- isSignificantMove ---");

// --- Isolated fixtures: each tests one significance reason at a time ---

// Subtree-size only: synthetic fixture with 11 descendants under "Boss"
{
  const sizeFixture = [
    { __emp_id: "Root", __mgr_id: null, Level: 1, Department: "A", FLC: 100 },
    { __emp_id: "Boss", __mgr_id: "Root", Level: 2, Department: "A", FLC: 100 },
    ...Array.from({ length: 11 }, (_, i) => ({
      __emp_id: `W${i}`, __mgr_id: "Boss", Level: 3, Department: "A", FLC: 50,
    })),
    { __emp_id: "Target", __mgr_id: "Root", Level: 2, Department: "A", FLC: 100 },
  ];
  const idx = buildIndex(sizeFixture, idOf, parentOf);
  const result = isSignificantMove("Boss", "Target", idx);
  assert(result.significant === true, "subtree-size: 11 descendants triggers");
  assert(result.reasons.length === 1, "subtree-size: exactly one reason");
  assert(result.reasons[0].startsWith("subtree-size:"), "subtree-size: reason prefix correct");
}

// Subtree-size below threshold: only 5 descendants
{
  const smallFixture = [
    { __emp_id: "Root", __mgr_id: null, Level: 1, Department: "A", FLC: 100 },
    { __emp_id: "Boss", __mgr_id: "Root", Level: 2, Department: "A", FLC: 100 },
    ...Array.from({ length: 5 }, (_, i) => ({
      __emp_id: `W${i}`, __mgr_id: "Boss", Level: 3, Department: "A", FLC: 50,
    })),
    { __emp_id: "Target", __mgr_id: "Root", Level: 2, Department: "A", FLC: 100 },
  ];
  const idx = buildIndex(smallFixture, idOf, parentOf);
  const result = isSignificantMove("Boss", "Target", idx);
  assert(result.significant === false, "subtree-size: 5 descendants does not trigger");
  assertEq(result.reasons, [], "subtree-size: no reasons");
}

// Cross-function only: src in Dept A, target in Dept B, same level parents
{
  const funcFixture = [
    { __emp_id: "Root", __mgr_id: null, Level: 1, Department: "X", FLC: 100 },
    { __emp_id: "MgrA", __mgr_id: "Root", Level: 2, Department: "Alpha", FLC: 100 },
    { __emp_id: "Leaf", __mgr_id: "MgrA", Level: 3, Department: "Alpha", FLC: 50 },
    { __emp_id: "MgrB", __mgr_id: "Root", Level: 2, Department: "Beta", FLC: 100 },
  ];
  const idx = buildIndex(funcFixture, idOf, parentOf);
  const result = isSignificantMove("Leaf", "MgrB", idx);
  assert(result.significant === true, "cross-function: triggers");
  assert(result.reasons.length === 1, "cross-function: exactly one reason");
  assert(result.reasons[0].startsWith("cross-function:"), "cross-function: reason prefix");
  assert(result.reasons[0].includes("Alpha") && result.reasons[0].includes("Beta"),
    "cross-function: mentions both departments");
}

// Level-jump only: move from L3 parent to L1 parent (delta = 2)
{
  const levelFixture = [
    { __emp_id: "CEO", __mgr_id: null, Level: 1, Department: "X", FLC: 500 },
    { __emp_id: "Dir", __mgr_id: "CEO", Level: 3, Department: "X", FLC: 200 },
    { __emp_id: "Leaf", __mgr_id: "Dir", Level: 4, Department: "X", FLC: 100 },
  ];
  const idx = buildIndex(levelFixture, idOf, parentOf);
  const result = isSignificantMove("Leaf", "CEO", idx);
  assert(result.significant === true, "level-jump: delta=2 triggers (L3->L1)");
  assert(result.reasons.length === 1, "level-jump: exactly one reason");
  assert(result.reasons[0].startsWith("level-jump:"), "level-jump: reason prefix");
}

// Level-jump below threshold: delta = 1
{
  const noJumpFixture = [
    { __emp_id: "CEO", __mgr_id: null, Level: 1, Department: "X", FLC: 500 },
    { __emp_id: "VP", __mgr_id: "CEO", Level: 2, Department: "X", FLC: 300 },
    { __emp_id: "Dir", __mgr_id: "VP", Level: 3, Department: "X", FLC: 200 },
    { __emp_id: "Leaf", __mgr_id: "Dir", Level: 4, Department: "X", FLC: 100 },
  ];
  const idx = buildIndex(noJumpFixture, idOf, parentOf);
  const result = isSignificantMove("Leaf", "VP", idx);
  assert(result.significant === false, "level-jump: delta=1 does not trigger");
  assertEq(result.reasons, [], "level-jump: no reasons for delta=1");
}

// No triggers: same dept, same parent level, < 10 descendants
{
  const records = make16NodeFixture();
  const idx = buildIndex(records, idOf, parentOf);
  const result = isSignificantMove("Dev1", "Dir-BE", idx);
  assert(result.significant === false, "no triggers: Dev1 to Dir-BE");
  assertEq(result.reasons, [], "no triggers: empty reasons");
}

// All three combined (use 16-node fixture)
{
  const records = make16NodeFixture();
  const idx = buildIndex(records, idOf, parentOf);
  const result = isSignificantMove("VP-Eng", "CFO", idx);
  assert(result.significant === true, "combined: VP-Eng to CFO triggers");
  const hasSize = result.reasons.some((r) => r.startsWith("subtree-size:"));
  const hasFunc = result.reasons.some((r) => r.startsWith("cross-function:"));
  assert(hasSize, "combined: subtree-size reason present (VP-Eng has 10 desc)");
  assert(hasFunc, "combined: cross-function reason present (Eng->Finance)");
}

// Edge: missing Department field
{
  const noDeptFixture = [
    { __emp_id: "A", __mgr_id: null, Level: 1, FLC: 100 },
    { __emp_id: "B", __mgr_id: "A", Level: 2, FLC: 100 },
  ];
  const idx = buildIndex(noDeptFixture, idOf, parentOf);
  const result = isSignificantMove("B", "A", idx);
  assert(result.significant === false, "missing dept: no cross-function trigger");
}

// Edge: root node (no parent) -- oldMgrLevel defaults to targetLevel => delta=0
{
  const records = make16NodeFixture();
  const idx = buildIndex(records, idOf, parentOf);
  const result = isSignificantMove("CEO", "VP-Sales", idx);
  const hasLevelJump = result.reasons.some((r) => r.startsWith("level-jump:"));
  assert(!hasLevelJump, "root node: no level-jump for root (no parent)");
}

// Edge: null __mgr_id -- handled gracefully
{
  const nullMgrFixture = [
    { __emp_id: "Orphan", __mgr_id: null, Level: 3, Department: "X", FLC: 100 },
    { __emp_id: "Target", __mgr_id: null, Level: 2, Department: "X", FLC: 200 },
  ];
  const idx = buildIndex(nullMgrFixture, idOf, parentOf);
  const result = isSignificantMove("Orphan", "Target", idx);
  assert(typeof result.significant === "boolean", "null mgr: returns valid result");
}

// ===========================================================================
// 12c: handleFlag cascade at data layer (collectDescendants)
// ===========================================================================
console.log("\n--- Flag cascade (data layer) ---");

{
  const records = make16NodeFixture();
  const idx = buildIndex(records, idOf, parentOf);

  // Flag Dir-FE => affected = Dir-FE + Dev1,2,3,8
  const dirFESubtree = collectDescendants("Dir-FE", idx.childrenByParent);
  assertEq(dirFESubtree.size, 5, "Dir-FE subtree: 5 nodes (self + 4 devs)");
  assert(dirFESubtree.has("Dir-FE"), "Dir-FE subtree includes Dir-FE");
  assert(dirFESubtree.has("Dev1"), "Dir-FE subtree includes Dev1");
  assert(dirFESubtree.has("Dev2"), "Dir-FE subtree includes Dev2");
  assert(dirFESubtree.has("Dev3"), "Dir-FE subtree includes Dev3");
  assert(dirFESubtree.has("Dev8"), "Dir-FE subtree includes Dev8");
  assert(!dirFESubtree.has("Dev4"), "Dir-FE subtree excludes Dev4");
  assert(!dirFESubtree.has("VP-Eng"), "Dir-FE subtree excludes VP-Eng");

  // Flag CEO => all 17 nodes
  const ceoSubtree = collectDescendants("CEO", idx.childrenByParent);
  assertEq(ceoSubtree.size, 17, "CEO subtree: all 17 nodes");

  // Flag leaf Dev1 => only Dev1
  const leafSubtree = collectDescendants("Dev1", idx.childrenByParent);
  assertEq(leafSubtree.size, 1, "Dev1 (leaf) subtree: 1 node");
  assert(leafSubtree.has("Dev1"), "Dev1 subtree includes Dev1");

  // Simulate: flag Dev1, flag Dir-FE, unflag Dir-FE => Dev1 unflagged (v1)
  let recs = records.map((r) => ({ ...r }));
  // Step 1: flag Dev1
  const dev1Sub = collectDescendants("Dev1", idx.childrenByParent);
  recs = recs.map((r) => dev1Sub.has(r.__emp_id) ? { ...r, is_flagged_removed: true } : r);
  assert(recs.find((r) => r.__emp_id === "Dev1").is_flagged_removed === true, "cascade v1: Dev1 flagged after step 1");

  // Step 2: flag Dir-FE
  recs = recs.map((r) => dirFESubtree.has(r.__emp_id) ? { ...r, is_flagged_removed: true } : r);
  assert(recs.find((r) => r.__emp_id === "Dir-FE").is_flagged_removed === true, "cascade v1: Dir-FE flagged after step 2");

  // Step 3: unflag Dir-FE => all descendants unflagged, including Dev1
  recs = recs.map((r) => dirFESubtree.has(r.__emp_id) ? { ...r, is_flagged_removed: false } : r);
  assert(recs.find((r) => r.__emp_id === "Dev1").is_flagged_removed === false, "cascade v1: Dev1 unflagged after parent unflag");
  assert(recs.find((r) => r.__emp_id === "Dir-FE").is_flagged_removed === false, "cascade v1: Dir-FE unflagged");
  assert(recs.find((r) => r.__emp_id === "Dev4").is_flagged_removed === false, "cascade v1: Dev4 unaffected");
}

// ===========================================================================
// 12e: computeSubtreeStats with flagged nodes
// ===========================================================================
console.log("\n--- computeSubtreeStats with flags ---");

{
  const records = make16NodeFixture();

  // All unflagged: CEO total cost = 3,030,000
  const stats0 = computeSubtreeStats(records, idOf, parentOf, {
    fteOf: (r) => r.FTE,
    flcOf: (r) => r.FLC,
    flaggedOf: (r) => !!r.is_flagged_removed,
  });
  assertEq(stats0.get("CEO").cost, 3030000, "unflagged: CEO total cost = 3.03M");
  assertEq(stats0.get("CEO").headcount, 17, "unflagged: CEO headcount = 17");

  // Flag Dir-FE and descendants (Dir-FE, Dev1, Dev2, Dev3, Dev8)
  const flaggedRecs = records.map((r) =>
    ["Dir-FE", "Dev1", "Dev2", "Dev3", "Dev8"].includes(r.__emp_id)
      ? { ...r, is_flagged_removed: true }
      : r
  );
  const stats1 = computeSubtreeStats(flaggedRecs, idOf, parentOf, {
    fteOf: (r) => r.FTE,
    flcOf: (r) => r.FLC,
    flaggedOf: (r) => !!r.is_flagged_removed,
  });
  // Dir-FE subtree cost = 200k + 4*100k = 600k. CEO should drop by 600k.
  assertEq(stats1.get("CEO").cost, 3030000 - 600000, "flagged Dir-FE: CEO cost drops by 600k");
  assertEq(stats1.get("VP-Eng").cost, 300000 + 200000 + 400000, "flagged Dir-FE: VP-Eng cost = 900k (self + Dir-BE subtree)");
  assertEq(stats1.get("VP-Eng").headcount, 6, "flagged Dir-FE: VP-Eng headcount = 6 (11 - 5 flagged)");
  assertEq(stats1.get("Dir-FE").cost, 0, "flagged Dir-FE: Dir-FE own cost = 0");
  assertEq(stats1.get("Dir-FE").headcount, 0, "flagged Dir-FE: Dir-FE headcount = 0");

  // Flag CEO and all descendants
  const allFlagged = records.map((r) => ({ ...r, is_flagged_removed: true }));
  const stats2 = computeSubtreeStats(allFlagged, idOf, parentOf, {
    fteOf: (r) => r.FTE,
    flcOf: (r) => r.FLC,
    flaggedOf: (r) => !!r.is_flagged_removed,
  });
  assertEq(stats2.get("CEO").cost, 0, "all flagged: CEO cost = 0");
  assertEq(stats2.get("CEO").headcount, 0, "all flagged: CEO headcount = 0");

  // Flag single leaf Dev1
  const leafFlagged = records.map((r) =>
    r.__emp_id === "Dev1" ? { ...r, is_flagged_removed: true } : r
  );
  const stats3 = computeSubtreeStats(leafFlagged, idOf, parentOf, {
    fteOf: (r) => r.FTE,
    flcOf: (r) => r.FLC,
    flaggedOf: (r) => !!r.is_flagged_removed,
  });
  assertEq(stats3.get("CEO").cost, 3030000 - 100000, "flag Dev1: CEO cost drops by 100k");
}

// ===========================================================================
// buildIndex: true roots vs broken manager refs
// ===========================================================================
console.log("\n--- buildIndex roots vs brokenRefs ---");

{
  const fixture = [
    { __emp_id: "CEO", __mgr_id: null },
    { __emp_id: "VP", __mgr_id: "CEO" },
    { __emp_id: "Orphan", __mgr_id: "MISSING-BOSS" },
    { __emp_id: "OrphanReport", __mgr_id: "Orphan" },
    { __emp_id: "BlankMgr", __mgr_id: "" },
    { __emp_id: "SpaceMgr", __mgr_id: "   " },
  ];
  const idx = buildIndex(fixture, idOf, parentOf);

  assert(idx.roots.includes("CEO"), "null mgr => true root");
  assert(idx.roots.includes("BlankMgr"), "empty-string mgr => true root");
  assert(idx.roots.includes("SpaceMgr"), "whitespace mgr => true root");
  assert(!idx.roots.includes("Orphan"), "missing mgr id must NOT be a main root");
  assert(!idx.roots.includes("VP"), "valid child is not a root");
  assert(!idx.roots.includes("OrphanReport"), "child of broken-ref is not a root");

  assert(idx.brokenRefs.includes("Orphan"), "missing mgr id => brokenRefs");
  assert(!idx.brokenRefs.includes("CEO"), "true root not in brokenRefs");
  assert(!idx.brokenRefs.includes("OrphanReport"), "valid parent link not in brokenRefs");

  assertEq(idx.childrenByParent.get("CEO"), ["VP"], "CEO children");
  assertEq(idx.childrenByParent.get("Orphan"), ["OrphanReport"], "broken-ref keeps its reports");
}

// ===========================================================================
// Summary
// ===========================================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
