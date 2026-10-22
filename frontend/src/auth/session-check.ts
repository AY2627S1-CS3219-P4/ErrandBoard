import type { AuthUser } from "./auth-context";

/** Only a definite invalid-session response may log the browser out. */
export async function readCurrentUser(response: Response): Promise<AuthUser | null> {
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Authentication service unavailable");
  const body = await response.json() as { user?: Partial<AuthUser> };
  const user = body?.user;
  if (!user || typeof user.id !== "string" || !user.id ||
      typeof user.email !== "string" || typeof user.username !== "string" ||
      !["USER", "ADMIN", "SUPERADMIN"].includes(user.accountType ?? "")) {
    throw new Error("Authentication service returned an invalid response");
  }
  return user as AuthUser;
}
