// FILE: /src/session/sessionId.ts

import "react-native-get-random-values";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { v4 as uuidv4 } from "uuid";

const SESSION_ID_STORAGE_KEY = "@r3f-avatar_mvp.sessionId.v1";

let inMemorySessionId: string | null = null;
let inflight: Promise<string> | null = null;

function isLikelyUuid(value: string): boolean {
  // Accept any non-empty string, but prefer uuid-like for safety.
  // We keep this permissive to avoid breaking if the DB column is text.
  return typeof value === "string" && value.trim().length > 0;
}

export function peekSessionId(): string | null {
  return inMemorySessionId;
}

export async function getOrCreateSessionId(): Promise<string> {
  if (inMemorySessionId) return inMemorySessionId;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const stored = await AsyncStorage.getItem(SESSION_ID_STORAGE_KEY);
      if (stored && isLikelyUuid(stored)) {
        inMemorySessionId = stored;
        return stored;
      }
    } catch {
      // Ignore storage read errors; we will create a new session id.
    }

    const fresh = uuidv4();

    try {
      await AsyncStorage.setItem(SESSION_ID_STORAGE_KEY, fresh);
    } catch {
      // Ignore storage write errors; session id still works for this run (not persisted).
    }

    inMemorySessionId = fresh;
    return fresh;
  })();

  try {
    const result = await inflight;
    return result;
  } finally {
    inflight = null;
  }
}

export async function resetSessionIdForDevOnly(): Promise<string> {
  const fresh = uuidv4();

  try {
    await AsyncStorage.setItem(SESSION_ID_STORAGE_KEY, fresh);
  } catch {
    // Ignore; still reset in-memory
  }

  inMemorySessionId = fresh;
  return fresh;
}
