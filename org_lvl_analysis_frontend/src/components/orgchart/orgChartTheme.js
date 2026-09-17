// A&M brand palette and management-level styling for OrgSight 2.0.

export const AM = {
  navy: "#01244a",
  navyLight: "#0a3366",
  navyMid: "#1a4d7a",
  blue: "#0085ca",
  blueMid: "#5c8bb4",
  blueLight: "#dee7f0",
  gold: "#c5a84a",
  goldLight: "#f3e9c4",
  white: "#ffffff",
  bg: "#f4f6f9",
  cardBg: "#ffffff",
  textPrimary: "#01244a",
  textSecondary: "#4a6a8a",
  textMuted: "#8a9ab4",
  border: "#dce4ee",
  borderLight: "#e8eef5",
  danger: "#d94f4f",
  dangerLight: "#fde7e7",
  success: "#2e9e6a",
  successLight: "#e3f5ec",
  warning: "#d4a942",
};

/**
 * Header stripe coloring per organisation level. Lower levels are progressively
 * lighter so the visual hierarchy is preserved at a glance.
 */
export function headerColorForLevel(level) {
  const lvl = Number(level) || 0;
  if (lvl <= 1) return { bg: AM.navy, dot: AM.gold };
  if (lvl === 2) return { bg: AM.navyLight, dot: AM.gold };
  if (lvl === 3) return { bg: AM.navyMid, dot: AM.blue };
  if (lvl === 4) return { bg: "#2d5a85", dot: AM.blue };
  return { bg: "#3d6a95", dot: AM.blueMid };
}

/**
 * Best-effort human label for the level. Prefer the row's own management-level
 * column if the dataset has one; otherwise fall back to a Lk numeric label.
 */
export function headerLabel(record, level, jobTitleCol) {
  const lvl = Number(level) || 0;
  let mgmt = null;
  for (const key of [
    "Management Level",
    "managementLevel",
    "Mgmt Level",
    "Level Label",
  ]) {
    if (record[key]) {
      mgmt = String(record[key]);
      break;
    }
  }
  if (!mgmt && jobTitleCol && record[jobTitleCol]) {
    const t = String(record[jobTitleCol]).toLowerCase();
    if (t.includes("chief") || t.includes("ceo")) mgmt = "Executive";
    else if (t.startsWith("svp") || t.includes("senior vp")) mgmt = "SVP";
    else if (t.startsWith("vp") || t.includes("vice president")) mgmt = "VP";
    else if (t.includes("director")) mgmt = "Director";
    else if (t.includes("manager")) mgmt = "Manager";
  }
  if (!mgmt) {
    if (lvl <= 1) mgmt = "Executive";
    else if (lvl === 2) mgmt = "VP";
    else if (lvl === 3) mgmt = "Director";
    else if (lvl === 4) mgmt = "Manager";
    else mgmt = "Staff";
  }
  return `L${lvl} · ${mgmt}`;
}
