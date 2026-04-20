import * as XLSX from "xlsx";
import { ParsedInventoryItem, InventoryItem } from "../_shared/types";
import { WEBHOOK_CONFIG } from "../_shared/webhook-config";

const MOCK_INVENTORY_KEY = 'moneypex_mock_inventory';

// Mock inventory data simulation probabilities
const SIMULATION_CONFIG = {
  MAKE_ACTIVE_INACTIVE_CHANCE: 0.5, // 50%
  MAKE_INACTIVE_ACTIVE_CHANCE: 0.3, // 30%
  STOCK_UPDATE_CHANCE: 0.8, // 80%
  DROP_ITEM_CHANCE: 0.2, // 20%
  ADD_ITEM_CHANCE: 0.2, // 20%
  MAX_OPERATIONS_PER_TYPE: 5
};

// Sample new products that can be added
const SAMPLE_NEW_PRODUCTS: ParsedInventoryItem[] = [
  { Name: "New Product Alpha", Type: "Electronics", Barcode: "9999111111", SalePrice: 99.99, PurchasePrice: 69.99, Stock: 15, IsActive: true },
  { Name: "New Product Beta", Type: "Clothing", Barcode: "9999222222", SalePrice: 34.50, PurchasePrice: 22.75, Stock: 25, IsActive: false },
  { Name: "New Product Gamma", Type: "Books", Barcode: "9999333333", SalePrice: 19.99, PurchasePrice: 12.50, Stock: 40, IsActive: true },
  { Name: "New Product Delta", Type: "Home & Garden", Barcode: "9999444444", SalePrice: 75.00, PurchasePrice: 50.00, Stock: 8, IsActive: true },
  { Name: "New Product Epsilon", Type: "Sports", Barcode: "9999555555", SalePrice: 129.99, PurchasePrice: 89.99, Stock: 12, IsActive: false },
  { Name: "New Product Zeta", Type: "Beauty", Barcode: "9999666666", SalePrice: 42.25, PurchasePrice: 28.50, Stock: 20, IsActive: true },
  { Name: "New Product Eta", Type: "Toys", Barcode: "9999777777", SalePrice: 16.75, PurchasePrice: 9.25, Stock: 35, IsActive: false },
  { Name: "New Product Theta", Type: "Kitchen", Barcode: "9999888888", SalePrice: 85.50, PurchasePrice: 62.25, Stock: 6, IsActive: true }
];

/**
 * Loads the initial mock inventory from the Excel file
 * Uses the same parsing logic as fetchInventoryFromMoneypex for consistency
 */
