import { createClient } from '@supabase/supabase-js';

const environment = import.meta.env || {};
const url = environment.VITE_SUPABASE_URL;
const key = environment.VITE_SUPABASE_PUBLISHABLE_KEY;

export const cloudConfigured = Boolean(url && key);

// Only the browser-safe publishable key is ever read here. Service-role keys
// belong exclusively in server-side tooling and must never be put in Vite env.
export const supabase = cloudConfigured
  ? createClient(url, key, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  })
  : null;
