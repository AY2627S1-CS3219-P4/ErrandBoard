import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AuthContext, type AuthStatus, type AuthUser } from "./auth-context";
import { apiFetch, AUTH_SESSION_EXPIRED_EVENT, userApiUrl } from "../api/client";
import { readCurrentUser } from "./session-check";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);

  const loadCurrentUser = useCallback(async (): Promise<AuthUser | null> => {
    const response = await apiFetch(userApiUrl("/auth/me"));
    return readCurrentUser(response);
  }, []);

  const refreshAuth = useCallback(async (showCheckingState = true) => {
    if (showCheckingState && !user) setStatus("checking");
    try {
      const currentUser = await loadCurrentUser();
      const authenticated = currentUser !== null;
      setUser(currentUser);
      setStatus(authenticated ? "authenticated" : "unauthenticated");
      return authenticated;
    } catch {
      // A failed check is not proof that the session was revoked. Retain a
      // previously verified user, but never grant access on a fresh load.
      setStatus(user ? "authenticated" : "unavailable");
      return false;
    }
  }, [loadCurrentUser, user]);

  const logout = useCallback(async () => {
    try {
      const response = await apiFetch(userApiUrl("/auth/logout"), {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) throw new Error("Logout could not be confirmed");
      setUser(null);
      setStatus("unauthenticated");
    } catch {
      // Do not claim logout succeeded if the revocation request never arrived.
      throw new Error("Unable to log out right now. Please try again.");
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
        setStatus("unavailable");
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
