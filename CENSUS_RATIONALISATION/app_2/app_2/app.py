"""
Streamlit UI for Census Data Rationalisation.
"""
import streamlit as st
import pandas as pd

from config import USERS
from file_utils import load_file, to_excel_bytes, normalise_master_columns, normalise_title_columns
from processing import build_lookups, resolve_step, process_rows, _normalise_key

# ---------------------------------------------------------------------------
# Page setup
# ---------------------------------------------------------------------------
st.set_page_config(page_title="Census Data Rationalisation", layout="wide")

# ---------------------------------------------------------------------------
# Custom CSS (shared across login + main app)
# ---------------------------------------------------------------------------
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

html, body,
p, span, div, label, input, textarea, select, button, a, li, td, th, h1, h2, h3, h4, h5, h6,
[data-testid="stMarkdownContainer"],
[data-testid="stText"],
[data-testid="stAlert"],
[data-testid="stMetricLabel"],
[data-testid="stMetricValue"],
[data-testid="stSelectbox"],
[data-testid="stFileUploader"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* ── Header banner ─────────────────────────────── */
.main-banner {
    background: linear-gradient(135deg, #0f2b46 0%, #1a4971 40%, #2b6da1 100%);
    padding: 2.25rem 2.5rem;
    border-radius: 14px;
    margin-bottom: 2rem;
    position: relative;
    overflow: hidden;
}
.main-banner::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -20%;
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%);
    border-radius: 50%;
}
.main-banner::after {
    content: '';
    position: absolute;
    bottom: -30%;
    left: 10%;
    width: 250px;
    height: 250px;
    background: radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%);
    border-radius: 50%;
}
.main-banner h1 {
    font-size: 1.85rem;
    font-weight: 800;
    color: #ffffff;
    margin: 0 0 0.4rem 0;
    letter-spacing: -0.02em;
    position: relative;
    z-index: 1;
}
.main-banner p {
    font-size: 0.95rem;
    color: rgba(255,255,255,0.78);
    margin: 0;
    font-weight: 400;
    position: relative;
    z-index: 1;
}

