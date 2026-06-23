"""
Centralized Azure OpenAI service for all LLM calls in OrgSight.

Provides:
- Env-based configuration (no hardcoded keys)
- Structured JSON output mode (guaranteed valid JSON)
- Retry with exponential backoff
- Safe JSON extraction from LLM responses
- Token usage + latency metrics (thread-safe)
"""

import asyncio
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator

from openai import AzureOpenAI

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration — loaded from environment (.env via python-dotenv in main.py)
# ---------------------------------------------------------------------------

_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4.1-mini")
_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2025-03-01-preview")

_client: AzureOpenAI | None = None


def _get_client() -> AzureOpenAI:
    """Lazy-init the Azure OpenAI client so env vars are read after dotenv."""
    global _client, _API_KEY, _ENDPOINT, _DEPLOYMENT, _API_VERSION
    if _client is None:
        _API_KEY = os.getenv("AZURE_OPENAI_API_KEY", _API_KEY)
        _ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", _ENDPOINT)
        _DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", _DEPLOYMENT)
        _API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", _API_VERSION)

        if not _API_KEY or not _ENDPOINT:
            raise RuntimeError(
                "AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT must be set "
                "in the environment (.env file)."
            )
        _client = AzureOpenAI(
            api_key=_API_KEY,
            azure_endpoint=_ENDPOINT,
            api_version=_API_VERSION,
        )
    return _client


# ---------------------------------------------------------------------------
# Metrics (thread-safe)
# ---------------------------------------------------------------------------

@dataclass
class LlmCallRecord:
    call_type: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    inputs_requested: int = 0
    outputs_returned: int = 0
    batch_size: int = 0
    retry: bool = False


@dataclass
class LlmMetrics:
    calls: list[LlmCallRecord] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def record(self, record: LlmCallRecord) -> None:
        with self._lock:
            self.calls.append(record)

    def reset(self) -> None:
        with self._lock:
            self.calls.clear()

    def summary(self) -> dict[str, Any]:
        with self._lock:
            calls = list(self.calls)
        if not calls:
            return {
                "call_count": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "total_latency_ms": 0,
                "inputs_requested": 0,
                "outputs_returned": 0,
                "completeness_pct": 100.0,
                "calls": [],
            }
        prompt = sum(c.prompt_tokens for c in calls)
        completion = sum(c.completion_tokens for c in calls)
        inputs = sum(c.inputs_requested for c in calls)
        outputs = sum(c.outputs_returned for c in calls)
        return {
            "call_count": len(calls),
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
            "total_latency_ms": round(sum(c.latency_ms for c in calls), 1),
            "wall_clock_note": "sum of per-call latency (parallel calls overlap in wall-clock)",
            "inputs_requested": inputs,
            "outputs_returned": outputs,
            "completeness_pct": round(100.0 * outputs / inputs, 2) if inputs else 100.0,
            "calls": [
                {
                    "call_type": c.call_type,
                    "prompt_tokens": c.prompt_tokens,
                    "completion_tokens": c.completion_tokens,
                    "total_tokens": c.total_tokens,
                    "latency_ms": round(c.latency_ms, 1),
                    "inputs_requested": c.inputs_requested,
                    "outputs_returned": c.outputs_returned,
                    "batch_size": c.batch_size,
                    "retry": c.retry,
                }
                for c in calls
            ],
        }


llm_metrics = LlmMetrics()


def reset_llm_metrics() -> None:
    llm_metrics.reset()


def get_llm_metrics() -> dict[str, Any]:
    return llm_metrics.summary()


# ---------------------------------------------------------------------------
# Core LLM call with retry
# ---------------------------------------------------------------------------

_MAX_RETRIES = 3
_BASE_DELAY = 1.0  # seconds


