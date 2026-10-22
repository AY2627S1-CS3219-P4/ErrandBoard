export const USER_API_BASE_URL = "/api/user";
export const SUPPLIER_API_BASE_URL = "/api/supplier";
export const ORDER_API_BASE_URL = "/api/order";
export const CREDIT_API_BASE_URL = "/api/credit";
export const AUTH_SESSION_EXPIRED_EVENT = "errandboard:auth-session-expired";
export const CREDIT_BALANCE_REFRESH_EVENT = "errandboard:credit-balance-refresh";

export interface CreditBalance {
  available: number;
  reserve: number;
}

export function requestCreditBalanceRefresh(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CREDIT_BALANCE_REFRESH_EVENT));
  }
}

// Share concurrent reads, but don't keep a successful balance cached indefinitely.
const creditBalanceRequests = new Map<string, Promise<CreditBalance>>();

type RefreshOutcome = "refreshed" | "invalid" | "unavailable";
let refreshInFlight: Promise<RefreshOutcome> | null = null;

export function userApiUrl(path: string): string {
  return `${USER_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function supplierApiUrl(path: string): string {
  return `${SUPPLIER_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function orderApiUrl(path: string): string {
  return `${ORDER_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function creditApiUrl(path: string): string {
  return `${CREDIT_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Fetch the signed-in user's balance; the endpoint derives identity from the cookie. */
export function getCreditBalance(userId: string): Promise<CreditBalance> {
  const cachedRequest = creditBalanceRequests.get(userId);
  if (cachedRequest) return cachedRequest;

  const request: Promise<CreditBalance> = apiFetch(creditApiUrl("/credit/me/balance"), { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Credit balance request failed (HTTP ${response.status})`);
      const balance = await response.json() as Partial<CreditBalance>;
      if (!Number.isFinite(balance.available) || !Number.isFinite(balance.reserve)) {
        throw new Error("Credit balance response has an invalid shape");
      }
      return balance as CreditBalance;
    })
    .finally(() => {
      if (creditBalanceRequests.get(userId) === request) {
        creditBalanceRequests.delete(userId);
      }
    });

  creditBalanceRequests.set(userId, request);
  return request;
}

async function shouldRefreshAccessToken(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const body = await response.clone().json().catch(() => null) as { code?: string } | null;
  // The browser may already have removed the 15-minute access cookie.
  return body?.code === "ACCESS_TOKEN_EXPIRED" || body?.code === "AUTHENTICATION_REQUIRED";
}

async function isAccessRevoked(response: Response): Promise<boolean> {
  if (response.status !== 401 && response.status !== 403) return false;
  const body = await response.clone().json().catch(() => null) as { code?: string } | null;
  return body?.code === "ACCESS_REVOKED" || body?.code === "ACCOUNT_INACTIVE" ||
    body?.code === "INVALID_ACCESS_TOKEN";
}

async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(userApiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((response): RefreshOutcome => {
        if (response.ok) return "refreshed";
        if (response.status === 401 || response.status === 403) return "invalid";
        return "unavailable";
      })
      .catch((): RefreshOutcome => "unavailable")
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

function dispatchSessionExpired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
}

async function fetchWithCredentials(input: string | URL, init: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}

/** Fetch through the same-origin API proxy and refresh a missing or expired access cookie once. */
export async function apiFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const firstResponse = await fetchWithCredentials(input, init);
  if (!await shouldRefreshAccessToken(firstResponse)) {
    if (await isAccessRevoked(firstResponse)) dispatchSessionExpired();
    return firstResponse;
  }

  const retryAfterRefresh = async (): Promise<Response> => {
    const refreshOutcome = await refreshAccessToken();
    if (refreshOutcome === "invalid") {
      dispatchSessionExpired();
      return firstResponse;
    }
    if (refreshOutcome === "unavailable") {
      return Response.json({
        code: "AUTHORIZATION_UNAVAILABLE",
        error: "Authentication is temporarily unavailable. Please try again.",
      }, { status: 503 });
    }

    // Retry exactly once. A second expiry is returned to the caller, not looped.
    const retried = await fetchWithCredentials(input, init);
    if (await isAccessRevoked(retried) || await shouldRefreshAccessToken(retried)) dispatchSessionExpired();
    return retried;
  };

  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("errandboard-access-token-refresh", retryAfterRefresh);
  }

  return retryAfterRefresh();
}
