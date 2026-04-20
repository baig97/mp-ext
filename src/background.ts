import { testMoneypexConnection, fetchInventoryForAvailabilityCheck, fetchAndAnalyzeInventoryFromMoneypex } from './api/fetchInventory';
import { testLootmartConnection, syncPendingTransactions, startRetryMechanism } from './api/webhookSync';
import { app } from "./_shared/firebase-config";
import { createSharedSupabaseClient } from './_shared/supabase-shared';
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";
import { getToken } from "firebase/messaging";
import { waitForCdcCompletion, isCdcInProgress, isInCdcCooldown } from './_shared/cdc-state';
import { WEBHOOK_CONFIG } from './_shared/webhook-config';

// Get sync interval from config
const { SYNC_INTERVAL_MINUTES } = WEBHOOK_CONFIG;

// Declare service worker global scope
declare const self: ServiceWorkerGlobalScope;

// Initialize messaging for service worker context
const messaging = getMessaging(app);

// Create shared supabase client
const supabaseBackground = createSharedSupabaseClient();

// Global stock threshold for warnings
const LOW_STOCK_THRESHOLD = 5;

// Store current merchant data for background operations
let currentMerchantData: { id: string; email: string; store_id: number } | null = null;

// Flag to track if background services are already initialized
let backgroundServicesInitialized = false;

// Simple console logging for debugging
const log = (message: string, data?: any) => {
  console.log(`[SW] ${new Date().toISOString()}: ${message}`, data || '');
};

// Periodic inventory CDC using Chrome alarms
const startPeriodicInventoryCdc = async (): Promise<void> => {
  const alarmName = 'periodicInventoryCdc';
  
  // Clear any existing alarm
  await chrome.alarms.clear(alarmName);
  
  // Create new alarm for periodic CDC
  await chrome.alarms.create(alarmName, {
    delayInMinutes: SYNC_INTERVAL_MINUTES,
    periodInMinutes: SYNC_INTERVAL_MINUTES
  });
  
  log(`Periodic inventory CDC scheduled every ${SYNC_INTERVAL_MINUTES} minutes`);
};

// Heartbeat mechanism using Chrome alarms
const startHeartbeat = async (): Promise<void> => {
  const alarmName = 'heartbeat';
  
  // Clear any existing heartbeat alarm
  await chrome.alarms.clear(alarmName);
  
  // Create new alarm for heartbeat every 1 minute
  await chrome.alarms.create(alarmName, {
    delayInMinutes: 1,
    periodInMinutes: 1
  });
  
  log('Heartbeat scheduled every 1 minute');
};

// Handle heartbeat alarm
const handleHeartbeat = async (): Promise<void> => {
  try {
    // Check for valid session (auto-refresh handles token management)
    const { data: { session }, error: sessionError } = await supabaseBackground.auth.getSession();
    
    if (sessionError || !session?.user) {
      log('Heartbeat skipped - no valid session');
      return;
    }

    // Only send heartbeat if we have merchant data with store_id
    if (!currentMerchantData?.store_id) {
      log('Skipping heartbeat - no store ID available');
      return;
    }

    log('Sending heartbeat', { storeId: currentMerchantData.store_id });

    const { data, error } = await supabaseBackground.rpc(
      'update_pos_client_last_alive_timestamp', 
      { p_store_id: currentMerchantData.store_id }
    );

    if (error) {
      log('Heartbeat error', { storeId: currentMerchantData.store_id, error });
    } else {
      log('Heartbeat sent successfully', { storeId: currentMerchantData.store_id, data });
    }
  } catch (error) {
    log('Error during heartbeat', error);
  }
};

