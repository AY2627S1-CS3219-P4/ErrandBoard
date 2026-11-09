import {
  apiFetch,
  userApiUrl,
  supplierApiUrl,
  orderApiUrl,
  creditApiUrl,
} from "./client";
import { serviceUnavailable } from "./service-errors";

// Admin dashboard statistics. Each service owns one rich `/stats` endpoint (all guarded by
// requireAdmin). The main dashboard reads a few top-level fields; each tab reads the detailed
// fields from the same response. Count/aggregation logic lives server-side — this module only
// transports and types the numbers.

export class StatsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StatsApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, service: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(url, { headers: { Accept: "application/json" }, signal, cache: "no-store" });
  } catch (error) {
    if (signal?.aborted) throw error; // callers ignore their own aborts
    throw new StatsApiError(0, "NETWORK", serviceUnavailable(service));
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
    throw new StatsApiError(
      response.status,
      body?.code ?? "UNKNOWN",
      body?.error ?? `Request failed (HTTP ${response.status})`,
    );
  }
  const payload = (await response.json()) as { stats: T };
  return payload.stats;
}

// --- Response shapes (mirror each service's /stats endpoint) ---

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  users: number;
  admins: number;
  superadmins: number;
}

export type SupplierCategory = "FOOD_BEVERAGE" | "RETAIL" | "CONVENIENCE" | "PRINTING" | "OTHER";

export interface SupplierStats {
  totalSuppliers: number;
  activeSuppliers: number;
  inactiveSuppliers: number;
  byCategory: Record<SupplierCategory, number>;
}

export interface ErrandStats {
  total: number;
  active: number;
  openActive: number;
  open: number;
  accepted: number;
  picked_up: number;
  pending_completion: number;
  completed: number;
  expired: number;
  cancelled: number;
  disputed: number;
  disputedBySystem: number;
  disputedByRequester: number;
  creditsHeld: number;
}

export interface CreditDistributionBin {
  label: string; // e.g. "50–99"
  count: number; // number of accounts whose available balance falls in this band
}

export interface CreditStats {
  totalCredits: number;
  available: number;
  reserve: number;
  accounts: number;
  activeAccounts: number;
  transferred: number; // lifetime credits paid out to couriers
  refunded: number;    // lifetime credits returned to requesters
  availableDistribution: CreditDistributionBin[]; // histogram of available balances
}

// --- Per-service getters (each tab calls the one it needs) ---

export function getUserStats(signal?: AbortSignal): Promise<UserStats> {
  return request<UserStats>(userApiUrl("/admin/stats"), "User Service", signal);
}

export function getSupplierStats(signal?: AbortSignal): Promise<SupplierStats> {
  return request<SupplierStats>(supplierApiUrl("/suppliers/stats"), "Supplier Service", signal);
}

export function getErrandStats(signal?: AbortSignal): Promise<ErrandStats> {
  return request<ErrandStats>(orderApiUrl("/errands/stats"), "Order Service", signal);
}

export function getCreditStats(signal?: AbortSignal): Promise<CreditStats> {
  return request<CreditStats>(creditApiUrl("/credit/stats"), "Credit Service", signal);
}

// --- Dashboard fan-out: one slow/failed service must not fail the whole dashboard ---

export interface AdminStats {
  users: UserStats | null;
  suppliers: SupplierStats | null;
  errands: ErrandStats | null;
  credits: CreditStats | null;
}

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export async function getAdminStats(signal?: AbortSignal): Promise<AdminStats> {
  const [users, suppliers, errands, credits] = await Promise.allSettled([
    getUserStats(signal),
    getSupplierStats(signal),
    getErrandStats(signal),
    getCreditStats(signal),
  ]);

  return {
    users: settled(users),
    suppliers: settled(suppliers),
    errands: settled(errands),
    credits: settled(credits),
  };
}
