import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dpgultbqxxdttrjcatco.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZ3VsdGJxeHhkdHRyamNhdGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5Mzg0NzIsImV4cCI6MjA2NjUxNDQ3Mn0.-IgB2vpHBAVR9o7JvyD-u6z8XvCJVI4jygz4acf-IIY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
