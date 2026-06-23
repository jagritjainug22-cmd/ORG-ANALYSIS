/**
 * Ask OrgSight — Conversational AI chat panel for org data analysis.
 *
 * Renders inside ProjectWorkspace as the "Ask OrgSight" tab.
 *
 * Features:
 *   - Auto-inits DuckDB session on mount
 *   - Streams responses word-by-word via SSE (POST /chat/stream)
 *   - Live phase indicators during agent processing
 *   - Abort / cancel in-flight stream
 *   - Conversation history persisted to localStorage (via useChatHistory)
 *   - Renders text, sortable tables, recharts-based charts
 *   - Follow-up suggestion chips
 *
 * Dependencies: recharts, useChatHistory (local hook)
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { chatEnsure, chatMessageStream } from "../api/backend";
import { useChatHistory } from "../hooks/useChatHistory";

const CHART_COLORS = ["#1e3a5f", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

// Phase display config — polished SVG icons themed to the OrgSight brand
const PhaseIconIntent = () => (
  // Neural-network / scope: magnifying glass with connected data nodes inside
  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Magnifying glass circle */}
    <circle cx="8.5" cy="8.5" r="5.25" />
    {/* Handle */}
    <line x1="12.5" y1="12.5" x2="16.5" y2="16.5" />
    {/* Inner network nodes */}
    <circle cx="7"  cy="8"   r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="7.2" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
    {/* Connecting lines between nodes */}
    <line x1="7"   y1="8"   x2="10"  y2="7.2" strokeWidth="1" />
    <line x1="10"  y1="7.2" x2="8.5" y2="10.2" strokeWidth="1" />
    <line x1="7"   y1="8"   x2="8.5" y2="10.2" strokeWidth="1" />
  </svg>
);

const PhaseIconQuery = () => (
  // Stacked database cylinders with a bolt — represents DuckDB/SQL execution
  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Bottom cylinder */}
    <ellipse cx="8" cy="14.5" rx="4.5" ry="1.5" />
    <line x1="3.5" y1="14.5" x2="3.5" y2="11" />
    <line x1="12.5" y1="14.5" x2="12.5" y2="11" />
    {/* Top cylinder cap */}
    <ellipse cx="8" cy="11" rx="4.5" ry="1.5" />
    {/* Mid cap */}
    <ellipse cx="8" cy="8.5" rx="4.5" ry="1.5" />
    <line x1="3.5" y1="11" x2="3.5" y2="8.5" />
    <line x1="12.5" y1="11" x2="12.5" y2="8.5" />
    {/* Lightning bolt (top-right) */}
    <polyline points="14.5,4 12.5,7.5 14.5,7.5 13,11" strokeWidth="1.6" stroke="currentColor" fill="none" />
  </svg>
);

const PhaseIconFormatting = () => (
  // Magic wand + sparkles — represents AI generating the narrative response
  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Wand shaft */}
    <line x1="4" y1="16" x2="11" y2="9" strokeWidth="1.8" />
    {/* Wand tip star */}
    <circle cx="11.8" cy="8.2" r="1" fill="currentColor" stroke="none" />
    {/* Sparkle top-right: 4-pointed star */}
    <line x1="15" y1="3"   x2="15" y2="5.5" strokeWidth="1.2" />
    <line x1="13.75" y1="4.25" x2="16.25" y2="4.25" strokeWidth="1.2" />
    {/* Sparkle small left */}
    <line x1="7"  y1="4"   x2="7"  y2="5.5" strokeWidth="1.1" />
    <line x1="6.25" y1="4.75" x2="7.75" y2="4.75" strokeWidth="1.1" />
    {/* Sparkle tiny top-middle */}
    <line x1="11.5" y1="3.5" x2="11.5" y2="4.7" strokeWidth="1" />
    <line x1="10.9" y1="4.1" x2="12.1" y2="4.1" strokeWidth="1" />
  </svg>
);

