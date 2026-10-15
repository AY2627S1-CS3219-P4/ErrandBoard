
export const ERRAND_STATUSES = [ "OPEN", "ACCEPTED", "PICKED_UP", "PENDING_COMPLETION", "COMPLETED", "CANCELLED", "EXPIRED" ] as const;

export type ErrandStatus = (typeof ERRAND_STATUSES)[number];

export const TERMINAL_STATUSES: readonly ErrandStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED"];
export const ACTIVE_STATUSES: readonly ErrandStatus[] = ["OPEN", "ACCEPTED", "PICKED_UP", "PENDING_COMPLETION"];


//allowed transition dictionary
//key: An ErrandStatus, value: Array of valid ErrandStatus that it can transition to
export const ALLOWED_TRANSITIONS: Record<ErrandStatus, ErrandStatus[]> = {
    OPEN: ["ACCEPTED", "CANCELLED", "EXPIRED"],
    ACCEPTED: ["PICKED_UP", "CANCELLED"],
    PICKED_UP: ["PENDING_COMPLETION", "CANCELLED"], //admin can cancel errand after dispute raised
    PENDING_COMPLETION: ["COMPLETED"],

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




