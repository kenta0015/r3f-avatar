import "react-native-gesture-handler";
import "@expo/metro-runtime";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";

import { Canvas } from "@react-three/fiber";
import { Audio } from "expo-av";

import DebugMessagesScreen from "./DebugMessagesScreen";
import { supabase } from "./supabaseClient";

import { ensureAvatarPreloaded } from "./src/avatar/avatarPreload";
import { installPollyFetchLogger } from "./src/debug/installPollyFetchLogger";
import { ensureTtsCacheInit, getPlayableTtsUriForText } from "./src/tts/ttsCache";

import { AvatarModel } from "./src/three/components/AvatarModel";
import { Floor, LoadingFallback, RotatingBox } from "./src/three/components/SceneParts";

import { subscribeMyMessageInserts, type RealtimeSubscriptionHandle } from "./src/supabase/realtimeMessages";
import { ensureAnonUserId } from "./src/supabase/anonAuth";

import { getOrCreateSessionId } from "./src/session/sessionId";

type RootStackParamList = {
  Landing: undefined;
  Experience: undefined;
  DebugMessages: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

type LandingProps = NativeStackScreenProps<RootStackParamList, "Landing">;
type ExperienceProps = NativeStackScreenProps<RootStackParamList, "Experience">;

const _log = console.log.bind(console);
console.log = (...args: any[]) => {
  const msg = String(args?.[0] ?? "");
  if (msg.includes("EXGL: gl.pixelStorei() doesn't support this parameter yet!")) return;
  _log(...args);
};

installPollyFetchLogger();

function nowMs() {
  const p: any = (globalThis as any).performance;
  if (p && typeof p.now === "function") return p.now();
  return Date.now();
}

type MessageLog = {
  id: string;
  name: string;
  message: string;
  createdAt: number;
  ttsUrl: string;
  status: "ready" | "loading" | "playing" | "error";
  errorMessage?: string;
};

type AuthStatus = "idle" | "loading" | "ready" | "error";

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Step 11-2(B): fixed scope (string) to isolate this app's rows/policies.
// You can override via .env: EXPO_PUBLIC_MESSAGE_SCOPE=...
const MESSAGE_SCOPE: string =
  (process.env as any)?.EXPO_PUBLIC_MESSAGE_SCOPE ||
  (process.env as any)?.EXPO_PUBLIC_MESSAGES_SCOPE ||
  "r3f-avatar-mvp";

type DbMessageRowCore = {
  id: string;
  user_id: string;
  name: string;
  message: string;
  created_at: string;
  session_id?: string | null;
  scope?: string | null;
};

async function selectMyMessagesScoped(client: typeof supabase, userId: string, limit: number) {
  const { data, error } = await client
    .from("messages")
    .select("id, user_id, name, message, created_at, session_id, scope")
    .eq("user_id", userId)
    .eq("scope", MESSAGE_SCOPE)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data as DbMessageRowCore[]) ?? [];
}

