import numpy as np
import pandas as pd

def spans_and_layers(df):
    """
    Compute IC, Manager counts and avg span by level.
    """
    if "Span" not in df.columns:
        raise ValueError("Span column missing")

    df = df.copy()
    df["Is_Manager"] = df["Span"].apply(lambda x: 1 if x > 0 else 0)
    df["Is_IC"] = 1 - df["Is_Manager"]

    summary = df.groupby("Level").agg(
        IC_Count=("Is_IC", "sum"),
        Manager_Count=("Is_Manager", "sum"),
        Avg_Span=("Span", "mean")
    ).reset_index()

    summary["Total_Employees"] = summary["IC_Count"] + summary["Manager_Count"]
    summary["Avg_Span"] = summary["Avg_Span"].round(2)

    return summary


def span_threshold(df, threshold, fte_col=None, flc_col=None):
    """
    Classification High / Low span.
    """
    df = df.copy()

    # Ensure Is_Manager exists
    if "Is_Manager" not in df.columns:
        df["Is_Manager"] = df["Span"].apply(lambda x: 1 if x > 0 else 0)
    if "Is_IC" not in df.columns:
        df["Is_IC"] = df["Is_Manager"].apply(lambda x: 0 if x == 1 else 1)

    # Compute threshold
    df["Span_Threshold"] = np.where(
        (df["Is_Manager"] == 1) & (df["Span"] >= threshold),
        "High",
        np.where(df["Is_Manager"] == 1, "Low", "")
    )

    high = ((df["Is_Manager"] == 1) & (df["Span"] >= threshold)).sum()
    low = ((df["Is_Manager"] == 1) & (df["Span"] < threshold)).sum()

    return df, high, low

