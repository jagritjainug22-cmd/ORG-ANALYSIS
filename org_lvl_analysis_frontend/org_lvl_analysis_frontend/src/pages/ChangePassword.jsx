import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useConfirmLogout } from "../hooks/useConfirmLogout";
import { changePassword, login as loginApi } from "../api/backend";

export default function ChangePassword() {
  const navigate = useNavigate();
  const { user, handlePasswordChanged } = useAuth();
  const confirmLogout = useConfirmLogout();
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (newPass !== confirmPass) {
      setError("New passwords do not match.");
      return;
    }
    if (newPass.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPass, newPass);
      const result = await loginApi(user.username, newPass);
      handlePasswordChanged(result.access_token, result.user);
      navigate("/projects");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to change password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <span className="text-am-500 font-bold text-xl tracking-tight">A&amp;M</span>
          <span className="h-5 w-px bg-gray-300" />
          <span className="text-gray-800 font-semibold">OrgSight</span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Change Your Password</h2>
            <p className="text-gray-500 text-sm mt-1">
              You must change your password before continuing.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Current Password</label>
              <input
                type="password" value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition"
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
              <input
                type="password" value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition"
                required minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm New Password</label>
              <input
                type="password" value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:ring-2 focus:ring-am-500 focus:border-am-500 outline-none transition"
                required minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit" disabled={loading}
                className="flex-1 py-2.5 bg-am-500 hover:bg-am-600 text-white rounded-md font-medium transition disabled:opacity-50 text-sm"
              >
                {loading ? "Changing..." : "Change Password"}
              </button>
              <button
                type="button"
                onClick={() => { handleLogout(); navigate("/login"); }}
                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md font-medium transition text-sm"
              >
                Logout
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