async function insertMessageScoped(
  client: typeof supabase,
  userId: string,
  name: string,
  message: string,
  sessionId: string
) {
  const { error } = await client.from("messages").insert({
    user_id: userId,
    name,
    message,
    session_id: sessionId,
    scope: MESSAGE_SCOPE,
  });

  if (error) throw error;
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function visemeToJawOpen(viseme: any): number {
  if (!viseme) return 0;

  const s = String(viseme).trim().toLowerCase();

  // wawa-lipsync style: "viseme_aa", "viseme_pp", "viseme_dd", ...
  if (s.startsWith("viseme_")) {
    const v = s.slice("viseme_".length);

    // Silence / rest
    if (v === "sil" || v === "rest" || v === "x") return 0.0;

    // Vowels (bigger)
    if (v === "aa") return 0.7;
    if (v === "o") return 0.65;
    if (v === "u") return 0.65;
    if (v === "e") return 0.6;
    if (v === "i") return 0.6;

    // Consonants (smaller, but not zero)
    if (v === "pp") return 0.28;
    if (v === "ff") return 0.24;
    if (v === "th") return 0.22;
    if (v === "dd") return 0.22;
    if (v === "kk") return 0.2;
    if (v === "ch") return 0.2;
    if (v === "ss") return 0.18;
    if (v === "nn") return 0.18;
    if (v === "rr") return 0.18;

    // Fallback: mid-low
    return 0.26;
  }

  // Fallback mapping (non-wawa)
  if (s.includes("sil") || s.includes("rest") || s === "x") return 0.02;

  if (s.includes("m") || s.includes("b") || s.includes("p")) return 0.18;
  if (s.includes("f") || s.includes("v")) return 0.24;

  if (s === "a" || s.includes("aa")) return 0.55;
  if (s === "e" || s.includes("eh") || s.includes("ee")) return 0.4;
  if (s === "i" || s.includes("ih") || s.includes("iy")) return 0.42;
  if (s === "o" || s.includes("oh") || s.includes("ao")) return 0.5;
  if (s === "u" || s.includes("uw") || s.includes("uh")) return 0.45;

  return 0.26;
}

function LandingScreen({ navigation }: LandingProps) {
  useEffect(() => {
    void ensureAvatarPreloaded("Landing").catch(() => {
      // ignore
    });

    void ensureTtsCacheInit().catch(() => {
      // ignore
    });

    void getOrCreateSessionId().catch(() => {
      // ignore
    });
  }, []);

  return (
    <SafeAreaView style={styles.landingSafe}>
      <View style={styles.landingContainer}>
        <Text style={styles.landingTitle}>R3F Avatar MVP</Text>
        <Text style={styles.landingSubtitle}>
          Navigation + local RPM avatar + Polly TTS playback (MVP). Next we add Supabase auth + messages table.
        </Text>

        <View style={styles.previewBox}>
          <Text style={styles.previewText}>Ready Player Me Avatar (local GLB)</Text>
          <Text style={styles.previewSubtext}>assets/avatar.glb</Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate("Experience")}>
          <Text style={styles.primaryButtonText}>Enter Experience</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.debugButton} onPress={() => navigation.navigate("DebugMessages")}>
          <Text style={styles.debugButtonText}>Open DebugMessagesScreen</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function ExperienceScreen({ navigation }: ExperienceProps) {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarReady, setAvatarReady] = useState(false);

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDbLoading, setIsDbLoading] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const lastWebBlobUrlRef = useRef<string | null>(null);

  const realtimeSubRef = useRef<RealtimeSubscriptionHandle | null>(null);

  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authUserId, setAuthUserId] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

  const [realtimeStatus, setRealtimeStatus] = useState<string>("idle");

  const [sessionId, setSessionId] = useState<string>("");
  const sessionIdRef = useRef<string>("");

  const pendingSpeakRef = useRef<{
    name: string;
    message: string;
    requestedAt: number;
    sessionId: string;
  } | null>(null);

  const experienceStartMsRef = useRef<number>(0);
  const avatarUriReadyLoggedRef = useRef(false);

  // Web-only lipsync (Wawa)
  const [mouthValue, setMouthValue] = useState<number | undefined>(undefined);
  const webAudioElRef = useRef<any>(null);
  const webRafRef = useRef<number | null>(null);
  const lipsyncRef = useRef<any>(null);
  const lastVisemeRef = useRef<any>(null);
  const mouthValueRef = useRef<number>(0);
  const mouthStateSentRef = useRef<number>(0);

  // Lipsync tuning (web)
  const MOUTH_GAIN = 2.5;
  const MOUTH_SMOOTH_ALPHA = 0.28;
  const MOUTH_SETSTATE_EPS = 0.008;

  const isAvatarLoading = !avatarError && (!avatarUri || !avatarReady);

  useEffect(() => {
    experienceStartMsRef.current = nowMs();
    avatarUriReadyLoggedRef.current = false;
    console.log("[PERF] Experience mounted");
  }, []);

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

    initSessionId();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!avatarUri) {
      setAvatarReady(false);
      return;
    }
    setAvatarReady(false);
  }, [avatarUri]);

  useEffect(() => {
    if (!avatarUri) return;

    if (!avatarUriReadyLoggedRef.current) {
      avatarUriReadyLoggedRef.current = true;
      const ms = Math.round(nowMs() - experienceStartMsRef.current);
      console.log(`[PERF] avatar uri ready in ${ms}ms`);
    }
  }, [avatarUri]);

  useEffect(() => {
    let mounted = true;

    async function setupAudio() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });
      } catch {
        // ignore
      }
    }

    async function resolveLocalAvatar() {
      try {
        const uri = await ensureAvatarPreloaded("Experience");
        if (mounted) setAvatarUri(uri);
      } catch (e: any) {
        if (mounted) setAvatarError(String(e?.message || e));
      }
    }

    setupAudio();
    resolveLocalAvatar();

    return () => {
      mounted = false;
      (async () => {
        try {
          if (soundRef.current) {
            await soundRef.current.unloadAsync();
            soundRef.current = null;
          }
        } catch {
          // ignore
        }

        if (Platform.OS === "web") {
          if (webRafRef.current) {
            try {
              cancelAnimationFrame(webRafRef.current);
            } catch {
              // ignore
            }
            webRafRef.current = null;
          }

          try {
            if (webAudioElRef.current) {
              try {
                webAudioElRef.current.pause();
              } catch {
                // ignore
              }
              webAudioElRef.current.onended = null;
              webAudioElRef.current.onerror = null;
              webAudioElRef.current = null;
            }
          } catch {
            // ignore
          }

          setMouthValue(0);
          mouthValueRef.current = 0;
          mouthStateSentRef.current = 0;
          lastVisemeRef.current = null;

          if (lastWebBlobUrlRef.current) {
            try {
              URL.revokeObjectURL(lastWebBlobUrlRef.current);
            } catch {
              // ignore
            }
            lastWebBlobUrlRef.current = null;
          }
        }
      })();
    };
  }, []);

  function setLogStatus(id: string, next: Partial<MessageLog>) {
    setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...next } : l)));
  }

  function stopWebLipsync() {
    if (Platform.OS !== "web") return;

    if (webRafRef.current) {
      try {
        cancelAnimationFrame(webRafRef.current);
      } catch {
        // ignore
      }
      webRafRef.current = null;
    }

    lastVisemeRef.current = null;
    mouthValueRef.current = 0;
    mouthStateSentRef.current = 0;
    setMouthValue(0);
  }

  async function ensureWebLipsyncManager() {
    if (Platform.OS !== "web") return null;
    if (lipsyncRef.current) return lipsyncRef.current;

    const mod: any = await import("wawa-lipsync");
    const LipsyncCtor = mod?.Lipsync;
    if (!LipsyncCtor) throw new Error("wawa-lipsync: Lipsync export not found");

    lipsyncRef.current = new LipsyncCtor();
    return lipsyncRef.current;
  }

  async function playWebTtsWithLipsync(logId: string, uri: string) {
    stopWebLipsync();

    const lipsync = await ensureWebLipsyncManager();

    // Stop any existing web audio
    try {
      if (webAudioElRef.current) {
        try {
          webAudioElRef.current.pause();
        } catch {
          // ignore
        }
        webAudioElRef.current.onended = null;
        webAudioElRef.current.onerror = null;
      }
    } catch {
      // ignore
    }

    const AudioCtor: any = (globalThis as any).Audio;
    if (!AudioCtor) throw new Error("Web Audio element not available");

    const audioEl: any = webAudioElRef.current || new AudioCtor();
    webAudioElRef.current = audioEl;

    // Important: src must be set BEFORE connectAudio()
    audioEl.preload = "auto";
    audioEl.crossOrigin = "anonymous";
    audioEl.src = uri;

    try {
      lipsync.connectAudio(audioEl);
    } catch (e: any) {
      throw new Error(`wawa-lipsync connectAudio failed: ${String(e?.message || e)}`);
    }

    // Start analyzer loop (logs viseme changes; updates mouthValue with smoothing)
    const analyze = () => {
      webRafRef.current = requestAnimationFrame(analyze);

      try {
        lipsync.processAudio();
        const viseme = lipsync.viseme;

        if (viseme !== lastVisemeRef.current) {
          lastVisemeRef.current = viseme;
          console.log("[LIPSYNC] viseme:", viseme);
        }

        const raw = visemeToJawOpen(viseme);
        const target = clamp01(raw * MOUTH_GAIN);

        const prev = mouthValueRef.current;
        const smoothed = prev + (target - prev) * MOUTH_SMOOTH_ALPHA;

        mouthValueRef.current = smoothed;

        if (Math.abs(smoothed - mouthStateSentRef.current) > MOUTH_SETSTATE_EPS) {
          mouthStateSentRef.current = smoothed;
          setMouthValue(smoothed);
        }
      } catch {
        // ignore (keep the loop alive)
      }
    };

    analyze();

    audioEl.onended = () => {
      stopWebLipsync();
      setIsSpeaking(false);
      setLogStatus(logId, { status: "ready" });

      if (lastWebBlobUrlRef.current) {
        try {
          URL.revokeObjectURL(lastWebBlobUrlRef.current);
        } catch {
          // ignore
        }
        lastWebBlobUrlRef.current = null;
      }
    };

    audioEl.onerror = () => {
      stopWebLipsync();
      setIsSpeaking(false);
      setLogStatus(logId, { status: "error", errorMessage: "Web audio playback error" });

      if (lastWebBlobUrlRef.current) {
        try {
          URL.revokeObjectURL(lastWebBlobUrlRef.current);
        } catch {
          // ignore
        }
        lastWebBlobUrlRef.current = null;
      }
    };

    // Play (user gesture from Speak button should allow this)
    await audioEl.play();
  }

  async function playTtsForLog(logId: string, text: string) {
    setIsSpeaking(true);
    setLogStatus(logId, { status: "loading", ttsUrl: "" });

    // Web: reset mouthValue immediately
    if (Platform.OS === "web") {
      mouthValueRef.current = 0;
      mouthStateSentRef.current = 0;
      setMouthValue(0);
    }

    try {
      // Stop/unload expo-av sound (native path)
      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch {
          // ignore
        }
        soundRef.current = null;
      }

      // Revoke previous blob (web path)
      if (Platform.OS === "web" && lastWebBlobUrlRef.current) {
        try {
          URL.revokeObjectURL(lastWebBlobUrlRef.current);
        } catch {
          // ignore
        }
        lastWebBlobUrlRef.current = null;
      }

      const startedAt = nowMs();
      const playable = await getPlayableTtsUriForText(text);
      const ms = Math.round(nowMs() - startedAt);
      console.log(`[PERF] TTS playable uri ready in ${ms}ms (${playable.source})`);

      if (Platform.OS === "web" && playable.uri.startsWith("blob:")) {
        lastWebBlobUrlRef.current = playable.uri;
      }

      setLogStatus(logId, { ttsUrl: playable.uri });

      if (Platform.OS === "web") {
        setLogStatus(logId, { status: "playing" });
        await playWebTtsWithLipsync(logId, playable.uri);
        return;
      }

      // Native: keep existing expo-av flow
      const { sound } = await Audio.Sound.createAsync(
        { uri: playable.uri },
        { shouldPlay: true, volume: 1.0 },
        (status) => {
          if (!status.isLoaded) return;

          if (status.isPlaying) {
            setLogStatus(logId, { status: "playing" });
          }

          if (status.didJustFinish) {
            setIsSpeaking(false);
            setLogStatus(logId, { status: "ready" });
          }
        }
      );

      soundRef.current = sound;
      setLogStatus(logId, { status: "playing" });
    } catch (e: any) {
      if (Platform.OS === "web") {
        stopWebLipsync();
      }
      setIsSpeaking(false);
      setLogStatus(logId, { status: "error", errorMessage: String(e?.message || e) });
    }
  }

  useEffect(() => {
    let alive = true;

    async function initAnonAuth() {
      setAuthStatus("loading");
      setAuthError("");
      setAuthUserId("");
      setRealtimeStatus("idle");

      try {
        const { userId } = await ensureAnonUserId(supabase);
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

  async function refreshMessages() {
    if (!authUserId) return;

    setIsDbLoading(true);
    try {
      const rows = await selectMyMessagesScoped(supabase, authUserId, 30);

      const mapped: MessageLog[] =
        (rows ?? []).map((row: any) => ({
          id: typeof row?.id === "string" && row.id ? row.id : makeId(),
          name: typeof row?.name === "string" ? row.name : String(row?.name ?? ""),
          message: typeof row?.message === "string" ? row.message : String(row?.message ?? ""),
          createdAt: typeof row?.created_at === "string" ? new Date(row.created_at).getTime() : Date.now(),
          ttsUrl: "",
          status: "ready",
        })) ?? [];

      setLogs(mapped);
    } catch {
      // ignore
    } finally {
      setIsDbLoading(false);
    }
  }

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (!authUserId) return;
    void refreshMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, authUserId]);

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (!authUserId) return;

    if (realtimeSubRef.current) {
      try {
        realtimeSubRef.current.unsubscribe();
      } catch {
        // ignore
      }
      realtimeSubRef.current = null;
    }

    setRealtimeStatus("subscribing");

    const sub = subscribeMyMessageInserts({
      client: supabase,
      userId: authUserId,
      onStatus: (s) => setRealtimeStatus(s),
      onError: () => setRealtimeStatus("error"),
      onInsert: (next: any) => {
        const nextScope = typeof next?.scope === "string" && next.scope ? next.scope : "";
        if (nextScope && nextScope !== MESSAGE_SCOPE) return;

        const nextLog: MessageLog = {
          id: String(next.id),
          name: String(next.name ?? ""),
          message: String(next.message ?? ""),
          createdAt: typeof next?.created_at === "string" ? new Date(next.created_at).getTime() : Date.now(),
          ttsUrl: "",
          status: "ready",
        };

        setLogs((prev) => {
          if (prev.some((r) => r.id === nextLog.id)) return prev;
          const merged = [nextLog, ...prev];
          return merged.slice(0, 30);
        });

        const pending = pendingSpeakRef.current;
        if (!pending) return;

        const ageMs = Date.now() - pending.requestedAt;
        const sameText =
          pending.name.trim() === String(next.name ?? "").trim() &&
          pending.message.trim() === String(next.message ?? "").trim();

        const nextSessionId = typeof next?.session_id === "string" && next.session_id ? next.session_id : "";
        const sameSession = !!pending.sessionId && !!nextSessionId && pending.sessionId === nextSessionId;

        if (sameSession && sameText && ageMs >= 0 && ageMs < 15_000) {
          pendingSpeakRef.current = null;
          void playTtsForLog(String(next.id), String(next.message ?? ""));
          setIsSending(false);
        }
      },
    });

    realtimeSubRef.current = sub;

    return () => {
      if (realtimeSubRef.current) {
        try {
          realtimeSubRef.current.unsubscribe();
        } catch {
          // ignore
        }
        realtimeSubRef.current = null;
      }
      setRealtimeStatus("idle");
    };
  }, [authStatus, authUserId]);

  async function speak() {
    const safeName = name.trim();
    const safeMessage = message.trim();

    if (!safeName || !safeMessage) return;
    if (authStatus !== "ready" || !authUserId) return;
    if (isSending || isSpeaking || isDbLoading || isAvatarLoading) return;

    setIsSending(true);

    try {
      const sid = sessionIdRef.current || sessionId || (await getOrCreateSessionId());
      sessionIdRef.current = sid;
      if (!sessionId) setSessionId(sid);

      pendingSpeakRef.current = {
        name: safeName,
        message: safeMessage,
        requestedAt: Date.now(),
        sessionId: sid,
      };

      await insertMessageScoped(supabase, authUserId, safeName, safeMessage, sid);
    } catch (e: any) {
      pendingSpeakRef.current = null;
      setIsSending(false);

      const id = makeId();

      const errorLog: MessageLog = {
        id,
        name: safeName,
        message: safeMessage,
        createdAt: Date.now(),
        ttsUrl: "",
        status: "error",
        errorMessage: String(e?.message || e),
      };

      setLogs((prev) => [errorLog, ...prev].slice(0, 30));
    }
  }

  async function retryAuth() {
    setAuthStatus("loading");
    setAuthError("");
    setAuthUserId("");
    setRealtimeStatus("idle");
    setLogs([]);
    pendingSpeakRef.current = null;
    setIsSending(false);
    setIsSpeaking(false);
    setIsDbLoading(false);

    if (Platform.OS === "web") {
      stopWebLipsync();
    }

    try {
      if (realtimeSubRef.current) {
        try {
          realtimeSubRef.current.unsubscribe();
        } catch {
          // ignore
        }
        realtimeSubRef.current = null;
      }

      const { userId } = await ensureAnonUserId(supabase);

      setAuthUserId(userId);
      setAuthStatus("ready");
    } catch (e: any) {
      setAuthStatus("error");
      setAuthError(String(e?.message || e));
    }
  }

  const camera = useMemo(
    () => ({
      position: [0, 0.4, 0.9] as [number, number, number],
      fov: 28,
    }),
    []
  );

  const canSpeak =
    authStatus === "ready" &&
    !!authUserId &&
    name.trim().length > 0 &&
    message.trim().length > 0 &&
    !isSpeaking &&
    !isSending &&
    !isDbLoading &&
    !isAvatarLoading;

  const showOverlay = isAvatarLoading || isSending || isSpeaking;

  const overlayTitle = isAvatarLoading ? "Loading avatar…" : isSending ? "Sending…" : isSpeaking ? "Speaking…" : "";

  const overlayHint = isAvatarLoading
    ? "Preparing 3D model and materials"
    : isSending
    ? "Writing to Supabase"
    : isSpeaking
    ? Platform.OS === "web"
      ? "Playing audio + lipsync (web)"
      : "Playing audio (cached)"
    : "";

  return (
    <KeyboardAvoidingView style={styles.experienceContainer} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.experienceHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.experienceTitle}>Experience</Text>

        <View style={styles.backButtonSpacer} />
      </View>

      <View style={styles.canvasWrap}>
        <View style={styles.canvasContainer}>
          <Canvas
            camera={camera}
            shadows
            onCreated={({ camera }) => {
              camera.lookAt(0, 0.0, 0);
              camera.updateProjectionMatrix();
            }}
          >
            <color attach="background" args={["#000000"]} />

            <ambientLight intensity={0.6} />
            <directionalLight position={[2, 4, 2]} intensity={1.2} castShadow />
            <pointLight position={[0, 2, 4]} intensity={0.6} />

            <Floor />

            <Suspense fallback={<LoadingFallback />}>
              {avatarError ? (
                <RotatingBox position={[0, 0, 0]} />
              ) : avatarUri ? (
                <AvatarModel
                  uri={avatarUri}
                  mouthActive={isSpeaking}
                  mouthValue={Platform.OS === "web" ? mouthValue : undefined}
                  onReady={() => {
                    setAvatarReady(true);
                    const ms = Math.round(nowMs() - experienceStartMsRef.current);
                    console.log(`[PERF] avatar READY in ${ms}ms`);
                  }}
                />
              ) : (
                <LoadingFallback />
              )}
            </Suspense>
          </Canvas>

          {showOverlay ? (
            Platform.OS === "web" ? (
              <View style={[styles.canvasOverlay, { pointerEvents: "none" } as any]}>
                <View style={styles.overlayCard}>
                  <ActivityIndicator />
                  <Text style={styles.overlayTitle}>{overlayTitle}</Text>
                  <Text style={styles.overlayHint}>{overlayHint}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.canvasOverlay} pointerEvents="none">
                <View style={styles.overlayCard}>
                  <ActivityIndicator />
                  <Text style={styles.overlayTitle}>{overlayTitle}</Text>
                  <Text style={styles.overlayHint}>{overlayHint}</Text>
                </View>
              </View>
            )
          ) : null}
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.authCard}>
          <View style={styles.authTopRow}>
            <Text style={styles.authTitle}>Supabase Auth (Anonymous)</Text>
            <Text style={styles.authStatus}>
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
              <Text style={styles.authLabel}>auth.uid() equivalent (user.id)</Text>
              <Text style={styles.authUid} numberOfLines={1}>
                {authUserId}
              </Text>

              <View style={{ height: 8 }} />

              <Text style={styles.authLabel}>Session ID (persisted)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {sessionId || "loading..."}
              </Text>

              <View style={{ height: 8 }} />

              <Text style={styles.authLabel}>Scope (fixed)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {MESSAGE_SCOPE}
              </Text>

              <View style={{ height: 8 }} />
              <View style={styles.authTopRow}>
                <Text style={styles.authLabel}>Realtime</Text>
                <Text style={styles.authStatus}>{realtimeStatus}</Text>
              </View>
            </>
          ) : authStatus === "error" ? (
            <>
              <Text style={styles.authErrorText} numberOfLines={3}>
                {authError}
              </Text>
              <Text style={styles.authHint}>Tip: check your Supabase settings, then restart Metro.</Text>
            </>
          ) : (
            <>
              <Text style={styles.authHint}>Initializing anonymous session…</Text>
              <View style={{ height: 6 }} />
              <Text style={styles.authLabel}>Session ID (persisted)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {sessionId || "loading..."}
              </Text>
              <View style={{ height: 8 }} />
              <Text style={styles.authLabel}>Scope (fixed)</Text>
              <Text style={styles.sessionIdText} numberOfLines={1}>
                {MESSAGE_SCOPE}
              </Text>
            </>
          )}

          <TouchableOpacity
            style={[styles.authButton, authStatus === "loading" ? styles.authButtonDisabled : null]}
            disabled={authStatus === "loading"}
            onPress={retryAuth}
          >
            <Text style={styles.authButtonText}>Retry Auth</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputsRow}>
          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              autoCapitalize="words"
              autoCorrect={false}
              editable={authStatus === "ready" && !isAvatarLoading}
            />
          </View>

          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Say something..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              autoCapitalize="sentences"
              autoCorrect
              editable={authStatus === "ready" && !isAvatarLoading}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.speakButton, !canSpeak ? styles.speakButtonDisabled : null]}
          disabled={!canSpeak}
          onPress={speak}
        >
          <Text style={styles.speakButtonText}>{isSpeaking ? "Speaking..." : isSending ? "Sending..." : "Speak"}</Text>
        </TouchableOpacity>

        <View style={styles.logsHeader}>
          <Text style={styles.logsTitle}>Messages (DB)</Text>
          <Text style={styles.logsHint}>Insert triggers Realtime → card auto-add</Text>
        </View>

        <ScrollView
          style={styles.logsList}
          contentContainerStyle={styles.logsContent}
          scrollEnabled={Platform.OS !== "web"}
        >
          {avatarError ? (
            <View style={styles.logCardError}>
              <Text style={styles.logCardTitle}>Avatar load failed</Text>
              <Text style={styles.logCardText} numberOfLines={3}>
                {avatarError}
              </Text>
              <Text style={styles.logCardHint}>Check: assets/avatar.glb</Text>
            </View>
          ) : null}

          {logs.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No messages yet.</Text>
            </View>
          ) : (
            logs.map((l) => (
              <View key={l.id} style={styles.logCard}>
                <View style={styles.logCardTopRow}>
                  <Text style={styles.logName}>{l.name}</Text>
                  <Text style={styles.logStatus}>
                    {l.status === "loading"
                      ? "loading"
                      : l.status === "playing"
                      ? "playing"
                      : l.status === "error"
                      ? "error"
                      : "ready"}
                  </Text>
                </View>
                <Text style={styles.logMessage}>{l.message}</Text>
                {l.status === "error" && l.errorMessage ? (
                  <Text style={styles.logErrorText} numberOfLines={2}>
                    {l.errorMessage}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator id="RootStack" initialRouteName="Landing" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="Experience" component={ExperienceScreen} />
        <Stack.Screen name="DebugMessages" component={DebugMessagesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  landingSafe: {
    flex: 1,
    backgroundColor: "black",
  },
  landingContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 16,
  },
  landingTitle: {
    color: "white",
    fontSize: 28,
    fontWeight: "700",
  },
  landingSubtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 20,
  },
  previewBox: {
    height: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 6,
  },
  previewText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontWeight: "700",
  },
  previewSubtext: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 8,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  primaryButtonText: {
    color: "black",
    fontSize: 16,
    fontWeight: "700",
  },
  debugButton: {
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  debugButtonText: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
  },

  experienceContainer: {
    flex: 1,
    backgroundColor: "black",
  },
  experienceHeader: {
    height: 56,
    paddingHorizontal: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  experienceTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  backButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "700",
  },
  backButtonSpacer: {
    width: 54,
  },
  canvasWrap: {
    flex: 1,
  },
  canvasContainer: {
    flex: 1,
  },
  canvasOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    paddingTop: 12,
    paddingRight: 12,
    paddingLeft: 12,
  },
  overlayCard: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    gap: 8,
  },
  overlayTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  overlayHint: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "700",
  },

  panel: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    gap: 10,
    ...(Platform.OS === "web"
      ? ({
          maxHeight: 260,
          overflow: "auto",
        } as any)
      : ({} as any)),
  },

  authCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 8,
  },
  authTopRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  authTitle: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  authStatus: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "800",
  },
  authLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontWeight: "800",
  },
  authUid: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  sessionIdText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 11,
    fontWeight: "900",
  },
  authHint: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  authErrorText: {
    color: "rgba(255,120,120,0.9)",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
  },
  authButton: {
    marginTop: 2,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  authButtonDisabled: {
    opacity: 0.45,
  },
  authButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },

  inputsRow: {
    flexDirection: "row",
    gap: 10,
  },
  inputWrap: {
    flex: 1,
    gap: 6,
  },
  inputLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "700",
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
  speakButton: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  speakButtonDisabled: {
    opacity: 0.35,
  },
  speakButtonText: {
    color: "black",
    fontSize: 15,
    fontWeight: "800",
  },

  logsHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  logsTitle: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  logsHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
  },
  logsList: {
    ...(Platform.OS === "web"
      ? ({
          flexGrow: 0,
          flexShrink: 0,
        } as any)
      : ({
          maxHeight: 220,
        } as any)),
  },
  logsContent: {
    gap: 8,
    paddingBottom: 6,
  },
  emptyState: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  emptyText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "700",
  },
  logCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 6,
  },
  logCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logName: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  logStatus: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
  },
  logMessage: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    lineHeight: 16,
  },
  logErrorText: {
    color: "rgba(255,120,120,0.9)",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },

  logCardError: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.35)",
    backgroundColor: "rgba(255,120,120,0.1)",
    gap: 6,
  },
  logCardTitle: {
    color: "white",
    fontSize: 12,
    fontWeight: "900",
  },
  logCardText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    lineHeight: 16,
  },
  logCardHint: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
});
