import {
    Supplier,
    type SupplierCategory,
    type SupplierDocument,
    type SupplierCoords,
}   from "../models/Supplier.js"


//Temporary schema comment so I don't need to split screen
/*
export interface SupplierDocument {
    name: string;
    category: SupplierCategory;
    building: string;
    coordinates: SupplierCoords;
    openingHour?: string;
    closingHour?: string;
    imageUrl?: string;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}
*/

//Input interfaces which specify what kind of input CRUD functions expect

export interface CreateSupplierInput {
    name: string;
    category: SupplierCategory;
    building: string;
    coordinates?: SupplierCoords;
    openingHour?: string;
    closingHour?: string;
    imageUrl?: string;
    description?: string;
}


export interface UpdateSupplierInput {
    name?: string;
    category?: SupplierCategory;
    building?: string;
    coordinates?: SupplierCoords;
    openingHour?: string;
    closingHour?: string;
    imageUrl?: string;
    description?: string;
}

export interface ListSuppliersInput {

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
        throw error;
    }
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


//Error handling functions

//mongoDB duplicate error code is 11000, hence the check
function isDuplicateKeyError(error: unknown): boolean {
    const duplicateErrorCode: number = 11000;
    let res = typeof error === "object" && error !== null 
                                        && "code" in error 
                                        && (error as { code?: number}).code === duplicateErrorCode;
    return res;
}