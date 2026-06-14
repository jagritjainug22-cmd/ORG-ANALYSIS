"""Generate a compact org-chart sample Excel file for OrgSight upload/testing."""
import os

import pandas as pd

ROWS = [
    # ID, Job Title, Contract Type, Status, BU, Division, Functional Area, Entity, Country, Office, Mgr ID, Start, Grade, FTE, Basic Pay, Add ons, FLC, Bonus
    ("PID_10001", "Chief Executive Officer", "Permanent", "Active", "Corporate", "Executive", "Executive Office", "Whitsbury Group Ltd", "UK", "UK - London", None, "2018-01-15", "E1", 1.0, 450000, 45000, 495000, 90000),
    ("PID_10002", "UK CVP Commercial", "Permanent", "Active", "Commercial", "UK & I Commercial", "Commercial UK", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10001", "2019-03-01", "E2", 1.0, 280000, 28000, 308000, 56000),
    ("PID_10003", "Global VP Technology", "Permanent", "Active", "Technology", "Digital & Engineering", "Technology", "Whitsbury Group Ltd", "UK", "UK - London", "PID_10001", "2019-06-01", "E2", 1.0, 295000, 29500, 324500, 59000),
    ("PID_10004", "VP Finance & G&A", "Permanent", "Active", "Finance", "Group Finance", "Finance", "Whitsbury Group Ltd", "UK", "UK - London", "PID_10001", "2020-01-10", "E2", 1.0, 265000, 26500, 291500, 53000),
    ("PID_10005", "Head of Sales UK", "Permanent", "Active", "Commercial", "UK & I Commercial", "Sales UK", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10002", "2020-04-01", "M1", 1.0, 145000, 14500, 159500, 29000),
    ("PID_10006", "Head of Sales Europe", "Permanent", "Active", "Commercial", "EU Commercial", "Sales EU", "Whitsbury DE GmbH", "Germany", "DE - Berlin", "PID_10002", "2021-02-15", "M1", 1.0, 138000, 13800, 151800, 27600),
    ("PID_10007", "Director of Engineering", "Permanent", "Active", "Technology", "Digital & Engineering", "Software Engineering", "Whitsbury US Inc", "USA", "US - New York", "PID_10003", "2020-07-01", "M1", 1.0, 185000, 18500, 203500, 37000),
    ("PID_10008", "Director Data & Analytics", "Permanent", "Active", "Technology", "Analytics & Automation", "Business Analytics", "Whitsbury UK Ltd", "UK", "UK - Manchester", "PID_10003", "2021-01-20", "M1", 1.0, 172000, 17200, 189200, 34400),
    ("PID_10011", "Sales Manager - London", "Permanent", "Active", "Commercial", "UK & I Commercial", "Sales UK", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10005", "2021-06-01", "M2", 1.0, 95000, 9500, 104500, 19000),
    ("PID_10013", "Sales Manager - Berlin", "Permanent", "Active", "Commercial", "EU Commercial", "Sales EU", "Whitsbury DE GmbH", "Germany", "DE - Berlin", "PID_10006", "2022-01-10", "M2", 1.0, 88000, 8800, 96800, 17600),
    ("PID_10014", "Engineering Manager - Platform", "Permanent", "Active", "Technology", "Digital & Engineering", "Software Engineering", "Whitsbury US Inc", "USA", "US - New York", "PID_10007", "2021-09-01", "M2", 1.0, 135000, 13500, 148500, 27000),
    ("PID_10015", "Engineering Manager - QA", "Permanent", "Active", "Technology", "Digital & Engineering", "Quality Assurance", "Whitsbury India Pvt Ltd", "India", "IN - Bangalore", "PID_10007", "2022-03-15", "M2", 1.0, 4200000, 420000, 4620000, 840000),
    ("PID_10016", "Data Science Lead", "Permanent", "Active", "Technology", "Analytics & Automation", "Business Analytics", "Whitsbury UK Ltd", "UK", "UK - Manchester", "PID_10008", "2022-06-01", "M2", 1.0, 98000, 9800, 107800, 19600),
    ("PID_10017", "Finance Manager", "Permanent", "Active", "Finance", "Group Finance", "Financial Control", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10004", "2021-11-01", "M2", 1.0, 92000, 9200, 101200, 18400),
    ("PID_10018", "HR Director", "Permanent", "Active", "Finance", "Group Finance", "Human Resources", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10004", "2020-08-15", "M2", 1.0, 105000, 10500, 115500, 21000),
    ("PID_10019", "Sales Executive", "Permanent", "Active", "Commercial", "UK & I Commercial", "Sales UK", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10011", "2022-09-01", "P1", 1.0, 55000, 5500, 60500, 11000),
    ("PID_10020", "Sales Executive", "Permanent", "Active", "Commercial", "UK & I Commercial", "Sales UK", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10011", "2023-01-15", "P1", 1.0, 52000, 5200, 57200, 10400),
    ("PID_10021", "Sales Executive", "Contractor", "Active", "Commercial", "UK & I Commercial", "Sales UK", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10011", "2023-06-01", "Contractor", 0.8, 48000, 0, 48000, 0),
    ("PID_10025", "Sales Executive", "Permanent", "Active", "Commercial", "EU Commercial", "Sales EU", "Whitsbury DE GmbH", "Germany", "DE - Berlin", "PID_10013", "2022-11-01", "P1", 1.0, 62000, 6200, 68200, 12400),
    ("PID_10026", "Sales Executive", "Permanent", "Active", "Commercial", "EU Commercial", "Sales EU", "Whitsbury DE GmbH", "Germany", "DE - Berlin", "PID_10013", "2023-03-01", "P1", 0.5, 58000, 5800, 63800, 11600),
    ("PID_10027", "Senior Software Engineer", "Permanent", "Active", "Technology", "Digital & Engineering", "Software Engineering", "Whitsbury US Inc", "USA", "US - New York", "PID_10014", "2022-02-01", "P2", 1.0, 125000, 12500, 137500, 25000),
    ("PID_10028", "Software Engineer", "Contractor", "Active", "Technology", "Digital & Engineering", "Software Engineering", "Whitsbury US Inc", "USA", "US - Remote", "PID_10014", "2023-04-01", "Contractor", 1.0, 95000, 0, 95000, 0),
    ("PID_10030", "QA Engineer", "Permanent", "Active", "Technology", "Digital & Engineering", "Quality Assurance", "Whitsbury India Pvt Ltd", "India", "IN - Bangalore", "PID_10015", "2022-08-01", "P1", 1.0, 1800000, 180000, 1980000, 360000),
    ("PID_10031", "QA Analyst", "Contractor", "Active", "Technology", "Digital & Engineering", "Quality Assurance", "Whitsbury India Pvt Ltd", "India", "IN - Bangalore", "PID_10015", "2023-07-01", "Contractor", 1.0, 1200000, 0, 1200000, 0),
    ("PID_10032", "Data Analyst", "Permanent", "Active", "Technology", "Analytics & Automation", "Business Analytics", "Whitsbury UK Ltd", "UK", "UK - Manchester", "PID_10016", "2023-01-10", "P1", 1.0, 65000, 6500, 71500, 13000),
    ("PID_10033", "Junior Data Analyst", "Permanent", "Active", "Technology", "Analytics & Automation", "Business Analytics", "Whitsbury UK Ltd", "UK", "UK - Manchester", "PID_10016", "2023-09-01", "P3", 1.0, 42000, 4200, 46200, 8400),
    ("PID_10034", "Financial Analyst", "Permanent", "Active", "Finance", "Group Finance", "Financial Control", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10017", "2022-05-01", "P1", 1.0, 58000, 5800, 63800, 11600),
    ("PID_10035", "HR Business Partner", "Permanent", "Active", "Finance", "Group Finance", "Human Resources", "Whitsbury UK Ltd", "UK", "UK - London", "PID_10018", "2021-04-01", "P2", 1.0, 72000, 7200, 79200, 14400),
]

COLUMNS = [
    "ID",
    "Job Title",
    "Contract Type",
    "Status",
    "Business Unit (Reporting line)",
    "Division (Reporting Line)",
    "Functional Area (Costed to)",
    "Employing Entity",
    "Country",
    "Office Location",
    "Line Manager ID",
    "Start Date",
    "Grade",
    "FTE",
    "Basic Pay",
    "Add ons",
    "Fully loaded cost",
    "On-target bonus",
]


def build_dataframe():
    records = []
    for row in ROWS:
        records.append(dict(zip(COLUMNS, row)))
    return pd.DataFrame(records)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "sample_data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "OrgSight_Sample_OrgChart_28rows.xlsx")

    df = build_dataframe()
    df.to_excel(out_path, index=False, sheet_name="Census")

    span = df["Line Manager ID"].value_counts()
    print(f"Created: {out_path}")
    print(f"Rows: {len(df)}")
    print(f"Countries: {sorted(df['Country'].unique())}")
    print(f"Top manager: {df.loc[df['Line Manager ID'].isna(), 'ID'].iloc[0]}")
    print(f"PID_10011 direct reports: {span.get('PID_10011', 0)}")


if __name__ == "__main__":
    main()
