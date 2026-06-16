import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  silentRefresh,
  setAccessToken,
  setCurrentUsername,
  setCurrentProjectId,
  onTokenRefreshed,
  logout as logoutApi,
} from "../api/backend";

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
    refreshTimerRef.current = setTimeout(() => {
      silentRefresh().catch(() => {});
    }, delay);
  }, []);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    silentRefresh()
      .then((data) => {
        setAccessToken(data.access_token);
        setCurrentUsername(data.user.username);
        setToken(data.access_token);
        setUser(data.user);
        scheduleProactiveRefresh(data.access_token);
      })
      .catch(() => {})
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
    try { await logoutApi(); } catch {}
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