// Handle periodic inventory CDC alarm
const handlePeriodicInventoryCdc = async (): Promise<void> => {
  log('Periodic inventory CDC triggered');
  
  try {
    // Trigger inventory fetch and CDC - this will automatically handle transactions via handleNewTransaction
    await fetchAndAnalyzeInventoryFromMoneypex();
    log('Periodic inventory CDC completed successfully');
  } catch (error) {
    log('Error during periodic inventory CDC', error);
    // Note: No need to retry webhook sync here since:
    // 1. If CDC succeeded, webhook sync already happened in handleNewTransaction()
    // 2. If CDC failed, there are no new transactions to sync
    // 3. Any existing pending transactions are already being handled by retry mechanisms
  }
};

// Perform CDC fetch using shared state management
const performCdcFetch = async (): Promise<void> => {
  if (isCdcInProgress()) {
    log('CDC already in progress, waiting for completion');
    await waitForCdcCompletion();
    return;
  }

  if (await isInCdcCooldown()) {
    log('CDC in cooldown period, skipping fetch');
    return;
  }

  try {
    log('Starting CDC inventory fetch');
    await fetchAndAnalyzeInventoryFromMoneypex();
    log('CDC inventory fetch completed successfully');
  } catch (error) {
    log('Error during CDC fetch', error);
    throw error;
  }
};

