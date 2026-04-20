import axios from 'axios';
import { ItemTransaction, InventorySyncReqPayload } from '../_shared/types';
import { supabase } from '../_shared/supabase-config';
import { WEBHOOK_CONFIG } from '../_shared/webhook-config';

// Configuration constants from config file
const { 
  WEBHOOK_URL, 
  TEST_ENDPOINT,
  SYNC_INTERVAL_MINUTES, 
  RETRY_INTERVAL_SECONDS, 
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  SOURCE_IDENTIFIER
} = WEBHOOK_CONFIG;

export interface SyncState {
  pendingTransactions: ItemTransaction[];
  lastSyncAttempt: string | null;
  isRetrying: boolean;
  retryCount: number;
}

/**
 * Stores pending transactions in Chrome extension local storage
 */
export async function storePendingTransactions(transactions: ItemTransaction[]): Promise<void> {
  await chrome.storage.local.set({ pending_transactions: transactions });
  console.log('[WEBHOOK-SYNC] 💾 Stored', transactions.length, 'pending transactions');
}

/**
 * Retrieves pending transactions from Chrome extension local storage
 */
export async function getPendingTransactions(): Promise<ItemTransaction[]> {
  const result = await chrome.storage.local.get(['pending_transactions']);
  const transactions = result.pending_transactions || [];
  console.log('[WEBHOOK-SYNC] 📦 Retrieved', transactions.length, 'pending transactions');
  return transactions;
}

/**
 * Adds a new transaction to the pending list
 */
export async function addPendingTransaction(transaction: ItemTransaction): Promise<void> {
  const currentTransactions = await getPendingTransactions();
  currentTransactions.push(transaction);
  await storePendingTransactions(currentTransactions);
  console.log('[WEBHOOK-SYNC] ➕ Added transaction', transaction.transaction_id, 'to pending list');
}

/**
 * Clears all pending transactions after successful sync
 */
export async function clearPendingTransactions(): Promise<void> {
  await chrome.storage.local.set({ pending_transactions: [] });
  console.log('[WEBHOOK-SYNC] 🧹 Cleared all pending transactions');
}

/**
 * Gets current sync state from storage
 */
export async function getSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(['sync_state']);
  return result.sync_state || {
    pendingTransactions: [],
    lastSyncAttempt: null,
    isRetrying: false,
    retryCount: 0
  };
}

/**
 * Updates sync state in storage
 */
export async function updateSyncState(state: Partial<SyncState>): Promise<void> {
  const currentState = await getSyncState();
  const updatedState = { ...currentState, ...state };
  await chrome.storage.local.set({ sync_state: updatedState });
}

/**
 * Gets a valid authentication token, refreshing if necessary
 */
export async function getValidAuthToken(): Promise<string | null> {
  try {
    // Get current session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('[WEBHOOK-SYNC] ❌ Error getting session:', sessionError);
      return null;
    }

    if (!session) {
      console.log('[WEBHOOK-SYNC] ❌ No active session found');
      return null;
    }

    // Check if token needs refresh (if expires in less than 5 minutes)
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0; // Convert to milliseconds
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    
    if (expiresAt < fiveMinutesFromNow) {
      console.log('[WEBHOOK-SYNC] 🔄 Token expires soon, refreshing...');
      
      const { data: { session: newSession }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError || !newSession) {
        console.error('[WEBHOOK-SYNC] ❌ Error refreshing session:', refreshError);
        return null;
      }
      
      console.log('[WEBHOOK-SYNC] ✅ Token refreshed successfully');
      return newSession.access_token;
    }

    return session.access_token;
  } catch (error) {
    console.error('[WEBHOOK-SYNC] ❌ Error getting auth token:', error);
    return null;
  }
}

/**
 * Creates the payload for webhook request
 */
export function createWebhookPayload(transactions: ItemTransaction[]): InventorySyncReqPayload {
  return {
    transactions,
    timestamp: new Date().toISOString(), // PostgreSQL compatible ISO timestamp
    source: SOURCE_IDENTIFIER
  };
}

/**
 * Makes the webhook request with authentication
 */
export async function makeWebhookRequest(payload: InventorySyncReqPayload): Promise<boolean> {
  try {
    const authToken = await getValidAuthToken();
    
    if (!authToken) {
      console.error('[WEBHOOK-SYNC] ❌ No valid auth token available');
      return false;
    }

    console.log('[WEBHOOK-SYNC] 📡 Making webhook request with', payload.transactions.length, 'transactions');
    
    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS
    });

    if (response.status >= 200 && response.status < 300) {
      console.log('[WEBHOOK-SYNC] ✅ Webhook request successful:', response.status, response.statusText);
      return true;
    } else {
      console.error('[WEBHOOK-SYNC] ❌ Webhook request failed:', response.status, response.statusText);
      return false;
    }
  } catch (error: any) {
    console.error('[WEBHOOK-SYNC] ❌ Webhook request error:', error.message);
    return false;
  }
}

/**
 * Attempts to sync pending transactions with retries
 */
