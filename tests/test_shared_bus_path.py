"""
Parity test: asserts that _shared_bus_path produces identical SVG path strings
to the shared fixture.  The JS sibling sharedBusPath.test.mjs runs the same
fixture against stepPath -- if either drifts, one test fails.

Run:  python tests/test_shared_bus_path.py
"""

import json
import os
import sys

# Make the backend package importable
backend_root = os.path.join(
    os.path.dirname(__file__),
    "..",
    "org_lvl_analysis_backend",
    "org_lvl_analysis_backend",
)
sys.path.insert(0, os.path.abspath(backend_root))

from services.orgchart_render_service import _shared_bus_path  # noqa: E402

fixture_path = os.path.join(
    os.path.dirname(__file__), "fixtures", "shared_bus_paths.json"
)
with open(fixture_path, "r", encoding="utf-8") as f:
    fixture = json.load(f)

passed = 0
failed = 0

for tc in fixture["cases"]:
    parent = (tc["parent"]["x"], tc["parent"]["y"])
    children = [(c["x"], c["y"]) for c in tc["children"]]
    result = _shared_bus_path(parent, children)
    expected = tc["expected"]
    if result == expected:
        print(f"  PASS: {tc['name']}")
        passed += 1
    else:
        print(f"  FAIL: {tc['name']}")
        print(f"    expected: {expected!r}")
        print(f"    got:      {result!r}")
        failed += 1

print(f"\n{passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)
