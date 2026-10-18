/*
*errand.ts basically defines interface formats that the backend expects to receive.
*Whatever the frontend sends for a specific operation must be adhere to the interface formats
*defined below.
*/

export const ERRAND_STATUSES = [ "OPEN", "ACCEPTED", "PICKED_UP", "PENDING_COMPLETION", "COMPLETED", "CANCELLED", "EXPIRED" ] as const;

export type ErrandStatus = (typeof ERRAND_STATUSES)[number];

export const STATUS_LABELS: Record<ErrandStatus, string> = {
    OPEN: "Open",
    ACCEPTED: "Accepted",
    PICKED_UP: "Picked up",
    PENDING_COMPLETION: "Awaiting confirmation",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    EXPIRED: "Expired"
}

//Relevant supplier information that errand pages would want to display
export interface ErrandSupplier {
    supplierId: string;
    name: string;
    building: string;
    address: string;
    imageUrl?: string;
}

export interface ErrandDocument {
    requesterId: string;
    courierId?: string;
    supplier: ErrandSupplier;
    dropoff: string;
    description: string;
    credit: number;
    status: ErrandStatus;
    expiresAt: Date;
    completeBy?: Date;
    confirmBy?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateErrandInput {
    requesterId: string;
    supplierId: string;
    dropoff: string;
    description: string;
    credit: number;
}

export interface ListFilters {
  supplierId?: string[];
  building?: string[];   
  address?: string[];
  dropoff?: string;
  q?: string; //matching keyword in errand description            
  since?: Date; 
}

export type ErrandAction = "cancel" | "courier-cancel" | "pickup" | "deliver" | "complete";

export const ACTIVE_STATUSES_SET: ReadonlySet<ErrandStatus> = new Set<ErrandStatus>([
  "OPEN",
  "ACCEPTED",
  "PICKED_UP",
  "PENDING_COMPLETION",
]);

