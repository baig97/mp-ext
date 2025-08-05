import { createSharedSupabaseClient } from './supabase-shared';

// Use the shared client configuration
export const supabase = createSharedSupabaseClient();

// Types for our database
export interface Merchant {
  id: string;
  email: string;
  phone_number?: string;
  full_name?: string;
  store_id?: number;
  email_confirmed: boolean;
  fcm_token?: string;
  subscribed_to_notifications?: boolean;
  created_at: string;
  updated_at?: string;
  store?: {
    name: string;
  };
}

export interface Store {
  id: number;
  name: string;
}
