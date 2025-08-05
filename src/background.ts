import { fetchInventoryFromMoneypex } from './api/fetchInventory';
import { app } from "./_shared/firebase-config";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";
import { getToken } from "firebase/messaging";

// Declare service worker global scope
declare const self: ServiceWorkerGlobalScope;

// Initialize messaging for service worker context
const messaging = getMessaging(app);

// Simplified logging for start/stop/push events only
const logEvent = (type: 'START' | 'STOP' | 'PUSH', message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[SW-${type}] ${timestamp}: ${message}`, data || '');
  
  // Store in chrome.storage for popup access
  chrome.storage.local.get(['swLogs'], (result) => {
    const logs = result.swLogs || [];
    logs.push({ type, timestamp, message, data });
    
    // Keep only last 50 logs
    if (logs.length > 50) {
      logs.splice(0, logs.length - 50);
    }
    
    chrome.storage.local.set({ swLogs: logs });
  });
};

// Log service worker start
logEvent('START', '🚀 Service Worker Started');

// Service Worker Startup/Installation
chrome.runtime.onStartup.addListener(() => {
  logEvent('START', '🔄 Chrome startup - Service Worker restarted');
  // Clear token validation flag on startup
  chrome.storage.local.remove(['tokenValidatedForSession']);
});

chrome.runtime.onInstalled.addListener(() => {
  logEvent('START', '🔧 Extension installed/updated - Service Worker started');
  // Clear token validation flag on install/update
  chrome.storage.local.remove(['tokenValidatedForSession']);
});

// Service Worker Suspend Detection (stop event)
chrome.runtime.onSuspend.addListener(() => {
  logEvent('STOP', '😴 Service Worker going to sleep');
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getFCMToken') {
    getToken(messaging, {
      vapidKey: "BH7yiwqpmEfGKeSCk6Vm-ju2v-G8Uv2nxpaBFoN5I6f7_cOh5JTfqBoBeSo4SpypFJMzoBt7K8V6tpbYqCocFZU",
      serviceWorkerRegistration: self.registration
    })
      .then((token: string) => {
        logEvent('START', '🔑 New FCM token generated', { tokenPrefix: token.substring(0, 20) + '...' });
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
});

// 🎯 Push notification handler - this wakes up the service worker
onBackgroundMessage(messaging, async (payload) => {
  logEvent('PUSH', '� Push notification received', {
    title: payload.notification?.title,
    body: payload.notification?.body,
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
    logEvent('PUSH', '� Notification displayed successfully');
    
  } catch (error) {
    logEvent('PUSH', '❌ Error handling push notification', error);
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  logEvent('PUSH', '� Notification clicked');
  
  event.notification.close();
  
  event.waitUntil(
    chrome.windows.getCurrent().then(() => {
      chrome.action.openPopup?.();
    }).catch(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    })
  );
});
