import type { AccessTokenClaims } from "../security/token.js";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenClaims;
    }
  }
}

export {};
