/**
 * useChatHistory — localStorage-backed chat history hook.
 *
 * Persists chat messages per (projectId, datasetId, scenarioId) triple.
 * Switching datasets/scenarios automatically switches to that key's history.
 * Returning to a previous dataset restores its prior conversation.
 *
 * Storage format: JSON array of message objects, capped at MAX_MESSAGES.
 * Key format: `orgsight_chat_<projectId>_<datasetId>_<scenarioId>`
 */

import { useState, useEffect, useCallback, useRef } from "react";

const MAX_MESSAGES = 50;

/**
 * @param {number|null} projectId
 * @param {number|null} datasetId
 * @param {number|null} scenarioId
 *
 * @returns {{
 *   messages: Array,
 *   setMessages: Function,
 *   clearHistory: Function,
 *   sessionRestored: boolean,
 * }}
 */
export function useChatHistory(projectId, datasetId, scenarioId) {
  // Compute a stable storage key
  const storageKey =
    projectId && datasetId && scenarioId
      ? `orgsight_chat_${projectId}_${datasetId}_${scenarioId}`
      : null;

  // Initialise from localStorage on first render (or when key changes)
  const [messages, setMessagesRaw] = useState(() => {
    if (!storageKey) return [];
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Track whether we restored a session (used to show the brief indicator)
  const [sessionRestored, setSessionRestored] = useState(() => {
    if (!storageKey) return false;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  });

  // Re-hydrate whenever the key changes (dataset / scenario switch)
  const prevKeyRef = useRef(storageKey);
  useEffect(() => {
    if (prevKeyRef.current === storageKey) return;
    prevKeyRef.current = storageKey;

    if (!storageKey) {
      setMessagesRaw([]);
      setSessionRestored(false);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setMessagesRaw(Array.isArray(parsed) ? parsed : []);
      setSessionRestored(Array.isArray(parsed) && parsed.length > 0);
    } catch {
      setMessagesRaw([]);
      setSessionRestored(false);
    }
  }, [storageKey]);

  // Auto-dismiss the "session restored" indicator after 2.5 s
  useEffect(() => {
    if (!sessionRestored) return;
    const t = setTimeout(() => setSessionRestored(false), 2500);
    return () => clearTimeout(t);
  }, [sessionRestored]);

  // Write-through: persist on every messages change
  useEffect(() => {
    if (!storageKey) return;
    try {
      const toStore = messages.slice(-MAX_MESSAGES);
      localStorage.setItem(storageKey, JSON.stringify(toStore));
    } catch {
      // Quota exceeded or private browsing — silently ignore
    }
  }, [messages, storageKey]);

  // Wrapped setter: also add timestamp to assistant messages
  const setMessages = useCallback((updater) => {
    setMessagesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
  }, []);

  // Clear both state and localStorage
  const clearHistory = useCallback(() => {
    setMessagesRaw([]);
    setSessionRestored(false);
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [storageKey]);

  return { messages, setMessages, clearHistory, sessionRestored };
}
