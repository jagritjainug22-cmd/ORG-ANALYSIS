import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  silentRefresh,
  setAccessToken,
  setCurrentUsername,
  setCurrentProjectId,
  logout as logoutApi,
} from "../api/backend";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    silentRefresh()
      .then((data) => {
        setAccessToken(data.access_token);
        setCurrentUsername(data.user.username);
        setToken(data.access_token);
        setUser(data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = useCallback((accessToken, userData) => {
    setAccessToken(accessToken);
    setCurrentUsername(userData.username);
    setToken(accessToken);
    setUser(userData);
  }, []);

  const handlePasswordChanged = useCallback((accessToken, userData) => {
    setAccessToken(accessToken);
    setCurrentUsername(userData.username);
    setToken(accessToken);
    setUser({ ...userData, must_change_password: false });
  }, []);

  const handleLogout = useCallback(async () => {
    try { await logoutApi(); } catch {}
    setToken(null);
    setUser(null);
    setAccessToken(null);
    setCurrentUsername(null);
    setCurrentProjectId(null);
  }, []);

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
