/**
 * Ask OrgSight — Conversational AI chat panel for org data analysis.
 *
 * Renders inside ProjectWorkspace as the "Ask OrgSight" tab.
 * - Auto-inits DuckDB session on mount
 * - Sends natural language questions to POST /chat/message
 * - Renders text, tables, charts based on backend response
 * - Maintains conversation history (last 6 turns)
 *
 * Dependencies: recharts
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { chatEnsure, chatMessage } from "../api/backend";

const CHART_COLORS = ["#1e3a5f", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AskOrgSight({ projectId, datasetId, scenarioId, onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [initStatus, setInitStatus] = useState("idle"); // idle | loading | ready | error
  const [initError, setInitError] = useState(null);
  const messagesEndRef = useRef(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Init DuckDB on mount (or when dataset/scenario changes)
  useEffect(() => {
    if (!datasetId || !scenarioId) {
      setInitStatus("idle");
      return;
    }
    let cancelled = false;
    setInitStatus("loading");
    setInitError(null);
    chatEnsure(datasetId, scenarioId)
      .then(() => { if (!cancelled) setInitStatus("ready"); })
      .catch((err) => {
        if (!cancelled) {
          setInitStatus("error");
          setInitError(err?.response?.data?.detail || "Failed to initialise data session");
        }
      });
    return () => { cancelled = true; };
  }, [datasetId, scenarioId]);

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
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const data = await chatMessage(msg, datasetId, scenarioId, conversationHistory);

      // Backend returns: { response, data, columns, row_count, total_rows, source, sql, chart_hint, follow_ups, intent }
      // Transform the data array (list of dicts) into the shape our component expects
      const dataPayload = data.data && data.data.length > 0
        ? { columns: data.columns || Object.keys(data.data[0]), rows: data.data }
        : null;

      // Build chart spec from chart_hint if available
      let chartSpec = null;
      if (data.chart_hint && data.chart_hint !== "table" && data.chart_hint !== "kpi_cards" && dataPayload) {
        const cols = dataPayload.columns;
        const numericCol = cols.find((c) => {
          const sample = dataPayload.rows[0]?.[c];
          return typeof sample === "number";
        });
        const labelCol = cols.find((c) => {
          const sample = dataPayload.rows[0]?.[c];
          return typeof sample !== "number";
        });
        if (numericCol && labelCol) {
          chartSpec = {
            chart_type: data.chart_hint === "horizontal_bar" ? "horizontal_bar" : data.chart_hint,
            title: "",
            x: labelCol,
            y: numericCol,
          };
        }
      }

      // Determine display mode
      let display = "text";
      if (dataPayload && chartSpec) display = "table+chart";
      else if (dataPayload) display = "table";
      else if (chartSpec) display = "chart";

      const assistantMsg = {
        role: "assistant",
        content: data.response,
        display,
        data: dataPayload,
        chart: chartSpec,
        followUps: data.follow_ups || [],
        source: data.source,
      };

      setMessages((prev) => [...prev, assistantMsg]);

    } catch (err) {
      console.error("Ask OrgSight error:", err);
      const detail = err?.response?.data?.detail;
      const errorMsg = typeof detail === "string" ? detail
        : detail?.detail || detail?.error || err.message || "Something went wrong";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${errorMsg}`, display: "text" },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, datasetId, scenarioId, conversationHistory]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // No dataset selected
  if (!datasetId || !scenarioId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-12">
        <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        <p className="text-lg font-medium">No Dataset Active</p>
        <p className="text-sm mt-1">Load a dataset first to start chatting with your org data.</p>
      </div>
    );
  }

  // Initialising
  if (initStatus === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-12">
        <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-500 rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium">Initialising data session...</p>
      </div>
    );
  }

  // Init error
  if (initStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-gray-700 font-medium">Failed to initialise</p>
        <p className="text-sm text-gray-500 mt-1">{initError}</p>
        <button
          onClick={() => { setInitStatus("idle"); setInitError(null); }}
          className="mt-4 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-md transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Ask OrgSight</h2>
          <p className="text-xs text-gray-500">Ask questions about your org data in plain English</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 transition px-2 py-1 rounded hover:bg-gray-100"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && <EmptyState onSelect={sendMessage} />}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} onFollowUp={sendMessage} />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 px-4 py-3 max-w-md">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-sm text-gray-500 italic">Analysing your data...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-6 py-3">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <textarea
            id="ask-orgsight-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your org data..."
            rows={1}
            className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all bg-white hover:border-gray-400"
            style={{ minHeight: "42px", maxHeight: "120px" }}
          />
          <button
            id="ask-orgsight-send"
            onClick={() => sendMessage()}
            disabled={isLoading || !input.trim()}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
              isLoading || !input.trim()
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-brand-500 hover:bg-brand-600 text-white cursor-pointer hover:shadow-md"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// MESSAGE BUBBLE — renders text + optional table + optional chart
// =============================================================================

function MessageBubble({ message, onFollowUp }) {
  const isUser = message.role === "user";
  const display = message.display || "text";
  const [showTable, setShowTable] = useState(display === "table");

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[85%] ${isUser ? "ml-auto" : ""}`}>
      {/* Reply text */}
      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? "bg-brand-500 text-white rounded-br-md"
          : "bg-white text-gray-800 border border-gray-200 shadow-sm rounded-bl-md"
      }`}>
        {message.content}
      </div>

      {/* Chart (above table when both present) */}
      {(display === "chart" || display === "table+chart") && message.chart && message.data && (
        <div className="mt-2 w-full max-w-2xl">
          <DynamicChart spec={message.chart} data={message.data.rows} />
        </div>
      )}

      {/* Table toggle for table+chart mode */}
      {display === "table+chart" && message.data && (
        <button
          onClick={() => setShowTable(!showTable)}
          className="mt-1.5 px-3 py-1 text-xs border border-gray-200 rounded-full bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition cursor-pointer"
        >
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      )}

      {/* Data table */}
      {(display === "table" || (display === "table+chart" && showTable)) && message.data && (
        <div className="mt-2 w-full overflow-x-auto">
          <DataTable columns={message.data.columns} rows={message.data.rows} />
        </div>
      )}

      {/* Follow-up suggestions */}
      {!isUser && message.followUps && message.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {message.followUps.slice(0, 3).map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="px-3 py-1 text-xs border border-gray-200 rounded-full bg-white text-gray-600 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 transition cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Source badge */}
      {!isUser && message.source && (
        <div className="mt-1 text-[10px] text-gray-400">
          via {message.source === "named_tool" ? "pre-built query" : message.source === "sql_agent" ? "SQL agent" : message.source === "insight_service" ? "insights engine" : message.source}
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
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
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
    const body = sortedRows.map((r) =>
      columns.map((c) => {
        const v = r[c];
        if (v == null) return "";
        return typeof v === "string" && (v.includes(",") || v.includes('"'))
          ? `"${v.replace(/"/g, '""')}"`
          : v;
      }).join(",")
    ).join("\n");
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
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50/50">
        <span className="text-[11px] text-gray-400">
          {rows.length} row{rows.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={exportCSV}
          className="text-[11px] text-gray-500 hover:text-brand-600 transition cursor-pointer flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-3 py-2 text-left font-semibold text-gray-600 bg-gray-50 border-b-2 border-gray-200 cursor-pointer hover:bg-gray-100 whitespace-nowrap transition select-none"
                >
                  {col}
                  {sortCol === col && (
                    <span className="ml-1 text-brand-500">{sortDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                {columns.map((col) => (
                  <td
                    key={col}
                    className={`px-3 py-1.5 border-b border-gray-100 whitespace-nowrap text-gray-700 ${
                      typeof row[col] === "number" ? "text-right font-mono" : ""
                    }`}
                  >
                    {formatValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// =============================================================================
// DYNAMIC CHART — renders from spec + data
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
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : v} />
            <Bar dataKey={y} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return (
          <BarChart {...commonProps} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey={x} type="category" tick={{ fontSize: 11 }} width={140} />
            <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : v} />
            <Bar dataKey={y} fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        );
      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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
            <CartesianGrid stroke="#f0f0f0" />
            <XAxis dataKey={x} tick={{ fontSize: 11 }} />
            <YAxis dataKey={y} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Scatter data={data} fill={CHART_COLORS[0]} />
          </ScatterChart>
        );
      case "area":
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey={y} stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.15} />
          </AreaChart>
        );
      default:
        return (
          <div className="text-gray-400 text-sm text-center py-8">
            Unsupported chart type: {chart_type}
          </div>
        );
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      {title && (
        <div className="text-center text-sm font-semibold text-brand-700 mb-3">{title}</div>
      )}
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
    { text: "Give me an org summary", icon: "📊" },
    { text: "Headcount by country", icon: "🌍" },
    { text: "Top 10 highest cost employees", icon: "💰" },
    { text: "Span of control distribution", icon: "📈" },
    { text: "L2 leader breakdown", icon: "👥" },
    { text: "Managers with fewer than 4 reports", icon: "⚠️" },
    { text: "Compare our spans against benchmark", icon: "📏" },
    { text: "What are the structural risks?", icon: "🔍" },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-8">
      {/* Logo / Icon */}
      <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-700 rounded-2xl flex items-center justify-center mb-6 shadow-lg">
        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </div>

      <h3 className="text-xl font-bold text-gray-800 mb-2">Ask OrgSight</h3>
      <p className="text-sm text-gray-500 mb-8 max-w-md text-center">
        Ask questions about your organisation data in plain English.
        I can analyse headcount, cost, hierarchy structure, spans of control, and more.
      </p>

      {/* Suggestion chips */}
      <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s.text)}
            className="group flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm text-gray-700 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 hover:shadow-md transition-all cursor-pointer"
          >
            <span className="text-base">{s.icon}</span>
            <span className="font-medium">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
