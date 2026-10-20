export const USER_API_BASE_URL = "/api/user";
export const SUPPLIER_API_BASE_URL = "/api/supplier";
export const ORDER_API_BASE_URL = "/api/order";
export const CREDIT_API_BASE_URL = "/api/credit";
export const AUTH_SESSION_EXPIRED_EVENT = "errandboard:auth-session-expired";

export interface CreditBalance {
  available: number;
  reserve: number;
}

const creditBalanceRequests = new Map<string, Promise<CreditBalance>>();

let refreshInFlight: Promise<boolean> | null = null;

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

/** Fetch a user's balance once per page load; the endpoint derives identity from the cookie. */
export function getCreditBalance(userId: string): Promise<CreditBalance> {
  const cachedRequest = creditBalanceRequests.get(userId);
  if (cachedRequest) return cachedRequest;

  const request = apiFetch(creditApiUrl("/credit/me/balance"))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Credit balance request failed (HTTP ${response.status})`);
      const balance = await response.json() as Partial<CreditBalance>;
      if (!Number.isFinite(balance.available) || !Number.isFinite(balance.reserve)) {
        throw new Error("Credit balance response has an invalid shape");
      }
      return balance as CreditBalance;
    })
    .catch((error: unknown) => {
      creditBalanceRequests.delete(userId);
      throw error;
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

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(userApiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((response) => response.ok)
      .catch(() => false)
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
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      dispatchSessionExpired();
      return firstResponse;
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
