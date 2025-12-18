// FILE: /src/avatar/avatarPreload.ts

import { Asset } from "expo-asset";
import { useGLTF } from "@react-three/drei/native";

declare global {
  // eslint-disable-next-line no-var
  var __AVATAR_PRELOAD__:
    | {
        promise?: Promise<string>;
        uri?: string;
        last?: {
          startedAtMs: number;
          finishedAtMs: number;
          durationMs: number;
          reason: string;
          hadLocalBefore: boolean;
          hadDownloadedBefore: boolean;
          localUriAfter: string | null;
          uri: string;
        };
      }
    | undefined;
}

const AVATAR_ASSET = require("../../assets/avatar.glb");

function nowMs() {
  const p: any = (globalThis as any).performance;
  if (p && typeof p.now === "function") return p.now();
  return Date.now();
}

export async function ensureAvatarPreloaded(reason: string): Promise<string> {
  if (globalThis.__AVATAR_PRELOAD__?.uri) return globalThis.__AVATAR_PRELOAD__.uri;

  if (!globalThis.__AVATAR_PRELOAD__) {
    globalThis.__AVATAR_PRELOAD__ = {};
  }

  if (!globalThis.__AVATAR_PRELOAD__.promise) {
    globalThis.__AVATAR_PRELOAD__.promise = (async () => {
      const startedAtMs = nowMs();
      console.log(`[AVATAR] preload start (${reason})`);

      try {
        const asset = Asset.fromModule(AVATAR_ASSET);

        const hadLocalBefore = !!asset.localUri;
        const hadDownloadedBefore = (asset as any)?.downloaded === true;

        await asset.downloadAsync();

        const uri = asset.localUri || asset.uri;
        if (!uri) throw new Error("Failed to resolve avatar URI from Expo Asset.");

        const finishedAtMs = nowMs();
        const durationMs = Math.round(finishedAtMs - startedAtMs);

        globalThis.__AVATAR_PRELOAD__ = {
          ...(globalThis.__AVATAR_PRELOAD__ || {}),
          uri,
          last: {
            startedAtMs,
            finishedAtMs,
            durationMs,
            reason,
            hadLocalBefore,
            hadDownloadedBefore,
            localUriAfter: asset.localUri || null,
            uri,
          },
        };

        console.log(
          `[AVATAR] preload done in ${durationMs}ms (${hadLocalBefore || hadDownloadedBefore ? "cache-warm" : "cold"})`
        );

        try {
          (useGLTF as any).preload?.(uri);
          console.log("[AVATAR] useGLTF.preload ok");
        } catch (e: any) {
          console.log("[AVATAR] useGLTF.preload skip", String(e?.message || e));
        }

        return uri;
      } catch (e: any) {
        console.log("[AVATAR] preload ERROR", String(e?.message || e));
        if (globalThis.__AVATAR_PRELOAD__) {
          delete globalThis.__AVATAR_PRELOAD__.promise;
        }
        throw e;
      }
    })();
  }

  return globalThis.__AVATAR_PRELOAD__.promise!;
}
