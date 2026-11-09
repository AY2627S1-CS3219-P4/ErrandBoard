
export const ERRAND_STATUSES = [ "OPEN", "ACCEPTED", "PICKED_UP", "PENDING_COMPLETION", "DISPUTED", "COMPLETED", "CANCELLED", "EXPIRED" ] as const;

export type ErrandStatus = (typeof ERRAND_STATUSES)[number];

// DISPUTED is NOT terminal: credits are held until an admin resolves the dispute,
// driving the errand to CANCELLED (refund requester) or COMPLETED (transfer to courier).
export const TERMINAL_STATUSES: readonly ErrandStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED"];
// Owner-visible working states that the deadline sweep auto-advances.
export const ACTIVE_STATUSES: readonly ErrandStatus[] = ["OPEN", "ACCEPTED", "PICKED_UP", "PENDING_COMPLETION"];
// Owner-visible but admin-driven; deliberately kept out of ACTIVE_STATUSES so no deadline
// sweep touches it. listMyErrands still surfaces these to the requester/courier.
export const HELD_STATUSES: readonly ErrandStatus[] = ["DISPUTED"];


//allowed transition dictionary
//key: An ErrandStatus, value: Array of valid ErrandStatus that it can transition to
export const ALLOWED_TRANSITIONS: Record<ErrandStatus, ErrandStatus[]> = {
    OPEN: ["ACCEPTED", "CANCELLED", "EXPIRED"],
    ACCEPTED: ["PICKED_UP", "CANCELLED", "DISPUTED"],
    PICKED_UP: ["PENDING_COMPLETION", "DISPUTED"],
    PENDING_COMPLETION: ["COMPLETED", "DISPUTED"],
    DISPUTED: ["CANCELLED", "COMPLETED"],

    //terminal
    COMPLETED: [],
    CANCELLED: [],
    EXPIRED: []
};

export function isTerminal(status: ErrandStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

export function validTransition(from: ErrandStatus, to: ErrandStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
}




