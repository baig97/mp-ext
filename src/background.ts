import { fetchInventoryFromMoneypex } from './api/fetchInventory';
import { app } from "./_shared/firebase-config";
import { createSharedSupabaseClient } from './_shared/supabase-shared';
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";
import { getToken } from "firebase/messaging";

// Declare service worker global scope
declare const self: ServiceWorkerGlobalScope;

// Initialize messaging for service worker context
const messaging = getMessaging(app);

// Create shared supabase client (same config as popup)
const supabaseBackground = createSharedSupabaseClient();

// Essential logging for critical events only
const logEvent = (type: 'START' | 'STOP' | 'PUSH', message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[SW-${type}] ${timestamp}: ${message}`, data || '');
  
  // Store in chrome.storage for popup access
  chrome.storage.local.get(['swLogs'], (result) => {
    const logs = result.swLogs || [];
    logs.push({ type, timestamp, message, data });
    
    // Keep only last 20 logs
    if (logs.length > 20) {
      logs.splice(0, logs.length - 20);
    }
    
    chrome.storage.local.set({ swLogs: logs });
  });
};

// Process order confirmation and update inventory
const processOrderConfirmation = async (orderId: string | number) => {
  try {
    logEvent('PUSH', '🔄 Processing order confirmation', { orderId });

    // Get current session from shared supabase client
    const { data: { session }, error: sessionError } = await supabaseBackground.auth.getSession();
    
    if (sessionError) {
      logEvent('PUSH', '❌ Error getting session', { orderId, sessionError });
      return;
    }
    
    if (!session) {
      logEvent('PUSH', '❌ No authenticated session for order processing', { orderId });
      return;
    }

    logEvent('PUSH', '✅ Session found successfully', { 
      orderId, 
      userId: session.user.id,
      email: session.user.email
    });

    // Get order items for the confirmed order
    const { data: orderItems, error } = await supabaseBackground
      .from('order_items')
      .select(`
        store_product_id,
        qty
      `)
      .eq('order_id', orderId);

    if (error) {
      logEvent('PUSH', '❌ Error fetching order items', { orderId, error });
      return;
    }

    if (!orderItems || orderItems.length === 0) {
      logEvent('PUSH', '⚠️ No order items found', { orderId });
      return;
    }

    // Prepare stock updates with negative quantities (items removed from stock)
    const stockUpdates = orderItems.map((item: any) => ({
      store_product_id: item.store_product_id,
      stock_update: -Math.abs(item.qty) // Ensure negative value
    }));

    logEvent('PUSH', '📦 Updating inventory for order items', { 
      orderId, 
      itemCount: stockUpdates.length,
      updates: stockUpdates
    });

    // Call the merchant_update_store_stock function
    const { error: updateError } = await supabaseBackground.rpc('merchant_update_store_stock', {
      updates: stockUpdates
    });

    if (updateError) {
      logEvent('PUSH', '❌ Error updating store stock', { orderId, error: updateError });
      return;
    }

    logEvent('PUSH', '✅ Successfully updated inventory', { 
      orderId, 
      updatedItems: stockUpdates.length 
    });

  } catch (error) {
    logEvent('PUSH', '❌ Error processing order confirmation', { orderId, error });
  }
};

// Initialize authentication sync between popup and background worker
const initializeAuth = async () => {
  try {
    // Add a small delay to ensure storage is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Try to get session from shared supabase client
    const { data: { session }, error } = await supabaseBackground.auth.getSession();
    
    if (error) {
      logEvent('START', '❌ Error getting session from shared client', error);
      return;
    }
    
    if (session && session.user) {
      logEvent('START', '🔑 Authenticated session restored', { 
        userId: session.user.id,
        email: session.user.email,
        expiresAt: session.expires_at
      });
    } else {
      logEvent('START', '🔐 No authenticated session found');
    }
  } catch (error) {
    logEvent('START', '❌ Error initializing auth', error);
  }
};

// Log service worker start
logEvent('START', '🚀 Service Worker Started');

// Initialize authentication
initializeAuth();

// Service Worker Startup/Installation
chrome.runtime.onStartup.addListener(() => {
  // Clear token validation flag on startup
  chrome.storage.local.remove(['tokenValidatedForSession']);
  // Re-initialize auth on startup
  initializeAuth();
});

chrome.runtime.onInstalled.addListener(() => {
  logEvent('START', '🔧 Extension installed/updated');
  // Clear token validation flag on install/update
  chrome.storage.local.remove(['tokenValidatedForSession']);
  // Re-initialize auth on install/update
  initializeAuth();
});

// Service Worker Suspend Detection (stop event)
chrome.runtime.onSuspend.addListener(() => {
  logEvent('STOP', '😴 Service Worker suspended');
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
        logEvent('START', '❌ FCM token generation failed', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
  
  if (request.action === 'ping') {
    sendResponse({ success: true, message: 'Service Worker is alive' });
    return true;
  }

  if (request.action === 'getLogs') {
    chrome.storage.local.get(['swLogs'], (result) => {
      sendResponse({ success: true, logs: result.swLogs || [] });
    });
    return true;
  }

  // Handle auth sync from popup
  if (request.action === 'syncAuth') {
    initializeAuth().then(() => {
      sendResponse({ success: true, message: 'Auth synced' });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
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
  logEvent('PUSH', '📬 Push notification received', {
    title: payload.notification?.title,
    data: payload.data
  });
  
  try {
    const notificationTitle = payload.notification?.title || 'LootMart Notification';
    const notificationOptions = {
      body: payload.notification?.body || 'You have a new notification',
      tag: 'lootmart-notification',
      requireInteraction: true,
      data: payload.data || {}
    };

    await self.registration.showNotification(notificationTitle, notificationOptions);
    
    // Check if this is an order confirmation notification
    if (notificationTitle.includes('Order Confirmed')) {
      const notificationBody = payload.notification?.body;
      
      if (notificationBody) {
        try {
          // Parse the order data from the notification body
          const orderData = JSON.parse(notificationBody);
          const orderId = orderData.orderId;
          
          if (orderId) {
            // Process the order confirmation in the background
            await processOrderConfirmation(orderId);
          }
        } catch (parseError) {
          logEvent('PUSH', '⚠️ Could not parse order data from notification', { parseError });
        }
      }
    }
    
  } catch (error) {
    logEvent('PUSH', '❌ Error handling push notification', error);
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