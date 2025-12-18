// FILE: /src/supabase/realtimeMessages.ts

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { isDbMessageRow, type DbMessageRow } from "./messagesRepo";

export type RealtimeStatus = string;

export type SubscribeScopeMessageInsertsArgs = {
  client: SupabaseClient;
  scope?: string;

  onInsert: (row: DbMessageRow) => void;

  onStatus?: (status: RealtimeStatus) => void;
  onError?: (err: unknown) => void;

  channelNamePrefix?: string;
  schema?: string;
  table?: string;
};

export type RealtimeSubscriptionHandle = {
  unsubscribe: () => void;
};

export function subscribeScopeMessageInserts(args: SubscribeScopeMessageInsertsArgs): RealtimeSubscriptionHandle {
  const {
    client,
    scope = "public",
    onInsert,
    onStatus,
    onError,
    channelNamePrefix = "experience-messages-inserts-scope",
    schema = "public",
    table = "messages",
  } = args;

  const safeScope = String(scope || "").trim() || "public";

  const channelName = `${channelNamePrefix}:${safeScope}`;

  let channel: RealtimeChannel | null = null;
  let unsubscribed = false;

  try {
    channel = client
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema,
          table,
          filter: `scope=eq.${safeScope}`,
        },
        (payload: any) => {
          if (unsubscribed) return;

          try {
            const next = payload?.new;
            if (!isDbMessageRow(next)) return;
            onInsert(next);
          } catch (e) {
            onError?.(e);
          }
        }
      )
      .subscribe((status: any) => {
        if (unsubscribed) return;
        onStatus?.(String(status ?? "unknown"));
      });
  } catch (e) {
    onError?.(e);
  }

  function unsubscribe() {
    if (unsubscribed) return;
    unsubscribed = true;

    if (!channel) return;

    try {
      client.removeChannel(channel);
    } catch (e) {
      onError?.(e);
    } finally {
      channel = null;
    }
  }

  return { unsubscribe };
}

// Backward-compatible export name (keep existing imports working)
export type SubscribeMyMessageInsertsArgs = {
  client: SupabaseClient;
  userId: string;

  onInsert: (row: DbMessageRow) => void;

  onStatus?: (status: RealtimeStatus) => void;
  onError?: (err: unknown) => void;

  channelNamePrefix?: string;
  schema?: string;
  table?: string;
};

export function subscribeMyMessageInserts(args: SubscribeMyMessageInsertsArgs): RealtimeSubscriptionHandle {
  // Preserve old behavior by mapping userId -> unique scope channel name
  // This avoids breaking existing screens during migration.
  const {
    client,
    userId,
    onInsert,
    onStatus,
    onError,
    channelNamePrefix = "experience-messages-inserts",
    schema = "public",
    table = "messages",
  } = args;

  if (!userId) {
    onError?.(new Error("subscribeMyMessageInserts: userId is required."));
    return { unsubscribe: () => {} };
  }

  let channel: RealtimeChannel | null = null;
  let unsubscribed = false;

  try {
    channel = client
      .channel(`${channelNamePrefix}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema,
          table,
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (unsubscribed) return;

          try {
            const next = payload?.new;
            if (!isDbMessageRow(next)) return;
            onInsert(next);
          } catch (e) {
            onError?.(e);
          }
        }
      )
      .subscribe((status: any) => {
        if (unsubscribed) return;
        onStatus?.(String(status ?? "unknown"));
      });
  } catch (e) {
    onError?.(e);
  }

  function unsubscribe() {
    if (unsubscribed) return;
    unsubscribed = true;

    if (!channel) return;

    try {
      client.removeChannel(channel);
    } catch (e) {
      onError?.(e);
    } finally {
      channel = null;
    }
  }

  return { unsubscribe };
}
