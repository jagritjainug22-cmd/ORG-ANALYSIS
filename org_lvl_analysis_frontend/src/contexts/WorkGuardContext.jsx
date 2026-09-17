import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import LogoutDialog from "../components/LogoutDialog";

const WorkGuardContext = createContext(null);

export function WorkGuardProvider({ children }) {
  const guardsRef = useRef(new Map());
  const logoutCallbackRef = useRef(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [guardVersion, setGuardVersion] = useState(0);
  const [anchorPos, setAnchorPos] = useState(null);

  const bumpGuards = useCallback(() => {
    setGuardVersion((v) => v + 1);
  }, []);

  const registerGuard = useCallback((id, guard) => {
    guardsRef.current.set(id, guard);
  }, []);

  const unregisterGuard = useCallback((id) => {
    guardsRef.current.delete(id);
  }, []);

  const getPendingGuards = useCallback(() => {
    return Array.from(guardsRef.current.entries())
      .filter(([, guard]) => guard.hasUnsavedWork?.())
      .map(([id, guard]) => ({
        id,
        label: typeof guard.getLabel === "function" ? guard.getLabel() : guard.label,
        description: typeof guard.getDescription === "function"
          ? guard.getDescription()
          : guard.description,
        save: guard.save,
        revert: guard.revert,
        hasUnsavedWork: guard.hasUnsavedWork,
      }));
  }, []);

  const requestLogout = useCallback((onComplete, pos = null) => {
    logoutCallbackRef.current = onComplete;
    setAnchorPos(pos);
    setDialogKey((k) => k + 1);
    setLogoutOpen(true);
  }, []);

  const closeLogoutDialog = useCallback(() => {
    setLogoutOpen(false);
    logoutCallbackRef.current = null;
    setAnchorPos(null);
  }, []);

  const handleSaveGuard = useCallback(async (guard) => {
    if (guard.save) await guard.save();
    bumpGuards();
  }, [bumpGuards]);

  const handleRevertGuard = useCallback(async (guard) => {
    if (guard.revert) await guard.revert();
    bumpGuards();
  }, [bumpGuards]);

  const handleConfirmLogout = useCallback(async () => {
    const cb = logoutCallbackRef.current;
    setLogoutOpen(false);
    logoutCallbackRef.current = null;
    if (cb) await cb();
  }, []);

  const value = {
    registerGuard,
    unregisterGuard,
    requestLogout,
  };

  return (
    <WorkGuardContext.Provider value={value}>
      {children}
      <LogoutDialog
        key={dialogKey}
        open={logoutOpen}
        pendingGuards={logoutOpen ? getPendingGuards() : []}
        guardVersion={guardVersion}
        anchorPos={anchorPos}
        onClose={closeLogoutDialog}
        onConfirmLogout={handleConfirmLogout}
        onSaveGuard={handleSaveGuard}
        onRevertGuard={handleRevertGuard}
      />
    </WorkGuardContext.Provider>
  );
}

export const useWorkGuard = () => {
  const ctx = useContext(WorkGuardContext);
  if (!ctx) throw new Error("useWorkGuard must be used within WorkGuardProvider");
  return ctx;
};
