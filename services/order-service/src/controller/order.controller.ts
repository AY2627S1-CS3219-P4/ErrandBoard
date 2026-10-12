import { Response, Request} from "express";
import { listOpenErrands, listMyErrands, getErrand, type ListFilters} from "../services/order.services.js";

export class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super("Validation failed");
  }
}

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


const userId = (req: Request) => req.user!.userId;
const idParam = (req: Request) => String(req.params.id);

//Read functions
export async function list(req: Request, res: Response): Promise<void> {
  res.json(await listOpenErrands(userId(req), parseListFilters(req)));
}

export async function mine(req: Request, res: Response): Promise<void> {
  res.json(await listMyErrands(userId(req)));
}

export async function getById(req: Request, res: Response): Promise<void> {
  res.json({ errand: await getErrand(userId(req), idParam(req)) });
}
