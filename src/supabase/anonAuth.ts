// FILE: /src/supabase/anonAuth.ts

import type { SupabaseClient } from "@supabase/supabase-js";

export type AnonAuthResult = {
  userId: string;
};

export async function ensureAnonUserId(client: SupabaseClient): Promise<AnonAuthResult> {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;

  let userId = sessionData?.session?.user?.id || "";

  if (!userId) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    userId = data?.user?.id || data?.session?.user?.id || "";
  }

  if (!userId) {
    throw new Error("Anonymous sign-in did not return a user id.");
  }

  return { userId };
}
