//What functions should the controller + service support?

//1. List all suppliers
//2. Add supplier
//3. Remove supplier
//4. Get specific supplier
//5. filter supplier 
//CRUD -> Create Read Update Delete

import type {Request, Response} from "express";
import {
    createSupplier,
    deactivateSupplier,
    getSupplierById,
    listSuppliers,
    updateSupplier,
    SupplierNotFoundError,
    DuplicateSupplierError

} from "../services/supplier.service.js";
import type { SupplierCategory } from "../models/Supplier.js";
import { duplexPair } from "stream";


export async function create(req: Request, res: Response): Promise<void> {
    try {
        const supplier = await createSupplier(req.body);
        res.status(201).json({supplier});
    } catch (error) {
        if (error instanceof SupplierNotFoundError) {
            res.status(404).json({error: "Supplier not found"});
            return;
        }

        if (error instanceof DuplicateSupplierError) {
            res.status(409).json({error: "Duplicate supplier"});
            return;
        }
        throw error;
    }
}

export async function list(req: Request, res: Response): Promise<void> {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const category = toArray(req.query.category) as SupplierCategory[] | undefined;
    const building = toArray(req.query.building);
    const showInactive = req.query.showInactive == "true"; //this needs an auth check?

    const suppliers = await listSuppliers({ search, category, building, showInactive });

    res.json({ suppliers });
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const supplier = await getSupplierById(String(req.params.id));
    res.json({ supplier });
  } catch (error) {
    if (error instanceof SupplierNotFoundError) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    throw error;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  try {
    const supplier = await updateSupplier(String(req.params.id), req.body);
    res.json({ supplier });
  } catch (error) {
    if (error instanceof SupplierNotFoundError) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    if (error instanceof DuplicateSupplierError) {
      res.status(409).json({ error: error.message });
      return;
    }

    throw error;
  }
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  try {
    const supplier = await deactivateSupplier(String(req.params.id));
    res.json({ supplier });
  } catch (error) {
    if (error instanceof SupplierNotFoundError) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    throw error;
  }
}


//this function helps convert unknown req.params into either an array of strings (string[]) or undefined
function toArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? (value as string[]) : [value as string]; //if array of strings return as is, else wrap the singular string in an array.
}