async function loadInitialMockInventory(): Promise<ParsedInventoryItem[]> {
  console.log('[MOCK-API] 📂 Loading initial inventory from Excel file...');
  
  try {
    // Load the Excel file from public directory using configured path
    const response = await fetch(WEBHOOK_CONFIG.MOCK_INVENTORY_FILE_PATH);
    if (!response.ok) {
      throw new Error(`Failed to load mock inventory file: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<InventoryItem>(worksheet, { defval: null });

    console.log('[MOCK-API] 📊 Raw data extracted:', jsonData.length, 'items');

    if (!jsonData || jsonData.length === 0) {
      const errorMsg = "No data found in the inventory file.";
      console.error('[MOCK-API] ❌', errorMsg);
      throw new Error(errorMsg);
    }

    // Validate and parse the data using the SAME logic as fetchInventoryFromMoneypex
    console.log('[MOCK-API] 🔍 Validating and parsing inventory data...');
    const parsedData: ParsedInventoryItem[] = jsonData.map((item, index) => {
      if (!item.Name || !item.Type || typeof item.SalePrice !== "string" || typeof item.PurchasePrice !== "string" || typeof item.Stock !== "string" || !item.IsActive) {
        const errorMsg = `Invalid inventory item format at index ${index}: ${JSON.stringify(item)}`;
        console.error('[MOCK-API] ❌', errorMsg);
        throw new Error(errorMsg);
      }

      return {
        Name: item.Name,
        Type: item.Type,
        Barcode: item.Barcode || null,
        SalePrice: parseFloat(item.SalePrice),
        PurchasePrice: parseFloat(item.PurchasePrice),
        Stock: parseInt(item.Stock, 10),
        IsActive: item.IsActive === "Yes",
      };
    });

    console.log('[MOCK-API] ✅ Successfully loaded and parsed', parsedData.length, 'items from Excel file');
    
    // Validate and sanitize the initial data to ensure webhook compatibility
    const sanitizedData = validateAndSanitizeInventory(parsedData);
    console.log('[MOCK-API] 🔍 Validated and sanitized inventory data');
    
    return sanitizedData;
  } catch (error) {
    console.error('[MOCK-API] ❌ Error loading initial inventory:', error);
    throw error;
  }
}

/**
 * Saves the current inventory state to Chrome storage
 */
async function saveInventoryToStorage(inventory: ParsedInventoryItem[]): Promise<void> {
  const storageData = {
    inventory,
    lastUpdated: new Date().toISOString()
  };
  await chrome.storage.local.set({ [MOCK_INVENTORY_KEY]: storageData });
  console.log('[MOCK-API] 💾 Saved', inventory.length, 'items to Chrome storage');
}

/**
 * Loads inventory from Chrome storage
 */
async function loadInventoryFromStorage(): Promise<ParsedInventoryItem[] | null> {
  try {
    const result = await chrome.storage.local.get([MOCK_INVENTORY_KEY]);
    const stored = result[MOCK_INVENTORY_KEY];
    if (!stored) return null;
    
    console.log('[MOCK-API] 📱 Loaded', stored.inventory.length, 'items from Chrome storage');
    return stored.inventory;
  } catch (error) {
    console.error('[MOCK-API] ❌ Error loading from Chrome storage:', error);
    return null;
  }
}

/**
 * Gets a random number of items to operate on (1 to max)
 */
function getRandomCount(max: number): number {
  return Math.floor(Math.random() * max) + 1;
}

/**
 * Randomly selects items from an array
 */
function selectRandomItems<T>(items: T[], count: number): T[] {
  const shuffled = [...items].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, items.length));
}

/**
 * Applies random stock changes to inventory
 */
function applyStockUpdates(inventory: ParsedInventoryItem[]): void {
  if (Math.random() > SIMULATION_CONFIG.STOCK_UPDATE_CHANCE) return;
  
  const count = getRandomCount(SIMULATION_CONFIG.MAX_OPERATIONS_PER_TYPE);
  const selectedItems = selectRandomItems(inventory, count);
  
  selectedItems.forEach(item => {
    // Random stock change between -20 and +30, but ensure stock never goes below 0
    const stockChange = Math.floor(Math.random() * 51) - 20;
    const newStock = Math.max(0, item.Stock + stockChange);
    
    // Only apply the change if it actually changes the stock value
    if (newStock !== item.Stock) {
      console.log(`[MOCK-API] 📦 Stock update: ${item.Name} ${item.Stock} → ${newStock} (${stockChange >= 0 ? '+' : ''}${stockChange})`);
      item.Stock = newStock;
    }
  });
}

/**
 * Makes active products inactive
 */
function makeProductsInactive(inventory: ParsedInventoryItem[]): void {
  if (Math.random() > SIMULATION_CONFIG.MAKE_ACTIVE_INACTIVE_CHANCE) return;
  
  const activeItems = inventory.filter(item => item.IsActive);
  if (activeItems.length === 0) return;
  
  const count = getRandomCount(Math.min(SIMULATION_CONFIG.MAX_OPERATIONS_PER_TYPE, activeItems.length));
  const selectedItems = selectRandomItems(activeItems, count);
  
  selectedItems.forEach(item => {
    console.log(`[MOCK-API] ❌ Deactivating: ${item.Name}`);
    item.IsActive = false;
  });
}

/**
 * Makes inactive products active
 */
function makeProductsActive(inventory: ParsedInventoryItem[]): void {
  if (Math.random() > SIMULATION_CONFIG.MAKE_INACTIVE_ACTIVE_CHANCE) return;
  
  const inactiveItems = inventory.filter(item => !item.IsActive);
  if (inactiveItems.length === 0) return;
  
  const count = getRandomCount(Math.min(SIMULATION_CONFIG.MAX_OPERATIONS_PER_TYPE, inactiveItems.length));
  const selectedItems = selectRandomItems(inactiveItems, count);
  
  selectedItems.forEach(item => {
    console.log(`[MOCK-API] ✅ Activating: ${item.Name}`);
    item.IsActive = true;
  });
}

/**
 * Removes items from inventory (drop operation)
 */
function dropItems(inventory: ParsedInventoryItem[]): ParsedInventoryItem[] {
  if (Math.random() > SIMULATION_CONFIG.DROP_ITEM_CHANCE) return inventory;
  
  const count = getRandomCount(Math.min(SIMULATION_CONFIG.MAX_OPERATIONS_PER_TYPE, inventory.length));
  const selectedItems = selectRandomItems(inventory, count);
  
  selectedItems.forEach(item => {
    console.log(`[MOCK-API] 🗑️ Dropping item: ${item.Name}`);
  });
  
  // Remove selected items from inventory
  return inventory.filter(item => !selectedItems.includes(item));
}

/**
 * Adds new items to inventory
 */
function addItems(inventory: ParsedInventoryItem[]): ParsedInventoryItem[] {
  if (Math.random() > SIMULATION_CONFIG.ADD_ITEM_CHANCE) return inventory;
  
  // Filter out items that are already in inventory (by name to avoid duplicates)
  const existingNames = new Set(inventory.map(item => item.Name));
  const availableNewItems = SAMPLE_NEW_PRODUCTS.filter(item => !existingNames.has(item.Name));
  
  if (availableNewItems.length === 0) {
    console.log(`[MOCK-API] ℹ️ No new items available to add`);
    return inventory;
  }
  
  const count = getRandomCount(Math.min(SIMULATION_CONFIG.MAX_OPERATIONS_PER_TYPE, availableNewItems.length));
  const selectedItems = selectRandomItems(availableNewItems, count);
  
  selectedItems.forEach(item => {
    console.log(`[MOCK-API] ➕ Adding new item: ${item.Name}`);
  });
  
  return [...inventory, ...selectedItems];
}

/**
 * Validates and sanitizes inventory data to ensure all values meet webhook requirements
 */
function validateAndSanitizeInventory(inventory: ParsedInventoryItem[]): ParsedInventoryItem[] {
  return inventory.map(item => ({
    ...item,
    // Ensure stock is always >= 0 (absolute value)
    Stock: Math.max(0, Math.abs(item.Stock)),
    // Ensure prices are positive
    SalePrice: Math.max(0, item.SalePrice),
    PurchasePrice: Math.max(0, item.PurchasePrice)
  }));
}

/**
 * Simulates random changes to inventory data
 */
function simulateInventoryChanges(inventory: ParsedInventoryItem[]): ParsedInventoryItem[] {
  console.log('[MOCK-API] 🎲 Applying random inventory changes...');
  
  // Create a deep copy to avoid mutating the original
  let updatedInventory = JSON.parse(JSON.stringify(inventory)) as ParsedInventoryItem[];
  
  // Apply various types of changes
  applyStockUpdates(updatedInventory);
  makeProductsInactive(updatedInventory);
  makeProductsActive(updatedInventory);
  updatedInventory = dropItems(updatedInventory);
  updatedInventory = addItems(updatedInventory);
  
  console.log(`[MOCK-API] 📊 Changes applied. Item count: ${inventory.length} → ${updatedInventory.length}`);
  return updatedInventory;
}

/**
 * Mock version of fetchInventoryFromMoneypex with simulated changes
 */
export async function fetchMockInventoryFromMoneypex(): Promise<ParsedInventoryItem[]> {
  console.log('[MOCK-API] 🎭 Starting mock inventory fetch...');
  
  // Check if we're in static mode
  if (WEBHOOK_CONFIG.MOCK_API_STATIC_MODE) {
    console.log('[MOCK-API] 🔒 Static mode enabled - always returning fresh Excel data');
    
    // In static mode, always return fresh Excel file data (ignore storage)
    // This ensures CDC can detect differences and sync remote DB to match Excel
    console.log('[MOCK-API] 📂 Loading fresh data from Excel file for static mode');
    const staticInventory = await loadInitialMockInventory();
    
    console.log('[MOCK-API] ✅ Static mock inventory fetch completed with', staticInventory.length, 'items');
    return staticInventory;
  }
  
  // Dynamic mode - apply random changes as before
  console.log('[MOCK-API] 🎲 Dynamic mode enabled - applying random changes');
  
  try {
    // Check if we have inventory in Chrome storage
    let currentInventory = await loadInventoryFromStorage();
    
    if (!currentInventory) {
      // First time - load from Excel file
      console.log('[MOCK-API] 🆕 First time run - loading from Excel file');
      currentInventory = await loadInitialMockInventory();
    } else {
      // Subsequent runs - apply random changes
      console.log('[MOCK-API] 🔄 Subsequent run - applying random changes');
      currentInventory = simulateInventoryChanges(currentInventory);
    }
    
    // Validate and sanitize inventory to ensure webhook compatibility
    currentInventory = validateAndSanitizeInventory(currentInventory);
    
    // Save the updated inventory to Chrome storage for next time
    await saveInventoryToStorage(currentInventory);
    
    console.log('[MOCK-API] ✅ Mock inventory fetch completed with', currentInventory.length, 'items');
    return currentInventory;
    
  } catch (error) {
    console.error('[MOCK-API] ❌ Error in mock inventory fetch:', error);
    throw error;
  }
}

/**
 * Mock version of testMoneypexConnection - always returns success
 */
export async function testMockMoneypexConnection(): Promise<{ success: boolean; error?: string }> {
  console.log('[MOCK-API] 🧪 Testing mock Moneypex connection...');
  
  // Simulate a small delay to make it feel realistic
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('[MOCK-API] ✅ Mock connection test successful');
  return { success: true };
}

/**
 * Mock version of fetchInventoryForAvailabilityCheck
 */
export async function fetchMockInventoryForAvailabilityCheck(): Promise<ParsedInventoryItem[]> {
  console.log('[MOCK-API] 🔍 Mock availability check - returning current inventory without changes...');
  
  // For availability checks, return current state without applying changes
  let currentInventory = await loadInventoryFromStorage();
  
  if (!currentInventory) {
    console.log('[MOCK-API] 📂 No stored inventory, loading from Excel file');
    currentInventory = await loadInitialMockInventory();
    // Validate and sanitize initial data
    currentInventory = validateAndSanitizeInventory(currentInventory);
    await saveInventoryToStorage(currentInventory);
  }
  
  // Always validate data before returning for availability checks
  currentInventory = validateAndSanitizeInventory(currentInventory);
  
  console.log('[MOCK-API] ✅ Mock availability check completed with', currentInventory.length, 'items');
  return currentInventory;
}
