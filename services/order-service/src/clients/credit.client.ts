import { settings } from "../config/settings.js";
import { InsufficientCreditsError, UpstreamError } from "../errors/order.errors.js";

const CREDIT_TIMEOUT_MS = 3000;

export interface CreditInput {
    orderId: string,
    requesterId: string,
    amount: number
}

export async function reserveCredits(creditInput: CreditInput): Promise<void> {
    const key = process.env.ORDER_CREDIT_API_KEY;
    if (!key) {
        throw new UpstreamError("credit-service");
    }

    let res: Response;
    try {
        res = await fetch(`${settings.creditServiceUrl}/credit/reservations`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(creditInput),
            signal: AbortSignal.timeout(CREDIT_TIMEOUT_MS),
        });
    } catch {
        // network failure or timeout
        throw new UpstreamError("credit-service");
    }

    if (res.ok) {
        return;
    }

    const body = await res.json().catch(() => null) as { error?: string } | null;

    if (res.status === 402 || res.status === 409) {
        throw new InsufficientCreditsError();
    }

    // 400, 401, 403, 503, 5xx, etc. are treated as upstream problems
    console.error("Credit service rejected reservation", res.status, body?.error);
    throw new UpstreamError("credit-service");
}