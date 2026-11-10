//What functions should the controller + service support?

//1. List all suppliers
//2. Add supplier
//3. Remove supplier
//4. Get specific supplier
//5. filter supplier 
//CRUD -> Create Read Update Delete

import type {Request, Response} from "express";
import { logger } from "../logger.js";
import {
    createSupplier,
    deactivateSupplier,
    getSupplierById,
    listSuppliers,
    updateSupplier,
    getSupplierStats,
    SupplierNotFoundError,
    DuplicateSupplierError
} from "../services/supplier.service.js";
import type { SupplierCategory } from "../models/Supplier.js";

function userId(req: Request): string | undefined {
  return req.user?.userId;
}

export async function create(req: Request, res: Response): Promise<void> {
    try {
        const supplier = await createSupplier(req.body);
        logger.info(
          {
            event: "supplier.created",
            supplierId: supplier._id.toString(),
            adminId: userId(req),
            supplierName: supplier.name,
            category: supplier.category,
            building: supplier.building,
          },
          "Supplier created by admin",
        );

        res.status(201).json({supplier});
    } catch (error) {
        if (error instanceof DuplicateSupplierError) {
          logger.warn(
            { 
              event: "supplier.created_rejected",
              adminId: userId(req),
              reason: "duplicate_supplier",
              // use supplierName instead of name, which is a pino-reserved field
              supplierName: req.body.name ?? "",
              building: req.body.building ?? "",
              category: req.body.category ?? "",
            },
            "Supplier create rejected"
          );

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
    const address = toArray(req.query.address);
    //only admins can see inactive suppliers
    const showInactive = isAdmin(req) && req.query.showInactive === "true";

    const suppliers = await listSuppliers({ search, category, building, address, showInactive });

    res.json({ suppliers });
}

// admin-only: platform-wide supplier statistics for the admin dashboard
export async function stats(_req: Request, res: Response): Promise<void> {
  res.json({ stats: await getSupplierStats() });
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const supplier = await getSupplierById(String(req.params.id), isAdmin(req));
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
    logger.info(
      {
        event: "supplier.updated",
        supplierId: supplier._id.toString(),
        adminId: userId(req),
        newFields: req.body ?? {},
      },
      "Supplier updated by admin",
    );
    res.json({ supplier });
  } catch (error) {
    if (error instanceof SupplierNotFoundError) {
      logger.warn( 
        { 
          event: "supplier.update_rejected", 
          adminId: userId(req), 
          reason: "supplier_not_found",
          newFields: req.body ?? {},
        },
      "Supplier update failed" );

      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    if (error instanceof DuplicateSupplierError) {
      logger.warn( 
        { 
          event: "supplier.update_rejected", 
          adminId: userId(req), 
          reason: "duplicate_supplier",
          newFields: req.body ?? {},
        },
      "Supplier update failed" );

      res.status(409).json({ error: error.message });
      return;
    }

    throw error;
  }
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  try {
    const supplier = await deactivateSupplier(String(req.params.id));
    logger.info( { event: "supplier.deactivated", supplierId: supplier._id.toString(), adminId: userId(req) },
      "Supplier deactivated by admin");
    res.json({ supplier });
  } catch (error) {
    if (error instanceof SupplierNotFoundError) {
      logger.warn( { event: "supplier.deactivate_rejected", adminId: userId(req), reason: "supplier_not_found" },
        "Supplier deactivation failed" );

      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    throw error;
  }
}


function isAdmin(req: Request): boolean {
  return req.user?.role === "ADMIN" || req.user?.role === "SUPERADMIN";
}

//this function helps convert unknown req.params into either an array of strings (string[]) or undefined
function toArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? (value as string[]) : [value as string]; //if array of strings return as is, else wrap the singular string in an array.
}