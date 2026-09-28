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
    updateSupplier,
    SupplierNotFoundError,
    DuplicateSupplierError
} from "../services/supplier.service.js";



export async function create(req: Request, res: Response): Promise<void> {
    try {
        const supplier = await createSupplier(req.body);
        res.json({supplier});
    } catch (error) {
        if (error = SupplierNotFoundError) {
            res.status(404).json({error: "Supplier not found"});
            return;
        }

        throw error;
    }
}

/*export async function list(req: Request, res: Response): Promise<void> {

}*/

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