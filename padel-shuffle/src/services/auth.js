import { supabase } from '../lib/supabase.js';
import { retryRead } from './query.js';

function client() {
  if (!supabase) throw new Error('Cloud is not configured yet. Add the VITE_SUPABASE variables first.');
  return supabase;
}

export async function getCurrentUser() {
  // getSession reads the persisted local session and avoids a network request
  // every time the Online tab is opened. Server RPCs still validate auth.uid().
  const { data, error } = await client().auth.getSession();
  if (error) throw error;
  return data.session?.user || null;
}

export async function getProfile(userId) {
  return retryRead(async () => {
    const { data, error } = await client().from('profiles').select('id, display_name, avatar_url').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data;
  });
}

export async function updateProfile({ displayName, avatarUrl }) {
  const user = await getCurrentUser();
  const { data, error } = await client().from('profiles')
    .update({ display_name: displayName.trim(), avatar_url: avatarUrl.trim() || null })
    .eq('id', user.id)
    .select('id, display_name, avatar_url')
    .single();
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email, password, displayName) {
  const { data, error } = await client().auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) throw error;
  return data.user;
}

export async function resetPasswordForEmail(email) {
  const { error } = await client().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}`
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await client().auth.signOut();
  if (error) throw error;
}
