"""
Azure OpenAI client initialisation and single-row LLM mapping logic.
"""
import json
import logging
from openai import AzureOpenAI

from config import (
    AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_DEPLOYMENT_NAME,
    AZURE_OPENAI_API_VERSION,
)

log = logging.getLogger(__name__)

client = AzureOpenAI(
    api_key=AZURE_OPENAI_API_KEY,
    azure_endpoint=AZURE_OPENAI_ENDPOINT,
    api_version=AZURE_OPENAI_API_VERSION,
)


def resolve_functions(input_functions, master_functions):
    """Make a single LLM call to map each input Function name to its best
    matching master Function name. Handles abbreviations, short forms, and
    corporate/consulting naming conventions common in census data projects.

    Parameters
    ----------
    input_functions : list[str]  -- unique Function names from the input file
    master_functions : list[str] -- unique Function names from the mapping files

    Returns dict {input_function: resolved_master_function}.
    If an input function has no reasonable match, it maps to itself.
    """
    if not input_functions or not master_functions:
        return {}

    input_list = "\n".join(f"  - {f}" for f in sorted(input_functions))
    master_list = "\n".join(f"  - {f}" for f in sorted(master_functions))

    prompt = f"""You are a corporate data standardisation expert working on a census
data rationalisation project. Your task is to map Function names from an input
file to the closest matching standard Function names from a master list.

The input file uses company-specific names, abbreviations, and short forms that
are common in consulting and corporate environments. For example:
  - "HR" or "Human Resources" are the same function
  - "S&D" could mean "Sales & Distribution" or "Sales & Marketing"
  - "C&P" could mean "Contracts & Procurement" or "Procurement"
  - "R&D" and "Research & Development" are the same
  - "ERA" could be an internal code for a department
  - "Comms" is short for "Communications"

INPUT FUNCTION NAMES:
{input_list}

MASTER FUNCTION NAMES (the standard names to map to):
{master_list}

INSTRUCTIONS:
1. For each input function, find the best matching master function based on
   semantic meaning, common abbreviations, and corporate naming conventions.
2. If an input function clearly matches a master function (even through
   abbreviations or alternate naming), map it.
3. If an input function has NO reasonable match in the master list, map it
   to itself (keep the original name).
4. Every input function must appear exactly once in the output.

RESPONSE FORMAT:
Return ONLY a JSON object where keys are the input function names (exactly as
provided) and values are the matched master function names (exactly as provided)
or the original input name if no match.

Return nothing else -- no explanation, no markdown, just the JSON object."""

    try:
        response = client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=1000,
        )
        raw = response.choices[0].message.content.strip()
        log.info("Function resolution raw response: %s", raw)

        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            raw = raw.rsplit("```", 1)[0].strip()
        result = json.loads(raw)

        resolution = {}
        for inp_func in input_functions:
            resolution[inp_func] = result.get(inp_func, inp_func)
        return resolution
    except Exception as e:
        log.error("Function resolution LLM call failed: %s", e)
        return {f: f for f in input_functions}