def call_llm(
    prompt: str,
    *,
    max_tokens: int = 2000,
    temperature: float = 0.0,
    system_message: str | None = None,
    json_mode: bool = False,
) -> tuple[str, dict[str, int], float]:
    """Make a single chat completion call with retry on transient errors.

    Returns (content, usage_dict, latency_ms).
    usage_dict keys: prompt_tokens, completion_tokens, total_tokens.
    """
    client = _get_client()
    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": prompt})

    kwargs: dict[str, Any] = {
        "model": _DEPLOYMENT,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    last_error = None
    for attempt in range(_MAX_RETRIES):
        try:
            t0 = time.perf_counter()
            response = client.chat.completions.create(**kwargs)
            latency_ms = (time.perf_counter() - t0) * 1000
            usage = response.usage
            usage_dict = {
                "prompt_tokens": usage.prompt_tokens if usage else 0,
                "completion_tokens": usage.completion_tokens if usage else 0,
                "total_tokens": usage.total_tokens if usage else 0,
            }
            content = response.choices[0].message.content.strip()
            return content, usage_dict, latency_ms
        except Exception as e:
            last_error = e
            delay = _BASE_DELAY * (2 ** attempt)
            log.warning(
                "LLM call attempt %d/%d failed: %s — retrying in %.1fs",
                attempt + 1, _MAX_RETRIES, e, delay,
            )
            time.sleep(delay)

    log.error("LLM call failed after %d retries: %s", _MAX_RETRIES, last_error)
    raise last_error  # type: ignore[misc]


async def call_llm_stream(
    prompt: str,
    *,
    max_tokens: int = 600,
    temperature: float = 0.3,
    system_message: str | None = None,
) -> AsyncGenerator[str, None]:
    """Async generator that streams LLM response text chunk-by-chunk.

    Yields individual text delta strings as they arrive from the API.
    The blocking SDK call is offloaded to a thread-pool executor so the
    async event loop remains unblocked throughout streaming.
    """
    client = _get_client()
    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": prompt})

    kwargs: dict[str, Any] = {
        "model": _DEPLOYMENT,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }

    # Run the blocking create() call in a thread so we get the stream object
    loop = asyncio.get_event_loop()
    stream = await loop.run_in_executor(
        None,
        lambda: client.chat.completions.create(**kwargs),
    )

    # Iterate the stream in a thread — the SDK chunk iteration is also blocking
    import queue as _queue

    q: _queue.Queue = _queue.Queue()
    _SENTINEL = object()

    def _drain():
        try:
            for chunk in stream:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    text = getattr(delta, "content", None)
                    if text:
                        q.put(text)
        except Exception as exc:
            q.put(exc)
        finally:
            q.put(_SENTINEL)

    # Start the drain thread
    import threading as _threading
    t = _threading.Thread(target=_drain, daemon=True)
    t.start()

    # Yield chunks as they appear in the queue
    while True:
        # Poll the queue without blocking the event loop
        try:
            item = await loop.run_in_executor(None, q.get)
        except Exception as exc:
            log.error("LLM stream drain error: %s", exc)
            break

        if item is _SENTINEL:
            break
        if isinstance(item, Exception):
            log.error("LLM stream chunk error: %s", item)
            break
        yield item


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------

def extract_json(text: str) -> Any:
    """Extract a JSON object or array from an LLM response."""
    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```\w*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    for pattern in [r"(\{[\s\S]*\})", r"(\[[\s\S]*\])"]:
        match = re.search(pattern, cleaned)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                continue

    raise ValueError(f"Could not extract JSON from LLM response: {text[:200]}...")


def call_llm_json(
    prompt: str,
    *,
    max_tokens: int = 2000,
    temperature: float = 0.0,
    system_message: str | None = None,
    call_type: str = "generic",
    inputs_requested: int = 0,
    batch_size: int = 0,
    retry: bool = False,
    record_metrics: bool = True,
) -> Any:
    """Call LLM with structured JSON mode, parse result, optionally record metrics."""
    raw, usage, latency_ms = call_llm(
        prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        system_message=system_message,
        json_mode=True,
    )
    log.info("LLM raw response (first 500 chars): %s", raw[:500])
    parsed = extract_json(raw)

    if record_metrics:
        outputs = 0
        if isinstance(parsed, dict):
            if "results" in parsed and isinstance(parsed["results"], list):
                outputs = len(parsed["results"])
            else:
                outputs = len(parsed)
        elif isinstance(parsed, list):
            outputs = len(parsed)

        llm_metrics.record(LlmCallRecord(
            call_type=call_type,
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            total_tokens=usage["total_tokens"],
            latency_ms=latency_ms,
            inputs_requested=inputs_requested,
            outputs_returned=outputs,
            batch_size=batch_size or inputs_requested,
            retry=retry,
        ))

    return parsed
