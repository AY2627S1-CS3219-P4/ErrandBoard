import { ErrandStatus } from "../status/errandState.js";

export class UpdateConflictError extends Error {
  constructor() {
    super("Errand update failed");
    this.name = "UpdateConflictError";
    Object.setPrototypeOf(this, UpdateConflictError.prototype);
  }
}

export class ErrandNotFoundError extends Error {
  constructor() {
    super("Errand not found");
    this.name = "ErrandNotFoundError";
    Object.setPrototypeOf(this, ErrandNotFoundError.prototype);
  }
}

export class SelfAssignErrandError extends Error {
  constructor() {
    super("Self-created errand cannot be assigned to self");
    this.name = "SelfAssignErrandError";
    Object.setPrototypeOf(this, SelfAssignErrandError.prototype);
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: ErrandStatus, to: ErrandStatus) {
    super(`Errand transition from ${from} to ${to} is not allowed`);
    this.name = "InvalidStatusTransitionError";
    Object.setPrototypeOf(this, InvalidStatusTransitionError.prototype);
  }
}