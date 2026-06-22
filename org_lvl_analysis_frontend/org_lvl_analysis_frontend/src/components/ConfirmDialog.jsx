import React, { useState } from "react";

/**
 * Typed-confirmation dialog (GitHub-style).
 * For destructive actions: user must type the exact `confirmText` to proceed.
 * For simple confirmations: just show message with Cancel/Confirm buttons.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState("");

  if (!open) return null;

  const needsTyping = !!confirmText;
  const canConfirm = needsTyping ? typed === confirmText : true;

  const handleConfirm = () => {
    if (!canConfirm) return;
    setTyped("");
    onConfirm();
  };

  const handleCancel = () => {
    setTyped("");
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md mx-4 overflow-hidden">
        <div className={`px-6 py-4 border-b ${destructive ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
          <h3 className={`text-lg font-semibold ${destructive ? "text-red-800" : "text-gray-800"}`}>
            {title}
          </h3>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">{message}</p>
          {needsTyping && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <span className="font-mono font-bold text-gray-900">{confirmText}</span> to confirm
              </label>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono"
                placeholder={confirmText}
                autoFocus
              />
            </div>
          )}
        </div>
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-md text-sm font-medium text-white transition disabled:opacity-40 disabled:cursor-not-allowed ${
              destructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-brand-500 hover:bg-brand-600"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