// Process order confirmation using new flow
const processOrderConfirmation = async (orderId: string | number, ignoreWarning: boolean = false) => {
  try {
    log('Processing order confirmation', { orderId, ignoreWarning });

    // Get current session from shared supabase client
    const { data: { session }, error: sessionError } = await supabaseBackground.auth.getSession();
    
    if (sessionError) {
      log('Error getting session', { orderId, sessionError });
      return;
    }
    
    if (!session) {
      log('No authenticated session for order processing', { orderId });
      return;
    }

    log('Session found successfully', { 
      orderId, 
      userId: session.user.id,
      email: session.user.email
    });

    // Step 1: Perform CDC fetch (wait for completion if in progress, skip if in cooldown)
    try {
      await performCdcFetch();
      log('CDC fetch and webhook sync completed before order processing', { orderId });
    } catch (cdcError) {
      log('Error during CDC fetch or webhook sync', { orderId, error: cdcError });
      
      // Check if this is a webhook sync failure
      if (cdcError instanceof Error && cdcError.message.includes('Webhook sync failed')) {
        log('Webhook sync failed - order confirmation may fail due to stale inventory data', { orderId });
        // Continue anyway as the order confirmation RPC might still work
      } else if (cdcError instanceof Error && cdcError.message.includes('Timeout waiting for webhook sync')) {
        log('Webhook sync timeout - order confirmation may fail due to stale inventory data', { orderId });
        // Continue anyway as the order confirmation RPC might still work  
      } else {
        log('CDC fetch failed but continuing with order processing', { orderId, error: cdcError });
      }
    }

    // Step 2: Use confirm_order RPC function
    log('Calling confirm_order RPC', { orderId, ignoreWarning });
    
    const { data, error } = await supabaseBackground.rpc('confirm_order', {
      p_order_id: orderId,
      p_ignore_warning: ignoreWarning
    });

    if (error) {
      log('Error calling confirm_order RPC', { orderId, error });
      return;
    }

    // Log the relevant response fields
    log('Order confirmation completed', { 
      orderId,
      finalStatus: data?.final_status,
      verificationStatus: data?.verification_status,
      message: data?.message
    });

    console.log('Final Status:', data?.final_status);
    console.log('Verification Status:', data?.verification_status);

  } catch (error) {
    log('Error processing order confirmation', { 
      orderId, 
      error: error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Update merchant data for authentication
// Generate and update FCM token for authenticated merchant
const updateFcmToken = async (userId: string): Promise<void> => {
  try {
    log('Generating FCM token for user (ensuring fresh token for potential re-install)', { userId });
    
    const token = await getToken(messaging, {
      vapidKey: "BH7yiwqpmEfGKeSCk6Vm-ju2v-G8Uv2nxpaBFoN5I6f7_cOh5JTfqBoBeSo4SpypFJMzoBt7K8V6tpbYqCocFZU",
      serviceWorkerRegistration: self.registration
    });

    log('FCM token generated successfully', { userId, token: token.substring(0, 20) + '...' });

    // Update the merchants table with the FCM token
    const { error: updateError } = await supabaseBackground
      .from('merchants')
      .update({ 
        fcm_token: token
      })
      .eq('id', userId);

    if (updateError) {
      log('Error updating FCM token in merchants table', { userId, error: updateError });
      throw updateError;
    }

    log('FCM token updated in merchants table successfully', { userId });

  } catch (error) {
    log('Error generating or updating FCM token', { userId, error });
    // Don't throw the error to prevent breaking the auth flow
  }
};

const updateMerchantData = async () => {
  try {
    const { data: { session }, error: sessionError } = await supabaseBackground.auth.getSession();
    
    if (sessionError || !session?.user) {
      currentMerchantData = null;
      log('No session - cleared merchant data');
      return;
    }

    // Fetch merchant data including current FCM token
    const { data: merchant, error: merchantError } = await supabaseBackground
      .from('merchants')
      .select('id, email, store_id, email_confirmed, fcm_token')
      .eq('id', session.user.id)
      .single();

    if (merchantError || !merchant) {
      currentMerchantData = null;
      log('No merchant data found');
      return;
    }

    if (!merchant.email_confirmed || !merchant.store_id) {
      currentMerchantData = null;
      log('Email not confirmed or no store ID');
      return;
    }

    // Update merchant data
    currentMerchantData = {
      id: merchant.id,
      email: merchant.email,
      store_id: merchant.store_id
    };

    log('Updated merchant data', { 
      ...currentMerchantData, 
      hasFcmToken: !!merchant.fcm_token,
      fcmTokenPrefix: merchant.fcm_token ? merchant.fcm_token.substring(0, 20) + '...' : 'none'
    });

    // Note: FCM token is now updated separately on every sign-in event

  } catch (error) {
    log('Error updating merchant data', error);
    currentMerchantData = null;
  }
};

// Initialize authentication sync between popup and background worker
const initializeAuth = async () => {
  try {
    // Add a small delay to ensure storage is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Set up auth state change listener for background worker
    supabaseBackground.auth.onAuthStateChange(async (event, session) => {
      log('Background auth state changed', { event, userId: session?.user?.id });
      
      if (event === 'SIGNED_IN' && session?.user) {
        log('User signed in - updating merchant data and FCM token', { userId: session.user.id });
        
        // Always update FCM token on every sign-in to handle extension re-installs
        await updateFcmToken(session.user.id);
        
        // Update merchant data after FCM token update
        await updateMerchantData();
        
        // Only start background services if not already initialized
        if (!backgroundServicesInitialized) {
          await startPeriodicInventoryCdc();
          await startHeartbeat();
          backgroundServicesInitialized = true;
          log('Background services initialized after sign in');
        }
      } else if (event === 'SIGNED_OUT') {
        log('User signed out - clearing merchant data');
        currentMerchantData = null;
        backgroundServicesInitialized = false;
      }
    });
    
    // Try to get session from shared supabase client
    const { data: { session }, error } = await supabaseBackground.auth.getSession();
    
    if (error) {
      log('Error getting session from shared client', error);
      return;
    }
    
    if (session && session.user) {
      log('Authenticated session restored', { 
        userId: session.user.id,
        email: session.user.email,
        expiresAt: session.expires_at
      });
      
      // Always update FCM token on session restoration (handles extension re-installs)
      await updateFcmToken(session.user.id);
      
      // Update merchant data and start sync interval
      await updateMerchantData();
      
      // Only start background services if not already initialized
      if (!backgroundServicesInitialized) {
        // Start periodic inventory CDC
        await startPeriodicInventoryCdc();
        
        // Start heartbeat
        await startHeartbeat();
        
        backgroundServicesInitialized = true;
        log('Background services initialized');
      } else {
        log('Background services already initialized, skipping');
      }
    } else {
      log('No authenticated session found');
      // Clear merchant data if no session
      currentMerchantData = null;
      // Reset background services flag so they can be reinitialized on next login
      backgroundServicesInitialized = false;
    }
  } catch (error) {
    log('Error initializing auth', error);
  }
};

// Log service worker start
log('Service Worker Started');

// Initialize authentication
initializeAuth();

// Chrome alarms listener for periodic inventory CDC and heartbeat
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodicInventoryCdc') {
    handlePeriodicInventoryCdc();
  } else if (alarm.name === 'heartbeat') {
    handleHeartbeat();
  }
});

// Service Worker Startup/Installation
chrome.runtime.onStartup.addListener(() => {
  // Clear token validation flag on startup
  chrome.storage.local.remove(['tokenValidatedForSession']);
  // Re-initialize auth on startup
  initializeAuth();
});

chrome.runtime.onInstalled.addListener((details) => {
  log('Extension installed/updated', details.reason);
  
  // Clear token validation flag on install/update
  chrome.storage.local.remove(['tokenValidatedForSession']);
  
  // On first install, clear pending transactions to start with a clean slate
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    log('First time install detected - clearing pending transactions');
    chrome.storage.local.remove(['pending_transactions']);
  }
  
  // Re-initialize auth on install/update
  initializeAuth();
});

