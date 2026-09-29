import { createContext } from "react";

export type AuthStatus = "checking" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  status: AuthStatus;
  refreshAuth: (showCheckingState?: boolean) => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
