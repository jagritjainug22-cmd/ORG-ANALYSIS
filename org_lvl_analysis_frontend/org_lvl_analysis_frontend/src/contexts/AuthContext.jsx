import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  silentRefresh,
  setAccessToken,
  setCurrentUsername,
  setCurrentProjectId,
  onTokenRefreshed,
  logout as logoutApi,
} from "../api/backend";

const _logAuth = (level, event, detail = {}) => {
  const entry = { t: new Date().toISOString(), level, event, ...detail };
  const style = level === "error"
    ? "color:#d94f4f;font-weight:bold"
    : level === "warn" ? "color:#d4a942;font-weight:bold" : "color:#0085ca";
  // eslint-disable-next-line no-console
  console.log(`%c[AUTH-CTX ${level.toUpperCase()}] ${entry.t} — ${event}`, style, detail);
};

const AuthContext = createContext(null);

const getTokenExpMs = (token) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef(null);

  const scheduleProactiveRefresh = useCallback((accessToken) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const expMs = getTokenExpMs(accessToken);
    if (!expMs) return;
    const delay = Math.max(expMs - Date.now() - 60_000, 0);
    _logAuth("info", "proactiveRefresh:scheduled", {
      firesInMs: delay,
      firesAt: new Date(Date.now() + delay).toISOString(),
      tokenExpiresAt: new Date(expMs).toISOString(),
    });
    refreshTimerRef.current = setTimeout(() => {
      _logAuth("info", "proactiveRefresh:firing", {});
      silentRefresh("proactive-timer").catch(() => {});
    }, delay);
  }, []);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    _logAuth("info", "mount:restoring-session", {});
    silentRefresh("page-mount")
      .then((data) => {
        setAccessToken(data.access_token);
        setCurrentUsername(data.user.username);
        setToken(data.access_token);
        setUser(data.user);
        scheduleProactiveRefresh(data.access_token);
        _logAuth("info", "mount:session-restored", { username: data.user.username });
      })
      .catch((err) => {
        _logAuth("info", "mount:no-session", {
          status: err?.response?.status,
          detail: err?.response?.data?.detail || err?.message,
          note: "user not logged in, showing login page",
        });
      })
      .finally(() => setLoading(false));
  }, [scheduleProactiveRefresh]);

  useEffect(() => {
    onTokenRefreshed((data) => {
      setToken(data.access_token);
      setUser(data.user);
      scheduleProactiveRefresh(data.access_token);
    });
    return () => onTokenRefreshed(null);
  }, [scheduleProactiveRefresh]);

  const handleLogin = useCallback((accessToken, userData) => {
    setAccessToken(accessToken);
    setCurrentUsername(userData.username);
    setToken(accessToken);
    setUser(userData);
    scheduleProactiveRefresh(accessToken);
  }, [scheduleProactiveRefresh]);

  const handlePasswordChanged = useCallback((accessToken, userData) => {
    setAccessToken(accessToken);
    setCurrentUsername(userData.username);
    setToken(accessToken);
    setUser({ ...userData, must_change_password: false });
    scheduleProactiveRefresh(accessToken);
  }, [scheduleProactiveRefresh]);

  const handleLogout = useCallback(async () => {
    clearRefreshTimer();
    // Fire and forget logout API to clean up server-side locks/sessions in background
    logoutApi().catch(() => {});
    // Clear client auth state instantly for immediate responsive UI transition
    setToken(null);
    setUser(null);
    setAccessToken(null);
    setCurrentUsername(null);
    setCurrentProjectId(null);
  }, [clearRefreshTimer]);

  const value = {
    token,
    user,
    loading,
    isAuthenticated: !!token,
    mustChangePassword: !!user?.must_change_password,
    handleLogin,
    handlePasswordChanged,
    handleLogout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
