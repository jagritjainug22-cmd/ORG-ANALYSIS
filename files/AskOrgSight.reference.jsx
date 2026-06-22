/**
 * ASK ORGSIGHT — Frontend Reference for Cursor (v3)
 *
 * Updated with:
 *  - Dynamic display modes: text / table / chart / table+chart
 *  - DataTable component with sorting and CSV export
 *  - DynamicChart renders spec + data from backend
 *  - Suggestion chips for common questions
 *  - Conversation history (last 6 turns)
 *
 * Dependencies: recharts (add to package.json)
 * Integration: lives in ProjectWorkspace as the "Ask OrgSight" tab
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const CHART_COLORS = ["#1e3a5f", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AskOrgSight({ projectId, datasetId, scenarioId, onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keep only last 6 messages for conversation history (3 turns)
  const conversationHistory = useMemo(() => {
    return messages
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
  }, [messages]);

  const sendMessage = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || isLoading) return;

    const userMsg = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/chat/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: msg,
          dataset_id: datasetId,
          scenario_id: scenarioId,
          conversation_history: conversationHistory,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }

      const data = await res.json();

      const assistantMsg = {
        role: "assistant",
        content: data.reply,
        display: data.display || "text",
        data: data.data || null,
        chart: data.chart || null,
        navigation: data.navigation || null,
        toolsUsed: data.tools_used || [],
      };

      setMessages(prev => [...prev, assistantMsg]);

      if (data.navigation && onNavigate) {
        onNavigate(data.navigation.target);
      }
    } catch (err) {
      console.error("Ask OrgSight error:", err);
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${err.message}`, display: "text" },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, projectId, datasetId, scenarioId, conversationHistory, onNavigate]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxHeight: "calc(100vh - 120px)" }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.length === 0 && <EmptyState onSelect={sendMessage} />}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {isLoading && (
          <div style={{ padding: "12px 16px", color: "#6b7280", fontStyle: "italic" }}>
            Analyzing your data...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: "1px solid #e5e7eb", padding: "12px 16px", display: "flex", gap: "8px" }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your org data..."
          rows={1}
          style={{
            flex: 1, resize: "none", border: "1px solid #d1d5db", borderRadius: "8px",
            padding: "8px 12px", fontSize: "14px", outline: "none",
          }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={isLoading || !input.trim()}
          style={{
            padding: "8px 20px",
            backgroundColor: isLoading || !input.trim() ? "#9ca3af" : "#1e3a5f",
            color: "white", border: "none", borderRadius: "8px",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            fontSize: "14px", fontWeight: 500,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}


// =============================================================================
// MESSAGE BUBBLE — renders text + optional table + optional chart
// =============================================================================

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const display = message.display || "text";
  const [showTable, setShowTable] = useState(display === "table");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", maxWidth: "90%" }}>
      {/* Reply text */}
      <div style={{
        padding: "10px 14px", borderRadius: "12px",
        backgroundColor: isUser ? "#1e3a5f" : "#f3f4f6",
        color: isUser ? "white" : "#1f2937",
        fontSize: "14px", lineHeight: "1.5", whiteSpace: "pre-wrap",
      }}>
        {message.content}
      </div>

      {/* Chart (above table when both present) */}
      {(display === "chart" || display === "table+chart") && message.chart && message.data && (
        <div style={{ marginTop: "8px", width: "100%", maxWidth: "600px" }}>
          <DynamicChart spec={message.chart} data={message.data.rows} />
        </div>
      )}

      {/* Table toggle for table+chart mode */}
      {display === "table+chart" && message.data && (
        <button
          onClick={() => setShowTable(!showTable)}
          style={{
            marginTop: "6px", padding: "4px 12px", fontSize: "12px",
            border: "1px solid #d1d5db", borderRadius: "12px",
            backgroundColor: "white", color: "#6b7280", cursor: "pointer",
          }}
        >
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      )}

      {/* Data table */}
      {(display === "table" || (display === "table+chart" && showTable)) && message.data && (
        <div style={{ marginTop: "8px", width: "100%", overflowX: "auto" }}>
          <DataTable columns={message.data.columns} rows={message.data.rows} />
        </div>
      )}

      {/* Navigation indicator */}
      {message.navigation && (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#6b7280", fontStyle: "italic" }}>
          Navigating to {message.navigation.target}...
        </div>
      )}
    </div>
  );
}


