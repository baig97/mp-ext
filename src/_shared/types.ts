export interface InventoryItem {
  Name: string;
  Type: string;
  Barcode: string | null;
  SalePrice: string;       // e.g., "0.00" (you can change to number if parsed)
  PurchasePrice: string;   // e.g., "0.00"
  Stock: string;           // e.g., "0" (can be number if parsed)
  IsActive: "Yes" | "No";  // assuming only Yes/No options
}

export interface ParsedInventoryItem {
  Name: string;
  Type: string;
  Barcode: string | null;
  SalePrice: number;
  PurchasePrice: number;
  Stock: number;
  IsActive: boolean; // parsed from "Yes"/"No"
}