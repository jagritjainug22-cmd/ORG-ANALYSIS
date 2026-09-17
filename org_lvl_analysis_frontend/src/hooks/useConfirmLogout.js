import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useWorkGuard } from "../contexts/WorkGuardContext";

export function useConfirmLogout() {
  const { handleLogout } = useAuth();
  const { requestLogout } = useWorkGuard();
  const navigate = useNavigate();

  return useCallback((e) => {
    // Extract button anchor position so the popover can attach below the button.
    let pos = null;
    const btn = e?.currentTarget ?? e?.target;
    if (btn) {
      const r = btn.getBoundingClientRect();
      pos = { top: r.bottom, right: r.right, left: r.left, width: r.width };
    }
    requestLogout(async () => {
      await handleLogout();
      navigate("/login");
    }, pos);
  }, [handleLogout, requestLogout, navigate]);
}
