import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";

import Login from "./components/Login";
import ProjectSelector from "./pages/ProjectSelector";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import ChangePassword from "./pages/ChangePassword";
import AdminLayout from "./pages/admin/AdminLayout";
import UserManagement from "./pages/admin/UserManagement";
import ProjectManagement from "./pages/admin/ProjectManagement";
import AuditLog from "./pages/admin/AuditLog";

function LoginPage() {
  const { isAuthenticated, mustChangePassword, handleLogin } = useAuth();

  if (isAuthenticated && mustChangePassword) return <Navigate to="/change-password" replace />;
  if (isAuthenticated) return <Navigate to="/projects" replace />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Login
          setToken={() => {}}
          setUsername={() => {}}
          onLoginComplete={(accessToken, userData) => {
            handleLogin(accessToken, userData);
          }}
        />
      </div>
    </div>
  );
}

function RequireAdmin({ children }) {
  const { isAuthenticated, mustChangePassword, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (user?.role !== "admin") return <Navigate to="/projects" replace />;
  return children;
}

export default function App() {
  const { isAuthenticated, mustChangePassword, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
          <p className="text-gray-500 text-sm">Restoring session...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/change-password" element={
        !isAuthenticated ? <Navigate to="/login" replace /> : <ChangePassword />
      } />

      <Route path="/projects" element={
        !isAuthenticated ? <Navigate to="/login" replace /> :
        mustChangePassword ? <Navigate to="/change-password" replace /> :
        <ProjectSelector />
      } />

      <Route path="/projects/:projectId" element={
        !isAuthenticated ? <Navigate to="/login" replace /> :
        mustChangePassword ? <Navigate to="/change-password" replace /> :
        <ProjectWorkspace />
      } />

      {/* Admin routes — only role=admin can access */}
      <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="projects" element={<ProjectManagement />} />
        <Route path="audit" element={<AuditLog />} />
      </Route>

      <Route path="*" element={
        <Navigate to={isAuthenticated ? (mustChangePassword ? "/change-password" : "/projects") : "/login"} replace />
      } />
    </Routes>
  );
}