export async function syncPendingTransactions(): Promise<boolean> {
  const pendingTransactions = await getPendingTransactions();
  
  if (pendingTransactions.length === 0) {
    console.log('[WEBHOOK-SYNC] ✅ No pending transactions to sync');
    return true;
  }

  console.log('[WEBHOOK-SYNC] 🚀 Starting sync of', pendingTransactions.length, 'pending transactions');
  
  const payload = createWebhookPayload(pendingTransactions);
  const success = await makeWebhookRequest(payload);
  
  if (success) {
    await clearPendingTransactions();
    await updateSyncState({
      lastSyncAttempt: new Date().toISOString(),
      isRetrying: false,
      retryCount: 0
    });
    console.log('[WEBHOOK-SYNC] 🎉 Successfully synced all pending transactions');
    return true;
  } else {
    await updateSyncState({
      lastSyncAttempt: new Date().toISOString(),
      isRetrying: true
    });
    console.log('[WEBHOOK-SYNC] ⚠️ Sync failed, will retry...');
    return false;
  }
}

/**
 * Starts the retry mechanism for failed sync attempts
 */
export async function startRetryMechanism(): Promise<void> {
  const syncState = await getSyncState();
  
  if (!syncState.isRetrying) {
    return;
  }

  console.log('[WEBHOOK-SYNC] 🔄 Starting retry mechanism...');
  
  const retryInterval = setInterval(async () => {
    const currentState = await getSyncState();
    
    if (!currentState.isRetrying || currentState.retryCount >= MAX_RETRIES) {
      clearInterval(retryInterval);
      
      if (currentState.retryCount >= MAX_RETRIES) {
        console.error('[WEBHOOK-SYNC] ❌ Max retries reached, stopping retry attempts');
        await updateSyncState({
          isRetrying: false,
          retryCount: 0
        });
      }
      return;
    }

    console.log('[WEBHOOK-SYNC] ⏰ Retry attempt', currentState.retryCount + 1, 'of', MAX_RETRIES);
    
    const success = await syncPendingTransactions();
    
    if (!success) {
      await updateSyncState({
        retryCount: currentState.retryCount + 1
      });
    } else {
      clearInterval(retryInterval);
    }
  }, RETRY_INTERVAL_SECONDS * 1000);
}

/**
 * Handles new transaction from CDC and triggers sync
 * Ensures webhook sync completion before returning
 */
export async function handleNewTransaction(transaction: ItemTransaction): Promise<void> {
  console.log('[WEBHOOK-SYNC] 📨 Handling new transaction:', transaction.transaction_id);
  
  // Add to pending transactions
  await addPendingTransaction(transaction);
  
  // Attempt immediate sync
  const success = await syncPendingTransactions();
  
  if (success) {
    console.log('[WEBHOOK-SYNC] ✅ Immediate sync successful');
    return;
  }

  console.log('[WEBHOOK-SYNC] ⚠️ Immediate sync failed, starting retry mechanism...');
  
  // Start retry mechanism
  await startRetryMechanism();
  
  // Wait for sync to complete by polling
  console.log('[WEBHOOK-SYNC] ⏳ Waiting for retry mechanism to complete...');
  
  let retryCount = 0;
  const maxWaitRetries = MAX_RETRIES + 2; // Allow a bit more time
  
  while (retryCount < maxWaitRetries) {
    await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_SECONDS * 1000));
    
    const pendingTransactions = await getPendingTransactions();
    const syncState = await getSyncState();
    
    // Check if sync completed successfully (no pending transactions)
    if (pendingTransactions.length === 0) {
      console.log('[WEBHOOK-SYNC] ✅ Retry mechanism completed successfully');
      return;
    }
    
    // Check if retry mechanism stopped due to max retries
    if (!syncState.isRetrying && syncState.retryCount >= MAX_RETRIES) {
      console.error('[WEBHOOK-SYNC] ❌ Retry mechanism failed after max attempts');
      throw new Error(`Webhook sync failed after ${MAX_RETRIES} retries`);
    }
    
    retryCount++;
    console.log('[WEBHOOK-SYNC] ⏰ Still waiting for sync completion...', retryCount);
  }
  
  console.error('[WEBHOOK-SYNC] ❌ Timeout waiting for webhook sync completion');
  throw new Error('Timeout waiting for webhook sync completion');
}

/**
 * Tests the Lootmart webhook connection status
 */
export async function testLootmartConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const authToken = await getValidAuthToken();
    
    if (!authToken) {
      return { success: false, error: 'No valid auth token available' };
    }

    console.log('[WEBHOOK-SYNC] 🧪 Testing Lootmart connection...');
    
    const response = await axios.get(TEST_ENDPOINT, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS
    });

    if (response.status >= 200 && response.status < 300) {
      console.log('[WEBHOOK-SYNC] ✅ Lootmart connection test successful');
      return { success: true };
    } else {
      console.error('[WEBHOOK-SYNC] ❌ Lootmart connection test failed:', response.status, response.statusText);
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
  } catch (error: any) {
    console.error('[WEBHOOK-SYNC] ❌ Lootmart connection test error:', error.message);
    return { success: false, error: error.message };
  }
}
