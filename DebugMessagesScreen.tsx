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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AuthStatus = "idle" | "loading" | "ready" | "error";

type DbMessageRow = {
  id: string;
  user_id: string;
  name: string;
  message: string;
  created_at: string;
};

function getSupabaseEnv() {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  return { url, anonKey };
}

export default function DebugMessagesScreen() {
  const supabaseRef = useRef<SupabaseClient | null>(null);

  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authUserId, setAuthUserId] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

  const [name, setName] = useState<string>("Ken");
  const [message, setMessage] = useState<string>("Hello from my device");

  const [rows, setRows] = useState<DbMessageRow[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [lastActionError, setLastActionError] = useState<string>("");

  const canInsert = useMemo(() => {
    return authStatus === "ready" && !!authUserId && name.trim().length > 0 && message.trim().length > 0 && !busy;
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

      try {
        const { url, anonKey } = getSupabaseEnv();
        if (!url || !anonKey) {
          throw new Error("Missing env vars: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY");
        }

        if (!supabaseRef.current) {
          supabaseRef.current = createClient(url, anonKey, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: false,
            },
          });
        }

        const supabase = supabaseRef.current;

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

    initAnonAuth();

    return () => {
      alive = false;
    };
  }, []);

  async function selectMyMessages() {
    if (!supabaseRef.current || !authUserId) return;

    setBusy(true);
    setLastActionError("");

    try {
      const supabase = supabaseRef.current;

      const { data, error } = await supabase
        .from("messages")
        .select("id, user_id, name, message, created_at")
        .eq("user_id", authUserId)
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
    if (!supabaseRef.current || !authUserId) return;

    const safeName = name.trim();
    const safeMessage = message.trim();
    if (!safeName || !safeMessage) return;

    setBusy(true);
    setLastActionError("");

    try {
      const supabase = supabaseRef.current;

      const { error } = await supabase.from("messages").insert({
        user_id: authUserId,
        name: safeName,
        message: safeMessage,
      });

      if (error) throw error;

      await selectMyMessages();
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

  async function retryAuth() {
    setAuthStatus("loading");
    setAuthError("");
    setAuthUserId("");
    setRows([]);
    setLastActionError("");

    try {
      const { url, anonKey } = getSupabaseEnv();
      if (!url || !anonKey) {
        throw new Error("Missing env vars: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY");
      }

      if (!supabaseRef.current) {
        supabaseRef.current = createClient(url, anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        });
      }

      const supabase = supabaseRef.current;

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
          <Text style={styles.subtitle}>This screen tests Step 6 without touching App.tsx</Text>
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
            <Text style={styles.mutedSmall}>Initializing anonymous session…</Text>
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
