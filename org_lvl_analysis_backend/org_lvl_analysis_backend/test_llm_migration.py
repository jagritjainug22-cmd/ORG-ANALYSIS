"""
GPT-4 / GPT-5 migration harness for OrgSight LLM layer.

Runs offline compatibility checks (no API key needed) plus optional live
calls when Azure credentials are configured in .env.

Usage:
  python test_llm_migration.py           # offline + live (if creds present)
  python test_llm_migration.py --offline # profile/kwargs checks only
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

backend = Path(__file__).resolve().parent
load_dotenv(backend / ".env")
sys.path.insert(0, str(backend))

from services import llm_service
from services.llm_service import (
    _build_completion_kwargs,
    _detect_model_family,
    _scale_output_budget,
    call_llm,
    call_llm_json,
    get_llm_profile,
)


def _ok(label: str) -> None:
    print(f"  OK  {label}")


def _fail(label: str, detail: str) -> None:
    print(f"  FAIL {label}: {detail}")


def run_offline_tests() -> bool:
    print("=== Offline compatibility checks ===\n")
    passed = True

    cases = [
        ("gpt-4.1-mini", "legacy"),
        ("gpt-4o", "legacy"),
        ("gpt-5", "reasoning"),
        ("gpt-5-mini", "reasoning"),
        ("gpt-5-chat", "gpt5_chat"),
        ("o3-mini", "reasoning"),
    ]
    for deployment, expected in cases:
        got = _detect_model_family(deployment)
        if got == expected:
            _ok(f"{deployment!r} -> {got}")
        else:
            _fail(f"{deployment!r} family", f"expected {expected}, got {got}")
            passed = False

    legacy_kw = _build_completion_kwargs(
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=400,
        temperature=0.0,
        family="legacy",
        json_mode=True,
    )
    if "max_tokens" in legacy_kw and "max_completion_tokens" not in legacy_kw:
        _ok("legacy kwargs use max_tokens")
    else:
        _fail("legacy kwargs", str(legacy_kw))
        passed = False

    reasoning_kw = _build_completion_kwargs(
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=400,
        temperature=0.0,
        family="reasoning",
        json_mode=True,
    )
    if (
        "max_completion_tokens" in reasoning_kw
        and "max_tokens" not in reasoning_kw
        and "temperature" not in reasoning_kw
    ):
        _ok("reasoning kwargs use max_completion_tokens, omit temperature")
    else:
        _fail("reasoning kwargs", str(reasoning_kw))
        passed = False

    scaled = _scale_output_budget(400, "reasoning")
    if scaled >= 1024:
        _ok(f"reasoning budget scaled 400 -> {scaled}")
    else:
        _fail("reasoning budget scale", f"got {scaled}")
        passed = False

    chat_kw = _build_completion_kwargs(
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=600,
        temperature=0.3,
        family="gpt5_chat",
    )
    if (
        "max_completion_tokens" in chat_kw
        and chat_kw.get("temperature") == 0.3
        and "max_tokens" not in chat_kw
    ):
        _ok("gpt5_chat kwargs use max_completion_tokens + temperature")
    else:
        _fail("gpt5_chat kwargs", str(chat_kw))
        passed = False

    print()
    profile = get_llm_profile()
    print("Active profile (from env):")
    for key, value in profile.items():
        print(f"  {key}: {value}")
    print()
    return passed


def run_live_tests() -> bool:
    print("=== Live API checks ===\n")
    if not os.getenv("AZURE_OPENAI_API_KEY") or not os.getenv("AZURE_OPENAI_ENDPOINT"):
        print("  SKIP  AZURE_OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT not set")
        return True

    passed = True

    print("--- Test 1: simple text ---")
    try:
        content, usage, latency = call_llm("Reply with exactly: MIGRATION_OK", max_tokens=20)
        print(f"  Response: {content!r}")
        print(f"  Usage: {usage}, latency_ms={latency:.0f}")
        _ok("text call")
    except Exception as exc:
        _fail("text call", f"{type(exc).__name__}: {exc}")
        passed = False

    print()
    print("--- Test 2: JSON mode ---")
    try:
        prompt = (
            'Return ONLY JSON: {"status": "ok", "model_family": "'
            + get_llm_profile()["model_family"]
            + '"}'
        )
        result = call_llm_json(prompt, max_tokens=100, call_type="migration_test")
        print(f"  JSON: {result}")
        _ok("json call")
    except Exception as exc:
        _fail("json call", f"{type(exc).__name__}: {exc}")
        passed = False

    print()
    print("--- Test 3: zero temperature (reasoning models omit this) ---")
    try:
        content, _, _ = call_llm("Say hello in one word.", max_tokens=20, temperature=0.0)
        print(f"  Response: {content!r}")
        _ok("temperature=0.0 accepted or omitted by profile")
    except Exception as exc:
        _fail("temperature call", f"{type(exc).__name__}: {exc}")
        passed = False

    print()
    return passed


def main() -> int:
    parser = argparse.ArgumentParser(description="OrgSight LLM migration harness")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Run offline profile/kwargs checks only",
    )
    args = parser.parse_args()

    offline_ok = run_offline_tests()
    live_ok = True if args.offline else run_live_tests()

    print("=== Summary ===")
    print(f"  offline: {'PASS' if offline_ok else 'FAIL'}")
    if not args.offline:
        print(f"  live:    {'PASS' if live_ok else 'FAIL'}")

    return 0 if offline_ok and live_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
