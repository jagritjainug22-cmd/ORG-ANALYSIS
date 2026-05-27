import numpy as np
import pandas as pd

def read_excel_file(file):
    df = pd.read_excel(file)

    # Replace inf/-inf
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    # Convert datetimes to string
    for col in df.select_dtypes(include=["datetime", "datetimetz"]):
        df[col] = df[col].astype(str)

    # Convert everything to pure Python types
    df = df.astype(object)

    # Replace NaN/NA with None (JSON-safe)
    df = df.where(pd.notna(df), None)

    # Ensure column names are strings
    df.columns = df.columns.map(str)

    return df
