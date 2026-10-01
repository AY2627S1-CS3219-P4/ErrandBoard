import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AuthContext, type AuthStatus, type AuthUser } from "./auth-context";

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);

  const loadCurrentUser = useCallback(async (): Promise<AuthUser | null> => {
    const response = await fetch(`${API_URL}/auth/me`, {
      credentials: "include",
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { user?: AuthUser };
    return body.user ?? null;
  }, []);

  const refreshAuth = useCallback(async (showCheckingState = true) => {
    if (showCheckingState) setStatus("checking");
    try {
      const currentUser = await loadCurrentUser();
      const authenticated = currentUser !== null;
      setUser(currentUser);
      setStatus(authenticated ? "authenticated" : "unauthenticated");
      return authenticated;
    } catch {
      setUser(null);
      setStatus("unauthenticated");
      return false;
    }
  }, [loadCurrentUser]);

  const logout = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Logout failed (HTTP ${response.status})`);
      }
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadCurrentUser()
      .then((currentUser) => {
        if (!active) return;
        setUser(currentUser);
        setStatus(currentUser ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus("unauthenticated");
      });
    return () => { active = false; };
  }, [loadCurrentUser]);

  const value = useMemo(() => ({ status, user, refreshAuth, logout }), [status, user, refreshAuth, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
