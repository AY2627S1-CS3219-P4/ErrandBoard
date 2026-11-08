import { orderApiUrl, apiFetch, requestCreditBalanceRefresh } from "./client";
import type { Errand, ErrandAction, CreateErrandInput, ErrandFilters } from "../types/errand";
import { serviceUnavailable } from "./service-errors";

/*define errand exclusive errors here*/
export class ErrandApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ErrandApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// 503 upstream outages (SUPPLIER_UNAVAILABLE, SERVICE_UPSTREAM_ERROR) are intentionally left
// out: they fall through to the generic 5xx message below, avoiding internal service names.
// DISPUTE_ALREADY_RESOLVED omitted, uses the server message that includes the resolved state (whether the requester or courier was refunded)
const CODE_MESSAGES: Record<string, string> = {
  SUPPLIER_NOT_FOUND: "This supplier no longer exists or has been deactivated.",
  SELF_ASSIGN: "You cannot accept your own errand.",
  UPDATE_CONFLICT: "This errand was just changed by someone else. Refreshing the latest state.",
  ERRAND_NOT_FOUND: "This errand is no longer available.",
  DEADLINE_PASSED: "The delivery deadline for this errand has passed.",
  INSUFFICIENT_CREDITS: "You do not have enough available credits for this errand.",
  ACCESS_REVOKED: "Your session is no longer valid. Please log in again.",
  ACCOUNT_INACTIVE: "Your account is inactive.",
  AUTHORIZATION_UNAVAILABLE: "Authorization is temporarily unavailable. Please try again.",
  ORDER_CREATION_PENDING: "We could not confirm whether your errand was created. Check My Errands before trying again.",
  CREDIT_RECONCILIATION_REQUIRED: "This errand needs a credit check. Please contact support before trying again.",
};

export function describeError(error: unknown): string {
  if (error instanceof ErrandApiError) {
    return CODE_MESSAGES[error.code] ?? (error.status >= 500 ? serviceUnavailable("Order Service") : error.message);
  }
  return serviceUnavailable("Order Service");
}


async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await apiFetch(orderApiUrl(path), { ...init, headers });
  } catch (error) {
    if (init.signal?.aborted) throw error; // callers ignore their own aborts
    throw new ErrandApiError(0, "NETWORK", serviceUnavailable("Order Service"));
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { code?: string; error?: string; fields?: Record<string, string> }
      | null;
    throw new ErrandApiError(
      response.status,
      body?.code ?? "UNKNOWN",
      body?.error ?? `Request failed (HTTP ${response.status})`,
      body?.fields,
    );
  }
  return (await response.json()) as T;
}

export async function listOpenErrands(filters: ErrandFilters, signal?: AbortSignal): Promise<Errand[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.dropoff) params.set("dropoff", filters.dropoff);
  if (filters.since) params.set("since", filters.since);
  filters.building?.forEach((value) => params.append("building", value));
  filters.supplierId?.forEach((value) => params.append("supplierId", value));
  const query = params.size > 0 ? `?${params}` : "";
  return (await request<{ errands: Errand[] }>(`/errands${query}`, { signal })).errands;
}

export async function listMyErrands(signal?: AbortSignal): Promise<Errand[]> {
  return (await request<{ errands: Errand[] }>("/errands/mine", { signal })).errands;
}

export async function createErrand(input: CreateErrandInput): Promise<Errand> {
  const body = await request<{ errand: Errand }>("/errands", {
    method: "POST",
    body: JSON.stringify(input),
  });
  // Order creates the errand only after Credit has reserved the requested amount.
  requestCreditBalanceRefresh();
  return body.errand;
}

export async function acceptErrand(id: string): Promise<Errand> {
  return runErrandAction(id, "accept");
}

export async function runErrandAction(id: string, action: Exclude<ErrandAction, "dispute"> | "accept"): Promise<Errand> {
  const body = await request<{ errand: Errand }>(`/errands/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
  });
  return body.errand;
}

// dispute carries a reason body, so it cannot reuse the bodyless runErrandAction helper.
export async function disputeErrand(id: string, reason: string): Promise<Errand> {
  const body = await request<{ errand: Errand }>(`/errands/${encodeURIComponent(id)}/dispute`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  return body.errand;
}

// admin: the dispute queue
export async function listDisputes(signal?: AbortSignal): Promise<Errand[]> {
  return (await request<{ errands: Errand[] }>("/errands/disputes", { signal })).errands;
}

// admin: resolve a dispute by refunding the requester
export async function resolveDisputeRefund(id: string): Promise<Errand> {
  const body = await request<{ errand: Errand }>(`/errands/${encodeURIComponent(id)}/resolve-refund`, {
    method: "POST",
  });
  requestCreditBalanceRefresh();
  return body.errand;
}

// admin: resolve a dispute by transferring the credit to the courier
export async function resolveDisputeTransfer(id: string): Promise<Errand> {
  const body = await request<{ errand: Errand }>(`/errands/${encodeURIComponent(id)}/resolve-transfer`, {
    method: "POST",
  });
  requestCreditBalanceRefresh();
  return body.errand;
}
