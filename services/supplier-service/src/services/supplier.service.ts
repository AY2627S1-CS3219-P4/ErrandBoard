import { QueryFilter } from "mongoose";
import {
    Supplier,
    type SupplierCategory,
    type SupplierDocument,
    type SupplierCoords,
    type OpeningHours,
}   from "../models/Supplier.js"

//Input interfaces which specify what kind of input CRUD functions expect

export interface CreateSupplierInput {
    name: string;
    category: SupplierCategory;
    building: string;
    address: string,
    coordinates?: SupplierCoords;
    openingHours?: OpeningHours;
    imageUrl?: string;
    description?: string;
}


export interface UpdateSupplierInput {
    name?: string;
    category?: SupplierCategory;
    building?: string;
    address?: string;
    coordinates?: SupplierCoords;
    openingHours?: OpeningHours;
    imageUrl?: string;
    description?: string;
}

//The listing should support free-text search on the supplier name. Should be case-insensitive, match on partial substrings
//Users should be able to filter suppliers by category and building (campus location).
//Filtering should support the selection of multiple options. search + category + buildling + multiple options
//The administrative user should be able to view the supplier listing (including soft-deleted records) through the same listing/search endpoint used by requesters and couriers (FR7).
export interface ListSuppliersInput {
    search?: string;
    category?: SupplierCategory[];
    building?: string[];
    address?: string[];
    showInactive?: boolean;
}

//Supplier specific error classes

export class SupplierNotFoundError extends Error {}

export class DuplicateSupplierError extends Error {}


//CRUD functions
export async function createSupplier(
    input: CreateSupplierInput
): Promise<SupplierDocument> {
    try {
        return await Supplier.create(input);
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new DuplicateSupplierError(
                `Supplier "${input.name}" already exists at "${input.building}".`
            );
        }    
        throw error;
    }
}

export async function listSuppliers(input: ListSuppliersInput) {
    const query: QueryFilter<SupplierDocument> = {};

    //if showInactive is true isActive should be set to false;
    if (!input.showInactive) {
        query.isActive = true;
    }

    //$options set to i for case insensitive
    if (input.search) {
        query.name = { $regex: escapeRegExp(input.search), $options: "i" };
    }

    if (input.category?.length) {
        query.category = { $in: input.category };
    }

    if (input.building?.length) {
        query.building = { $in: input.building };
    }

    if (input.address?.length) {
        query.building = { $in: input.address };
    }
    
    //return sorted ascending
    return Supplier.find(query).sort({ name: 1 });
}

export async function getSupplierById(
    id: string
): Promise<SupplierDocument> {
    const supplier = await Supplier.findById(id);

    if (!supplier) throw new SupplierNotFoundError(`Supplier ${id} not found`);
    return supplier;
}

export async function updateSupplier(
    id: string,
    input: UpdateSupplierInput
): Promise<SupplierDocument> {
    try {
        const target = await Supplier.findByIdAndUpdate(
            id,
            {$set: input},
            {new: true, runValidators: true} 
            //new lets function return modified document rather than original
            //validators runs schema validation during update
        );

        if (!target) throw new SupplierNotFoundError(`Supplier ${id} not found`);

        return target;

    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new DuplicateSupplierError(
                "Update would duplicate an existing supplier's name + building",
            );
        }
        throw error;
    }
}


//Instead of deleting outright, set the active attribute of the supplier to false
export async function deactivateSupplier(
    id: string
): Promise<SupplierDocument> {
    const supplier = await Supplier.findByIdAndUpdate(
        id,
        { $set: {isActive: false}},
        {new: true}
    )

    if (!supplier) throw new SupplierNotFoundError(`Supplier ${id} not found`);

    return supplier;
}


//filter function for listing of suppliers

//Error handling functions

//mongoDB duplicate error code is 11000, hence the check
function isDuplicateKeyError(error: unknown): boolean {
    const duplicateErrorCode: number = 11000;
    let res = typeof error === "object" && error !== null 
                                        && "code" in error 
                                        && (error as { code?: number}).code === duplicateErrorCode;
    return res;
}


//replaces special regex characters in a string so it can be safely used
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}