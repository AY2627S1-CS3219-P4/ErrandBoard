import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AuthContext, type AuthStatus } from "./auth-context";

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");

  const refreshAuth = useCallback(async (showCheckingState = true) => {
    if (showCheckingState) setStatus("checking");
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        credentials: "include",
      });
      const authenticated = response.ok;
      setStatus(authenticated ? "authenticated" : "unauthenticated");
      return authenticated;
    } catch {
      setStatus("unauthenticated");
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then((response) => {
        if (active) setStatus(response.ok ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (active) setStatus("unauthenticated");
      });
    return () => { active = false; };
  }, []);

  const value = useMemo(() => ({ status, refreshAuth }), [status, refreshAuth]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
