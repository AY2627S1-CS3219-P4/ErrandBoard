import type { ErrandStatus } from "../status/errandState.js";

// Topic exchange. Consumers bind their own durable queues to it, 
// eg credit binds "errand.completed", "errand.cancelled", "errand.expired".
export const EXCHANGE_NAME = "errand.events";

export type EventType = "errand.completed" | "errand.cancelled" | "errand.expired";

export interface ErrandEvent {
    key: string //errandId
    value: {
        eventId: string;
        type: EventType;
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