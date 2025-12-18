// FILE: /src/supabase/messagesRepo.ts

import type { SupabaseClient } from "@supabase/supabase-js";

export type DbMessageRow = {
  id: string;
  user_id: string;
  name: string;
  message: string;
  created_at: string;
  session_id: string;
  scope: string;
};

export type MessageEntity = {
  id: string;
  userId: string;
  name: string;
  message: string;
  createdAtMs: number;
  sessionId: string;
  scope: string;
};

export function isDbMessageRow(value: any): value is DbMessageRow {
  if (!value || typeof value !== "object") return false;

  return (
    typeof value.id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    typeof value.created_at === "string" &&
    typeof value.session_id === "string" &&
    typeof value.scope === "string"
  );
}

function toMs(createdAt: string): number {
  const ms = new Date(createdAt).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function mapRow(row: DbMessageRow): MessageEntity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    message: row.message,
    createdAtMs: toMs(row.created_at),
    sessionId: row.session_id,
    scope: row.scope,
  };
}

export async function insertMessageToDb(
  client: SupabaseClient,
  userId: string,
  name: string,
  message: string,
  sessionId: string,
  scope: string = "public"
): Promise<void> {
  const safeUserId = String(userId || "").trim();
  const safeName = String(name || "").trim();
  const safeMessage = String(message || "").trim();
  const safeSessionId = String(sessionId || "").trim();
  const safeScope = String(scope || "").trim() || "public";

  if (!safeUserId) throw new Error("insertMessageToDb: userId is required.");
  if (!safeName) throw new Error("insertMessageToDb: name is required.");
  if (!safeMessage) throw new Error("insertMessageToDb: message is required.");
  if (!safeSessionId) throw new Error("insertMessageToDb: sessionId is required.");

  const { error } = await client.from("messages").insert({
    user_id: safeUserId,
    name: safeName,
    message: safeMessage,
    session_id: safeSessionId,
    scope: safeScope,
  });

  if (error) throw error;
}

export async function selectMyMessages(
  client: SupabaseClient,
  userId: string,
  limit: number = 30
): Promise<MessageEntity[]> {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return [];

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 30;

  const { data, error } = await client
    .from("messages")
    .select("id, user_id, name, message, created_at, session_id, scope")
    .eq("user_id", safeUserId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;

  const rows = Array.isArray(data) ? (data as any[]) : [];
  const out: MessageEntity[] = [];

  for (const r of rows) {
    if (!isDbMessageRow(r)) continue;
    out.push(mapRow(r));
  }

  return out;
}

export async function selectScopeMessages(
  client: SupabaseClient,
  scope: string = "public",
  limit: number = 30
): Promise<MessageEntity[]> {
  const safeScope = String(scope || "").trim() || "public";
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 30;

  const { data, error } = await client
    .from("messages")
    .select("id, user_id, name, message, created_at, session_id, scope")
    .eq("scope", safeScope)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;

  const rows = Array.isArray(data) ? (data as any[]) : [];
  const out: MessageEntity[] = [];

  for (const r of rows) {
    if (!isDbMessageRow(r)) continue;
    out.push(mapRow(r));
  }

  return out;
}
