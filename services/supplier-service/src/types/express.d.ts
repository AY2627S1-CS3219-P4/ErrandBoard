import type { AccessTokenClaims } from "./auth.types.js";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenClaims;
    }
  }
}

export {};
