export const ACCOUNT_TYPES = ["USER", "ADMIN", "SUPERADMIN"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccessTokenClaims {
  userId: string;
  role: AccountType;
  authzVersion: number;
}
