export interface Supplier {
  _id: string;
  name: string;
  category: string;
  building: string;
  imageUrl?: string;
  description?: string;
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
