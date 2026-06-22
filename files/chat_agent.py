"""
Ask OrgSight Agent — the tool-use loop.

Single entry point: run_agent()

Flow:
  1. Build system prompt from live schema + benchmarks
  2. Send conversation to Azure OpenAI with 9 tool definitions
  3. If tool_call → execute tool, capture data, loop back
  4. If text → parse structured JSON response (reply + display + chart)
  5. Return complete response payload for the frontend

The LLM decides: which tool to call, whether to chain multiple tools,
what display mode to use, and what chart type fits. All routing happens
via native function calling — no separate intent classifier.
"""

import json
import logging
from openai import AzureOpenAI

from services.chat_tools import ALL_TOOLS, execute_tool
from services.chat_prompt import build_system_prompt

logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 6

# Lazy-initialized Azure OpenAI client
_client: AzureOpenAI | None = None


def _get_client(config: dict) -> AzureOpenAI:
    """Get or create the Azure OpenAI client."""
    global _client
    if _client is None:
        _client = AzureOpenAI(
            azure_endpoint=config["azure_openai_endpoint"],
            api_key=config["azure_openai_api_key"],
            api_version=config.get("azure_openai_api_version", "2024-10-21"),
        )
    return _client


def run_agent(
    duckdb_manager,
    user_id: int,
    schema_info: dict,
    dataset_meta: dict,
    conversation_history: list[dict],
    user_message: str,
    azure_config: dict,
) -> dict:
    """
    Run one turn of the Ask OrgSight chatbot.

    Args:
        duckdb_manager:      Existing DuckDB manager instance
        user_id:             Current user's ID (for per-user DuckDB session)
        schema_info:         Live schema from /chat/schema
        dataset_meta:        Column mappings from datasets table
        conversation_history: Previous messages [{"role": ..., "content": ...}]
        user_message:        The new user message
        azure_config:        {"azure_openai_endpoint", "azure_openai_api_key",
                              "azure_openai_deployment", "azure_openai_api_version"}

    Returns:
        {
            "reply": str,                  # Natural language answer
            "display": str,                # "text" | "table" | "chart" | "table+chart"
            "data": {                      # Query results (if any)
                "columns": [...],
                "rows": [...]
            } | None,
            "chart": {...} | None,         # Chart spec (if display includes chart)
            "navigation": {...} | None,    # Navigation command (if triggered)
            "tool_calls_made": int,        # For debugging
            "tools_used": [str],           # Which tools were called
        }
    """
    client = _get_client(azure_config)
    deployment = azure_config.get("azure_openai_deployment", "gpt-4o")

    # Build system prompt with live schema + benchmarks
    system_prompt = build_system_prompt(schema_info, dataset_meta)

    # Build known columns set for SQL validation
    known_columns = {col["name"] for col in schema_info.get("columns", [])}

    # Tool execution context — passed to all executors
    ctx = {
        "duckdb_manager": duckdb_manager,
        "user_id": user_id,
        "dataset_meta": dataset_meta,
        "known_columns": known_columns,
    }

    # Assemble messages
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    # State tracking
    last_data = None          # Most recent query results (for chart pairing)
    last_columns = None       # Column names from last query
    navigation = None
    tool_calls_made = 0
    tools_used = []

    # ---- TOOL-USE LOOP ----
    for iteration in range(MAX_TOOL_ITERATIONS):

        response = client.chat.completions.create(
            model=deployment,
            messages=messages,
            tools=ALL_TOOLS,
            tool_choice="auto",
            response_format={"type": "json_object"} if iteration > 0 and not messages[-1].get("role") == "tool" else None,
            # Only force JSON on final response, not during tool calls
        )

        choice = response.choices[0]

        # ----- FINAL TEXT RESPONSE -----
        if choice.finish_reason == "stop":
            raw_content = choice.message.content or ""
            parsed = _parse_response(raw_content)

            # Build data payload for frontend
            data_payload = None
            if last_data and last_columns:
                data_payload = {
                    "columns": last_columns,
                    "rows": last_data,
                }

            return {
                "reply": parsed.get("reply", raw_content),
                "display": parsed.get("display", "text"),
                "data": data_payload,
                "chart": parsed.get("chart"),
                "navigation": navigation,
                "tool_calls_made": tool_calls_made,
                "tools_used": tools_used,
            }

        # ----- TOOL CALLS -----
        if choice.finish_reason == "tool_calls":
            messages.append(choice.message.model_dump())

            for tool_call in choice.message.tool_calls:
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)
                tool_calls_made += 1
                tools_used.append(tool_name)

                logger.info(
                    f"[Ask OrgSight] Tool #{tool_calls_made}: {tool_name}"
                    f"({json.dumps(tool_args)[:200]})"
                )

                # Execute tool
                text_result, raw_data = execute_tool(tool_name, tool_args, ctx)

                # Capture data for chart pairing and frontend response
                if raw_data is not None:
                    last_data = raw_data
                    last_columns = list(raw_data[0].keys()) if raw_data else []

                # Capture navigation
                if tool_name == "navigate":
                    navigation = tool_args

                # Feed result back to the LLM
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": text_result if isinstance(text_result, str) else json.dumps(text_result),
                })

            continue

        # ----- UNEXPECTED -----
        logger.warning(f"Unexpected finish_reason: {choice.finish_reason}")
        return {
            "reply": choice.message.content or "Something unexpected happened. Please try again.",
            "display": "text",
            "data": None,
            "chart": None,
            "navigation": navigation,
            "tool_calls_made": tool_calls_made,
            "tools_used": tools_used,
        }

    # Exhausted iterations
    logger.warning(f"Agent hit max iterations ({MAX_TOOL_ITERATIONS})")
    return {
        "reply": "I ran several queries but couldn't fully resolve your question. Could you try rephrasing?",
        "display": "text",
        "data": None,
        "chart": None,
        "navigation": navigation,
        "tool_calls_made": tool_calls_made,
        "tools_used": tools_used,
    }


def _parse_response(raw: str) -> dict:
    """
    Parse the LLM's final response. Expects JSON with reply + display + chart.
    Falls back gracefully if the LLM returns plain text instead.
    """
    # Try JSON parse first
    try:
        # Strip markdown code fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

        parsed = json.loads(cleaned)

        # Validate expected fields
        result = {
            "reply": parsed.get("reply", ""),
            "display": parsed.get("display", "text"),
        }

        if "chart" in parsed and parsed["chart"]:
            result["chart"] = parsed["chart"]

        return result

    except (json.JSONDecodeError, KeyError):
        # LLM returned plain text — that's fine, treat as text-only response
        return {
            "reply": raw,
            "display": "text",
        }
