import type { AccessTokenClaims } from "./auth.types.ts";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenClaims;
    }
  }
}

export {};