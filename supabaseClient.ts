import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * IMPORTANT:
 * This file must be the ONLY place in the app that calls `createClient()`.
 * All other files should import { supabase } from "./supabaseClient".
 *
 * We also cache the client on globalThis to avoid multiple instances during
 * Fast Refresh / HMR, which can trigger GoTrue "Multiple GoTrueClient instances"
 * warnings and undefined auth storage behavior.
 */

declare global {
  // eslint-disable-next-line no-var
  var __SUPABASE_CLIENT__: SupabaseClient | undefined;
}

export const supabaseUrl: string = String(process.env.EXPO_PUBLIC_SUPABASE_URL ?? "");
export const supabaseAnonKey: string = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "");

function createSupabaseSingleton(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Keep this as a hard error so misconfigured env is obvious.
    // If you want softer behavior later, we can switch this to a console.warn + dummy client.
    throw new Error(
      "Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Prevent oddities on web refresh / URL handling
      detectSessionInUrl: false,
      // Defaults are fine, but keeping explicit makes intent clear
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export const supabase: SupabaseClient =
  globalThis.__SUPABASE_CLIENT__ ?? (globalThis.__SUPABASE_CLIENT__ = createSupabaseSingleton());
