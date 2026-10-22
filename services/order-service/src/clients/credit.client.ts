import { settings } from "../config/settings.js";
import { CreditRecoveryRequiredError, InsufficientCreditsError, UpstreamError } from "../errors/order.errors.js";

const CREDIT_TIMEOUT_MS = 3_000;

export interface CreditInput {
  orderId: string;
  requesterId: string;
  amount: number;
}

export type ReservationState = "NOT_RESERVED" | "RESERVED" | "REFUNDED" | "TRANSFERRED";
export interface ReservationStatus {
  state: ReservationState;
  requesterId?: string;
  amount?: number;
  courierId?: string;
}

function orderKey(): string {
  const key = process.env.ORDER_CREDIT_API_KEY;
  if (!key) throw new UpstreamError("credit-service");
  return key;
}

async function creditFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(new URL(path, settings.creditServiceUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${orderKey()}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(CREDIT_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("credit-service");
  }
}

export function reservationMatches(status: ReservationStatus, input: CreditInput): boolean {
  return status.requesterId === input.requesterId && status.amount === input.amount;
}

/** A 503 here means the result remains unknown, not that no reservation exists. */
export async function inspectReservation(orderId: string): Promise<ReservationStatus> {
  const response = await creditFetch(`/credit/reservations/${encodeURIComponent(orderId)}`);
  if (!response.ok) {
    if (response.status === 409) throw new CreditRecoveryRequiredError();
    throw new UpstreamError("credit-service", response.status);
  }
  const status = await response.json().catch(() => null) as ReservationStatus | null;
  if (!status || !["NOT_RESERVED", "RESERVED", "REFUNDED", "TRANSFERRED"].includes(status.state)) {
    throw new UpstreamError("credit-service");
  }
  return status;
}

/** Retry the same orderId only after Credit confirms that no reserve was committed. */
export async function reserveCredits(input: CreditInput): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response | undefined;
    try {
      response = await creditFetch("/credit/reservations", {
        method: "POST", body: JSON.stringify(input),
      });
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
    }
    if (response?.ok) return;

    const status = await inspectReservation(input.orderId);
    if (status.state === "RESERVED") {
      if (!reservationMatches(status, input)) throw new CreditRecoveryRequiredError();
      return;
    }
    if (status.state !== "NOT_RESERVED") throw new CreditRecoveryRequiredError();
    if (response?.status === 402 || response?.status === 409) throw new InsufficientCreditsError();
    if (attempt === 1) throw new UpstreamError("credit-service");
  }
}

/** Safe to repeat after a timeout; Credit's ORDER_END index permits one outcome. */
export async function releaseReservation(input: CreditInput): Promise<void> {
  let response: Response | undefined;
  try {
    response = await creditFetch(`/credit/reservations/${encodeURIComponent(input.orderId)}/release`, {
      method: "POST",
      body: JSON.stringify({ requesterId: input.requesterId, amount: input.amount }),
    });
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
  }
  if (response?.ok) return;

  const status = await inspectReservation(input.orderId);
  if (status.state === "NOT_RESERVED") return;
  if (status.state === "REFUNDED" && reservationMatches(status, input)) return;
  if (status.state === "RESERVED" && reservationMatches(status, input) && !response) {
    throw new UpstreamError("credit-service");
  }
  throw new CreditRecoveryRequiredError();
}
