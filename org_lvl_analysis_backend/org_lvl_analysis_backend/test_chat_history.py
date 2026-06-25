"""
Ask OrgSight — Conversation History Test Suite
================================================

Fires a sequence of queries against the /chat/message endpoint,
accumulating history between turns to test:
  - Follow-up reference resolution ("break that down by…")
  - Pronoun resolution ("what about the UK?")
  - Refinement ("now filter that to managers only")
  - Context continuity ("how does that compare to…")

Usage:
    python test_chat_history.py [--base-url URL] [--username USER] [--password PASS]
                                [--project-id PID] [--dataset-id DID] [--scenario-id SID]

Defaults assume a local dev server on port 8001 with user jagrit.m.
"""

import argparse
import json
import sys
import time
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_BASE = "http://127.0.0.1:8001"
DEFAULT_USER = "jagrit.m"
DEFAULT_PASS = "32jaincolony"
DEFAULT_PROJECT = 1
DEFAULT_DATASET = 4
DEFAULT_SCENARIO = 5

# ---------------------------------------------------------------------------
# Colour helpers (works on Windows 10+ and all Unix terminals)
# ---------------------------------------------------------------------------

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def _header(text: str) -> None:
    print(f"\n{BOLD}{CYAN}{'=' * 70}")
    print(f"  {text}")
    print(f"{'=' * 70}{RESET}\n")


def _step(n: int, total: int, query: str) -> None:
    print(f"{BOLD}[{n}/{total}]{RESET} {YELLOW}{query}{RESET}")


def _result(response: dict, elapsed: float) -> None:
    source = response.get("source", "?")
    sql = response.get("sql")
    row_count = response.get("row_count", 0)
    intent = response.get("intent", {})
    text = response.get("response", "")

    print(f"  {DIM}Intent: {intent.get('intent', '?')} | Route: {intent.get('route', '?')} | "
          f"Tool: {intent.get('tool_name', '?')} | Source: {source} | "
          f"Rows: {row_count} | Time: {elapsed:.1f}s{RESET}")
    if sql:
        sql_short = sql.replace("\n", " ")[:120]
        print(f"  {DIM}SQL: {sql_short}{'…' if len(sql) > 120 else ''}{RESET}")
    print(f"  {GREEN}{text[:300]}{'…' if len(text) > 300 else ''}{RESET}")
    print()


# ---------------------------------------------------------------------------
# Test scenarios — realistic multi-turn conversations
# ---------------------------------------------------------------------------

