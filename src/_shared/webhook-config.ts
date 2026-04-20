// Configuration for the webhook sync system
export const WEBHOOK_CONFIG = {
  // TODO: Replace with your actual webhook endpoint
  WEBHOOK_URL: 'https://dpgultbqxxdttrjcatco.supabase.co/functions/v1/inventory_sync_webhook/push',
  
  // TODO: Replace with your actual test endpoint for connection status
  TEST_ENDPOINT: 'https://dpgultbqxxdttrjcatco.supabase.co/functions/v1/inventory_sync_webhook/test-connection',

  // Sync interval in minutes (default: 5 minutes)
  SYNC_INTERVAL_MINUTES: 5,

  // Retry interval in seconds (default: 10 seconds)
  RETRY_INTERVAL_SECONDS: 10,
  
  // Maximum number of retries before giving up (default: 6 = 1 minute total)
  MAX_RETRIES: 6,
  
  // Request timeout in milliseconds (default: 30 seconds)
  REQUEST_TIMEOUT_MS: 30000,
  
  // Source identifier for the webhook payload
  SOURCE_IDENTIFIER: 'moneypex-extension',
  
  // Mock mode setting - set to true to use mock inventory API instead of real Moneypex API
  USE_MOCK_API: false, // Change to false for production use
  
  // Mock API behavior settings (only applies when USE_MOCK_API is true)
  // MOCK_API_STATIC_MODE controls how the mock API behaves:
  // - true: Always returns fresh Excel data (static) - CDC will sync remote DB to match Excel file
  //         First runs may trigger webhook to align remote data, then subsequent runs stay in sync
  // - false: Applies random changes each time (dynamic) - useful for testing CDC and webhook sync
  MOCK_API_STATIC_MODE: true, // Set to true for static responses (fresh Excel data), false for dynamic simulation
  
  // Path to the mock inventory Excel file (relative to public directory)
  MOCK_INVENTORY_FILE_PATH: '/mock-inventory.xlsx'
};
