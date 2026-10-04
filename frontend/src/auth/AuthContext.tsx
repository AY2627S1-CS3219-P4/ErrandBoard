import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AuthContext, type AuthStatus, type AuthUser } from "./auth-context";
import { apiFetch, AUTH_SESSION_EXPIRED_EVENT, userApiUrl } from "../api/client";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);

  const loadCurrentUser = useCallback(async (): Promise<AuthUser | null> => {
    const response = await apiFetch(userApiUrl("/auth/me"));

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
      const response = await apiFetch(userApiUrl("/auth/logout"), {
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

  useEffect(() => {
    const onSessionExpired = () => {
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  const value = useMemo(() => ({ status, user, refreshAuth, logout }), [status, user, refreshAuth, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
