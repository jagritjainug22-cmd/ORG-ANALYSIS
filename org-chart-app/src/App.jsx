import { useState, useMemo, useCallback, useRef, useEffect } from "react";

// ── A&M Brand Colors ──
const AM = {
  navy: "#01244a",
  navyLight: "#0a3366",
  blue: "#0085ca",
  blueMid: "#5c8bb4",
  blueLight: "#dee7f0",
  gold: "#c5a84a",
  white: "#ffffff",
  bg: "#f4f6f9",
  cardBg: "#ffffff",
  textPrimary: "#01244a",
  textSecondary: "#4a6a8a",
  textMuted: "#8a9ab4",
  border: "#dce4ee",
  borderLight: "#e8eef5",
  danger: "#d94f4f",
  success: "#2e9e6a",
};

const MGMT_COLORS = {
  "Executive": { bg: AM.navy, text: AM.white, badge: AM.gold },
  "VP": { bg: "#0d3a6e", text: AM.white, badge: AM.gold },
  "SVP": { bg: "#0d3a6e", text: AM.white, badge: AM.gold },
  "Director": { bg: AM.navyLight, text: AM.blueLight, badge: AM.blue },
  "Manager": { bg: "#1a4d7a", text: AM.blueLight, badge: AM.blueMid },
  "Staff": { bg: AM.cardBg, text: AM.textPrimary, badge: AM.blueMid },
  _default: { bg: AM.cardBg, text: AM.textPrimary, badge: AM.textMuted },
};

const getMgmtStyle = lvl => MGMT_COLORS[lvl] || MGMT_COLORS._default;
const isDark = lvl => ["Executive", "VP", "SVP", "Director", "Manager"].includes(lvl);

