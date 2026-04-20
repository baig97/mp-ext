/**
 * Global CDC state management
 * Coordinates CDC operations across different parts of the application
 */

// Global CDC state
let cdcInProgress = false;
let lastCdcCompletionTime: number | null = null;
const CDC_COOLDOWN_MS = 5000; // 5 seconds

/**
 * Sets the CDC completion timestamp and stores it in localStorage
 */
export const setCdcCompletionTime = async (): Promise<void> => {
  const timestamp = Date.now();
  lastCdcCompletionTime = timestamp;
  await chrome.storage.local.set({ lastCdcCompletionTime: timestamp });
  console.log('[CDC-STATE] 💾 CDC completion time set', { timestamp });
};

/**
 * Gets the last CDC completion time from memory or localStorage
 */
export const getCdcCompletionTime = async (): Promise<number | null> => {
  if (lastCdcCompletionTime !== null) {
    return lastCdcCompletionTime;
  }
  
  const result = await chrome.storage.local.get(['lastCdcCompletionTime']);
  lastCdcCompletionTime = result.lastCdcCompletionTime || null;
  return lastCdcCompletionTime;
};

/**
 * Checks if we're within the CDC cooldown period
 */
export const isInCdcCooldown = async (): Promise<boolean> => {
  const lastCompletion = await getCdcCompletionTime();
  if (!lastCompletion) return false;
  
  const timeSinceCompletion = Date.now() - lastCompletion;
  return timeSinceCompletion < CDC_COOLDOWN_MS;
};

/**
 * Sets the CDC in-progress flag
 */
export const setCdcInProgress = (inProgress: boolean): void => {
  cdcInProgress = inProgress;
  console.log('[CDC-STATE] 🔄 CDC in progress state changed', { inProgress });
};

/**
 * Checks if CDC is currently in progress
 */
export const isCdcInProgress = (): boolean => {
  return cdcInProgress;
};

/**
 * Waits for any currently running CDC operation to complete
 */
export const waitForCdcCompletion = async (): Promise<void> => {
  if (!cdcInProgress) return;
  
  console.log('[CDC-STATE] ⏳ Waiting for CDC to complete...');
  
  while (cdcInProgress) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('[CDC-STATE] ✅ CDC completion wait finished');
};

/**
 * Gets the CDC cooldown period in milliseconds
 */
export const getCdcCooldownMs = (): number => {
  return CDC_COOLDOWN_MS;
};
