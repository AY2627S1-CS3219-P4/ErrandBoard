import { Response, Request} from "express";
import { Error as MongooseError } from "mongoose";
import {
  listOpenErrands,
  listMyErrands,
  getErrand,
  type ListFilters,
  createErrand,
  acceptErrand,
  pickUpErrand,
  deliverErrand,
  completeErrand,
  cancelErrandByRequester,
  cancelErrandByCourier,
} from "../services/order.services.js";
import {
  ErrandNotFoundError,
  SelfAssignErrandError,
  ValidationError,
  UpdateConflictError,
  SupplierNotFoundError,
  SupplierUnavailableError,
  DeliveryDeadlinePassedError,
  InsufficientCreditsError,
  UpstreamError,
} from "../errors/order.errors.js";

function toArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const items = (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseListFilters(req: Request): ListFilters {
  const filters: ListFilters = {
    supplierId: toArray(req.query.supplierId),
    building: toArray(req.query.building),
    address: toArray(req.query.address),
    dropoff: toText(req.query.dropoff),
    q: toText(req.query.q),
  };

  const since = toText(req.query.since);
  if (since) {
    const date = new Date(since);
    if (Number.isNaN(date.getTime())) throw new ValidationError({ since: "since must be an ISO date" });
    filters.since = date;
  }

  return filters;
}

function sendKnownError(res: Response, error: unknown): boolean {
  if (error instanceof ValidationError) {
    res.status(400).json({ code: "VALIDATION_FAILED", error: error.message, fields: error.fields });
  } else if (error instanceof MongooseError.ValidationError) {
    const fields = Object.fromEntries(Object.entries(error.errors).map(([path, err]) => [path, err.message]));
    res.status(400).json({ code: "VALIDATION_FAILED", error: "Validation failed", fields });
  } else if (error instanceof ErrandNotFoundError) {
    res.status(404).json({ code: "ERRAND_NOT_FOUND", error: "Errand not found" });
  } else if (error instanceof SelfAssignErrandError) {
    res.status(403).json({ code: "SELF_ASSIGN", error: "Errands cannot be self-assigned" });
  } else if (error instanceof DeliveryDeadlinePassedError) {
    res.status(409).json( { code: "DEADLINE_PASSED", error: "Delivery deadline passed"})
  } else if (error instanceof UpdateConflictError) {
    res.status(409).json({ code: "UPDATE_CONFLICT", error: "Errand could not be updated" });
  } else if (error instanceof SupplierNotFoundError) {
    res.status(404).json({ code: "SUPPLIER_NOT_FOUND", error: "Supplier not found or no longer active" });
  } else if (error instanceof SupplierUnavailableError) {
    res.status(503).json({ code: "SUPPLIER_UNAVAILABLE", error: error.message });
  } else if (error instanceof InsufficientCreditsError) {
    res.status(400).json({ code: "INSUFFICIENT_CREDITS", error: "Insufficient credits" });
  } else if (error instanceof UpstreamError) {
    res.status(503).json({ code: "SERVICE_UPSTREAM_ERROR", error: error.message });
  }
  else {
    return false;
  }
  return true;
}

const userId = (req: Request) => req.user!.userId;
const idParam = (req: Request) => String(req.params.id);

//Read functions
export async function list(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errands: await listOpenErrands(userId(req), parseListFilters(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

export async function mine(req: Request, res: Response): Promise<void> {
  res.json({ errands: await listMyErrands(userId(req)) });
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errand: await getErrand(userId(req), idParam(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

export async function create(req: Request, res: Response): Promise<void> {
  try {
    // the supplier copy is looked up from supplier-service, so only the id is taken from the client
    const { supplierId, dropoff, description, credit } = req.body ?? {};
    const errand = await createErrand({ requesterId: userId(req), supplierId, dropoff, description, credit });
    res.status(201).json({ errand });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

//Update functions (the acting courier/requester is always the authenticated user)
export async function accept(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errand: await acceptErrand(idParam(req), userId(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

export async function pickup(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errand: await pickUpErrand(idParam(req), userId(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

export async function deliver(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errand: await deliverErrand(idParam(req), userId(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

export async function complete(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errand: await completeErrand(idParam(req), userId(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

export async function cancelByRequester(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errand: await cancelErrandByRequester(idParam(req), userId(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}

export async function cancelByCourier(req: Request, res: Response): Promise<void> {
  try {
    res.json({ errand: await cancelErrandByCourier(idParam(req), userId(req)) });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}