// ── Demo Data ──
const DEMO_DATA = [
  { employeeId: "100001", jobTitle: "Chief Executive Officer", functionalL1: "Executive", functionalL2: "Leadership", managementLevel: "Executive", fte: 1, salary: 450000, managerId: null, activeStatus: "Yes", jobFamilyGroup: "Executive", badgeNo: "B100001", workState: "Georgia", jobCode: "9999", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100002", jobTitle: "VP Revenue Cycle & Finance", functionalL1: "Revenue Cycle", functionalL2: "Leadership", managementLevel: "VP", fte: 1, salary: 195000, managerId: "100001", activeStatus: "Yes", jobFamilyGroup: "Revenue Cycle", badgeNo: "B100002", workState: "Georgia", jobCode: "9001", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100003", jobTitle: "VP Information Technology", functionalL1: "IT", functionalL2: "Leadership", managementLevel: "VP", fte: 1, salary: 205000, managerId: "100001", activeStatus: "Yes", jobFamilyGroup: "IT", badgeNo: "B100003", workState: "Georgia", jobCode: "9002", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100004", jobTitle: "VP Operations", functionalL1: "Supply Chain", functionalL2: "Leadership", managementLevel: "VP", fte: 1, salary: 188000, managerId: "100001", activeStatus: "Yes", jobFamilyGroup: "Supply Chain & Logistics", badgeNo: "B100004", workState: "Georgia", jobCode: "9003", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100010", jobTitle: "Director PFS", functionalL1: "Revenue Cycle", functionalL2: "Revenue Cycle PFS", managementLevel: "Director", fte: 1, salary: 155000, managerId: "100002", activeStatus: "Yes", jobFamilyGroup: "Revenue Cycle", badgeNo: "B100010", workState: "Georgia", jobCode: "8501", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100011", jobTitle: "Director Coding", functionalL1: "Revenue Cycle", functionalL2: "Coding", managementLevel: "Director", fte: 1, salary: 148000, managerId: "100002", activeStatus: "Yes", jobFamilyGroup: "Medical Quality and Regulatory", badgeNo: "B100011", workState: "Georgia", jobCode: "8502", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100012", jobTitle: "Director IT Infrastructure", functionalL1: "IT", functionalL2: "IT Infrastructure", managementLevel: "Director", fte: 1, salary: 172000, managerId: "100003", activeStatus: "Yes", jobFamilyGroup: "IT", badgeNo: "B100012", workState: "Georgia", jobCode: "8503", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100013", jobTitle: "Director Applications", functionalL1: "IT", functionalL2: "Application & Data Administration", managementLevel: "Director", fte: 1, salary: 168000, managerId: "100003", activeStatus: "Yes", jobFamilyGroup: "IT", badgeNo: "B100013", workState: "Georgia", jobCode: "8504", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100020", jobTitle: "Sr Project Coordinator", functionalL1: "Revenue Cycle", functionalL2: "Revenue Cycle PFS", managementLevel: "Staff", fte: 1, salary: 102049, managerId: "100010", activeStatus: "Yes", jobFamilyGroup: "Revenue Cycle", badgeNo: "1009313", workState: "Georgia", jobCode: "8162", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100021", jobTitle: "Reimbursement Auditor", functionalL1: "Revenue Cycle", functionalL2: "Revenue Cycle PFS", managementLevel: "Staff", fte: 0.5, salary: 46675, managerId: "100010", activeStatus: "Yes", jobFamilyGroup: "Revenue Cycle", badgeNo: "1044975", workState: "Georgia", jobCode: "7590", workerType: "Employee", employeeType: "Regular", programmedHours: 20 },
  { employeeId: "100022", jobTitle: "Sr Reimbursement Analyst", functionalL1: "Revenue Cycle", functionalL2: "Reimbursement", managementLevel: "Staff", fte: 1, salary: 93350, managerId: "100010", activeStatus: "Yes", jobFamilyGroup: "Finance", badgeNo: "1050066", workState: "Georgia", jobCode: "8172", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100023", jobTitle: "Charge Capture Analyst", functionalL1: "Revenue Cycle", functionalL2: "Coding", managementLevel: "Staff", fte: 1, salary: 69044, managerId: "100011", activeStatus: "Yes", jobFamilyGroup: "Medical Quality and Regulatory", badgeNo: "1094909", workState: "Georgia", jobCode: "6086", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100030", jobTitle: "Network Engineer", functionalL1: "IT", functionalL2: "IT Infrastructure", managementLevel: "Staff", fte: 1, salary: 118777, managerId: "100012", activeStatus: "Yes", jobFamilyGroup: "IT", badgeNo: "1051417", workState: "Georgia", jobCode: "7052", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100031", jobTitle: "Sr Service Analyst", functionalL1: "IT", functionalL2: "IT Help Desk", managementLevel: "Staff", fte: 1, salary: 96550, managerId: "100012", activeStatus: "Yes", jobFamilyGroup: "IT", badgeNo: "1044830", workState: "Georgia", jobCode: "8178", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100032", jobTitle: "Sr Application Analyst", functionalL1: "IT", functionalL2: "Application & Data Administration", managementLevel: "Staff", fte: 1, salary: 123328, managerId: "100013", activeStatus: "Yes", jobFamilyGroup: "IT", badgeNo: "1000012", workState: "Georgia", jobCode: "8271", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
  { employeeId: "100040", jobTitle: "Sr Category Leader", functionalL1: "Supply Chain", functionalL2: "Category Management", managementLevel: "Staff", fte: 1, salary: 113443, managerId: "100004", activeStatus: "Yes", jobFamilyGroup: "Supply Chain & Logistics", badgeNo: "1009747", workState: "Georgia", jobCode: "8111", workerType: "Employee", employeeType: "Regular", programmedHours: 40 },
];

// ── Helpers ──
function buildTree(data, parentId = null) {
  return data.filter(d => d.managerId === parentId).map(d => ({ ...d, children: buildTree(data, d.employeeId) }));
}
function getSubtreeIds(id, data) {
  const ids = [id];
  const find = pid => data.filter(d => d.managerId === pid).forEach(c => { ids.push(c.employeeId); find(c.employeeId); });
  find(id); return ids;
}
function subtreeStats(id, data) {
  const ids = getSubtreeIds(id, data);
  const p = data.filter(d => ids.includes(d.employeeId));
  return { hc: p.length, fte: p.reduce((s, x) => s + (x.fte || 0), 0), sal: p.reduce((s, x) => s + (x.salary || 0), 0) };
}
function isDesc(nid, aid, data) {
  let c = data.find(d => d.employeeId === nid);
  while (c) { if (c.employeeId === aid) return true; c = data.find(d => d.employeeId === c.managerId); }
  return false;
}
function getAncestors(id, data) {
  const anc = []; let c = data.find(d => d.employeeId === id);
  while (c?.managerId) { anc.push(c.managerId); c = data.find(d => d.employeeId === c.managerId); }
  return anc;
}
const fmt$ = n => "$" + (n || 0).toLocaleString();

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const rawHeaders = lines[0].split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const headers = rawHeaders.map(h => h.replace(/"/g, "").trim());
  const colMap = {};
  const aliases = {
    employeeId: ["employee id", "employeeid", "emp id", "empid", "worker id", "id"],
    jobTitle: ["job title", "jobtitle", "title", "position title"],
    jobCode: ["job code", "jobcode"],
    jobFamilyGroup: ["job family group", "jobfamilygroup", "job family"],
    functionalL1: ["functional l1", "functionall1", "func l1", "function l1"],
    functionalL2: ["functional l2", "functionall2", "func l2", "function l2"],
    managementLevel: ["management level", "managementlevel", "mgmt level", "level"],
    workerType: ["worker type", "workertype"],
    employeeType: ["employee type", "employeetype"],
    activeStatus: ["active status", "activestatus", "active"],
    fte: ["fte", "total fte"],
    programmedHours: ["programmed hours", "programmedhours", "hours"],
    managerId: ["manager id", "managerid", "mgr id", "supervisor id", "reports to"],
    badgeNo: ["badge no", "badgeno", "badge"],
    workState: ["work address - state/province", "work state", "workstate", "state"],
    salary: ["salary", "annual salary", "compensation"],
  };
  headers.forEach((h, i) => {
    const low = h.toLowerCase().trim();
    for (const [key, alts] of Object.entries(aliases)) {
      if (alts.includes(low)) { colMap[key] = i; break; }
    }
  });
  return lines.slice(1).map(line => {
    const cols = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, "").trim());
    const get = key => cols[colMap[key]] || "";
    const salRaw = get("salary").replace(/[$,]/g, "");
    return {
      employeeId: get("employeeId") || String(Math.random()).slice(2, 10),
      jobTitle: get("jobTitle") || "Unknown",
      jobCode: get("jobCode"), jobFamilyGroup: get("jobFamilyGroup"),
      functionalL1: get("functionalL1") || "Other", functionalL2: get("functionalL2"),
      managementLevel: get("managementLevel") || "Staff",
      workerType: get("workerType"), employeeType: get("employeeType"),
      activeStatus: get("activeStatus") || "Yes",
      fte: parseFloat(get("fte")) || 1,
      programmedHours: parseInt(get("programmedHours")) || 40,
      managerId: get("managerId") || null,
      badgeNo: get("badgeNo"), workState: get("workState"),
      salary: parseFloat(salRaw) || 0,
    };
  });
}

// ── Components ──
const Badge = ({ label, color, dark }) => (
  <span style={{
    background: color, color: dark ? AM.navy : AM.white, fontSize: 9, fontWeight: 700,
    padding: "2px 7px", borderRadius: 4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    letterSpacing: "0.6px", whiteSpace: "nowrap",
  }}>{label}</span>
);

const NodeCard = ({ node, data, depth, state, actions, spotlight }) => {
  const s = getMgmtStyle(node.managementLevel);
  const dark = isDark(node.managementLevel);
  const isEdit = state.editing === node.employeeId;
  const isSel = state.selectedId === node.employeeId;
  const hasKids = node.children?.length > 0;
  const isCollapsed = state.collapsed.has(node.employeeId);
  const stats = hasKids ? subtreeStats(node.employeeId, data) : null;
  const spotlitIds = spotlight ? [...getAncestors(spotlight, data), spotlight, ...data.filter(d => d.managerId === spotlight).map(d => d.employeeId)] : null;
  const dimmed = spotlight && !spotlitIds.includes(node.employeeId);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: dimmed ? 0.2 : 1, transition: "opacity 0.25s" }}>
      <div
        draggable={!isEdit}
        onDragStart={e => { e.stopPropagation(); actions.setDragId(node.employeeId); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); actions.doDrop(node.employeeId); }}
        onClick={() => actions.setSelectedId(isSel ? null : node.employeeId)}
        style={{
          background: s.bg,
          border: `2px solid ${isSel ? AM.gold : dark ? "#ffffff15" : AM.border}`,
          borderRadius: 10,
          padding: "14px 18px",
          minWidth: 190, maxWidth: 230,
          cursor: isEdit ? "default" : "grab",
          transition: "all 0.15s ease",
          boxShadow: isSel ? `0 0 0 3px ${AM.gold}33, 0 4px 16px #00000018` : `0 2px 8px #00000010`,
          position: "relative",
        }}
      >
        {/* Badges */}
        <div style={{ position: "absolute", top: -9, right: 10, display: "flex", gap: 4 }}>
          <Badge label={node.managementLevel?.slice(0, 3).toUpperCase() || "STF"} color={s.badge} dark={!dark} />
          {node.fte < 1 && <Badge label={`${node.fte} FTE`} color={AM.danger} />}
          {node.activeStatus !== "Yes" && <Badge label="INACTIVE" color="#888" />}
        </div>

        {isEdit ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
            {["jobTitle", "functionalL1", "managementLevel"].map(f => (
              <input key={f} value={state.editBuf[f] || ""} onChange={e => actions.setEditBuf({ ...state.editBuf, [f]: e.target.value })}
                placeholder={f} autoFocus={f === "jobTitle"}
                style={{ background: dark ? "#ffffff15" : "#f0f4f8", border: `1px solid ${dark ? "#ffffff25" : AM.border}`, borderRadius: 6, padding: "5px 8px", color: dark ? AM.white : AM.textPrimary, fontSize: 12, fontFamily: "Inter, system-ui, sans-serif", outline: "none" }} />
            ))}
            <input value={state.editBuf.salary || ""} onChange={e => actions.setEditBuf({ ...state.editBuf, salary: Number(e.target.value) || 0 })}
              placeholder="Salary" style={{ background: dark ? "#ffffff15" : "#f0f4f8", border: `1px solid ${dark ? "#ffffff25" : AM.border}`, borderRadius: 6, padding: "5px 8px", color: dark ? AM.white : AM.textPrimary, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", outline: "none" }} />
            <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
              <button onClick={e => { e.stopPropagation(); actions.saveEdit(node.employeeId); }} style={{ flex: 1, background: AM.blue, border: "none", borderRadius: 6, color: AM.white, fontSize: 11, fontWeight: 600, padding: "6px 0", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif" }}>Save</button>
              <button onClick={e => { e.stopPropagation(); actions.setEditing(null); }} style={{ flex: 1, background: dark ? "#ffffff15" : "#e8eef5", border: "none", borderRadius: 6, color: dark ? AM.blueLight : AM.textSecondary, fontSize: 11, padding: "6px 0", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontWeight: 700, fontSize: 13, color: dark ? AM.white : AM.textPrimary, lineHeight: 1.35, marginTop: 2 }}>{node.jobTitle}</div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 10, color: dark ? "#ffffff55" : AM.textMuted, marginTop: 3 }}>ID: {node.employeeId}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: dark ? AM.blue : AM.blue, fontWeight: 600, fontFamily: "Inter, system-ui, sans-serif" }}>{node.functionalL1}</span>
              <span style={{ fontSize: 10, color: dark ? "#ffffff33" : AM.textMuted }}>·</span>
              <span style={{ fontSize: 10, color: dark ? "#ffffffaa" : AM.textSecondary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{fmt$(node.salary)}</span>
            </div>
            {stats && (
              <div style={{ marginTop: 8, padding: "5px 8px", background: dark ? "#ffffff0a" : "#f0f4f8", borderRadius: 6, display: "flex", gap: 10 }}>
                <span style={{ fontSize: 9, color: dark ? "#ffffff66" : AM.textMuted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{stats.hc} ppl</span>
                <span style={{ fontSize: 9, color: dark ? "#ffffff66" : AM.textMuted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{stats.fte} FTE</span>
                <span style={{ fontSize: 9, color: dark ? "#ffffff66" : AM.textMuted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{fmt$(stats.sal)}</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 4, marginTop: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <CardBtn label="Edit" dark={dark} onClick={e => { e.stopPropagation(); actions.startEdit(node); }} />
              <CardBtn label="+ Add" dark={dark} onClick={e => { e.stopPropagation(); actions.addChild(node.employeeId); }} />
              {hasKids && <CardBtn label={isCollapsed ? "▶" : "▼"} dark={dark} onClick={e => { e.stopPropagation(); actions.toggleCollapse(node.employeeId); }} />}
              <CardBtn label="◎" dark={dark} onClick={e => { e.stopPropagation(); actions.toggleSpotlight(node.employeeId); }} title="Spotlight" />
              {node.managerId && <CardBtn label="✕" dark={dark} danger onClick={e => { e.stopPropagation(); actions.deleteNode(node.employeeId); }} />}
            </div>
          </>
        )}
      </div>

      {hasKids && !isCollapsed && (
        <>
          <div style={{ width: 2, height: 20, background: AM.border }} />
          <div style={{ position: "relative", display: "flex" }}>
            {node.children.length > 1 && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: `calc(100% - 190px)`, height: 2, background: AM.border }} />}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {node.children.map(ch => (
                <div key={ch.employeeId} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 2, height: 16, background: AM.border }} />
                  <NodeCard node={ch} data={data} depth={depth + 1} state={state} actions={actions} spotlight={spotlight} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const CardBtn = ({ label, onClick, dark, danger, title }) => (
  <button onClick={onClick} title={title} style={{
    background: danger ? (dark ? "#ff4d4f20" : "#fff0f0") : (dark ? "#ffffff12" : "#f0f4f8"),
    border: "none", borderRadius: 5, color: danger ? AM.danger : (dark ? "#ffffffbb" : AM.textSecondary),
    fontSize: 10, padding: "3px 8px", cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif",
    transition: "background 0.15s",
  }}>{label}</button>
);

const DetailPanel = ({ node, onClose }) => {
  if (!node) return null;
  const fields = [
    ["Employee ID", node.employeeId], ["Badge No", node.badgeNo], ["Job Code", node.jobCode],
    ["Job Title", node.jobTitle], ["Job Family Group", node.jobFamilyGroup],
    ["Functional L1", node.functionalL1], ["Functional L2", node.functionalL2],
    ["Management Level", node.managementLevel], ["Worker Type", node.workerType],
    ["Employee Type", node.employeeType], ["Active Status", node.activeStatus],
    ["FTE", node.fte], ["Hours", node.programmedHours],
    ["Manager ID", node.managerId || "—"], ["State", node.workState],
    ["Salary", fmt$(node.salary)],
  ];
  return (
    <div style={{ width: 300, borderLeft: `2px solid ${AM.border}`, background: AM.white, padding: 20, overflow: "auto", flexShrink: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: AM.navy }}>Employee Details</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: AM.textMuted, fontSize: 18, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ background: AM.navy, borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ color: AM.white, fontWeight: 700, fontSize: 14 }}>{node.jobTitle}</div>
        <div style={{ color: AM.blueMid, fontSize: 11, marginTop: 3 }}>{node.functionalL1} · {node.functionalL2}</div>
      </div>
      {fields.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${AM.borderLight}` }}>
          <span style={{ fontSize: 11, color: AM.textMuted }}>{k}</span>
          <span style={{ fontSize: 11, color: AM.textPrimary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
};

// ── Upload Screen ──
const UploadScreen = ({ onLoad, onDemo }) => {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef();
  const handleFile = file => {
    const reader = new FileReader();
    reader.onload = e => { const d = parseCSV(e.target.result); if (d.length) onLoad(d); };
    reader.readAsText(file);
  };
  return (
    <div style={{ minHeight: "100vh", background: AM.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 520 }}>
        <div style={{ width: 64, height: 64, background: AM.navy, borderRadius: 12, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: AM.gold, fontSize: 28, fontWeight: 700, fontFamily: "Inter, system-ui, sans-serif" }}>A</span>
        </div>
        <h1 style={{ color: AM.navy, fontSize: 28, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.5px" }}>Org Chart Builder</h1>
        <p style={{ color: AM.textSecondary, fontSize: 14, margin: "0 0 32px" }}>Upload your employee data to build an interactive org chart</p>

        <div
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={e => { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => inputRef.current.click()}
          style={{
            border: `2px dashed ${dragActive ? AM.blue : AM.border}`,
            borderRadius: 14, padding: "48px 32px", cursor: "pointer",
            background: dragActive ? `${AM.blue}08` : AM.white,
            transition: "all 0.2s",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
          <div style={{ color: AM.textPrimary, fontSize: 15, fontWeight: 600 }}>Drop CSV / TSV file here</div>
          <div style={{ color: AM.textMuted, fontSize: 12, marginTop: 6 }}>or click to browse</div>
          <input ref={inputRef} type="file" accept=".csv,.tsv,.txt" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        </div>

        <div style={{ marginTop: 16, padding: "12px 16px", background: AM.white, borderRadius: 10, border: `1px solid ${AM.borderLight}`, textAlign: "left" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: AM.navy, marginBottom: 6 }}>Required columns:</div>
          <div style={{ fontSize: 11, color: AM.textSecondary, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            Employee ID, Manager ID, Job Title
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: AM.navy, marginTop: 8, marginBottom: 6 }}>Optional columns:</div>
          <div style={{ fontSize: 11, color: AM.textSecondary, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            Functional L1/L2, Management Level, FTE, Salary, Job Code, Badge No, Active Status, Work State, etc.
          </div>
        </div>

        <button onClick={onDemo} style={{
          marginTop: 20, background: "none", border: `1px solid ${AM.border}`, borderRadius: 8,
          color: AM.textSecondary, fontSize: 13, padding: "10px 24px", cursor: "pointer",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          or load demo data →
        </button>
      </div>
    </div>
  );
};

// ── Main ──
export default function App() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editBuf, setEditBuf] = useState({});
  const [dragId, setDragId] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [search, setSearch] = useState("");
  const [filterL1, setFilterL1] = useState("All");
  const [zoom, setZoom] = useState(0.75);
  const [spotlight, setSpotlight] = useState(null);
  const [errors, setErrors] = useState([]);

  // Validate data on load
  const loadData = useCallback(d => {
    const errs = [];
    const ids = new Set(d.map(x => x.employeeId));
    const orphans = d.filter(x => x.managerId && !ids.has(x.managerId));
    if (orphans.length) errs.push(`${orphans.length} orphan(s): Manager IDs not found — they'll appear as root nodes.`);
    const dupes = d.filter((x, i) => d.findIndex(y => y.employeeId === x.employeeId) !== i);
    if (dupes.length) errs.push(`${dupes.length} duplicate Employee ID(s) found.`);
    orphans.forEach(o => o.managerId = null);
    setErrors(errs);
    setData(d);
  }, []);

  if (!data) return <UploadScreen onLoad={loadData} onDemo={() => loadData(DEMO_DATA)} />;

  const allL1s = ["All", ...new Set(data.map(d => d.functionalL1).filter(Boolean))];
  const tree = buildTree(data, null);
  const selectedNode = data.find(d => d.employeeId === selectedId);
  const totalStats = { hc: data.length, fte: data.reduce((s, d) => s + (d.fte || 0), 0), sal: data.reduce((s, d) => s + (d.salary || 0), 0) };

  const actions = {
    setEditing, setEditBuf, setDragId,
    setSelectedId,
    startEdit: node => { setEditing(node.employeeId); setEditBuf({ jobTitle: node.jobTitle, functionalL1: node.functionalL1, managementLevel: node.managementLevel, salary: node.salary }); },
    saveEdit: id => { setData(prev => prev.map(d => d.employeeId === id ? { ...d, ...editBuf } : d)); setEditing(null); },
    deleteNode: id => { const ids = getSubtreeIds(id, data); setData(prev => prev.filter(d => !ids.includes(d.employeeId))); },
    addChild: parentId => {
      const newId = "NEW_" + Date.now();
      const parent = data.find(d => d.employeeId === parentId);
      const newNode = { employeeId: newId, jobTitle: "New Role", functionalL1: parent?.functionalL1 || "Other", functionalL2: "", managementLevel: "Staff", fte: 1, salary: 0, managerId: parentId, activeStatus: "Yes", jobFamilyGroup: "", badgeNo: "", workState: "Georgia", jobCode: "", workerType: "Employee", employeeType: "Regular", programmedHours: 40 };
      setData(prev => [...prev, newNode]);
      setEditing(newId); setEditBuf({ jobTitle: "New Role", functionalL1: parent?.functionalL1 || "Other", managementLevel: "Staff", salary: 0 });
    },
    doDrop: targetId => {
      if (!dragId || dragId === targetId || isDesc(targetId, dragId, data)) return;
      setData(prev => prev.map(d => d.employeeId === dragId ? { ...d, managerId: targetId } : d));
      setDragId(null);
    },
    toggleCollapse: id => setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    toggleSpotlight: id => setSpotlight(prev => prev === id ? null : id),
  };

  const collapseByLevel = lvl => {
    const map = { VP: ["VP", "SVP"], Director: ["VP", "SVP", "Director"], Manager: ["VP", "SVP", "Director", "Manager"] };
    const levels = map[lvl] || [];
    const toCollapse = data.filter(d => levels.includes(d.managementLevel) && data.some(c => c.managerId === d.employeeId)).map(d => d.employeeId);
    setCollapsed(new Set(toCollapse));
  };

  const exportJSON = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = "org-data.json"; a.click(); };
  const exportCSV = () => { const keys = Object.keys(data[0]); const csv = [keys.join(","), ...data.map(d => keys.map(k => `"${d[k] ?? ""}"`).join(","))].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "org-data.csv"; a.click(); };

  return (
    <div style={{ minHeight: "100vh", background: AM.bg, fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: AM.navy, padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 32, height: 32, background: AM.gold, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: AM.navy, fontSize: 16, fontWeight: 700 }}>A</span>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: AM.white, letterSpacing: "-0.3px" }}>Org Chart</h1>
            <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
              {[["Headcount", totalStats.hc], ["FTE", totalStats.fte], ["Payroll", fmt$(totalStats.sal)]].map(([l, v]) => (
                <span key={l} style={{ fontSize: 10, color: AM.blueMid, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                  {l}: <span style={{ color: AM.blueLight }}>{typeof v === "number" && l === "Payroll" ? v.toLocaleString() : v}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            style={{ background: "#ffffff12", border: "1px solid #ffffff20", borderRadius: 6, padding: "6px 10px", color: AM.white, fontSize: 12, fontFamily: "Inter, system-ui, sans-serif", outline: "none", width: 140 }} />
          <select value={filterL1} onChange={e => setFilterL1(e.target.value)}
            style={{ background: "#ffffff12", border: "1px solid #ffffff20", borderRadius: 6, padding: "6px 8px", color: AM.white, fontSize: 12, outline: "none", fontFamily: "Inter, system-ui, sans-serif" }}>
            {allL1s.map(l => <option key={l} value={l} style={{ background: AM.navy }}>{l}</option>)}
          </select>

          {/* Collapse by level */}
          <select defaultValue="" onChange={e => { if (e.target.value === "expand") setCollapsed(new Set()); else if (e.target.value) collapseByLevel(e.target.value); e.target.value = ""; }}
            style={{ background: "#ffffff12", border: "1px solid #ffffff20", borderRadius: 6, padding: "6px 8px", color: AM.blueMid, fontSize: 11, outline: "none", fontFamily: "Inter, system-ui, sans-serif" }}>
            <option value="" disabled style={{ background: AM.navy }}>Collapse...</option>
            <option value="VP" style={{ background: AM.navy }}>Below VP</option>
            <option value="Director" style={{ background: AM.navy }}>Below Director</option>
            <option value="Manager" style={{ background: AM.navy }}>Below Manager</option>
            <option value="expand" style={{ background: AM.navy }}>Expand All</option>
          </select>

          {/* Zoom */}
          <div style={{ display: "flex", background: "#ffffff12", borderRadius: 6, overflow: "hidden", border: "1px solid #ffffff20" }}>
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} style={{ background: "none", border: "none", color: AM.blueLight, padding: "4px 8px", cursor: "pointer", fontSize: 13 }}>−</button>
            <span style={{ padding: "4px 4px", fontSize: 10, color: AM.blueMid, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", minWidth: 34, textAlign: "center", lineHeight: "22px" }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(1.5, z + 0.1))} style={{ background: "none", border: "none", color: AM.blueLight, padding: "4px 8px", cursor: "pointer", fontSize: 13 }}>+</button>
          </div>

          <HdrBtn label={showRaw ? "Hide Data" : "Raw Data"} active={showRaw} onClick={() => setShowRaw(!showRaw)} />
          <HdrBtn label="JSON ↓" onClick={exportJSON} />
          <HdrBtn label="CSV ↓" onClick={exportCSV} />
          <HdrBtn label="↻ New" onClick={() => { setData(null); setErrors([]); }} />
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{ background: "#fff8e6", padding: "8px 24px", borderBottom: `1px solid #f0d060`, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <div style={{ fontSize: 12, color: "#8a6d00" }}>{errors.join(" | ")}</div>
          <button onClick={() => setErrors([])} style={{ marginLeft: "auto", background: "none", border: "none", color: "#8a6d00", cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Spotlight indicator */}
      {spotlight && (
        <div style={{ background: `${AM.gold}15`, padding: "6px 24px", borderBottom: `1px solid ${AM.gold}33`, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: AM.gold, fontWeight: 600 }}>◎ Spotlight: {data.find(d => d.employeeId === spotlight)?.jobTitle || spotlight}</span>
          <button onClick={() => setSpotlight(null)} style={{ background: AM.gold, border: "none", borderRadius: 4, color: AM.navy, fontSize: 10, fontWeight: 700, padding: "2px 8px", cursor: "pointer" }}>Clear</button>
        </div>
      )}

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: 40 }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center", transition: "transform 0.15s", display: "inline-flex", justifyContent: "center", width: "100%" }}>
            {tree.map(root => (
              <NodeCard key={root.employeeId} node={root} data={data} depth={0} state={{ editing, editBuf, collapsed, selectedId }} actions={actions} spotlight={spotlight} />
            ))}
          </div>
        </div>

        {selectedId && !showRaw && <DetailPanel node={selectedNode} onClose={() => setSelectedId(null)} />}

        {showRaw && (
          <div style={{ width: 380, borderLeft: `2px solid ${AM.border}`, background: AM.white, overflow: "auto", padding: 20, flexShrink: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: AM.navy, marginBottom: 4 }}>Raw Data</div>
            <div style={{ fontSize: 10, color: AM.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "1px" }}>Live sync — edits reflect here</div>
            <pre style={{
              background: "#f6f8fb", borderRadius: 8, padding: 14, fontSize: 10,
              color: AM.textSecondary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", lineHeight: 1.6,
              whiteSpace: "pre-wrap", wordBreak: "break-word", border: `1px solid ${AM.borderLight}`, maxHeight: "80vh", overflow: "auto",
            }}>{JSON.stringify(data, null, 2)}</pre>
          </div>
        )}
      </div>

      <style>{`
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${AM.border}; border-radius:3px; }
        ::selection { background: ${AM.blue}33; }
      `}</style>
    </div>
  );
}

const HdrBtn = ({ label, onClick, active }) => (
  <button onClick={onClick} style={{
    background: active ? AM.blue : "#ffffff12", border: `1px solid ${active ? AM.blue : "#ffffff20"}`, borderRadius: 6,
    color: active ? AM.white : AM.blueLight, fontSize: 11, fontWeight: 600, padding: "6px 12px",
    cursor: "pointer", fontFamily: "Inter, system-ui, sans-serif", transition: "all 0.15s",
  }}>{label}</button>
);
