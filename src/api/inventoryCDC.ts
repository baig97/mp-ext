import { ParsedInventoryItem, Item, ItemOperation, OperationType, ItemTransaction } from "../_shared/types";

/**
 * Converts a ParsedInventoryItem to the Item interface format
 */
export function convertToItem(parsedItem: ParsedInventoryItem): Item | null {
  // Skip items without barcodes as they can't be properly tracked
  if (!parsedItem.Barcode) {
    return null;
  }

  // Use barcode as merchant_product_id since it's unavailable from moneypex api
  return {
    merchant_product_id: parsedItem.Barcode,
    barcode: parsedItem.Barcode,
    stock: parsedItem.Stock,
    raw_title: parsedItem.Name,
    price: parsedItem.SalePrice,
    is_active_outlet: parsedItem.IsActive,
  };
}

/**
 * Creates a map of items using barcode as the key
 */
export function createItemMap(parsedItems: ParsedInventoryItem[]): Map<string, Item> {
  const itemMap = new Map<string, Item>();
  
  for (const parsedItem of parsedItems) {
    const item = convertToItem(parsedItem);
    if (item && item.barcode) {
      itemMap.set(item.barcode, item);
    }
  }
  
  return itemMap;
}

/**
 * Stores the item map in Chrome extension local storage
 */
export async function storeItemMap(itemMap: Map<string, Item>): Promise<void> {
  const mapObject = Object.fromEntries(itemMap);
  await chrome.storage.local.set({ last_fetch_map: mapObject });
  console.log('[CDC] 💾 Stored item map with', itemMap.size, 'items');
}

/**
 * Retrieves the last stored item map from Chrome extension local storage
 */
export async function getLastItemMap(): Promise<Map<string, Item> | null> {
  const result = await chrome.storage.local.get(['last_fetch_map']);
  
  if (!result.last_fetch_map) {
    console.log('[CDC] 📭 No previous item map found');
    return null;
  }
  
  const itemMap = new Map<string, Item>();
  for (const [key, value] of Object.entries(result.last_fetch_map)) {
    itemMap.set(key, value as Item);
  }
  
  console.log('[CDC] 📦 Retrieved previous item map with', itemMap.size, 'items');
  return itemMap;
}

/**
 * Compares two items to check if they are different
 */
function areItemsDifferent(item1: Item, item2: Item): boolean {
  return (
    item1.merchant_product_id !== item2.merchant_product_id ||
    item1.barcode !== item2.barcode ||
    item1.stock !== item2.stock ||
    item1.raw_title !== item2.raw_title ||
    item1.price !== item2.price ||
    item1.is_active_outlet !== item2.is_active_outlet
  );
}

/**
 * Creates operations by comparing old and new item maps
 */
export function createOperations(oldMap: Map<string, Item>, newMap: Map<string, Item>): ItemOperation[] {
  const operations: ItemOperation[] = [];
  
  // Check for updates and inserts
  for (const [barcode, newItem] of newMap) {
    const oldItem = oldMap.get(barcode);
    
    if (!oldItem) {
      // Item doesn't exist in old map - INSERT operation
      operations.push({
        operation_type: OperationType.INSERT,
        item: newItem,
      });
    } else if (areItemsDifferent(oldItem, newItem)) {
      // Item exists but is different - UPDATE operation
      operations.push({
        operation_type: OperationType.UPDATE,
        item: newItem,
      });
    }
    // If item exists and is the same, no operation needed
  }
  
  // Check for deletes
  for (const [barcode, oldItem] of oldMap) {
    if (!newMap.has(barcode)) {
      // Item exists in old map but not in new map - DELETE operation
      operations.push({
        operation_type: OperationType.DELETE,
        item: oldItem,
      });
    }
  }
  
  console.log('[CDC] 🔄 Created', operations.length, 'operations');
  console.log('[CDC] 📊 Operations breakdown:', {
    inserts: operations.filter(op => op.operation_type === OperationType.INSERT).length,
    updates: operations.filter(op => op.operation_type === OperationType.UPDATE).length,
    deletes: operations.filter(op => op.operation_type === OperationType.DELETE).length,
  });
  
  return operations;
}

/**
 * Creates a transaction with the given operations and current timestamp
 */
export function createTransaction(operations: ItemOperation[]): ItemTransaction {
  const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const transaction: ItemTransaction = {
    transaction_id: transactionId,
    operations,
  };
  
  console.log('[CDC] 🆔 Created transaction:', transactionId, 'with', operations.length, 'operations');
  return transaction;
}

/**
 * Main CDC processing function that handles the complete CDC workflow
 */
export async function processCDC(parsedItems: ParsedInventoryItem[]): Promise<ItemTransaction | null> {
  console.log('[CDC] 🚀 Starting CDC processing...');
  
  // Create new item map
  const newItemMap = createItemMap(parsedItems);
  console.log('[CDC] 📋 Created new item map with', newItemMap.size, 'items');
  
  // Get previous item map
  const oldItemMap = await getLastItemMap();
  
  // If this is the very first time (no previous map), store the new map and skip CDC
  if (!oldItemMap) {
    console.log('[CDC] 🎯 First time fetch - storing baseline, no operations to create');
    await storeItemMap(newItemMap);
    return null;
  }
  
  // Create operations by comparing maps
  const operations = createOperations(oldItemMap, newItemMap);
  
  // Store the new map for next comparison (regardless of whether changes were found)
  await storeItemMap(newItemMap);
  
  // If no changes, return null
  if (operations.length === 0) {
    console.log('[CDC] ✅ No changes detected - no transaction created');
    return null;
  }
  
  // Create and return transaction
  const transaction = createTransaction(operations);
  return transaction;
}
