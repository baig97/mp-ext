import { fetchInventoryFromMoneypex } from './api/fetchInventory';

// const SUPABASE_FUNCTION_URL = `https://dpgultbqxxdttrjcatco.functions.supabase.co/sync_inventory`;

async function syncInventory() {
  try {
    const parsedInventoryItems = await fetchInventoryFromMoneypex();
    console.log('✅ Fetched inventory:', parsedInventoryItems);

    // Commented out Supabase API call
    // const res = await fetch(SUPABASE_FUNCTION_URL, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({ parsedInventoryItems })
    // });

    // const result = await res.json();
    // console.log('✅ Inventory sync complete:', result);
  } catch (err) {
    console.error('❌ Inventory fetch failed:', err);
  }
}

// Fetch inventory once on start
syncInventory();

// Set up periodic polling
chrome.alarms.create('pollInventory', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'pollInventory') {
    await syncInventory();
  }
});