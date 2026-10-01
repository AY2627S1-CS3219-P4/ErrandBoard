import { createContext } from "react";

export type AuthStatus = "checking" | "authenticated" | "unauthenticated";

export type AccountType = "USER" | "ADMIN" | "SUPERADMIN";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  accountType: AccountType;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  refreshAuth: (showCheckingState?: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
