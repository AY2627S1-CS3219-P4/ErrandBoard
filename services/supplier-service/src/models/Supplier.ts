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

export interface TimeSlot {
  open: string;
  close: string;
}

//Each day holds zero or more slots; an empty array means the supplier is closed that day
export interface OpeningHours {
  mon: TimeSlot[];
  tue: TimeSlot[];
  wed: TimeSlot[];
  thu: TimeSlot[];
  fri: TimeSlot[];
  sat: TimeSlot[];
  sun: TimeSlot[];
}

export interface SupplierDocument {
    name: string;
    category: SupplierCategory;
    building: string;
    address: string;
    locationDescription?: string;
    coordinates?: SupplierCoords;
    openingHours: OpeningHours;
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
  { _id: false },
)

const timeSlotSchema = new Schema<TimeSlot>(
  {
    open: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "open must be HH:mm"],
    },
    close: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "close must be HH:mm"],
    },
  },
  { _id: false },
)

const dayField = { type: [timeSlotSchema], default: [] };

const openingHoursSchema = new Schema<OpeningHours>(
  {
    mon: dayField,
    tue: dayField,
    wed: dayField,
    thu: dayField,
    fri: dayField,
    sat: dayField,
    sun: dayField,
  },
  { _id: false },
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
    address: {
      type: String,
      required: true,
      trim: true,
      minlength: 1, 
      maxlength: 100,
    },
    locationDescription: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    coordinates: {
      type: coordinateSchema,
      required: false,
    },
    openingHours: {
      type: openingHoursSchema,
      default: () => ({}),
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