import * as XLSX from "xlsx";
import { InventoryItem, ParsedInventoryItem, ItemTransaction } from "../_shared/types";
import { processCDC } from "./inventoryCDC";
import { handleNewTransaction } from "./webhookSync";
import { setCdcInProgress, setCdcCompletionTime, waitForCdcCompletion, isCdcInProgress, isInCdcCooldown } from "../_shared/cdc-state";
import { WEBHOOK_CONFIG } from "../_shared/webhook-config";
import { 
  fetchMockInventoryFromMoneypex, 
  testMockMoneypexConnection, 
  fetchMockInventoryForAvailabilityCheck 
} from "./mockInventory";

export interface FetchInventoryResult {
  allItems: ParsedInventoryItem[];
  transaction: ItemTransaction | null;
}

export async function fetchInventoryFromMoneypex(): Promise<ParsedInventoryItem[]> {
  // Check if mock mode is enabled
  if (WEBHOOK_CONFIG.USE_MOCK_API) {
    console.log('[FETCH-WRAPPER] 🎭 Using mock API');
    return await fetchMockInventoryFromMoneypex();
  }
  
  console.log('[MONEYPEX-FETCH] 🚀 Starting inventory fetch from Moneypex...');
  
  const exportUrl = "https://pos.moneypex.com/Product/ExportProducts?SupplierId=&CategoryId=&SearchFilter_Name=&ProductTypeId=";

  const body = new URLSearchParams();
  body.append("SearchFilter.Name", "");
  body.append("SearchFilter.CategoryId", "");
  body.append("SearchFilter.SupplierId", "");
  body.append("SearchFilter.ProductTypeId", "");

  console.log('[MONEYPEX-FETCH] 📡 Making request to:', exportUrl);

  const response = await fetch(exportUrl, {
    method: "GET",
    mode: "cors",
    credentials: "include",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Upgrade-Insecure-Requests": "1"
    },
    referrer: "https://pos.moneypex.com/Product/Index",
    referrerPolicy: "strict-origin-when-cross-origin"
  });

  if (!response.ok) {
    const errorMsg = `Failed to fetch inventory: ${response.status} ${response.statusText}`;
    console.error('[MONEYPEX-FETCH] ❌', errorMsg);
    throw new Error(errorMsg);
  }

  console.log('[MONEYPEX-FETCH] ✅ Successfully received response from Moneypex');

  const blob = await response.blob();
  console.log('[MONEYPEX-FETCH] 📄 Response size:', blob.size, 'bytes');
  
  const arrayBuffer = await blob.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<InventoryItem>(worksheet, { defval: null });

  console.log('[MONEYPEX-FETCH] 📊 Raw data extracted:', jsonData.length, 'items');

  if (!jsonData || jsonData.length === 0) {
    const errorMsg = "No data found in the inventory file.";
    console.error('[MONEYPEX-FETCH] ❌', errorMsg);
    throw new Error(errorMsg);
  }

  // Validate and parse the data
  console.log('[MONEYPEX-FETCH] 🔍 Validating and parsing inventory data...');
  const parsedData: ParsedInventoryItem[] = jsonData.map((item, index) => {
    if (!item.Name || !item.Type || typeof item.SalePrice !== "string" || typeof item.PurchasePrice !== "string" || typeof item.Stock !== "string" || !item.IsActive) {
      const errorMsg = `Invalid inventory item format at index ${index}: ${JSON.stringify(item)}`;
      console.error('[MONEYPEX-FETCH] ❌', errorMsg);
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

  console.log('[MONEYPEX-FETCH] ✅ Successfully parsed', parsedData.length, 'inventory items');
  return parsedData;
}

/**
 * Tests Moneypex connection by making a simple request without triggering CDC
 */
export async function testMoneypexConnection(): Promise<{ success: boolean; error?: string }> {
  // Check if mock mode is enabled
  if (WEBHOOK_CONFIG.USE_MOCK_API) {
    console.log('[TEST-WRAPPER] 🎭 Using mock API');
    return await testMockMoneypexConnection();
  }
  
  console.log('[MONEYPEX-TEST] 🧪 Testing Moneypex connection...');
  
  const exportUrl = "https://pos.moneypex.com/Product/ExportProducts?SupplierId=&CategoryId=&SearchFilter_Name=&ProductTypeId=";

  try {
    const response = await fetch(exportUrl, {
      method: "HEAD", // Use HEAD request to test connection without downloading data
      mode: "cors",
      credentials: "include",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Upgrade-Insecure-Requests": "1"
      },
      referrer: "https://pos.moneypex.com/Product/Index",
      referrerPolicy: "strict-origin-when-cross-origin"
    });

    if (response.ok) {
      console.log('[MONEYPEX-TEST] ✅ Moneypex connection test successful');
      return { success: true };
    } else {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      console.error('[MONEYPEX-TEST] ❌ Moneypex connection test failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: any) {
    const errorMsg = error.message || 'Connection failed';
    console.error('[MONEYPEX-TEST] ❌ Moneypex connection test error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Fetches inventory from Moneypex for availability checking only (no CDC processing)
 * Used for FCM order processing to avoid triggering unnecessary CDC transactions
 */
export async function fetchInventoryForAvailabilityCheck(): Promise<ParsedInventoryItem[]> {
  // Check if mock mode is enabled
  if (WEBHOOK_CONFIG.USE_MOCK_API) {
    console.log('[AVAILABILITY-WRAPPER] 🎭 Using mock API');
    return await fetchMockInventoryForAvailabilityCheck();
  }
  
  console.log('[MONEYPEX-AVAILABILITY] 🔍 Fetching inventory for availability check only...');
  
  // Use the same fetch logic but without CDC processing
  const allItems = await fetchInventoryFromMoneypex();
  
  console.log('[MONEYPEX-AVAILABILITY] ✅ Fetched', allItems.length, 'items for availability check');
  return allItems;
}

/**
 * Fetches inventory from Moneypex and processes CDC to detect changes
 * Returns all items and any detected changes as a transaction
 * Coordinates with global CDC state to prevent concurrent operations
 */
export async function fetchAndAnalyzeInventoryFromMoneypex(): Promise<FetchInventoryResult> {
  // Check if CDC is already in progress
  if (isCdcInProgress()) {
    console.log('[MONEYPEX-FETCH] ⏳ CDC already in progress, waiting for completion...');
    await waitForCdcCompletion();
    
    // After waiting, check if we're now in cooldown
    if (await isInCdcCooldown()) {
      console.log('[MONEYPEX-FETCH] ⏸️ CDC completed recently, returning without new fetch');
      return { allItems: [], transaction: null };
    }
  }

  // Check cooldown before starting new CDC
  if (await isInCdcCooldown()) {
    console.log('[MONEYPEX-FETCH] ⏸️ CDC in cooldown period, skipping fetch');
    return { allItems: [], transaction: null };
  }

  try {
    setCdcInProgress(true);
    console.log('[MONEYPEX-FETCH] 🚀 Starting inventory fetch and CDC processing...');
    
    // Fetch all items from Moneypex
    const allItems = await fetchInventoryFromMoneypex();
    
    // Process CDC to detect changes
    const transaction = await processCDC(allItems);
    
    // Set completion time
    await setCdcCompletionTime();
    
    console.log('[MONEYPEX-FETCH] 📊 Fetch Summary:');
    console.log(`  - Total items fetched: ${allItems.length}`);
    if (transaction) {
      console.log(`  - Changes detected: ${transaction.operations.length} operations`);
      console.log(`  - Transaction ID: ${transaction.transaction_id}`);
      
      // Handle the new transaction for webhook sync and wait for completion
      await handleNewTransaction(transaction);
    } else {
      console.log('  - No changes detected or first-time fetch');
    }
    
    return {
      allItems,
      transaction
    };
  } catch (error) {
    console.error('[MONEYPEX-FETCH] ❌ Error during CDC processing:', error);
    throw error;
  } finally {
    setCdcInProgress(false);
  }
};