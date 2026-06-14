"""
File loading and export helpers.
"""
import io
import re
import pandas as pd


def load_file(uploaded_file):
    """Return a DataFrame from an Excel upload."""
    return pd.read_excel(uploaded_file)


def to_excel_bytes(df):
    """Convert a DataFrame to downloadable Excel bytes."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Output")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Flexible column-name matching
# ---------------------------------------------------------------------------
def _normalize(name):
    """Reduce a column name to a canonical key by lowering case and stripping
    all spaces, underscores, and hyphens.

    Examples:
      'Sub Function'  -> 'subfunction'
      'sub_function'  -> 'subfunction'
      'SubFunction'   -> 'subfunction'
      'SUB-FUNCTION'  -> 'subfunction'
      'sub  function' -> 'subfunction'
    """
    return re.sub(r"[\s_\-]+", "", str(name).strip()).lower()


def find_column(df, target):
    """Return the actual column name in *df* that matches *target* after
    normalisation, or None if no match is found.

    Parameters
    ----------
    df : pd.DataFrame
    target : str  -- the canonical name to look for, e.g. 'Function'
    """
    target_key = _normalize(target)
    for col in df.columns:
        if _normalize(col) == target_key:
            return col
    return None


def normalise_master_columns(df):
    """Rename the Function and Subfunction columns in the Function/Subfunction
    mapping DataFrame to canonical names.

    Returns (normalised_df, error_message).
    error_message is None on success, or a descriptive string on failure.
    """
    func_col = find_column(df, "Function")
    subfunc_col = find_column(df, "Subfunction")

    missing = []
    if func_col is None:
        missing.append("Function")
    if subfunc_col is None:
        missing.append("Subfunction")

    if missing:
        return None, (
            f"Could not find column(s): {', '.join(missing)}. "
            "Accepted variants include: Function, function, FUNCTION, "
            "func_tion, Sub Function, sub_function, SubFunction, etc."
        )

    rename_map = {}
    if func_col != "Function":
        rename_map[func_col] = "Function"
    if subfunc_col != "Subfunction":
        rename_map[subfunc_col] = "Subfunction"

    if rename_map:
        df = df.rename(columns=rename_map)

    return df, None


def normalise_title_columns(df):
    """Rename the Function, Raw Job Title, and Standard Job Title columns in
    the Title mapping DataFrame to canonical names.

    Expected columns (flexible naming):
      Function          -> "Function"
      Raw Job Title     -> "Title"
      Standard Job Title -> "Standard Title"

    Returns (normalised_df, error_message).
    error_message is None on success, or a descriptive string on failure.
    """
    func_col = find_column(df, "Function")

    # Try several common variants for the raw title column
    title_col = None
    for candidate in ["RawJobTitle", "Raw Job Title", "Title", "JobTitle", "Job Title"]:
        title_col = find_column(df, candidate)
        if title_col is not None:
            break

    # Try several common variants for the standard/rationalised title column
    std_col = None
    for candidate in [
        "StandardJobTitle", "Standard Job Title",
        "RationalisedTitle", "Rationalised Title",
        "MappedTitle", "Mapped Title",
        "StandardTitle", "Standard Title",
    ]:
        std_col = find_column(df, candidate)
        if std_col is not None:
            break

    missing = []
    if func_col is None:
        missing.append("Function")
    if title_col is None:
        missing.append("Raw Job Title / Title")
    if std_col is None:
        missing.append("Standard Job Title / Rationalised Title")

    if missing:
        return None, (
            f"Could not find column(s): {', '.join(missing)}. "
            "Expected columns for Function, Raw Job Title (or Title), and "
            "Standard Job Title (or Rationalised Title). "
            "Accepts flexible naming like raw_job_title, StandardJobTitle, etc."
        )

    rename_map = {}
    if func_col != "Function":
        rename_map[func_col] = "Function"
    if title_col != "Title":
        rename_map[title_col] = "Title"
    if std_col != "Standard Title":
        rename_map[std_col] = "Standard Title"

    if rename_map:
        df = df.rename(columns=rename_map)

    return df, None