const PHASE_CONFIG = {
  intent:     { icon: <PhaseIconIntent />,     label: "Classifying your question..." },
  query:      { icon: <PhaseIconQuery />,      label: "Running analysis query..."    },
  formatting: { icon: <PhaseIconFormatting />, label: "Writing response..."          },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AskOrgSight({ projectId, datasetId, scenarioId, onNavigate }) {
  const { messages, setMessages, clearHistory, sessionRestored } = useChatHistory(
    projectId, datasetId, scenarioId
  );

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamPhase, setStreamPhase] = useState(null); // current phase label
  const [initStatus, setInitStatus] = useState("idle"); // idle | loading | ready | error
  const [initError, setInitError] = useState(null);

  const messagesEndRef = useRef(null);
  const abortRef = useRef(null); // holds the stream cleanup / abort function
  const textareaRef = useRef(null);

  // Auto-scroll on new messages / loading state change
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

  // Keep last 6 messages for conversation history context
  const conversationHistory = useMemo(() => {
    return messages
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  const abortStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setIsLoading(false);
    setStreamPhase(null);
  }, []);

  const sendMessage = useCallback((text, resolvedColumns = {}) => {
    const msg = (text || input).trim();
    if (!msg || isLoading) return;

    // Add user message (don't show if it's a re-send for clarification)
    if (!Object.keys(resolvedColumns).length) {
      const userMsg = { role: "user", content: msg, timestamp: new Date().toISOString() };
      setMessages((prev) => [...prev, userMsg]);
    }
    setInput("");
    setIsLoading(true);
    setStreamPhase(null);

    // Add a streaming placeholder for the assistant bubble
    const streamingMsgId = Date.now();
    const placeholderMsg = {
      role: "assistant",
      content: "",
      display: "text",
      _streaming: true,
      _id: streamingMsgId,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, placeholderMsg]);

    let accText = "";

    const abort = chatMessageStream(
      msg,
      datasetId,
      scenarioId,
      conversationHistory,
      {
        onStatus: ({ phase, message: phaseMsg }) => {
          setStreamPhase(PHASE_CONFIG[phase] || { icon: "⏳", label: phaseMsg });
        },

        onToken: (token) => {
          accText += token;
          setMessages((prev) =>
            prev.map((m) =>
              m._id === streamingMsgId
                ? { ...m, content: accText }
                : m
            )
          );
        },

        onDone: (payload) => {
          // Build the final message with all structured data
          const dataPayload =
            payload.data && payload.data.length > 0
              ? { columns: payload.columns || Object.keys(payload.data[0]), rows: payload.data }
              : null;

          let chartSpec = null;
          if (
            payload.chart_hint &&
            payload.chart_hint !== "table" &&
            payload.chart_hint !== "kpi_cards" &&
            dataPayload
          ) {
            const cols = dataPayload.columns;
            const numericCol = cols.find((c) => typeof dataPayload.rows[0]?.[c] === "number");
            const labelCol = cols.find((c) => typeof dataPayload.rows[0]?.[c] !== "number");
            if (numericCol && labelCol) {
              chartSpec = {
                chart_type: payload.chart_hint === "horizontal_bar" ? "horizontal_bar" : payload.chart_hint,
                title: "",
                x: labelCol,
                y: numericCol,
              };
            }
          }

          let display = "text";
          if (dataPayload && chartSpec) display = "table+chart";
          else if (dataPayload) display = "table";

          const finalMsg = {
            role: "assistant",
            content: accText,
            display,
            data: dataPayload,
            chart: chartSpec,
            followUps: payload.follow_ups || [],
            source: payload.source,
            timestamp: new Date().toISOString(),
          };

          // Handle clarification responses
          if (payload.source === "clarification_needed") {
            finalMsg.clarification = {
              type: payload.clarification_type,
              options: payload.options || [],
              originalQuery: payload.original_query,
            };
            finalMsg.display = "clarification";
          }

          // Handle navigation responses
          if (payload.source === "navigate" && payload.navigation_target) {
            finalMsg.navigationTarget = payload.navigation_target;
          }

          setMessages((prev) =>
            prev.map((m) => (m._id === streamingMsgId ? finalMsg : m))
          );

          abortRef.current = null;
          setIsLoading(false);
          setStreamPhase(null);
        },

        onError: (errMsg) => {
          setMessages((prev) =>
            prev.map((m) =>
              m._id === streamingMsgId
                ? {
                    role: "assistant",
                    content: accText || `Something went wrong: ${errMsg}`,
                    display: "text",
                    timestamp: new Date().toISOString(),
                  }
                : m
            )
          );
          abortRef.current = null;
          setIsLoading(false);
          setStreamPhase(null);
        },
      },
      resolvedColumns
    );

    abortRef.current = abort;
  }, [input, isLoading, datasetId, scenarioId, conversationHistory, setMessages]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── No dataset ──────────────────────────────────────────────────────────────
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

  // ── Initialising ────────────────────────────────────────────────────────────
  if (initStatus === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-12">
        <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-500 rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium">Initialising data session...</p>
      </div>
    );
  }

  // ── Init error ──────────────────────────────────────────────────────────────
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

  // ── Main chat UI ────────────────────────────────────────────────────────────
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

        {/* Session restored badge */}
        {sessionRestored && (
          <div
            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 border border-brand-200 text-xs text-brand-700 animate-pulse"
            title="Previous session chat restored from storage"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Session restored
          </div>
        )}

        {messages.length > 0 && !sessionRestored && (
          <button
            id="ask-orgsight-clear"
            onClick={clearHistory}
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
          <MessageBubble
            key={msg._id || i}
            message={msg}
            onFollowUp={sendMessage}
            onClarify={(query, selectedColumn) => {
              // Extract the ambiguous term from the clarification message
              const termMatch = msg.content?.match(/'([^']+)'/);
              const term = termMatch ? termMatch[1] : "column";
              sendMessage(query, { [term]: selectedColumn });
            }}
          />
        ))}

        {/* Live loading indicator with phase */}
        {isLoading && (
          <div className="flex items-center gap-3 px-4 py-3 max-w-md">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-sm text-gray-500 italic">
              {streamPhase
                ? <>{streamPhase.icon} {streamPhase.label}</>
                : "Analysing your data..."}
            </span>
            {/* Abort button */}
            <button
              id="ask-orgsight-abort"
              onClick={abortStream}
              title="Stop generating"
              className="ml-auto p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-6 py-3">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <textarea
            id="ask-orgsight-input"
            ref={textareaRef}
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
        <p className="text-[10px] text-gray-400 text-center mt-1.5">
          Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">Enter</kbd> to send · <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
}


// =============================================================================
// MESSAGE BUBBLE — renders text + optional table + optional chart
// =============================================================================

function formatMarkdown(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const elements = [];
  let listItems = [];
  let inList = false;

  const parseInlineStyles = (lineText) => {
    const regex = /(\*\*.*?\*\*|`.*?`)/g;
    const tokens = lineText.split(regex);
    return tokens.map((token, idx) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return <strong key={idx} className="font-bold text-[#01244a]">{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return <code key={idx} className="bg-gray-100 border border-gray-200 px-1 py-0.5 rounded text-xs text-red-600 font-mono">{token.slice(1, -1)}</code>;
      }
      return token;
    });
  };

  const flushList = (key) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key} className="list-disc pl-5 my-2 space-y-1 text-gray-700">
          {listItems.map((item, idx) => (
            <li key={idx}>{parseInlineStyles(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      flushList(`list-${index}`);
      elements.push(
        <h4 key={index} className="text-sm font-bold text-[#01244a] mt-3 mb-1.5 border-b border-gray-100 pb-1">
          {parseInlineStyles(trimmed.slice(4))}
        </h4>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList(`list-${index}`);
      elements.push(
        <h3 key={index} className="text-base font-bold text-[#01244a] mt-4 mb-2">
          {parseInlineStyles(trimmed.slice(3))}
        </h3>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList(`list-${index}`);
      elements.push(
        <h2 key={index} className="text-lg font-bold text-[#01244a] mt-5 mb-2.5">
          {parseInlineStyles(trimmed.slice(2))}
        </h2>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      inList = true;
      listItems.push(trimmed.slice(2));
    } else if (/^\d+\.\s+/.test(trimmed)) {
      flushList(`list-${index}`);
      const match = trimmed.match(/^(\d+)\.\s+(.*)/);
      elements.push(
        <div key={index} className="flex gap-2 my-1.5 text-gray-700">
          <span className="font-bold text-[#01244a] min-w-[1.25rem] text-right">{match[1]}.</span>
          <span className="flex-1">{parseInlineStyles(match[2])}</span>
        </div>
      );
    } else if (trimmed === "") {
      flushList(`list-${index}`);
      elements.push(<div key={index} className="h-2" />);
    } else {
      flushList(`list-${index}`);
      elements.push(
        <p key={index} className="my-1.5 text-gray-700 leading-relaxed">
          {parseInlineStyles(line)}
        </p>
      );
    }
  });

  flushList("list-final");
  return elements;
}

function MessageBubble({ message, onFollowUp, onClarify }) {
  const isUser = message.role === "user";
  const display = message.display || "text";
  const isStreaming = !!message._streaming;
  const [showTable, setShowTable] = useState(display === "table");
  const [selectedOption, setSelectedOption] = useState(null);

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[85%] ${isUser ? "ml-auto" : ""}`}>
      {/* Reply text */}
      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
        isUser
          ? "bg-brand-500 text-white rounded-br-md whitespace-pre-wrap"
          : "bg-white text-gray-800 border border-gray-200 shadow-sm rounded-bl-md"
      }`}>
        {isUser ? (
          message.content || "—"
        ) : (
          <div className="space-y-1">
            {formatMarkdown(message.content)}
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-brand-400 ml-0.5 align-middle animate-[blink_1s_step-end_infinite]" />
            )}
          </div>
        )}
      </div>

      {/* Clarification card */}
      {display === "clarification" && message.clarification && (
        <div className="mt-2 w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="space-y-2">
            {message.clarification.options.map((opt, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                  selectedOption === opt.column
                    ? "border-brand-500 bg-brand-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="clarification"
                  value={opt.column}
                  checked={selectedOption === opt.column}
                  onChange={() => setSelectedOption(opt.column)}
                  className="mt-0.5 accent-brand-500"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800">{opt.column}</div>
                  {opt.samples && opt.samples.length > 0 && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      e.g. {opt.samples.slice(0, 3).join(", ")}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
          <button
            disabled={!selectedOption}
            onClick={() => {
              if (selectedOption && onClarify) {
                onClarify(message.clarification.originalQuery, selectedOption);
              }
            }}
            className={`mt-3 w-full py-2 px-4 rounded-lg text-sm font-medium transition ${
              selectedOption
                ? "bg-brand-500 text-white hover:bg-brand-600 cursor-pointer"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Use this column
          </button>
        </div>
      )}

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
      {!isUser && !isStreaming && message.followUps && message.followUps.length > 0 && (
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
      {!isUser && !isStreaming && message.source && (
        <div className="mt-1 text-[10px] text-gray-400">
          via {
            message.source === "named_tool" ? "pre-built query"
            : message.source === "sql_agent" ? "SQL agent"
            : message.source === "insight_service" ? "insights engine"
            : message.source
          }
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
                  className="px-3 py-2 text-left font-bold text-white bg-[#01244a] border-b border-[#08304a] cursor-pointer hover:bg-[#08304a]/85 whitespace-nowrap transition select-none"
                >
                  {col}
                  {sortCol === col && (
                    <span className="ml-1 text-[#c5a84a] font-bold">{sortDir === "asc" ? "↑" : "↓"}</span>
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

  const [chartType, setChartType] = useState(spec.chart_type);
  const [selectedX, setSelectedX] = useState(spec.x);
  const [selectedY, setSelectedY] = useState(spec.y);

  const keys = Object.keys(data[0] || {});
  const commonProps = { data, margin: { top: 10, right: 20, left: 10, bottom: 10 } };

  const renderChart = () => {
    switch (chartType) {
      case "bar":
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={selectedX} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : v} />
            <Bar dataKey={selectedY} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return (
          <BarChart {...commonProps} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey={selectedX} type="category" tick={{ fontSize: 11 }} width={140} />
            <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : v} />
            <Bar dataKey={selectedY} fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        );
      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={selectedX} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey={selectedY} stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        );
      case "pie":
        return (
          <PieChart>
            <Pie data={data} dataKey={selectedY} nameKey={selectedX} cx="50%" cy="50%" outerRadius={100} label={{ fontSize: 11 }}>
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
            <XAxis dataKey={selectedX} tick={{ fontSize: 11 }} />
            <YAxis dataKey={selectedY} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Scatter data={data} fill={CHART_COLORS[0]} />
          </ScatterChart>
        );
      case "area":
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={selectedX} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey={selectedY} stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.15} />
          </AreaChart>
        );
      default:
        return (
          <div className="text-gray-400 text-sm text-center py-8">
            Unsupported chart type: {chartType}
          </div>
        );
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-gray-100 pb-3">
        {spec.title ? (
          <div className="text-sm font-semibold text-brand-700">{spec.title}</div>
        ) : (
          <div className="text-sm font-semibold text-brand-700">Dynamic Chart</div>
        )}
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
          <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200/50">
            {[
              { id: "bar", label: "Bar" },
              { id: "line", label: "Line" },
              { id: "pie", label: "Pie" },
              { id: "area", label: "Area" }
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setChartType(t.id)}
                className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all ${
                  chartType === t.id
                    ? "bg-[#01244a] text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase">X:</span>
            <select
              value={selectedX}
              onChange={(e) => setSelectedX(e.target.value)}
              className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {keys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Y:</span>
            <select
              value={selectedY}
              onChange={(e) => setSelectedY(e.target.value)}
              className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {keys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>
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
    { 
      text: "Give me an org summary", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ) 
    },
    { 
      text: "Headcount by country", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 002 2h2m-4-3.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM2 12a10 10 0 1120 0 10 10 0 01-20 0z" />
        </svg>
      ) 
    },
    { 
      text: "Top 10 highest cost employees", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) 
    },
    { 
      text: "Span of control distribution", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ) 
    },
    { 
      text: "L2 leader breakdown", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ) 
    },
    { 
      text: "Managers with fewer than 4 reports", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ) 
    },
    { 
      text: "Compare our spans against benchmark", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ) 
    },
    { 
      text: "What are the structural risks?", 
      icon: (
        <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ) 
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-8">
      {/* Logo / Icon */}
      <div className="w-16 h-16 bg-gradient-to-br from-[#01244a] to-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg animate-pulse">
        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </div>

      <h3 className="text-xl font-bold text-[#01244a] mb-2" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>Ask OrgSight</h3>
      <p className="text-sm text-gray-500 mb-8 max-w-md text-center">
        Ask questions about your organisation data in plain English.
        I can analyse headcount, cost, hierarchy structure, spans of control, and more.
      </p>

      {/* Suggestion chips */}
      <div className="flex flex-wrap gap-2.5 justify-center max-w-2xl">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s.text)}
            className="group flex items-center gap-2.5 px-4 py-2.5 border border-blue-100 rounded-xl bg-blue-50/50 text-sm text-slate-800 hover:bg-blue-100/70 hover:border-blue-300 hover:shadow-sm transition-all duration-200 cursor-pointer"
          >
            {s.icon}
            <span className="font-semibold text-slate-700 group-hover:text-blue-900 transition-colors">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
