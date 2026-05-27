import pandas as pd
from io import BytesIO

def export_excel(df: pd.DataFrame, sheet_name: str = "Sheet1") -> bytes:
    """
    Export a DataFrame to Excel and return bytes.
    """
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name)
    return output.getvalue()
