export const USER_API_BASE_URL = "/api/user";
export const SUPPLIER_API_BASE_URL = "/api/supplier";
export const AUTH_SESSION_EXPIRED_EVENT = "errandboard:auth-session-expired";

let refreshInFlight: Promise<boolean> | null = null;

export function userApiUrl(path: string): string {
  return `${USER_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function supplierApiUrl(path: string): string {
  return `${SUPPLIER_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function isAccessTokenExpired(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const body = await response.clone().json().catch(() => null) as { code?: string } | null;
  return body?.code === "ACCESS_TOKEN_EXPIRED";
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

/** Fetch through the same-origin API proxy and refresh an expired access cookie once. */
export async function apiFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const firstResponse = await fetchWithCredentials(input, init);
  if (!await isAccessTokenExpired(firstResponse)) return firstResponse;

  const retryAfterRefresh = async (): Promise<Response> => {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      dispatchSessionExpired();
      return firstResponse;
    }

    // Retry exactly once. A second expiry is returned to the caller, not looped.
    return fetchWithCredentials(input, init);
  };

  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("errandboard-access-token-refresh", retryAfterRefresh);
  }

  return retryAfterRefresh();
}
