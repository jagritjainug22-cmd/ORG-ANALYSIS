/**
 * Parity test: asserts that stepPath produces identical SVG path strings to
 * the shared fixture.  The Python sibling test_shared_bus_path.py runs the
 * same fixture against _shared_bus_path — if either drifts, one test fails.
 *
 * Run:  node tests/sharedBusPath.test.mjs
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the function under test (ESM, relative path to the source)
const layoutPath = join(
  __dirname,
  "..",
  "org_lvl_analysis_frontend",
  "org_lvl_analysis_frontend",
  "src",
  "components",
  "orgchart",
  "orgChartLayout.js"
);

const { stepPath } = await import("file://" + layoutPath.replace(/\\/g, "/"));

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "shared_bus_paths.json"), "utf-8")
);

let passed = 0;
let failed = 0;

for (const tc of fixture.cases) {
  const result = stepPath(tc.parent, tc.children);
  if (result === tc.expected) {
    console.log(`  PASS: ${tc.name}`);
    passed++;
  } else {
    console.error(`  FAIL: ${tc.name}`);
    console.error(`    expected: ${JSON.stringify(tc.expected)}`);
    console.error(`    got:      ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