// =============================================================================
// DATA TABLE — sortable, compact, with CSV export
// =============================================================================

function DataTable({ columns, rows }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  if (!rows || rows.length === 0) return null;

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [rows, sortCol, sortDir]);

  const exportCSV = () => {
    const header = columns.join(",");
    const body = sortedRows.map(r => columns.map(c => {
      const v = r[c];
      return typeof v === "string" && v.includes(",") ? `"${v}"` : v;
    }).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "orgsight_data.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatValue = (v) => {
    if (v == null) return "—";
    if (typeof v === "number") {
      return Math.abs(v) >= 1000 ? v.toLocaleString() : v;
    }
    return String(v);
  };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", backgroundColor: "white" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px", borderBottom: "1px solid #f3f4f6" }}>
        <button onClick={exportCSV} style={{
          fontSize: "11px", color: "#6b7280", background: "none", border: "none", cursor: "pointer",
        }}>
          Export CSV
        </button>
      </div>
      <div style={{ overflowX: "auto", maxHeight: "320px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  style={{
                    padding: "6px 10px", textAlign: "left", borderBottom: "2px solid #e5e7eb",
                    backgroundColor: "#f9fafb", cursor: "pointer", whiteSpace: "nowrap",
                    fontWeight: 600, color: "#374151", position: "sticky", top: 0,
                  }}
                >
                  {col} {sortCol === col ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "white" : "#f9fafb" }}>
                {columns.map(col => (
                  <td key={col} style={{
                    padding: "5px 10px", borderBottom: "1px solid #f3f4f6",
                    whiteSpace: "nowrap", color: "#4b5563",
                    textAlign: typeof row[col] === "number" ? "right" : "left",
                  }}>
                    {formatValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "4px 10px", fontSize: "11px", color: "#9ca3af", borderTop: "1px solid #f3f4f6" }}>
        {rows.length} row{rows.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}


// =============================================================================
// DYNAMIC CHART
// =============================================================================

function DynamicChart({ spec, data }) {
  if (!data || data.length === 0) return null;

  const { chart_type, title, x, y } = spec;
  const commonProps = { data, margin: { top: 10, right: 20, left: 10, bottom: 10 } };

  const renderChart = () => {
    switch (chart_type) {
      case "bar":
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={x} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : v} />
            <Bar dataKey={y} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return (
          <BarChart {...commonProps} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey={x} type="category" tick={{ fontSize: 11 }} width={140} />
            <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : v} />
            <Bar dataKey={y} fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        );
      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={x} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey={y} stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        );
      case "pie":
        return (
          <PieChart>
            <Pie data={data} dataKey={y} nameKey={x} cx="50%" cy="50%" outerRadius={100} label={{ fontSize: 11 }}>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        );
      case "scatter":
        return (
          <ScatterChart {...commonProps}>
            <CartesianGrid />
            <XAxis dataKey={x} tick={{ fontSize: 11 }} />
            <YAxis dataKey={y} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Scatter data={data} fill={CHART_COLORS[0]} />
          </ScatterChart>
        );
      case "area":
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={x} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey={y} stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.2} />
          </AreaChart>
        );
      default:
        return <div style={{ color: "#9ca3af", padding: "20px", textAlign: "center" }}>Unsupported chart type: {chart_type}</div>;
    }
  };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px", backgroundColor: "white" }}>
      <div style={{ textAlign: "center", fontSize: "13px", fontWeight: 600, marginBottom: "8px", color: "#1e3a5f" }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}


// =============================================================================
// EMPTY STATE — suggestion chips
// =============================================================================

function EmptyState({ onSelect }) {
  const suggestions = [
    "Give me an org summary",
    "Headcount by country",
    "Top 10 highest cost employees",
    "Span of control distribution",
    "L2 leader breakdown",
    "Managers with fewer than 4 reports",
    "Compare our spans against benchmark",
    "What are the structural risks?",
  ];

  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "#6b7280" }}>
      <h3 style={{ fontSize: "18px", fontWeight: 600, color: "#1e3a5f", marginBottom: "8px" }}>
        Ask OrgSight
      </h3>
      <p style={{ fontSize: "14px", marginBottom: "24px" }}>
        Ask questions about your org data in plain English.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s)}
            style={{
              padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: "16px",
              backgroundColor: "white", fontSize: "12px", color: "#374151", cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
