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

// CDC related interfaces
export interface Item {
  merchant_product_id: string;
  barcode: string; // ItemCode
  stock: number; // Onhand
  raw_title: string; // Description
  price: number; // Slprice
  is_active_outlet: boolean; // isactive
}

export enum OperationType {
  INSERT = "INSERT",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
}

export interface BaseOperation {
  operation_type: OperationType;
}

export interface InsertOperation extends BaseOperation {
  operation_type: OperationType.INSERT;
  item: Item;
}

export interface DeleteOperation extends BaseOperation {
  operation_type: OperationType.DELETE;
  item: Item;
}

export interface UpdateOperation extends BaseOperation {
  operation_type: OperationType.UPDATE;
  item: Item;
}

export type ItemOperation = InsertOperation | UpdateOperation | DeleteOperation;

export interface ItemTransaction {
  transaction_id: string;
  operations: ItemOperation[];
}

export interface InventorySyncReqPayload {
  transactions: ItemTransaction[];
  timestamp: string;
  source: string;
}