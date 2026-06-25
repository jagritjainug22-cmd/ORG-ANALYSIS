"""Quick LLM connectivity test."""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

backend = Path(__file__).resolve().parent
load_dotenv(backend / ".env")

sys.path.insert(0, str(backend))
from services.llm_service import call_llm, call_llm_json, get_llm_profile

profile = get_llm_profile()
print("Endpoint:", os.getenv("AZURE_OPENAI_ENDPOINT"))
print("Deployment:", profile["deployment"])
print("Model family:", profile["model_family"])
print("Uses max_completion_tokens:", profile["uses_max_completion_tokens"])
print("Supports temperature:", profile["supports_temperature"])
print("API key set:", bool(os.getenv("AZURE_OPENAI_API_KEY")))
print()

print("--- Test 1: simple text call ---")
try:
    resp = call_llm("Reply with exactly: LLM_OK", max_tokens=20)
    print("Response:", repr(resp))
    print("Status: OK")
except Exception as e:
    print("FAILED:", type(e).__name__, e)

print()
print("--- Test 2: JSON call (function mapping style) ---")
try:
    prompt = (
        "Map these input functions to master list.\n"
        "INPUT: HR, S and D\n"
        "MASTER: Human Resources, Sales and Marketing\n"
        'Return ONLY JSON: {"HR": "...", "S and D": "..."}'
    )
    result = call_llm_json(prompt, max_tokens=100)
    print("JSON result:", result)
    print("Status: OK")
except Exception as e:
    print("FAILED:", type(e).__name__, e)
