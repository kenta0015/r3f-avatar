import "react-native-gesture-handler";
import "@expo/metro-runtime";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei/native";
import { Asset } from "expo-asset";
import { Audio } from "expo-av";
import type { GLTF } from "three-stdlib";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RootStackParamList = {
  Landing: undefined;
  Experience: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

type LandingProps = NativeStackScreenProps<RootStackParamList, "Landing">;
type ExperienceProps = NativeStackScreenProps<RootStackParamList, "Experience">;

// Put your Ready Player Me avatar here:
//   /assets/avatar.glb
//
// For MVP fastest TTS:
// use your existing Lambda URL (Polly proxy)
const POLLY_LAMBDA_BASE_URL = "https://xlt57x5dyt6ymnc7waumag2ywy0vluso.lambda-url.us-east-1.on.aws/";

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

function RotatingBox(props: any) {
  const mesh = useRef<any>(null);
  const [hovered, setHover] = useState(false);
  const [active, setActive] = useState(false);

  useFrame(() => {
    if (mesh?.current) {
      mesh.current.rotation.x += 0.01;
      mesh.current.rotation.y += 0.01;
    }
  });

  return (
    <mesh
      {...props}
      ref={mesh}
      scale={active ? [1.5, 1.5, 1.5] : [1, 1, 1]}
      onClick={() => setActive((v) => !v)}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? "hotpink" : "orange"} />
    </mesh>
  );
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]} receiveShadow>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial color="#1a1a1a" />
    </mesh>
  );
}

function LoadingFallback() {
  return (
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  );
}

function AvatarModel({ uri }: { uri: string }) {
  const gltf = useGLTF(uri) as unknown as GLTF;
  return <primitive object={gltf.scene} position={[0, -1.6, 0]} scale={[1, 1, 1]} />;
}

function LandingScreen({ navigation }: LandingProps) {
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
      </View>
    </SafeAreaView>
  );
}

function getSupabaseEnv() {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  return { url, anonKey };
}

function ExperienceScreen({ navigation }: ExperienceProps) {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authUserId, setAuthUserId] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

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
        const asset = Asset.fromModule(require("./assets/avatar.glb"));
        await asset.downloadAsync();

        const uri = asset.localUri || asset.uri;
        if (!uri) throw new Error("Failed to resolve avatar URI from Expo Asset.");

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
      })();
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function initAnonAuth() {
      setAuthStatus("loading");
      setAuthError("");
      setAuthUserId("");

      try {
        const { url, anonKey } = getSupabaseEnv();

        if (!url || !anonKey) {
          throw new Error(
            "Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY."
          );
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

  const camera = useMemo(
    () => ({
      position: [0, 1.2, 3.0] as [number, number, number],
      fov: 45,
    }),
    []
  );

  function buildTtsUrl(text: string) {
    const u = new URL(POLLY_LAMBDA_BASE_URL);
    u.searchParams.set("text", text);
    u.searchParams.set("voiceId", "Joanna");
    u.searchParams.set("format", "mp3");
    u.searchParams.set("engine", "neural");
    u.searchParams.set("tone", "healing");
    return u.toString();
  }

  async function speak() {
    const safeName = name.trim();
    const safeMessage = message.trim();

    if (!safeName || !safeMessage) return;

    const ttsUrl = buildTtsUrl(safeMessage);
    const id = makeId();

    const newLog: MessageLog = {
      id,
      name: safeName,
      message: safeMessage,
      createdAt: Date.now(),
      ttsUrl,
      status: "loading",
    };

    setLogs((prev) => [newLog, ...prev]);
    setIsSpeaking(true);

    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: ttsUrl },
        { shouldPlay: true, volume: 1.0 },
        (status) => {
          if (!status.isLoaded) return;
          if (status.isPlaying) {
            setLogs((prev) =>
              prev.map((l) => (l.id === id ? { ...l, status: "playing" as const } : l))
            );
          }
          if (status.didJustFinish) {
            setIsSpeaking(false);
            setLogs((prev) =>
              prev.map((l) => (l.id === id ? { ...l, status: "ready" as const } : l))
            );
          }
        }
      );

      soundRef.current = sound;

      setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, status: "playing" } : l)));
    } catch (e: any) {
      setIsSpeaking(false);
      setLogs((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, status: "error", errorMessage: String(e?.message || e) } : l
        )
      );
    }
  }

  async function retryAuth() {
    setAuthStatus("loading");
    setAuthError("");
    setAuthUserId("");

    try {
      const { url, anonKey } = getSupabaseEnv();

      if (!url || !anonKey) {
        throw new Error(
          "Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY."
        );
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
    } catch (e: any) {
      setAuthStatus("error");
      setAuthError(String(e?.message || e));
    }
  }

  const canSpeak = name.trim().length > 0 && message.trim().length > 0 && !isSpeaking;

  return (
    <KeyboardAvoidingView
      style={styles.experienceContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.experienceHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.experienceTitle}>Experience</Text>

        <View style={styles.backButtonSpacer} />
      </View>

      <View style={styles.canvasWrap}>
        <Canvas camera={camera} shadows>
          <color attach="background" args={["#000000"]} />

          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 4, 2]} intensity={1.2} castShadow />
          <pointLight position={[0, 2, 4]} intensity={0.6} />

          <Floor />

          <Suspense fallback={<LoadingFallback />}>
            {avatarError ? (
              <RotatingBox position={[0, 0, 0]} />
            ) : avatarUri ? (
              <AvatarModel uri={avatarUri} />
            ) : (
              <LoadingFallback />
            )}
          </Suspense>
        </Canvas>
      </View>

      <View style={styles.panel}>
        <View style={styles.authCard}>
          <View style={styles.authTopRow}>
            <Text style={styles.authTitle}>Supabase Auth (Anonymous)</Text>
            <Text style={styles.authStatus}>
              {authStatus === "loading" ? "loading" : authStatus === "ready" ? "ready" : authStatus === "error" ? "error" : "idle"}
            </Text>
          </View>

          {authStatus === "ready" ? (
            <>
              <Text style={styles.authLabel}>auth.uid() equivalent (user.id)</Text>
              <Text style={styles.authUid} numberOfLines={1}>
                {authUserId}
              </Text>
            </>
          ) : authStatus === "error" ? (
            <>
              <Text style={styles.authErrorText} numberOfLines={3}>
                {authError}
              </Text>
              <Text style={styles.authHint}>
                Tip: create a .env and add EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart Metro.
              </Text>
            </>
          ) : (
            <Text style={styles.authHint}>Initializing anonymous session…</Text>
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
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.speakButton, !canSpeak ? styles.speakButtonDisabled : null]}
          disabled={!canSpeak}
          onPress={speak}
        >
          <Text style={styles.speakButtonText}>{isSpeaking ? "Speaking..." : "Speak"}</Text>
        </TouchableOpacity>

        <View style={styles.logsHeader}>
          <Text style={styles.logsTitle}>Messages (local)</Text>
          <Text style={styles.logsHint}>TTS plays via your Polly Lambda URL</Text>
        </View>

        <ScrollView style={styles.logsList} contentContainerStyle={styles.logsContent}>
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

  panel: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    gap: 10,
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
    maxHeight: 220,
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
    backgroundColor: "rgba(255,120,120,0.10)",
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
