import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dpgultbqxxdttrjcatco.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZ3VsdGJxeHhkdHRyamNhdGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5Mzg0NzIsImV4cCI6MjA2NjUxNDQ3Mn0.-IgB2vpHBAVR9o7JvyD-u6z8XvCJVI4jygz4acf-IIY';

// Shared Chrome storage adapter for both popup and background worker
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Storage get error:', chrome.runtime.lastError);
          resolve(null);
        } else {
          const value = result[key];
          // Supabase expects a string, but Chrome storage might store objects
          resolve(value ? (typeof value === 'string' ? value : JSON.stringify(value)) : null);
        }
      });
    });
  },
  
  async setItem(key: string, value: string): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        // Supabase sends JSON strings, parse them before storing
        const parsedValue = JSON.parse(value);
        chrome.storage.local.set({ [key]: parsedValue }, () => {
          if (chrome.runtime.lastError) {
            console.error('Storage set error:', chrome.runtime.lastError);
          }
          resolve();
        });
      } catch (error) {
        // If it's not JSON, store as string
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            console.error('Storage set error:', chrome.runtime.lastError);
          }
          resolve();
        });
      }
    });
  },
  
  async removeItem(key: string): Promise<void> {
    return new Promise<void>((resolve) => {
      chrome.storage.local.remove([key], () => {
        if (chrome.runtime.lastError) {
          console.error('Storage remove error:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }
};

// Shared options for both popup and background worker
const sharedSupabaseOptions = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Important for extensions
    storage: chromeStorageAdapter
  }
};

// Export the shared client creator
export const createSharedSupabaseClient = () => {
  return createClient(supabaseUrl, supabaseAnonKey, sharedSupabaseOptions);
};

// Export individual pieces if needed
export { supabaseUrl, supabaseAnonKey, sharedSupabaseOptions };
