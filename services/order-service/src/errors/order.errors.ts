import { ErrandStatus } from "../status/errandState.js";

export class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super("Validation failed");
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class SupplierNotFoundError extends Error {
  constructor() {
    super("Supplier not found");
    this.name = "SupplierNotFoundError";
    Object.setPrototypeOf(this, SupplierNotFoundError.prototype);
  }
}

// supplier service could not be reached or gave an unexpected response
export class SupplierUnavailableError extends Error {
  constructor() {
    super("Supplier service is unavailable. Please retry later.");
    this.name = "SupplierUnavailableError";
    Object.setPrototypeOf(this, SupplierUnavailableError.prototype);
  }
}

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

export class DeliveryDeadlinePassedError extends Error {
  constructor() {
    super("Delivery deadline has passed");
    this.name = "DeliveryDeadlinePassedError";
    Object.setPrototypeOf(this, DeliveryDeadlinePassedError.prototype);
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: ErrandStatus, to: ErrandStatus) {
    super(`Errand transition from ${from} to ${to} is not allowed`);
    this.name = "InvalidStatusTransitionError";
    Object.setPrototypeOf(this, InvalidStatusTransitionError.prototype);
  }
}