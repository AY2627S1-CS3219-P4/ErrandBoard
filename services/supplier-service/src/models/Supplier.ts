import { model, Schema } from "mongoose";


//What details should a supplier have?

//1. Name
//2. Category
//3. Location (Address)
//4. Opening and closing hours
//5. Image
//6. description
//7. 

export const SUPPLIER_CATEGORIES = [
    "FOOD_BEVERAGE",
    "RETAIL",
    "CONVENIENCE",
    "PRINTING",
    "OTHER"
] as const

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number]

export interface SupplierCoords {
  latitude: number; //support floating point and integer values
  longitude: number;
}

export interface SupplierDocument {
    name: string;
    category: SupplierCategory;
    building: string;
    coordinates?: SupplierCoords;
    openingHour?: string;
    closingHour?: string;
    imageUrl?: string;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const coordinateSchema = new Schema<SupplierCoords>(
  {
    latitude: {type: Number, required: true},
    longitude: {type: Number, required: true},
  },
)

const supplierSchema = new Schema<SupplierDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    category: {
      type: String,
      enum: SUPPLIER_CATEGORIES,
      required: true,
    },
    building: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    coordinates: {
      type: coordinateSchema,
      required: false,
    },
    openingHour: {
      type: String,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "openingTime must be HH:mm"],
    },
    closingHour: {
      type: String,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "closingTime must be HH:mm"],
    },
    imageUrl: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    collection: "suppliers",
    timestamps: true,
  },
);

//Based on issue #2 enforce unique constraint on name and building
supplierSchema.index(
  {name: 1, building: 1},
  {unique: true}
);

export const Supplier = model<SupplierDocument>("Supplier", supplierSchema);