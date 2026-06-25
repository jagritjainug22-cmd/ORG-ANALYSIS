/**
 * Tiered column-mapping readiness for Upload & Prepare and downstream modules.
 *
 * Core — required for cleanup, validate, hierarchy.
 * Rationalise — Function required for meaningful rationalisation output (backend dependency).
 */

const CORE_FIELDS = [
  { key: "empCol", label: "Employee ID" },
  { key: "mgrCol", label: "Manager ID" },
  { key: "fteCol", label: "FTE" },
  { key: "flcCol", label: "Fully Loaded Cost (FLC)" },
  { key: "countryCol", label: "Country" },
  { key: "jobTitleCol", label: "Job Title" },
];

const RATIONALISE_REQUIRED = [{ key: "funcCol", label: "Function" }];
const RATIONALISE_RECOMMENDED = [{ key: "subfuncCol", label: "Sub-Function" }];

function pick(cols, field) {
  const v = cols[field.key];
  return v && String(v).trim() ? null : field.label;
}

/**
 * @param {Record<string, string>} cols — empCol, mgrCol, funcCol, etc.
 * @returns readiness object for UI banners
 */
export function computeColumnReadiness(cols) {
  const missingCore = CORE_FIELDS.map((f) => pick(cols, f)).filter(Boolean);
  const missingRationalise = RATIONALISE_REQUIRED.map((f) => pick(cols, f)).filter(Boolean);
  const missingRecommended = RATIONALISE_RECOMMENDED.map((f) => pick(cols, f)).filter(Boolean);

  let level = "ready";
  let requiresAttention = false;
  let message = "";

  if (missingCore.length > 0) {
    level = "blocked";
    requiresAttention = true;
    message = `Necessary column(s) [${missingCore.join(", ")}] are not mapped. Set them in Column Configuration, then click Save Config.`;
  } else if (missingRationalise.length > 0) {
    level = "partial";
    requiresAttention = true;
    message =
      "Core columns mapped. Map Function before Rationalise — subfunction and title mapping depend on it. Save Config after updating.";
  } else if (missingRecommended.length > 0) {
    level = "ready";
    requiresAttention = false;
    message =
      "Core and Function mapped. Sub-Function is optional but recommended for full subfunction rationalisation.";
  } else {
    level = "ready";
    requiresAttention = false;
    message = "All columns mapped for cleanup and rationalisation.";
  }

  return {
    level,
    requiresAttention,
    message,
    missingCore,
    missingRationalise,
    missingRecommended,
    summary: {
      unmapped_core: missingCore.map((label) => ({ label })),
      unmapped_rationalise: missingRationalise.map((label) => ({ label })),
      unmapped_recommended: missingRecommended.map((label) => ({ label })),
    },
  };
}

/** Build cols object from ProjectWorkspace state variables. */
export function columnStateFromWorkspace(state) {
  return {
    empCol: state.empCol,
    mgrCol: state.mgrCol,
    fteCol: state.fteCol,
    flcCol: state.flcCol,
    countryCol: state.countryCol,
    jobTitleCol: state.jobTitleCol,
    funcCol: state.funcCol,
    subfuncCol: state.subfuncCol,
  };
}

/** Build cols from auto-map API mappings (target_id → source_column). */
export function columnStateFromMappings(mappings) {
  const g = (id) => (mappings?.[id]?.source_column || "").trim();
  return {
    empCol: g("employee_id"),
    mgrCol: g("manager_id"),
    fteCol: g("fte"),
    flcCol: g("flc"),
    countryCol: g("country"),
    jobTitleCol: g("job_title"),
    funcCol: g("function"),
    subfuncCol: g("subfunction"),
  };
}

/** Build cols from saved dataset DB record. */
export function columnStateFromDataset(dataset) {
  if (!dataset) return columnStateFromWorkspace({});
  return {
    empCol: dataset.emp_col || "",
    mgrCol: dataset.mgr_col || "",
    fteCol: dataset.fte_col || "",
    flcCol: dataset.flc_col || "",
    countryCol: dataset.country_col || "",
    jobTitleCol: dataset.job_title_col || "",
    funcCol: dataset.func_col || "",
    subfuncCol: dataset.subfunc_col || "",
  };
}

/** Apply readiness to React state setters. */
export function applyReadinessToState(readiness, setters) {
  setters.setColumnMappingMessage(readiness.message);
  setters.setColumnMappingRequiresAttention(readiness.requiresAttention);
  setters.setColumnMappingSummary((prev) => ({
    ...(prev || {}),
    ...readiness.summary,
  }));
  setters.setColumnReadiness?.(readiness);
}