/* ── Step badges ───────────────────────────────── */
.step-header {
    display: flex;
    align-items: center;    gap: 0.7rem;
    margin-bottom: 0.2rem;
}
.step-num {
    background: linear-gradient(135deg, #1a4971, #2b6da1);
    color: #fff;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.8rem;
    flex-shrink: 0;
}
.step-label {
    font-size: 1.1rem;
    font-weight: 700;
    color: #0f2b46;
}
.step-desc {
    font-size: 0.82rem;
    color: #6b7280;
    margin: 0.15rem 0 0.8rem 2.55rem;
}

/* ── Containers ────────────────────────────────── */
div[data-testid="stVerticalBlockBorderWrapper"] {
    border-radius: 12px !important;
    border: 1px solid #e2e8f0 !important;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04) !important;
    transition: box-shadow 0.25s ease, border-color 0.25s ease;
}
div[data-testid="stVerticalBlockBorderWrapper"]:hover {
    box-shadow: 0 4px 16px rgba(0,0,0,0.07) !important;
    border-color: #cbd5e1 !important;
}

/* ── File uploader ─────────────────────────────── */
[data-testid="stFileUploader"] section {
    border: 2px dashed #cbd5e1 !important;
    border-radius: 10px !important;
    padding: 1rem !important;
    background: #fafbfc !important;
    transition: border-color 0.25s ease, background 0.25s ease;
}
[data-testid="stFileUploader"] section:hover {
    border-color: #2b6da1 !important;
    background: #f0f7ff !important;
}

/* ── Buttons ───────────────────────────────────── */
.stButton > button {
    border-radius: 8px !important;
    font-weight: 600 !important;
    padding: 0.55rem 1.6rem !important;
    font-size: 0.9rem !important;
    letter-spacing: 0.01em !important;
    transition: all 0.2s ease !important;
    border: none !important;
    background: linear-gradient(135deg, #1a4971, #2b6da1) !important;
    color: #fff !important;
}
.stButton > button:hover {
    box-shadow: 0 4px 14px rgba(26,73,113,0.35) !important;
    transform: translateY(-1px) !important;
}
.stButton > button:active {
    transform: translateY(0) !important;
}

/* ── Download button ───────────────────────────── */
.stDownloadButton > button {
    background: linear-gradient(135deg, #047857, #059669) !important;
    color: #fff !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 700 !important;
    padding: 0.7rem 2.2rem !important;
    font-size: 0.95rem !important;
    letter-spacing: 0.01em !important;
    transition: all 0.2s ease !important;
}
.stDownloadButton > button:hover {
    box-shadow: 0 4px 14px rgba(5,150,105,0.35) !important;
    transform: translateY(-1px) !important;
}

/* ── Metrics ───────────────────────────────────── */
[data-testid="stMetric"] {
    background: linear-gradient(135deg, #f8fafc, #f0f7ff);
    padding: 0.85rem 1rem;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
}
[data-testid="stMetricValue"] {
    color: #1a4971 !important;
    font-weight: 800 !important;
}
[data-testid="stMetricLabel"] {
    color: #64748b !important;
    font-weight: 500 !important;
    text-transform: uppercase !important;
    font-size: 0.7rem !important;
    letter-spacing: 0.05em !important;
}

/* ── Alerts ────────────────────────────────────── */
[data-testid="stAlert"] {
    border-radius: 10px !important;
}

/* ── Expanders ─────────────────────────────────── */
[data-testid="stExpander"] {
    border-radius: 10px !important;
    border: 1px solid #e2e8f0 !important;
}

/* ── DataFrames ────────────────────────────────── */
[data-testid="stDataFrame"] {
    border-radius: 10px;
    overflow: hidden;
}

/* ── Selectboxes ───────────────────────────────── */
[data-testid="stSelectbox"] label {
    font-weight: 600 !important;
    color: #374151 !important;
    font-size: 0.85rem !important;
}

/* ── Divider override ──────────────────────────── */
hr {
    border: none !important;
    height: 1px !important;
    background: linear-gradient(to right, transparent, #d1d5db, transparent) !important;
    margin: 1.75rem 0 !important;
}

/* ── Hide sidebar toggle (no sidebar used) ─────── */
[data-testid="stSidebar"],
[data-testid="stSidebarCollapsedControl"],
button[data-testid="stSidebarCollapsedControl"],
[data-testid="collapsedControl"] {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
}

/* ── Hide element toolbars (hover arrows on dataframes, metrics, etc.) ── */
[data-testid="stElementToolbar"],
[data-testid="StyledFullScreenButton"],
button[data-testid="StyledFullScreenButton"],
[data-testid="stElementToolbarButton"],
.stElementToolbar {
    display: none !important;
    pointer-events: none !important;
}

/* ── Login page ────────────────────────────────── */
.login-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 70vh;
}
.login-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.08);
    padding: 2.5rem 2.5rem 2rem;
    width: 100%;
    max-width: 400px;
}
.login-card h2 {
    font-size: 1.5rem;
    font-weight: 800;
    color: #0f2b46;
    margin: 0 0 0.25rem 0;
    text-align: center;
}
.login-card .login-sub {
    font-size: 0.85rem;
    color: #6b7280;
    text-align: center;
    margin-bottom: 1.5rem;
}
.login-banner {
    background: linear-gradient(135deg, #0f2b46 0%, #1a4971 40%, #2b6da1 100%);
    padding: 1.5rem 2rem;
    border-radius: 12px;
    text-align: center;
    margin-bottom: 2rem;
    position: relative;
    overflow: hidden;
}
.login-banner::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -30%;
    width: 200px;
    height: 200px;
    background: radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%);
    border-radius: 50%;
}
.login-banner h1 {
    font-size: 1.3rem;
    font-weight: 800;
    color: #fff;
    margin: 0;
    position: relative;
    z-index: 1;
}
.login-banner p {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.7);
    margin: 0.3rem 0 0;
    position: relative;
    z-index: 1;
}
</style>
""", unsafe_allow_html=True)


def _step(number, title, caption=None):
    """Render a styled step header."""
    st.markdown(f"""
    <div class="step-header">
        <span class="step-num">{number}</span>
        <span class="step-label">{title}</span>
    </div>
    """, unsafe_allow_html=True)
    if caption:
        st.markdown(f'<div class="step-desc">{caption}</div>', unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
if "authenticated" not in st.session_state:
    st.session_state["authenticated"] = False
    st.session_state["username"] = ""

if not st.session_state["authenticated"]:
    _blank_l, center, _blank_r = st.columns([1, 1.2, 1])
    with center:
        st.markdown("""
        <div class="login-banner">
            <h1>Census Data Rationalisation</h1>
            <p>AI-powered title and subfunction mapping</p>
        </div>
        """, unsafe_allow_html=True)

        with st.container(border=True):
            st.markdown(
                '<h2 style="font-size:1.35rem;font-weight:800;color:#0f2b46;'
                'text-align:center;margin:0 0 0.15rem">Sign In</h2>',
                unsafe_allow_html=True,
            )
            st.markdown(
                '<p style="font-size:0.82rem;color:#6b7280;text-align:center;'
                'margin-bottom:1.2rem">Enter your credentials to continue</p>',
                unsafe_allow_html=True,
            )

            username = st.text_input("Username", placeholder="Enter username")
            password = st.text_input("Password", type="password", placeholder="Enter password")

            if st.button("Sign In", use_container_width=True, key="login_btn"):
                if username in USERS and USERS[username] == password:
                    st.session_state["authenticated"] = True
                    st.session_state["username"] = username
                    st.rerun()
                else:
                    st.error("Invalid username or password.")

    st.stop()

# ---------------------------------------------------------------------------
# Header (shown only after login)
# ---------------------------------------------------------------------------
st.markdown("""
<div class="main-banner">
    <h1>Census Data Rationalisation</h1>
    <p>Map input titles and subfunctions to simplified master lists using AI-powered matching.</p>
