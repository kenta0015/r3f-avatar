// FILE: DebugMessagesScreen.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

import { getOrCreateSessionId } from "./src/session/sessionId";

type AuthStatus = "idle" | "loading" | "ready" | "error";

// Step 11-2(B): fixed scope (string) to isolate this app's rows/policies.
// You can override via .env: EXPO_PUBLIC_MESSAGE_SCOPE=...
const MESSAGE_SCOPE: string =
  (process.env as any)?.EXPO_PUBLIC_MESSAGE_SCOPE ||
  (process.env as any)?.EXPO_PUBLIC_MESSAGES_SCOPE ||
  "r3f-avatar-mvp";

type DbMessageRow = {
  id: string;
  user_id: string;
  name: string;
  message: string;
  created_at: string;
  session_id?: string | null;
  scope?: string | null;
};

function isDbMessageRow(value: any): value is DbMessageRow {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    typeof value.created_at === "string" &&
    (value.session_id === undefined || value.session_id === null || typeof value.session_id === "string") &&
    (value.scope === undefined || value.scope === null || typeof value.scope === "string")
  );
}

export default function DebugMessagesScreen() {
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);

  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authUserId, setAuthUserId] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

  const [sessionId, setSessionId] = useState<string>("");
  const sessionIdRef = useRef<string>("");

  const [name, setName] = useState<string>("Ken");
  const [message, setMessage] = useState<string>("Hello from my device");

  const [rows, setRows] = useState<DbMessageRow[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [lastActionError, setLastActionError] = useState<string>("");

  const [realtimeStatus, setRealtimeStatus] = useState<string>("idle");

  useEffect(() => {
    let alive = true;

    async function initSessionId() {
      try {
        const id = await getOrCreateSessionId();
        if (!alive) return;
        sessionIdRef.current = id;
        setSessionId(id);
      } catch {
        // ignore
      }
    }

    void initSessionId();

    return () => {
      alive = false;
    };
  }, []);

  const canInsert = useMemo(() => {
    return (
      authStatus === "ready" &&
      !!authUserId &&
      name.trim().length > 0 &&
      message.trim().length > 0 &&
      !busy
    );
  }, [authStatus, authUserId, name, message, busy]);

  const canSelect = useMemo(() => {
    return authStatus === "ready" && !!authUserId && !busy;
  }, [authStatus, authUserId, busy]);

  useEffect(() => {
    let alive = true;

    async function initAnonAuth() {
      setAuthStatus("loading");
      setAuthError("");
      setAuthUserId("");
      setLastActionError("");
      setRealtimeStatus("idle");

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        let userId = sessionData?.session?.user?.id || "";

        if (!userId) {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          userId = data?.user?.id || data?.session?.user?.id || "";
        }

        if (!userId) {
          throw new Error("Anonymous sign-in did not return a user id.");
        }

        if (!alive) return;

        setAuthUserId(userId);
        setAuthStatus("ready");
      } catch (e: any) {
        if (!alive) return;
        setAuthStatus("error");
        setAuthError(String(e?.message || e));
      }
    }

    void initAnonAuth();

    return () => {
      alive = false;
    };
  }, []);

  async function selectMyMessages() {
    if (!authUserId) return;

    setBusy(true);
    setLastActionError("");

    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, user_id, name, message, created_at, session_id, scope")
        .eq("user_id", authUserId)
        .eq("scope", MESSAGE_SCOPE)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;

      setRows((data as DbMessageRow[]) ?? []);
    } catch (e: any) {
      setLastActionError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function insertMessage() {
    if (!authUserId) return;

    const safeName = name.trim();
    const safeMessage = message.trim();
    if (!safeName || !safeMessage) return;

    setBusy(true);
    setLastActionError("");

    try {
      const sid = sessionIdRef.current || sessionId || (await getOrCreateSessionId());
      sessionIdRef.current = sid;
      if (!sessionId) setSessionId(sid);

      const { error } = await supabase.from("messages").insert({
        user_id: authUserId,
        name: safeName,
        message: safeMessage,
        session_id: sid,
        scope: MESSAGE_SCOPE,
      });

      if (error) throw error;

      // Step 9: no reload here. UI should update via Realtime subscription.
    } catch (e: any) {
      setLastActionError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (authStatus !== "ready") return;
    void selectMyMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (!authUserId) return;

    // Safety: ensure we don't keep multiple channels alive (double inserts)
    if (realtimeChannelRef.current) {
      try {
        supabase.removeChannel(realtimeChannelRef.current);
      } catch {
        // ignore
      }
      realtimeChannelRef.current = null;
    }

    setRealtimeStatus("subscribing");

    const channel = supabase
      .channel(`debug-messages-inserts:${authUserId}:${MESSAGE_SCOPE}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `user_id=eq.${authUserId}`,
        },
        (payload: any) => {
          const next = payload?.new;
          if (!isDbMessageRow(next)) return;

          const nextScope = typeof next.scope === "string" && next.scope ? next.scope : "";
          if (nextScope !== MESSAGE_SCOPE) return;

          setRows((prev) => {
            if (prev.some((r) => r.id === next.id)) return prev;
            const merged = [next, ...prev];
            return merged.slice(0, 30);
          });
        }
      )
      .subscribe((status: any) => {
        setRealtimeStatus(String(status || "unknown"));
      });

    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current) {
        try {
          supabase.removeChannel(realtimeChannelRef.current);
        } catch {
          // ignore
        }
        realtimeChannelRef.current = null;
      }
      setRealtimeStatus("idle");
    };
  }, [authStatus, authUserId]);

  async function retryAuth() {
    setAuthStatus("loading");
    setAuthError("");
    setAuthUserId("");
    setRows([]);
    setLastActionError("");
    setRealtimeStatus("idle");

    try {
      // Cleanup any existing realtime channel before re-auth
      if (realtimeChannelRef.current) {
        try {
          supabase.removeChannel(realtimeChannelRef.current);
        } catch {
          // ignore
        }
        realtimeChannelRef.current = null;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      let userId = sessionData?.session?.user?.id || "";

      if (!userId) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        userId = data?.user?.id || data?.session?.user?.id || "";
      }

      if (!userId) throw new Error("Anonymous sign-in did not return a user id.");

      setAuthUserId(userId);
      setAuthStatus("ready");
      await selectMyMessages();
    } catch (e: any) {
      setAuthStatus("error");
      setAuthError(String(e?.message || e));
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>Debug: Messages INSERT / SELECT</Text>
          <Text style={styles.subtitle}>This screen tests Step 6–9 without touching App.tsx</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Supabase Auth (Anonymous)</Text>
            <Text style={styles.muted}>
              {authStatus === "loading"
                ? "loading"
                : authStatus === "ready"
                ? "ready"
                : authStatus === "error"
                ? "error"
                : "idle"}
            </Text>
          </View>

          {authStatus === "ready" ? (
            <>
              <Text style={styles.label}>user.id</Text>
              <Text style={styles.value} numberOfLines={1}>
                {authUserId}
              </Text>

              <View style={{ height: 8 }} />

              <Text style={styles.label}>Session ID (persisted)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {sessionId || "loading..."}
              </Text>

              <View style={{ height: 8 }} />

              <Text style={styles.label}>Scope (fixed)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {MESSAGE_SCOPE}
              </Text>

              <View style={{ height: 8 }} />
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Realtime</Text>
                <Text style={styles.mutedSmall}>{realtimeStatus}</Text>
              </View>
            </>
          ) : authStatus === "error" ? (
            <>
              <Text style={styles.errorText} numberOfLines={4}>
                {authError}
              </Text>
              <Text style={styles.mutedSmall}>
                Tip: ensure .env has EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY and restart Metro.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.mutedSmall}>Initializing anonymous session…</Text>
              <View style={{ height: 6 }} />
              <Text style={styles.label}>Session ID (persisted)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {sessionId || "loading..."}
              </Text>
              <View style={{ height: 8 }} />
              <Text style={styles.label}>Scope (fixed)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {MESSAGE_SCOPE}
              </Text>
            </>
          )}

          <TouchableOpacity
            style={[styles.buttonGhost, authStatus === "loading" ? styles.disabled : null]}
            disabled={authStatus === "loading"}
            onPress={retryAuth}
          >
            <Text style={styles.buttonGhostText}>Retry Auth</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Insert</Text>

          <View style={styles.inputWrap}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputWrap}>
            <Text style={styles.label}>Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Say something..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              autoCapitalize="sentences"
              autoCorrect
            />
          </View>

          <View style={styles.rowGap}>
            <TouchableOpacity
              style={[styles.buttonPrimary, !canInsert ? styles.disabled : null]}
              disabled={!canInsert}
              onPress={insertMessage}
            >
              <Text style={styles.buttonPrimaryText}>{busy ? "Working..." : "INSERT (messages)"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.buttonGhost, !canSelect ? styles.disabled : null]}
              disabled={!canSelect}
              onPress={selectMyMessages}
            >
              <Text style={styles.buttonGhostText}>{busy ? "Working..." : "SELECT (my logs)"}</Text>
            </TouchableOpacity>
          </View>

          {lastActionError ? (
            <Text style={styles.errorText} numberOfLines={4}>
              {lastActionError}
            </Text>
          ) : null}
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>My latest logs</Text>
          <Text style={styles.mutedSmall}>{rows.length} rows</Text>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.mutedSmall}>No rows yet (or RLS blocked SELECT).</Text>
            </View>
          ) : (
            rows.map((r) => (
              <View key={r.id} style={styles.rowCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.rowName}>{r.name}</Text>
                  <Text style={styles.mutedSmall}>{new Date(r.created_at).toLocaleString()}</Text>
                </View>
                <Text style={styles.rowMessage}>{r.message}</Text>

                {r.session_id ? (
                  <Text style={styles.mutedTiny} numberOfLines={1}>
                    session: {r.session_id}
                  </Text>
                ) : (
                  <Text style={styles.mutedTiny} numberOfLines={1}>
                    session: (null)
                  </Text>
                )}

                <Text style={styles.mutedTiny} numberOfLines={1}>
                  scope: {typeof r.scope === "string" && r.scope ? r.scope : "(null)"}
                </Text>

                <Text style={styles.mutedTiny} numberOfLines={1}>
                  id: {r.id}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "black",
  },
  safe: {
    flex: 1,
    backgroundColor: "black",
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  header: {
    gap: 6,
    marginBottom: 10,
  },
  title: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 10,
    marginBottom: 10,
  },
  cardTitle: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
  },
  rowGap: {
    flexDirection: "row",
    gap: 10,
  },
  label: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "800",
  },
  value: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  muted: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "800",
  },
  mutedSmall: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  mutedTiny: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "700",
  },
  sessionIdText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 11,
    fontWeight: "900",
  },
  errorText: {
    color: "rgba(255,120,120,0.95)",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 14,
  },
  inputWrap: {
    gap: 6,
  },
  input: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    color: "white",
    fontSize: 14,
  },
  buttonPrimary: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  buttonPrimaryText: {
    color: "black",
    fontSize: 12,
    fontWeight: "900",
  },
  buttonGhost: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  buttonGhostText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.4,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 2,
    marginBottom: 8,
  },
  listTitle: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: 14,
  },
  empty: {
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 6,
  },
  rowName: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  rowMessage: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
});