// Service Worker Suspend Detection (stop event)
chrome.runtime.onSuspend.addListener(() => {
  log('Service Worker suspended');
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getFCMToken') {
    getToken(messaging, {
      vapidKey: "BH7yiwqpmEfGKeSCk6Vm-ju2v-G8Uv2nxpaBFoN5I6f7_cOh5JTfqBoBeSo4SpypFJMzoBt7K8V6tpbYqCocFZU",
      serviceWorkerRegistration: self.registration
    })
      .then((token: string) => {
        sendResponse({ success: true, token });
      })
      .catch((error: any) => {
        log('FCM token generation failed', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
  
  // Test Moneypex connection
  if (request.action === 'testMoneypexConnection') {
    testMoneypexConnection().then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Test Lootmart webhook connection
  if (request.action === 'testLootmartConnection') {
    testLootmartConnection().then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Handle auth sync from popup
  if (request.action === 'syncAuth') {
    initializeAuth().then(async () => {
      sendResponse({ success: true, message: 'Auth synced' });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Trigger manual inventory sync
  // Refresh merchant data and restart sync interval
  if (request.action === 'refreshMerchantData') {
    (async () => {
      try {
        const { data: { session }, error } = await supabaseBackground.auth.getSession();
        
        if (error || !session?.user) {
          sendResponse({ success: false, error: 'No authenticated session' });
          return;
        }

        // Update FCM token first, then merchant data
        await updateFcmToken(session.user.id);
        await updateMerchantData();
        
        sendResponse({ success: true, message: 'Merchant data and FCM token refreshed' });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Update FCM token for current user
  if (request.action === 'updateFCMToken') {
    (async () => {
      try {
        const { data: { session }, error } = await supabaseBackground.auth.getSession();
        
        if (error || !session?.user) {
          sendResponse({ success: false, error: 'No authenticated session' });
          return;
        }

        await updateFcmToken(session.user.id);
        sendResponse({ success: true, message: 'FCM token updated' });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Get current status (simplified version for compatibility)
  if (request.action === 'getStatus') {
    sendResponse({
      success: true,
      merchantData: currentMerchantData
    });
    return true;
  }

  // Get current auth session
  if (request.action === 'getSession') {
    (async () => {
      try {
        const { data: { session }, error } = await supabaseBackground.auth.getSession();
        
        if (error) {
          sendResponse({ success: false, error: error.message });
        } else {
          sendResponse({ 
            success: true, 
            session: session ? {
              user: session.user,
              expires_at: session.expires_at
            } : null 
          });
        }
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

// Push notification handler
onBackgroundMessage(messaging, async (payload) => {
  log('Push notification received', {
    title: payload.notification?.title,
    body: payload.notification?.body,
    data: payload.data
  });
  
  try {
    const notificationTitle = payload.notification?.title || 'LootMart Notification';
    const notificationBody = payload.notification?.body || 'You have a new notification';
    const notificationOptions = {
      body: notificationBody,
      tag: 'lootmart-notification',
      requireInteraction: true,
      data: payload.data || {}
    };

    await self.registration.showNotification(notificationTitle, notificationOptions);
    
    // Check for order-related notifications
    const isOrderNotification = 
      notificationTitle.toLowerCase().includes('order confirmed') ||
      notificationTitle.toLowerCase().includes('order needs confirmation') ||
      notificationTitle.toLowerCase().includes('order pending confirmation') ||
      notificationTitle.toLowerCase().includes('pending confirmation') ||
      notificationTitle.toLowerCase().includes('order ready') ||
      (payload.data && payload.data.type === 'order_confirmation') ||
      (payload.data && payload.data.orderId);
    
    if (isOrderNotification) {
      log('Detected order notification, attempting to process', {
        title: notificationTitle,
        body: notificationBody,
        data: payload.data
      });
      
      let orderId = null;
      let ignoreWarning = false;
      
      // Try to parse notification body as JSON first (your specification)
      if (notificationBody) {
        try {
          const orderData = JSON.parse(notificationBody);
          log('Successfully parsed notification body as JSON', orderData);
          
          orderId = orderData.orderId;
          ignoreWarning = orderData.ignoreWarning === true;
          
          log('Extracted order data from JSON body', { orderId, ignoreWarning });
        } catch (parseError) {
          log('Could not parse notification body as JSON, trying other methods', { 
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
            body: notificationBody 
          });
          
          // Fallback: Try to get order ID from payload data
          if (payload.data && payload.data.orderId) {
            orderId = payload.data.orderId;
            log('Found order ID in payload data', { orderId });
          } else if (payload.data && payload.data.order_id) {
            orderId = payload.data.order_id;
            log('Found order_id in payload data', { orderId });
          } else {
            // Try regex to extract order ID from text - handle both "order 123" and "[123]" formats
            let orderIdMatch = notificationBody.match(/order[^\d]*(\d+)/i);
            if (!orderIdMatch) {
              // Try to extract from [number] format in title if not found in body
              orderIdMatch = notificationTitle.match(/\[(\d+)\]/);
            }
            if (orderIdMatch) {
              orderId = orderIdMatch[1];
              log('Extracted order ID from text', { orderId, text: notificationBody || notificationTitle });
            }
          }
          
          // Extract ignoreWarning from payload data as fallback
          if (payload.data && payload.data.ignoreWarning !== undefined) {
            const ignoreWarningValue = payload.data.ignoreWarning;
            if (typeof ignoreWarningValue === 'boolean') {
              ignoreWarning = ignoreWarningValue;
            } else if (typeof ignoreWarningValue === 'string') {
              ignoreWarning = ignoreWarningValue === 'true';
            }
          }
        }
      }
      
      // Additional fallback: try to extract order ID from title if still not found
      if (!orderId && notificationTitle) {
        const titleOrderIdMatch = notificationTitle.match(/\[(\d+)\]/);
        if (titleOrderIdMatch) {
          orderId = titleOrderIdMatch[1];
          log('Extracted order ID from notification title', { orderId, title: notificationTitle });
        }
      }
      
      if (orderId) {
        log('Processing order confirmation via RPC', { orderId, ignoreWarning });
        await processOrderConfirmation(orderId, ignoreWarning);
      } else {
        log('No order ID found in notification', {
          title: notificationTitle,
          body: notificationBody,
          data: payload.data
        });
      }
    } else {
      log('Non-order notification - no processing needed', {
        title: notificationTitle
      });
    }
    
  } catch (error) {
    log('Error handling push notification', error);
  }
});

// Handle notification clicks - no logging for clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    chrome.windows.getCurrent().then(() => {
      chrome.action.openPopup?.();
    }).catch(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    })
  );
});