</div>
""", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# 1. Function / Subfunction mapping file
# ---------------------------------------------------------------------------
with st.container(border=True):
    _step("1", "Upload Function / Subfunction Mapping",
          "Must contain a <strong>Function</strong> and a <strong>Subfunction</strong> column.")
    func_file = st.file_uploader(
        "Function / Subfunction mapping (Excel)", type=["xlsx", "xls"], key="func_map"
    )

    func_df = None
    if func_file:
        raw = load_file(func_file)
        if raw is not None:
            func_df, err = normalise_master_columns(raw)
            if err:
                st.error(err)
            else:
                m1, m2, m3 = st.columns(3)
                m1.metric("Rows", f"{len(func_df):,}")
                m2.metric("Functions", func_df["Function"].nunique())
                m3.metric("Subfunctions", func_df["Subfunction"].nunique())
                with st.expander("Preview Function / Subfunction mapping"):
                    st.dataframe(func_df, use_container_width=True)

st.divider()

# ---------------------------------------------------------------------------
# 2. Title mapping file
# ---------------------------------------------------------------------------
with st.container(border=True):
    _step("2", "Upload Title Mapping",
          "Must contain <strong>Function</strong>, <strong>Raw Job Title</strong> (or Title), "
          "and <strong>Standard Job Title</strong> (or Rationalised Title) columns.")
    title_file = st.file_uploader(
        "Title mapping (Excel)", type=["xlsx", "xls"], key="title_map"
    )

    title_df = None
    if title_file:
        raw = load_file(title_file)
        if raw is not None:
            title_df, err = normalise_title_columns(raw)
            if err:
                st.error(err)
            else:
                m1, m2, m3, m4 = st.columns(4)
                m1.metric("Rows", f"{len(title_df):,}")
                m2.metric("Functions", title_df["Function"].nunique())
                m3.metric("Raw Titles", title_df["Title"].nunique())
                m4.metric("Standard Titles", title_df["Standard Title"].nunique())
                with st.expander("Preview Title mapping"):
                    st.dataframe(title_df, use_container_width=True)

st.divider()

# ---------------------------------------------------------------------------
# 3. Input file
# ---------------------------------------------------------------------------
with st.container(border=True):
    _step("3", "Upload Input File",
          "Select which columns correspond to Title, Function, and Subfunction.")
    input_file = st.file_uploader(
        "Input file (Excel)", type=["xlsx", "xls"], key="input"
    )

    input_df = None
    col_title = col_function = col_subfunction = None

    if input_file:
        input_df = load_file(input_file)
        if input_df is not None:
            m1, m2 = st.columns(2)
            m1.metric("Rows", f"{len(input_df):,}")
            m2.metric("Columns", len(input_df.columns))
            with st.expander("Preview input data"):
                st.dataframe(input_df.head(20), use_container_width=True)

            st.markdown("")
            columns = list(input_df.columns)
            col1, col2, col3 = st.columns(3)
            with col1:
                col_title = st.selectbox("Column for Title", options=columns, index=0)
            with col2:
                default_func = columns.index("Function") if "Function" in columns else 0
                col_function = st.selectbox(
                    "Column for Function", options=columns, index=default_func
                )
            with col3:
                default_sub = (
                    columns.index("Subfunction") if "Subfunction" in columns else 0
                )
                col_subfunction = st.selectbox(
                    "Column for Subfunction", options=columns, index=default_sub
                )

st.divider()

# ---------------------------------------------------------------------------
# 4. Resolve Function names
# ---------------------------------------------------------------------------
with st.container(border=True):
    _step("4", "Resolve Function Names")

    can_run = func_df is not None and title_df is not None and input_df is not None
    if not can_run:
        st.info("Upload all three files above to proceed.")

    if can_run:
        st.markdown(
            f"**Mapped columns** &mdash; Title: `{col_title}` &nbsp;|&nbsp; "
            f"Function: `{col_function}` &nbsp;|&nbsp; Subfunction: `{col_subfunction}`"
        )

        if st.button("Resolve Functions", key="resolve_btn"):
            with st.spinner("Resolving Function names..."):
                lookups = build_lookups(func_df, title_df)
                subfunc_lookup = lookups[0]
                title_by_func = lookups[2]
                func_display_names = lookups[4]

                func_resolution, resolution_df = resolve_step(
                    input_df, col_function, subfunc_lookup, title_by_func, func_display_names
                )

            st.session_state["lookups"] = lookups
            st.session_state["func_resolution"] = func_resolution
            st.session_state["resolution_df"] = resolution_df
            st.session_state.pop("result_df", None)

        if "resolution_df" in st.session_state:
            st.markdown("**Review the Function name resolution below.** "
                        "You can edit the *Resolved To* column if any mapping is incorrect.")

            if "lookups" in st.session_state:
                func_display_names = st.session_state["lookups"][4]
                options_set = set(func_display_names.values())
                for _, r in st.session_state["resolution_df"].iterrows():
                    options_set.add(r["Resolved To"])
                master_func_options = sorted(options_set)
            else:
                master_func_options = []

            edited_df = st.data_editor(
                st.session_state["resolution_df"],
                column_config={
                    "Input Function": st.column_config.TextColumn(
                        "Input Function", disabled=True
                    ),
                    "Resolved To": st.column_config.SelectboxColumn(
                        "Resolved To",
                        options=master_func_options,
                        required=True,
                    ),
                    "Method": st.column_config.TextColumn(
                        "Method", disabled=True
                    ),
                },
                use_container_width=True,
                hide_index=True,
                key="resolution_editor",
            )

st.divider()

# ---------------------------------------------------------------------------
# 5. Run Rationalisation
# ---------------------------------------------------------------------------
with st.container(border=True):
    _step("5", "Run Rationalisation")

    show_process = can_run and "resolution_df" in st.session_state
    if not show_process:
        st.info("Complete the previous steps first to enable processing.")

    if show_process:
        if st.button("Start Processing", key="process_btn"):
            func_resolution = {}
            for _, row in edited_df.iterrows():
                inp = row["Input Function"]
                resolved = row["Resolved To"]
                func_resolution[inp] = _normalise_key(resolved)

            lookups = st.session_state["lookups"]
            (subfunc_lookup, title_exact, title_by_func,
             all_master_titles, _disp) = lookups

            with st.spinner("Running LLM-based mapping..."):
                result_df = process_rows(
                    input_df.copy(),
                    func_resolution,
                    subfunc_lookup,
                    title_exact, title_by_func, all_master_titles,
                    col_title, col_function, col_subfunction,
                )
            st.session_state["result_df"] = result_df

    if can_run and "result_df" in st.session_state:
        result_df = st.session_state["result_df"]
        st.success(f"Mapping complete. {len(result_df)} rows processed.")
        st.dataframe(result_df, use_container_width=True)

st.divider()

# ---------------------------------------------------------------------------
# 6. Download Output
# ---------------------------------------------------------------------------
with st.container(border=True):
    _step("6", "Download Output")

    if not can_run or "result_df" not in st.session_state:
        st.info("Run the rationalisation in Step 5 to generate downloadable output.")
    else:
        result_df = st.session_state["result_df"]
        st.download_button(
            label="Download as Excel",
            data=to_excel_bytes(result_df),
            file_name="rationalised_output.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
