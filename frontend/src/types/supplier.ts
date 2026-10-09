export const SUPPLIER_CATEGORIES = [
    "FOOD_BEVERAGE",
    "RETAIL",
    "CONVENIENCE",
    "PRINTING",
    "OTHER"
] as const

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number]

export interface SupplierCoords {
  latitude: number;
  longitude: number;
}

export interface TimeSlot {
  open: string;
  close: string;
}

export interface OpeningHours {
  mon: TimeSlot[];
  tue: TimeSlot[];
  wed: TimeSlot[];
  thu: TimeSlot[];
  fri: TimeSlot[];
  sat: TimeSlot[];
  sun: TimeSlot[];
}

export interface Supplier {
  _id: string;
  name: string;
  category: SupplierCategory;
  building: string;
  address: string;
  locationDescription?: string;
  coordinates?: SupplierCoords;
  openingHours?: OpeningHours;
  imageUrl?: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierFilters {
  categories: string[];
  buildings: string[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  FOOD_BEVERAGE: "Food/Beverage",
  RETAIL: "Retail",
  CONVENIENCE: "Convenience",
  PRINTING: "Printing",
  OTHER: "Other",
};
