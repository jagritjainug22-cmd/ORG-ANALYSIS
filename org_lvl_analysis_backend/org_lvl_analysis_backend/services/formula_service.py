"""
Safe formula evaluation for user-defined derived columns.

Supports: +, -, *, /, ** (power), unary minus/plus, parentheses,
          numeric literals, and column name references.

Column references can be written in two forms:
  - Bracket syntax (recommended):  [Fully loaded cost] / [FTE]
  - Raw name syntax (single-word):  FLC / FTE

Bracket syntax handles columns with spaces or special characters.
"""

import ast
import operator
import re
from typing import Any, Dict, List, Optional

_SAFE_OPS = {
    ast.Add:  operator.add,
    ast.Sub:  operator.sub,
    ast.Mult: operator.mul,
    ast.Div:  operator.truediv,
    ast.Pow:  operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

_BRACKET_RE = re.compile(r"\[([^\]]+)\]")


def _extract_brackets(expression: str):
    """
    Replace [Column Name] bracket references with safe __colN__ identifiers.
    Returns (normalized_expr, col_map) where col_map maps safe_name -> original_col.
    """
    col_map: Dict[str, str] = {}
    counter = [0]

    def _replace(m: re.Match) -> str:
        col_name = m.group(1).strip()
        safe = f"__col{counter[0]}__"
        counter[0] += 1
        col_map[safe] = col_name
        return safe

    normalized = _BRACKET_RE.sub(_replace, expression)
    return normalized, col_map


def _normalize_expression(expression: str, available_columns: List[str]):
    """
    Replace column names with safe Python identifiers for ast.parse.

    Phase 1: extract [Bracket] references.
    Phase 2: longest-first raw name replacement for simple single-word columns.
    Returns (normalized_expr, col_map).
    """
    normalized, col_map = _extract_brackets(expression)

    # Phase 2: raw name match (longest first to avoid partial matches)
    sorted_cols = sorted(available_columns, key=lambda x: -len(x))
    for col in sorted_cols:
        if col not in normalized:
            continue
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", col)
        if safe_name and safe_name[0].isdigit():
            safe_name = "col_" + safe_name
        if not safe_name:
            safe_name = "col_unknown"
        base = safe_name
        idx = 0
        while safe_name in col_map and col_map[safe_name] != col:
            idx += 1
            safe_name = f"{base}_{idx}"
        col_map[safe_name] = col
        normalized = normalized.replace(col, safe_name)

    return normalized, col_map


def _safe_eval(node: ast.AST, values: Dict[str, float]) -> float:
    """Recursively evaluate a whitelisted AST node."""
    if isinstance(node, ast.Constant):
        return float(node.n)
    if isinstance(node, ast.Num):  # Python < 3.8 compat
        return float(node.n)
    if isinstance(node, ast.Name):
        key = node.id
        if key not in values:
            raise KeyError(f"Column '{key}' not found in record")
        v = values[key]
        try:
            return float(v) if v is not None and v != "" else 0.0
        except (TypeError, ValueError):
            return 0.0
    if isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in _SAFE_OPS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        left = _safe_eval(node.left, values)
        right = _safe_eval(node.right, values)
        if op_type is ast.Div and right == 0:
            return 0.0
        return _SAFE_OPS[op_type](left, right)
    if isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in _SAFE_OPS:
            raise ValueError(f"Unsupported unary operator: {op_type.__name__}")
        return _SAFE_OPS[op_type](_safe_eval(node.operand, values))
    raise ValueError(f"Unsupported expression element: {type(node).__name__}")


def _friendly_error(expression: str, exc: Exception, available_columns: List[str]) -> str:
    """Convert raw parser/eval errors into actionable user messages."""
    msg = str(exc)

    if "invalid syntax" in msg.lower():
        # Check if expression contains a multi-word column without brackets
        for col in available_columns:
            if " " in col and col in expression:
                return (
                    f'Column "{col}" contains spaces — wrap it in brackets: [{col}]'
                )
        return 'Invalid syntax. Wrap column names that have spaces in brackets, e.g. [Fully loaded cost] / [FTE]'

    if "not found in record" in msg:
        col_match = re.search(r"Column '([^']+)'", msg)
        col = col_match.group(1) if col_match else "?"
        return f'Column "{col}" was not found. Type [ to see available columns.'

    if "Unsupported operator" in msg:
        return "Unsupported operator. Use +  −  ×  ÷  ^  and parentheses."

    if "Unsupported expression" in msg:
        return "Expression contains unsupported syntax. Only arithmetic and column references are allowed."

    return msg


def validate_expression(expression: str, available_columns: List[str]) -> dict:
    """
    Parse and validate an expression string.

    Returns::

        {"valid": True,  "error": None,   "referenced_cols": [...]}
        {"valid": False, "error": "...",  "referenced_cols": [...]}
    """
    if not expression or not expression.strip():
        return {"valid": False, "error": "Expression cannot be empty", "referenced_cols": []}
    try:
        normalized, col_map = _normalize_expression(expression, available_columns)
        tree = ast.parse(normalized.strip(), mode="eval")
        referenced_safe = [n.id for n in ast.walk(tree) if isinstance(n, ast.Name)]
        referenced_cols = [col_map.get(name, name) for name in referenced_safe]
        missing = [c for c in referenced_cols if c not in available_columns]
        if missing:
            return {
                "valid": False,
                "error": f'Unknown column(s): {", ".join(missing)}. Type [ to pick from available columns.',
                "referenced_cols": referenced_cols,
            }
        dummy = {safe: 1.0 for safe in col_map}
        _safe_eval(tree.body, dummy)
        return {"valid": True, "error": None, "referenced_cols": referenced_cols}
    except Exception as exc:
        return {
            "valid": False,
            "error": _friendly_error(expression, exc, available_columns),
            "referenced_cols": [],
        }


def evaluate_formula(expression: str, record: Dict[str, Any]) -> Optional[float]:
    """
    Evaluate *expression* against a single record dict.
    Returns the numeric result rounded to 4 dp, or None on any error.
    """
    available_columns = list(record.keys())
    try:
        normalized, col_map = _normalize_expression(expression, available_columns)
        tree = ast.parse(normalized.strip(), mode="eval")
        values = {safe: record.get(orig) for safe, orig in col_map.items()}
        result = _safe_eval(tree.body, values)
        return round(float(result), 4)
    except Exception:
        return None


def apply_formulas_to_records(
    records: List[Dict[str, Any]],
    formulas: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Apply a list of formula dicts (each with 'col_name' and 'expression')
    to every record, adding derived columns in-place.
    """
    if not formulas or not records:
        return records
    result = []
    for record in records:
        r = dict(record)
        for formula in formulas:
            col_name = formula.get("col_name") or formula.get("column_name")
            expression = formula.get("expression")
            if col_name and expression:
                r[col_name] = evaluate_formula(expression, record)
        result.append(r)
    return result