SCENARIOS = [
    {
        "name": "Scenario 1: Drill-Down from Overview",
        "description": "Start broad, then drill into specifics step by step",
        "queries": [
            "Give me an overview of the org",
            "Which country has the most employees?",
            "What about their average cost?",
            "Break that down by level",
            "Show me the managers in that country with fewer than 3 direct reports",
        ],
    },
    {
        "name": "Scenario 2: Cost Deep-Dive with Follow-Ups",
        "description": "Cost analysis with progressive refinement",
        "queries": [
            "What is the total fully loaded cost of the org?",
            "How is that split between managers and individual contributors?",
            "Which level has the highest cost concentration?",
            "Now show me the top 5 most expensive employees",
            "Who do they report to?",
        ],
    },
    {
        "name": "Scenario 3: Span of Control Investigation",
        "description": "Span analysis with contextual follow-ups",
        "queries": [
            "What is the average span of control?",
            "How does that compare to the industry benchmark?",
            "Show me managers with only 1 direct report",
            "What would we save if we removed those managers?",
            "Which business unit has the most of them?",
        ],
    },
    {
        "name": "Scenario 4: Pronoun Resolution Stress Test",
        "description": "Heavy use of 'that', 'those', 'them', 'it'",
        "queries": [
            "How many employees are at level 3?",
            "What is their average cost?",
            "How many of them are managers?",
            "List those managers",
            "Sort them by cost descending",
        ],
    },
    {
        "name": "Scenario 5: Switching Topics Mid-Conversation",
        "description": "Topic changes to test context doesn't over-anchor",
        "queries": [
            "Show headcount by country",
            "What grades do we have in the org?",
            "Going back to country — which one has the highest cost per FTE?",
            "Now tell me about the hierarchy — how many levels deep is the org?",
            "Which L2 leader has the deepest org beneath them?",
        ],
    },
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def login(session: requests.Session, base: str, username: str, password: str) -> str:
    r = session.post(f"{base}/auth/login", json={"username": username, "password": password})
    if r.status_code != 200:
        print(f"{RED}Login failed: {r.status_code} {r.text}{RESET}")
        sys.exit(1)
    token = r.json()["access_token"]
    session.headers["Authorization"] = f"Bearer {token}"
    print(f"{GREEN}Logged in as {username}{RESET}")
    return token


def init_duckdb(session: requests.Session, base: str, project_id: int,
                dataset_id: int, scenario_id: int) -> None:
    r = session.post(
        f"{base}/projects/{project_id}/chat/init",
        json={"dataset_id": dataset_id, "scenario_id": scenario_id},
    )
    if r.status_code != 200:
        print(f"{RED}DuckDB init failed: {r.status_code} {r.text}{RESET}")
        sys.exit(1)
    data = r.json()
    print(f"{GREEN}DuckDB loaded: {data.get('row_count', '?')} rows, "
          f"{data.get('column_count', '?')} columns | "
          f"Status: {data.get('status')}{RESET}")


def run_scenario(session: requests.Session, base: str, project_id: int,
                 dataset_id: int, scenario_id: int, scenario: dict) -> dict:
    """Run a single conversation scenario, accumulating history."""
    _header(scenario["name"])
    print(f"  {DIM}{scenario['description']}{RESET}\n")

    history = []
    results = {"name": scenario["name"], "turns": []}
    queries = scenario["queries"]

    for i, query in enumerate(queries, 1):
        _step(i, len(queries), query)

        t0 = time.time()
        r = session.post(
            f"{base}/projects/{project_id}/chat/message",
            json={
                "message": query,
                "dataset_id": dataset_id,
                "scenario_id": scenario_id,
                "history": history,
            },
        )
        elapsed = time.time() - t0

        if r.status_code != 200:
            print(f"  {RED}ERROR {r.status_code}: {r.text[:200]}{RESET}\n")
            results["turns"].append({
                "query": query, "status": "error",
                "error": r.text[:200], "elapsed_s": round(elapsed, 2),
            })
            # Still add to history as a failed turn so context is preserved
            history.append({"role": "user", "content": query})
            history.append({
                "role": "assistant",
                "content": f"Error: {r.text[:100]}",
            })
            continue

        resp = r.json()
        _result(resp, elapsed)

        turn_record = {
            "query": query,
            "status": "ok",
            "intent": resp.get("intent", {}).get("intent"),
            "route": resp.get("intent", {}).get("route"),
            "tool": resp.get("intent", {}).get("tool_name"),
            "source": resp.get("source"),
            "sql": resp.get("sql"),
            "row_count": resp.get("row_count", 0),
            "response_preview": resp.get("response", "")[:200],
            "elapsed_s": round(elapsed, 2),
        }
        results["turns"].append(turn_record)

        # Build history entries for the next turn
        data_summary = None
        if resp.get("row_count", 0) > 0:
            cols = resp.get("columns", [])
            data_summary = f"{resp['row_count']} rows, columns: {', '.join(cols[:8])}"
            if len(cols) > 8:
                data_summary += f" (+{len(cols)-8} more)"

        history.append({"role": "user", "content": query})
        history.append({
            "role": "assistant",
            "content": resp.get("response", ""),
            "sql": resp.get("sql"),
            "data_summary": data_summary,
        })

    return results


def main():
    parser = argparse.ArgumentParser(description="Ask OrgSight conversation history test suite")
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    parser.add_argument("--username", default=DEFAULT_USER)
    parser.add_argument("--password", default=DEFAULT_PASS)
    parser.add_argument("--project-id", type=int, default=DEFAULT_PROJECT)
    parser.add_argument("--dataset-id", type=int, default=DEFAULT_DATASET)
    parser.add_argument("--scenario-id", type=int, default=DEFAULT_SCENARIO)
    parser.add_argument("--scenario", type=int, default=None,
                        help="Run only scenario N (1-based index)")
    parser.add_argument("--save-json", default=None,
                        help="Save full results to a JSON file")
    args = parser.parse_args()

    session = requests.Session()

    _header("Ask OrgSight — Conversation History Test Suite")

    # Step 1: Login
    login(session, args.base_url, args.username, args.password)

    # Step 2: Init DuckDB
    init_duckdb(session, args.base_url, args.project_id, args.dataset_id, args.scenario_id)

    # Step 3: Run scenarios
    scenarios_to_run = SCENARIOS
    if args.scenario is not None:
        idx = args.scenario - 1
        if 0 <= idx < len(SCENARIOS):
            scenarios_to_run = [SCENARIOS[idx]]
        else:
            print(f"{RED}Invalid scenario index {args.scenario}. Valid: 1-{len(SCENARIOS)}{RESET}")
            sys.exit(1)

    all_results = []
    total_turns = 0
    total_ok = 0
    total_errors = 0
    t_start = time.time()

    for scenario in scenarios_to_run:
        result = run_scenario(
            session, args.base_url, args.project_id,
            args.dataset_id, args.scenario_id, scenario,
        )
        all_results.append(result)
        for t in result["turns"]:
            total_turns += 1
            if t["status"] == "ok":
                total_ok += 1
            else:
                total_errors += 1

    total_time = time.time() - t_start

    # Step 4: Summary
    _header("Test Summary")
    print(f"  Scenarios run:  {len(scenarios_to_run)}")
    print(f"  Total turns:    {total_turns}")
    print(f"  Successful:     {GREEN}{total_ok}{RESET}")
    print(f"  Errors:         {RED}{total_errors}{RESET}")
    print(f"  Total time:     {total_time:.1f}s")
    print(f"  Avg per turn:   {total_time / max(total_turns, 1):.1f}s")
    print()

    # Step 5: Save JSON if requested
    if args.save_json:
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump(all_results, f, indent=2, default=str)
        print(f"  {GREEN}Results saved to {args.save_json}{RESET}")


if __name__ == "__main__":
    main()
