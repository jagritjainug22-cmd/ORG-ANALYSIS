import React, { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Slide-to-confirm track
// ---------------------------------------------------------------------------
function SlideToConfirm({ onConfirm, disabled }) {
  const trackRef = useRef(null);
  const [dragX, setDragX] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const THRESHOLD = 0.85;
  const dragXRef = useRef(0);

  useEffect(() => {
    setDragX(0);
    dragXRef.current = 0;
    setConfirmed(false);
  }, [disabled]);

  const maxDrag = () => {
    if (!trackRef.current) return 0;
    return Math.max(trackRef.current.offsetWidth - 40, 0);
  };

  const finishDrag = useCallback((x) => {
    const max = maxDrag();
    if (max > 0 && x >= max * THRESHOLD) {
      setDragX(max);
      dragXRef.current = max;
      setConfirmed(true);
      onConfirm();
    } else {
      setDragX(0);
      dragXRef.current = 0;
    }
    draggingRef.current = false;
  }, [onConfirm]);

  const onPointerDown = (e) => {
    if (disabled || confirmed) return;
    draggingRef.current = true;
    startXRef.current = e.clientX - dragXRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    const max = maxDrag();
    const x = Math.max(0, Math.min(e.clientX - startXRef.current, max));
    setDragX(x);
    dragXRef.current = x;
  };

  const onPointerUp = (e) => {
    if (!draggingRef.current) return;
    finishDrag(dragXRef.current);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const progress = maxDrag() > 0 ? dragX / maxDrag() : 0;

  return (
    <div
      ref={trackRef}
      className={`relative h-9 rounded-full border overflow-hidden select-none touch-none ${
        disabled ? "bg-gray-100 border-gray-200 opacity-60" : "bg-red-50 border-red-200"
      }`}
    >
      {/* Fill bar */}
      <div
        className="absolute inset-y-0 left-0 bg-red-100 transition-none rounded-full"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-red-600/70 pointer-events-none">
        {confirmed ? "Logging out…" : "slide to logout →"}
      </span>
      <div
        role="button"
        aria-label="Slide to confirm logout"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ transform: `translateX(${dragX}px)` }}
        className={`absolute left-0.5 top-0.5 flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-colors ${
          confirmed ? "bg-red-700" : "bg-red-500 cursor-grab active:cursor-grabbing"
        }`}
      >
        <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog — two rendering modes:
//   • Compact anchored popover (confirm-only, anchor known)
//   • Centered modal (unsaved work, or no anchor)
// ---------------------------------------------------------------------------
export default function LogoutDialog({
  open,
  pendingGuards,
  guardVersion,
  anchorPos,
  onClose,
  onConfirmLogout,
  onSaveGuard,
  onRevertGuard,
}) {
  const [phase, setPhase] = useState("unsaved");
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setActionError(null);
    setBusyId(null);
    setPhase(pendingGuards.length > 0 ? "unsaved" : "confirm");
  }, [open, pendingGuards.length, guardVersion]);

  if (!open) return null;

  const handleSave = async (guard) => {
    setBusyId(guard.id);
    setActionError(null);
    try { await onSaveGuard(guard); }
    catch (e) { setActionError(e?.message || "Failed to save changes."); }
    finally { setBusyId(null); }
  };

  const handleRevert = async (guard) => {
    setBusyId(guard.id);
    setActionError(null);
    try { await onRevertGuard(guard); }
    catch (e) { setActionError(e?.message || "Failed to revert changes."); }
    finally { setBusyId(null); }
  };

  // ------------------------------------------------------------------
  // Compact popover — anchored below the logout button, confirm phase
  // ------------------------------------------------------------------
  if (phase === "confirm" && anchorPos) {
    const popoverStyle = {
      position: "fixed",
      top: anchorPos.top + 8,
      right: window.innerWidth - anchorPos.right,
      width: 240,
      zIndex: 10000,
    };

    return (
      <>
        {/* Thin backdrop — just for click-outside dismiss, no blur */}
        <div
          className="fixed inset-0 z-[9999]"
          onClick={onClose}
          aria-hidden
        />
        <div style={popoverStyle} className="z-[10000]">
          {/* Caret */}
          <div
            className="absolute -top-1.5 right-3 w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45"
            style={{ zIndex: 1 }}
          />
          <div className="relative bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Sign out</span>
              <button
                onClick={onClose}
                className="p-0.5 rounded hover:bg-gray-200 transition text-gray-400 hover:text-gray-600"
                aria-label="Cancel"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Slide track */}
            <div className="px-3 py-3">
              <SlideToConfirm onConfirm={onConfirmLogout} disabled={false} />
            </div>
          </div>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Full centered modal — unsaved work, or no anchor available
  // ------------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {phase === "unsaved" ? "Unsaved work" : "Confirm logout"}
          </h3>
        </div>

        <div className="space-y-4 px-6 py-5">
          {phase === "unsaved" ? (
            <>
              <p className="text-sm text-gray-600">
                You have unsaved changes. Save them to baseline or revert before logging out.
              </p>
              <div className="space-y-3">
                {pendingGuards.map((guard) => (
                  <div key={guard.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-gray-900">{guard.label}</p>
                    {guard.description && (
                      <p className="mt-1 text-xs text-gray-600">{guard.description}</p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={!!busyId}
                        onClick={() => handleSave(guard)}
                        className="flex-1 rounded-lg bg-am-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-am-600 disabled:opacity-50"
                      >
                        {busyId === guard.id ? "Saving…" : "Save to baseline"}
                      </button>
                      <button
                        type="button"
                        disabled={!!busyId}
                        onClick={() => handleRevert(guard)}
                        className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                      >
                        {busyId === guard.id ? "Reverting…" : "Revert"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">Are you sure you want to logout?</p>
              <SlideToConfirm onConfirm={onConfirmLogout} disabled={false} />
            </>
          )}

          {actionError && (
            <p className="text-sm text-red-600">{actionError}</p>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
