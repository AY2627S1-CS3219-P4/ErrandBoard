import type { ErrandStatus } from "../status/errandState.js";

// Topic exchange. Consumers bind their own durable queues to it, 
// eg credit binds "errand.completed", "errand.cancelled", "errand.expired".
export const EXCHANGE_NAME = "errand.events";

export type EventType = "errand.completed" | "errand.cancelled" | "errand.expired";

// Why an errand reached its terminal state. Lets a notification consumer tell a dispute
// outcome apart from an ordinary completion/cancellation; the credit service ignores it.
export const TERMINAL_CAUSES = [
    "CONFIRMED",            // requester confirmed receipt
    "AUTO_CONFIRMED",       // confirmation window lapsed, auto-completed by the sweep
    "REQUESTER_CANCELLED",  // requester cancelled an open errand
    "COURIER_CANCELLED",    // courier cancelled an accepted errand
    "EXPIRED",              // open errand expired unaccepted
    "DISPUTE_REFUNDED",     // admin resolved a dispute in the requester's favour
    "DISPUTE_TRANSFERRED",  // admin resolved a dispute in the courier's favour
] as const;
export type TerminalCause = (typeof TERMINAL_CAUSES)[number];

export interface ErrandEvent {
    key: string //errandId
    value: {
        eventId: string;
        type: EventType;
        cause: TerminalCause;
        requesterId: string;
        courierId: string | null;
        credit: number;
        occurredAt: string;
    }
}

export interface EventPublisher {
    isReady(): boolean;
    publish(event: ErrandEvent): Promise<void>;
    close(): Promise<void>;
}

const NAMES: Partial<Record<ErrandStatus, EventType>> = {
    COMPLETED: "errand.completed",
    CANCELLED: "errand.cancelled",
    EXPIRED: "errand.expired",
};

// F17: only terminal statuses produce public events
export function publicEventType(status: ErrandStatus): EventType | undefined {
    return NAMES[status];
}