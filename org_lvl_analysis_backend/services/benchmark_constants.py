"""
OrgSight Benchmark Constants & Tool Executor
==============================================

Benchmarks are exposed as a TOOL, not baked into the system prompt.
The LLM calls get_benchmarks(category) when it needs comparison data.

Categories:
  - span         → span of control targets and thresholds
  - layers       → org depth targets
  - management   → manager-to-IC ratios, cost % targets
  - delayering   → delayering thresholds and estimation method
  - location     → high/low cost location tiers
  - functions    → customer-facing vs support classification
  - all          → everything (use sparingly)

Usage:
    from services.benchmark_constants import BENCHMARK_TOOL, execute_get_benchmarks
"""

import json


# ---------------------------------------------------------------------------
# Structured benchmark data
# ---------------------------------------------------------------------------

BENCHMARKS = {
    "span": {
        "target_span_mixed_org": 6,
        "below_benchmark_threshold": 4,
        "above_benchmark_threshold": 12,
        "frontline_managers_ideal": "6–10 direct reports",
        "midlevel_managers_ideal": "5–7 direct reports",
        "senior_leaders_ideal": "4–6 direct reports",
        "interpretation": {
            "below_4": "Delayering candidate — manager role may not be justified",
            "4_to_5": "Below target — consider consolidating with adjacent team",
            "6_to_8": "Ideal range for most org types",
            "9_to_12": "Wide but acceptable for front-line operational roles",
            "above_12": "Overloaded — risk of inadequate oversight",
        },
    },

    "layers": {
        "max_recommended_enterprise": 7,
        "target_small_org_under_500": 5,
        "target_medium_org_500_to_5000": 6,
        "target_large_org_5000_plus": 7,
        "excessive_layering_definition": "Any level beyond the recommended maximum",
        "interpretation": {
            "at_or_below_target": "Healthy — org is appropriately flat",
            "1_above_target": "Amber — review deepest branches for consolidation",
            "2_plus_above_target": "Red — excessive layering driving cost and slowing decisions",
        },
    },

    "management": {
        "manager_to_ic_ratio_target": "1:6 (one manager per 6 individual contributors)",
        "mgr_cost_pct_of_total_target": "< 25%",
        "mgr_headcount_pct_of_total_target": "< 15%",
        "over_managed_threshold": "mgr_pct > 25% for a function or unit",
        "under_managed_threshold": "mgr_pct < 10% for a function or unit",
        "interpretation": {
            "mgr_pct_above_25": "Over-managed — too many managers relative to ICs, high overhead",
            "mgr_pct_15_to_25": "Normal range",
            "mgr_pct_below_10": "Under-managed — may indicate insufficient oversight or very flat teams",
        },
    },

    "delayering": {
        "candidate_threshold": "Managers with Span < 4",
        "estimation_method": [
            "1. Count managers with Span < benchmark threshold (default: 4)",
            "2. Sum their Fully Loaded Cost = maximum potential savings",
            "3. Apply realization factor: 60-70% (not all can be removed)",
            "4. Present as range: 'Between $X and $Y in potential savings'",
            "5. Note: specialized roles, compliance roles, and transition managers may be exceptions",
        ],
        "common_exceptions": [
            "Managers in regulatory/compliance roles (required by law)",
            "Managers in transition (team being built)",
            "Managers of highly specialized individual contributors",
            "Country managers with small local teams",
        ],
    },

    "location": {
        "high_cost_tier": [
            "USA", "UK", "Germany", "Switzerland", "Australia",
            "Singapore", "Japan", "Canada", "Netherlands", "France",
        ],
        "low_cost_tier": [
            "India", "Philippines", "Malaysia", "Vietnam", "Egypt",
            "Poland", "Romania", "Mexico", "Colombia", "South Africa",
        ],
        "guidance": (
            "Support and back-office functions in high-cost locations are "
            "candidates for offshoring or nearshoring. Customer-facing roles "
            "typically need to remain near the customer."
        ),
    },

    "functions": {
        "customer_facing": [
            "Sales", "Account Management", "Customer Success",
            "Client Delivery", "Field Operations", "Business Development",
        ],
        "support_overhead": [
            "HR", "Finance", "Legal", "IT", "Compliance",
            "Procurement", "Administration", "Facilities",
        ],
        "support_cost_target": "< 30% of total workforce cost",
        "guidance": (
            "High support function cost relative to total may indicate "
            "over-investment in overhead. Compare against the 30% benchmark."
        ),
    },
}


# ---------------------------------------------------------------------------
# Tool definition (sent to Azure OpenAI)
# ---------------------------------------------------------------------------

BENCHMARK_TOOL = {
    "type": "function",
    "function": {
        "name": "get_benchmarks",
        "description": (
            "Get A&M industry benchmark constants for organizational analysis. "
            "Call this BEFORE or AFTER running a data query when you need to compare "
            "computed metrics against industry standards. "
            "Use for: 'how do we compare', 'is this good', 'benchmark', 'industry standard', "
            "'over-managed', 'under-managed', 'efficiency', 'optimization opportunities', "
            "'what should our span be', 'are we too deep'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "categories": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["span", "layers", "management", "delayering", "location", "functions", "all"],
                    },
                    "description": (
                        "Which benchmark categories to retrieve. Pick only what's relevant. "
                        "Examples: span analysis → ['span'], delayering → ['span', 'delayering'], "
                        "full org review → ['all']."
                    ),
                },
            },
            "required": ["categories"],
        },
    },
}


# ---------------------------------------------------------------------------
# Tool executor
# ---------------------------------------------------------------------------

def execute_get_benchmarks(args: dict, ctx: dict = None) -> tuple[str, None]:
    """
    Return benchmark constants for the requested categories.
    Returns (text_for_llm, None) — no raw data for chart pairing.
    """
    categories = args.get("categories", ["all"])

    if "all" in categories:
        categories = list(BENCHMARKS.keys())

    parts = ["A&M INDUSTRY BENCHMARKS\n"]

    for cat in categories:
        if cat not in BENCHMARKS:
            parts.append(f"\n⚠ Unknown benchmark category: '{cat}'")
            continue

        data = BENCHMARKS[cat]
        parts.append(f"\n{'='*50}")
        parts.append(f"{cat.upper()} BENCHMARKS")
        parts.append(f"{'='*50}")
        parts.append(_format_benchmark(cat, data))

    parts.append(
        "\n\nWhen comparing computed metrics to these benchmarks:"
        "\n- ALWAYS state both the computed value and the benchmark"
        "\n- Use directional language: 'above/below/within benchmark range'"
        "\n- End with a concrete observation: 'This suggests...'"
    )

    return "\n".join(parts), None


def _format_benchmark(category: str, data: dict, indent: int = 0) -> str:
    """Recursively format benchmark data into readable text for the LLM."""
    lines = []
    prefix = "  " * indent

    for key, value in data.items():
        label = key.replace("_", " ").title()

        if isinstance(value, dict):
            lines.append(f"{prefix}{label}:")
            lines.append(_format_benchmark(category, value, indent + 1))
        elif isinstance(value, list):
            lines.append(f"{prefix}{label}:")
            for item in value:
                lines.append(f"{prefix}  - {item}")
        else:
            lines.append(f"{prefix}{label}: {value}")

    return "\n".join(lines)
