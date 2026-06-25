// Client-side search ranking for org-chart employee lookup.

function getRecordSearchFields(record, { empCol, jobTitleCol, countryCol }) {
  return {
    empId: String(record.__emp_id ?? record[empCol] ?? ""),
    empName: String(record[empCol] ?? ""),
    jobTitle: String((jobTitleCol && record[jobTitleCol]) || record["Job Title"] || ""),
    country: String(countryCol && record[countryCol] ? record[countryCol] : ""),
    division: String(record.Division ?? ""),
  };
}

/**
 * Higher score = better match. Zero means no match.
 */
export function scoreSearchMatch(fields, term) {
  const q = term.trim().toLowerCase();
  if (!q) return 0;

  const idL = fields.empId.toLowerCase();
  const nameL = fields.empName.toLowerCase();
  const titleL = fields.jobTitle.toLowerCase();

  if (idL === q) return 100;
  if (nameL === q) return 90;
  if (idL.startsWith(q)) return 80;
  if (nameL.startsWith(q)) return 70;
  if (titleL.startsWith(q)) return 60;

  const haystack = [fields.empName, fields.jobTitle, fields.country, fields.division]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return 40;
  return 0;
}

/**
 * Rank pre-filtered records by search relevance (best first).
 * Each entry: { id, record, score, level }.
 */
export function rankSearchMatches(records, term, columnOptions) {
  const q = term.trim().toLowerCase();
  if (!q || !records?.length) return [];

  return records
    .map((record) => {
      const fields = getRecordSearchFields(record, columnOptions);
      const score = scoreSearchMatch(fields, q);
      if (score <= 0) return null;
      const level = Number(record.Level) || 999;
      return { id: fields.empId, record, score, level, label: fields.empName || fields.empId };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.level !== b.level) return a.level - b.level;
      return a.label.localeCompare(b.label);
    });
}
