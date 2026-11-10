import type { AccessTokenClaims } from "../security/token.js";

declare global {
  namespace Express {
    interface Request {
      // Set by the admin/superadmin guards after a token is verified, so controllers
      // can attribute privileged actions to the acting account in audit logs.
      user?: AccessTokenClaims;
    }
  }
}

export {};
