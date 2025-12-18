// FILE: /src/supabase/experienceMessaging.ts

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { isDbMessageRow, type DbMessageRow } from "./messagesRepo";

export async function getOrCreateAnonUserId(client: SupabaseClient): Promise<string> {
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

  return userId;
}

export type SubscribeStatusCallback = (status: string) => void;

export type SubscribeResult = {
  channel: RealtimeChannel;
  unsubscribe: () => void;
};

export function subscribeToMyMessageInserts(
  client: SupabaseClient,
  userId: string,
  onInsertRow: (row: DbMessageRow) => void,
  onStatus?: SubscribeStatusCallback
): SubscribeResult {
  if (!userId) {
    throw new Error("subscribeToMyMessageInserts: userId is required.");
  }

  const channel = client
    .channel(`experience-messages-inserts:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `user_id=eq.${userId}`,
      },
      (payload: any) => {
        const next = payload?.new;
        if (!isDbMessageRow(next)) return;
        onInsertRow(next);
      }
    )
    .subscribe((status: any) => {
      if (onStatus) onStatus(String(status || "unknown"));
    });

  const unsubscribe = () => {
    try {
      client.removeChannel(channel);
    } catch {
      // ignore
    }
  };

  return { channel, unsubscribe };
}