def map_subfunction(row_index, title, input_function, input_subfunction, master_subfunctions):
    """Use Azure OpenAI to pick the best-matching master subfunction or propose
    a new one when no good match exists.

    Returns (row_index, result_subfunction, matched_from_master, had_error).
    """

    if not master_subfunctions:
        # No master candidates: use LLM to simplify/normalise the subfunction
        prompt = f"""You are a data classification expert working on census data
rationalisation. The following subfunction name is verbose or uses internal codes.
Simplify it into a clean, concise, standardised subfunction name.

INPUT:
  Title: {title}
  Function: {input_function}
  Subfunction: {input_subfunction}

INSTRUCTIONS:
1. Analyse the Title, Function, and Subfunction.
2. Create a concise, standardised subfunction name that captures the core
   responsibility. Remove any internal codes, prefixes like "SA", or
   company-specific jargon.

RESPONSE FORMAT:
Return ONLY a JSON object with two keys:
  "matched": false
  "subfunction": the simplified subfunction name

Return nothing else -- no explanation, no markdown, just the JSON object."""

        try:
            response = client.chat.completions.create(
                model=AZURE_OPENAI_DEPLOYMENT_NAME,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=200,
            )
            raw = response.choices[0].message.content.strip()
            log.info("Row %s simplify subfunction response: %s", row_index, raw)
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1]
                raw = raw.rsplit("```", 1)[0].strip()
            result = json.loads(raw)
            return row_index, result.get("subfunction", input_subfunction), False, False
        except Exception as e:
            log.error("Row %s simplify subfunction failed: %s", row_index, e)
            return row_index, input_subfunction, False, True

    subfunctions_list = "\n".join(
        f"  - {sf}" for sf in sorted(set(master_subfunctions))
    )

    prompt = f"""You are a data classification expert. Your task is to map an input
subfunction to the most relevant subfunction from a master list.

INPUT ROW:
  Title: {title}
  Function: {input_function}
  Subfunction: {input_subfunction}

MASTER SUBFUNCTIONS (for the function "{input_function}"):
{subfunctions_list}

INSTRUCTIONS:
1. Analyse the Title, Function, and Subfunction from the input row.
2. Compare the input subfunction with every master subfunction listed above.
3. Pick the single master subfunction that is the BEST semantic match based on
   the meaning of the Title and Subfunction.
4. ONLY if absolutely none of the master subfunctions are even remotely related,
   create a concise new subfunction name.
5. Prefer picking from the master list over creating a new name.

RESPONSE FORMAT:
Return ONLY a JSON object with two keys:
  "matched": true if you picked from the master list, false if you created a new one
  "subfunction": the chosen or newly created subfunction name

Return nothing else -- no explanation, no markdown, just the JSON object."""

    try:
        response = client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=200,
        )
        raw = response.choices[0].message.content.strip()
        log.info("Row %s raw LLM response: %s", row_index, raw)

        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            raw = raw.rsplit("```", 1)[0].strip()
        result = json.loads(raw)
        mapped = result.get("subfunction", input_subfunction)
        matched = result.get("matched", False)
        log.info("Row %s: '%s' -> '%s' (matched=%s)", row_index, input_subfunction, mapped, matched)
        return row_index, mapped, bool(matched), False
    except Exception as e:
        log.error("Row %s LLM call failed: %s", row_index, e)
        return row_index, input_subfunction, False, True


def map_title(row_index, input_title, input_function, master_titles):
    """Use Azure OpenAI to pick the best-matching rationalised title from a
    master list, or generate a simplified title if no good match exists.

    Parameters
    ----------
    row_index : int
    input_title : str -- the original title from the input file
    input_function : str -- the function this row belongs to (used to keep
                            title mapping within the same functional domain)
    master_titles : list[str] -- candidate standard titles (already filtered
                                 by function when possible)

    Returns (row_index, rationalised_title, matched_from_master, had_error).
    """

    if not master_titles:
        log.warning("Row %s: no master titles provided, keeping input value.", row_index)
        return row_index, input_title, False, False

    titles_list = "\n".join(
        f"  - {t}" for t in sorted(set(master_titles))
    )

    prompt = f"""You are a job-title standardisation expert. Your task is to map an
input job title to the most relevant standard title from a master list.

INPUT:
  Raw Job Title: {input_title}
  Function: {input_function}

MASTER STANDARD TITLES (for the "{input_function}" function):
{titles_list}

INSTRUCTIONS:
1. The input title belongs to the "{input_function}" function.
2. Compare it with every standard title in the master list above.
3. Pick the single master title that is the BEST semantic match -- the one
   that most accurately represents the same role or responsibility within
   the "{input_function}" domain.
4. ONLY if absolutely none of the master titles are even remotely related,
   create a concise, simplified title that captures the core role.
5. Prefer picking from the master list over creating a new title.
6. NEVER pick a title that belongs to a completely different functional area.

RESPONSE FORMAT:
Return ONLY a JSON object with two keys:
  "matched": true if you picked from the master list, false if you created a new one
  "title": the chosen or newly created standard title

Return nothing else -- no explanation, no markdown, just the JSON object."""

    try:
        response = client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=200,
        )
        raw = response.choices[0].message.content.strip()
        log.info("Row %s raw title LLM response: %s", row_index, raw)

        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            raw = raw.rsplit("```", 1)[0].strip()
        result = json.loads(raw)
        mapped = result.get("title", input_title)
        matched = result.get("matched", False)
        log.info("Row %s title: '%s' -> '%s' (matched=%s)", row_index, input_title, mapped, matched)
        return row_index, mapped, bool(matched), False
    except Exception as e:
        log.error("Row %s title LLM call failed: %s", row_index, e)
        return row_index, input_title, False, True
