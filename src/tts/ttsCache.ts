// FILE: /Users/ken/app development/r3f-avatar-mvp/src/tts/ttsCache.ts

import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";

export const POLLY_LAMBDA_BASE_URL =
  (process.env.EXPO_PUBLIC_POLLY_URL || "").trim() ||
  "https://xlt57x5dyt6ymnc7waumag2ywy0vluso.lambda-url.us-east-1.on.aws/";

export const TTS_OPTS = {
  voiceId: "Matthew",
  format: "mp3",
  engine: "neural",
  tone: "healing",
} as const;

export type TtsCacheIndex = {
  version: number;
  createdAt: number;
  lastCleanupAt: number;
  items: Record<
    string,
    {
      key: string;
      fileUri: string; // native only
      contentType: string;
      sizeBytes: number;
      createdAt: number;
      lastAccessAt: number;
    }
  >;
};

export type TtsPlayableResult = {
  uri: string;
  source: "cache" | "network";
  contentType?: string;
  sizeBytes?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __TTS_CACHE__:
    | {
        initPromise?: Promise<void>;
        dir?: string;
        indexPath?: string;
        index?: TtsCacheIndex;
        inflight?: Record<string, Promise<TtsPlayableResult>>;
      }
    | undefined;
}

const TTS_CACHE_VERSION = 1;
const TTS_CACHE_DIR_NAME = "tts-cache-v1";
const TTS_CACHE_INDEX_FILE = "index.json";
const TTS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TTS_CACHE_MAX_BYTES_NATIVE = 80 * 1024 * 1024; // 80MB
const TTS_CACHE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

function nowMs() {
  const p: any = (globalThis as any).performance;
  if (p && typeof p.now === "function") return p.now();
  return Date.now();
}

