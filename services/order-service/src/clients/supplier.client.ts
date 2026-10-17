import { settings } from "../config/settings.js";
import { SupplierNotFoundError, SupplierUnavailableError } from "../errors/order.errors.js";
import type { SupplierCopy } from "../models/Errand.js";

const SUPPLIER_TIMEOUT_MS = 3000;

interface SupplierResponse {
  supplier: {
    name: string;
    building: string;
    address: string;
    imageUrl?: string;
  };
}

// fetch supplier data from supplier service for supplier status check
export async function fetchActiveSupplier(supplierId: string): Promise<SupplierCopy> {
  let response: Response;
  try {
    const url = new URL(`/suppliers/${encodeURIComponent(supplierId)}`, settings.supplierServiceUrl);
    response = await fetch(url, { signal: AbortSignal.timeout(SUPPLIER_TIMEOUT_MS) });
  } catch {
    throw new SupplierUnavailableError();
  }

  if (response.status === 404) throw new SupplierNotFoundError();
  if (!response.ok) throw new SupplierUnavailableError();

  let body: SupplierResponse;
  try {
    body = (await response.json()) as SupplierResponse;
  } catch {
    throw new SupplierUnavailableError();
  }

  const { name, building, address, imageUrl } = body.supplier ?? {};
  if (!name || !building) throw new SupplierUnavailableError();

  return { supplierId, name, building, address, imageUrl };
}
