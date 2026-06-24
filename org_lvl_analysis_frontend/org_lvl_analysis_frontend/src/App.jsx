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
    <div className="min-h-screen grid lg:grid-cols-2 grid-cols-1 bg-white">
      {/* LEFT: Branding panel */}
      <div
        className="hidden lg:flex relative flex-col justify-between p-12 text-white overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #01244a 0%, #0a3366 55%, #0a3f86 100%)",
        }}
      >
        {/* subtle decorative grid */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="text-2xl font-bold tracking-tight">A&amp;M</div>
          <div className="h-6 w-px bg-white/30" />
          <div className="text-sm font-medium text-white/80 tracking-wide">
            OrgSight
          </div>
        </div>

        {/* Headline */}
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl xl:text-5xl font-bold leading-tight mb-4">
            OrgSight
            <br />
            Workforce Intelligence
          </h1>
          <p className="text-white/80 text-base leading-relaxed mb-10">
            Streamline your organizational insights with data-driven analysis,
            scenario modelling, and automated reporting.
          </p>

          <div className="space-y-4">
            <FeatureLine
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              }
              label="Org Chart Visualization"
            />
            <FeatureLine
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 12l3-3 3 3 5-5 4 4 3-3M3 12v8h18v-8" />
                </svg>
              }
              label="Spans & Layers Analysis"
            />
            <FeatureLine
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              label="Export & Reporting"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-xs text-white/50">
          &copy; {new Date().getFullYear()} Alvarez &amp; Marsal. All rights reserved.
        </div>
      </div>

      {/* RIGHT: Login form */}
      <div className="flex items-center justify-center p-6 sm:p-12 bg-surface-soft">
        {/* Mobile brand header */}
        <div className="absolute top-6 left-6 lg:hidden flex items-center gap-2">
          <span className="text-brand-500 font-bold text-lg">A&amp;M</span>
          <span className="text-gray-500 text-sm">OrgSight</span>
        </div>

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

function FeatureLine({ icon, label }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-md bg-white/10 border border-white/15 flex items-center justify-center text-white">
        {icon}
      </div>
      <span className="text-sm font-medium text-white/90">{label}</span>
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
      <div className="min-h-screen bg-surface-soft flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-100 border-t-brand-500 rounded-full animate-spin"></div>
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

      {/* Admin routes â€” only role=admin can access */}
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