function normalizeTextForKey(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function fnv1a32Hex(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildTtsUrl(text: string) {
  const u = new URL(POLLY_LAMBDA_BASE_URL);
  u.searchParams.set("text", text);
  u.searchParams.set("voiceId", TTS_OPTS.voiceId);
  u.searchParams.set("format", TTS_OPTS.format);
  u.searchParams.set("engine", TTS_OPTS.engine);
  u.searchParams.set("tone", TTS_OPTS.tone);
  const built = u.toString();
  console.log("[POLLY] URL", built.replace(/text=[^&]*/i, "text=<omitted>"));
  return u.toString();
}

function getTtsCacheKeyFromText(text: string) {
  const norm = normalizeTextForKey(text);
  const base = [
    `tts-v${TTS_CACHE_VERSION}`,
    `base=${POLLY_LAMBDA_BASE_URL}`,
    `voice=${TTS_OPTS.voiceId}`,
    `engine=${TTS_OPTS.engine}`,
    `tone=${TTS_OPTS.tone}`,
    `format=${TTS_OPTS.format}`,
    `text=${norm}`,
  ].join("|");
  return fnv1a32Hex(base);
}

function getCacheStorage(): any | null {
  const cs: any = (globalThis as any).caches;
  if (!cs) return null;
  return cs;
}

function safeContentType(headers: any): string {
  const raw = headers?.["content-type"] || headers?.["Content-Type"] || "";
  return String(raw || "");
}

function isAudioContentType(contentType: string) {
  return contentType.toLowerCase().includes("audio");
}

export async function ensureTtsCacheInit() {
  if (!globalThis.__TTS_CACHE__) globalThis.__TTS_CACHE__ = {};
  const state = globalThis.__TTS_CACHE__;

  if (state.initPromise) return state.initPromise;

  state.initPromise = (async () => {
    state.inflight = state.inflight || {};

    if (Platform.OS === "web") {
      // Web uses Cache Storage; no file dir needed
      return;
    }

    const baseDir = (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory ?? null;

    if (!baseDir) {
      console.log("[TTS] cacheDirectory missing; native file cache disabled");
      return;
    }

    const dir = `${baseDir}${TTS_CACHE_DIR_NAME}/`;
    const indexPath = `${dir}${TTS_CACHE_INDEX_FILE}`;

    state.dir = dir;
    state.indexPath = indexPath;

    try {
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
    } catch {
      // ignore
    }

    let idx: TtsCacheIndex | null = null;

    try {
      const info = await FileSystem.getInfoAsync(indexPath);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(indexPath);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.version === TTS_CACHE_VERSION && parsed.items) {
          idx = parsed as TtsCacheIndex;
        }
      }
    } catch {
      // ignore
    }

    if (!idx) {
      idx = {
        version: TTS_CACHE_VERSION,
        createdAt: Date.now(),
        lastCleanupAt: 0,
        items: {},
      };
      try {
        await FileSystem.writeAsStringAsync(indexPath, JSON.stringify(idx));
      } catch {
        // ignore
      }
    }

    state.index = idx;
  })();

  return state.initPromise;
}

async function persistTtsIndex() {
  const state = globalThis.__TTS_CACHE__;
  if (!state || Platform.OS === "web") return;
  if (!state.index || !state.indexPath) return;
  try {
    await FileSystem.writeAsStringAsync(state.indexPath, JSON.stringify(state.index));
  } catch {
    // ignore
  }
}

function calcNativeTotalBytes(idx: TtsCacheIndex) {
  let total = 0;
  for (const k of Object.keys(idx.items)) {
    total += Number(idx.items[k]?.sizeBytes || 0);
  }
  return total;
}

async function maybeCleanupNativeTtsCache() {
  const state = globalThis.__TTS_CACHE__;
  if (!state || Platform.OS === "web") return;
  if (!state.index || !state.dir) return;

  const idx = state.index;
  const now = Date.now();
  if (now - (idx.lastCleanupAt || 0) < TTS_CACHE_CLEANUP_INTERVAL_MS) return;

  idx.lastCleanupAt = now;

  // 1) Remove expired
  const keys = Object.keys(idx.items);
  for (const key of keys) {
    const it = idx.items[key];
    const age = now - (it?.createdAt || 0);
    if (age > TTS_CACHE_TTL_MS) {
      try {
        await FileSystem.deleteAsync(it.fileUri, { idempotent: true });
      } catch {
        // ignore
      }
      delete idx.items[key];
    }
  }

  // 2) Enforce max bytes (LRU by lastAccessAt)
  let total = calcNativeTotalBytes(idx);
  if (total > TTS_CACHE_MAX_BYTES_NATIVE) {
    const entries = Object.values(idx.items).sort((a, b) => (a.lastAccessAt || 0) - (b.lastAccessAt || 0));
    for (const it of entries) {
      if (total <= TTS_CACHE_MAX_BYTES_NATIVE) break;
      try {
        await FileSystem.deleteAsync(it.fileUri, { idempotent: true });
      } catch {
        // ignore
      }
      total -= Number(it.sizeBytes || 0);
      delete idx.items[it.key];
    }
  }

  await persistTtsIndex();
}

async function getNativeCachedTtsUri(key: string): Promise<TtsPlayableResult | null> {
  const state = globalThis.__TTS_CACHE__;
  if (!state || Platform.OS === "web") return null;
  if (!state.index) return null;

  const it = state.index.items[key];
  if (!it) return null;

  // Verify file exists
  try {
    const info = await FileSystem.getInfoAsync(it.fileUri);
    if (!info.exists) {
      delete state.index.items[key];
      await persistTtsIndex();
      return null;
    }
  } catch {
    // ignore
  }

  // TTL check
  const now = Date.now();
  if (now - (it.createdAt || 0) > TTS_CACHE_TTL_MS) {
    try {
      await FileSystem.deleteAsync(it.fileUri, { idempotent: true });
    } catch {
      // ignore
    }
    delete state.index.items[key];
    await persistTtsIndex();
    return null;
  }

  it.lastAccessAt = now;
  void persistTtsIndex();

  return {
    uri: it.fileUri,
    source: "cache",
    contentType: it.contentType,
    sizeBytes: it.sizeBytes,
  };
}

async function saveNativeTtsToCache(key: string, ttsUrl: string): Promise<TtsPlayableResult> {
  const state = globalThis.__TTS_CACHE__;
  if (!state || Platform.OS === "web") {
    return { uri: ttsUrl, source: "network" };
  }
  if (!state.dir || !state.index) {
    return { uri: ttsUrl, source: "network" };
  }

  const safeUrl = ttsUrl.replace(/text=[^&]*/i, "text=<omitted>");
  console.log("[TTS] native cache MISS → download", key, safeUrl);

  const tmpUri = `${state.dir}${key}.tmp.${Date.now()}.mp3`;
  const finalUri = `${state.dir}${key}.mp3`;

  try {
    const res = await FileSystem.downloadAsync(ttsUrl, tmpUri);
    const ct = safeContentType(res?.headers || {});
    if (res.status !== 200 || !isAudioContentType(ct)) {
      try {
        await FileSystem.deleteAsync(tmpUri, { idempotent: true });
      } catch {
        // ignore
      }
      throw new Error(`TTS download not audio: HTTP ${res.status}, content-type=${ct || "<none>"}`);
    }

    try {
      await FileSystem.deleteAsync(finalUri, { idempotent: true });
    } catch {
      // ignore
    }

    await FileSystem.moveAsync({ from: tmpUri, to: finalUri });

    const info = await FileSystem.getInfoAsync(finalUri);
    const sizeBytes = Number((info as any)?.size || 0);

    const now = Date.now();
    state.index.items[key] = {
      key,
      fileUri: finalUri,
      contentType: ct,
      sizeBytes,
      createdAt: now,
      lastAccessAt: now,
    };

    await persistTtsIndex();
    await maybeCleanupNativeTtsCache();

    console.log("[TTS] native cache SAVED", key, `${Math.round(sizeBytes / 1024)}KB`, ct);

    return { uri: finalUri, source: "network", contentType: ct, sizeBytes };
  } catch (e: any) {
    try {
      await FileSystem.deleteAsync(tmpUri, { idempotent: true });
    } catch {
      // ignore
    }
    console.log("[TTS] native cache ERROR", key, String(e?.message || e));
    throw e;
  }
}

async function getWebCachedTtsBlobUrl(key: string): Promise<TtsPlayableResult | null> {
  if (Platform.OS !== "web") return null;

  const cacheStorage = getCacheStorage();
  if (!cacheStorage) return null;

  const cache = await cacheStorage.open(TTS_CACHE_DIR_NAME);
  const req = new Request(`/__tts_cache__/tts/${key}.mp3`, { method: "GET" });
  const res = await cache.match(req);
  if (!res) return null;

  const ct = res.headers.get("content-type") || "";
  if (!isAudioContentType(ct)) {
    try {
      await cache.delete(req);
    } catch {
      // ignore
    }
    return null;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  console.log("[TTS] web cache HIT", key, `${Math.round(blob.size / 1024)}KB`, ct);

  return { uri: url, source: "cache", contentType: ct, sizeBytes: blob.size };
}

async function saveWebTtsToCacheAndGetBlobUrl(key: string, ttsUrl: string): Promise<TtsPlayableResult> {
  if (Platform.OS !== "web") return { uri: ttsUrl, source: "network" };

  const cacheStorage = getCacheStorage();
  const safeUrl = ttsUrl.replace(/text=[^&]*/i, "text=<omitted>");

  if (!cacheStorage) {
    console.log("[TTS] web cache disabled (CacheStorage missing) → network", key, safeUrl);
    return { uri: ttsUrl, source: "network" };
  }

  console.log("[TTS] web cache MISS → fetch", key, safeUrl);

  const cache = await cacheStorage.open(TTS_CACHE_DIR_NAME);
  const cacheReq = new Request(`/__tts_cache__/tts/${key}.mp3`, { method: "GET" });

  const res = await fetch(ttsUrl, { method: "GET" });
  const ct = res.headers.get("content-type") || "";

  if (!res.ok || !isAudioContentType(ct)) {
    throw new Error(`TTS fetch not audio: HTTP ${res.status}, content-type=${ct || "<none>"}`);
  }

  try {
    await cache.put(cacheReq, res.clone());
  } catch {
    // ignore
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  console.log("[TTS] web cache SAVED", key, `${Math.round(blob.size / 1024)}KB`, ct);

  return { uri: url, source: "network", contentType: ct, sizeBytes: blob.size };
}

export async function getPlayableTtsUriForText(text: string): Promise<TtsPlayableResult> {
  await ensureTtsCacheInit();

  const key = getTtsCacheKeyFromText(text);
  const ttsUrl = buildTtsUrl(text);

  if (!globalThis.__TTS_CACHE__) globalThis.__TTS_CACHE__ = {};
  const state = globalThis.__TTS_CACHE__;
  state.inflight = state.inflight || {};

  if (state.inflight[key]) return state.inflight[key];

  const promise = (async () => {
    const startedAt = nowMs();

    if (Platform.OS === "web") {
      const hit = await getWebCachedTtsBlobUrl(key);
      if (hit) {
        const ms = Math.round(nowMs() - startedAt);
        console.log(`[PERF] TTS playable uri ready in ${ms}ms (${hit.source})`);
        return hit;
      }
      const out = await saveWebTtsToCacheAndGetBlobUrl(key, ttsUrl);
      const ms = Math.round(nowMs() - startedAt);
      console.log(`[PERF] TTS playable uri ready in ${ms}ms (${out.source})`);
      return out;
    }

    const hit = await getNativeCachedTtsUri(key);
    if (hit) {
      const ms = Math.round(nowMs() - startedAt);
      console.log(`[PERF] TTS playable uri ready in ${ms}ms (${hit.source})`);
      return hit;
    }

    const out = await saveNativeTtsToCache(key, ttsUrl);
    const ms = Math.round(nowMs() - startedAt);
    console.log(`[PERF] TTS playable uri ready in ${ms}ms (${out.source})`);
    return out;
  })();

  state.inflight[key] = promise;

  try {
    const out = await promise;
    return out;
  } finally {
    delete state.inflight[key];
  }
}
