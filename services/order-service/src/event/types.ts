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

// ---- Status-change events (consumed by the Notification Service) ----
// Unlike the terminal events above, these are emitted for EVERY transition and carry no settlement
// semantics: Credit never binds to this routing key. See src/event/status.events.ts.
export const STATUS_EVENT_TYPE = "errand.status.changed" as const;

export type ActorRole = "REQUESTER" | "COURIER" | "SYSTEM" | "ADMIN";

export interface Actor {
    role: ActorRole;
    userId: string | null; // null for the lifecycle sweep
}
export const SYSTEM_ACTOR: Actor = { role: "SYSTEM", userId: null };

export interface StatusChangeEvent {
    key: string; // errandId
    value: {
        eventId: string; // `<errandId>:status:<STATUS>`; an errand reaches each status at most once
        type: typeof STATUS_EVENT_TYPE;
        errandId: string;
        status: ErrandStatus;
        previousStatus: ErrandStatus;
        actor: Actor;
        requesterId: string;
        courierId: string | null;
        credit: number;
        supplierName: string;
        dropoff: string;
        deadline: string | null; // deliverBy for PICKED_UP, confirmBy for PENDING_COMPLETION
        occurredAt: string;
    };
}

export type PublishableEvent = ErrandEvent | StatusChangeEvent;

export interface EventPublisher {
    isReady(): boolean;
    publish(event: PublishableEvent): Promise<void>;
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