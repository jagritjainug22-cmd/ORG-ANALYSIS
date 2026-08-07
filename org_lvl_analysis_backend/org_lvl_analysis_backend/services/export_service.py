import pandas as pd
from io import BytesIO

def export_excel(
    df: pd.DataFrame,
    sheet_name: str = "Sheet1",
    include_index: bool = False,
    index_label: str | None = None,
) -> bytes:
    """
    Export a DataFrame to Excel and return bytes.

    Preserves all columns. List/dict values (e.g. Chain) are stringified
    so openpyxl can write them without dropping or erroring.

    By default the row index is dropped since most callers build their
    DataFrame from a plain list of records (index is just 0..n and carries
    no data). Pass include_index=True for DataFrames where the index holds
    meaningful labels (e.g. crosstab category rows).
    """
    out = df.copy()
    for col in out.columns:
        sample = out[col].dropna().head(1)
        if len(sample) and isinstance(sample.iloc[0], (list, dict, tuple)):
            out[col] = out[col].apply(
                lambda v: (
                    " > ".join(str(x) for x in v) if isinstance(v, (list, tuple))
                    else (str(v) if isinstance(v, dict) else v)
                )
            )
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        out.to_excel(
            writer,
            sheet_name=sheet_name,
            index=include_index,
            index_label=index_label if include_index else None,
        )
    return output.getvalue()
