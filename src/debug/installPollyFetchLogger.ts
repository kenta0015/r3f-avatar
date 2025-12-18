// FILE: src/debug/installPollyFetchLogger.ts

declare global {
  // eslint-disable-next-line no-var
  var __FETCH_LOGGER_INSTALLED__: boolean | undefined;
}

export function installPollyFetchLogger(): void {
  if (globalThis.__FETCH_LOGGER_INSTALLED__) return;
  globalThis.__FETCH_LOGGER_INSTALLED__ = true;

  if (typeof globalThis.fetch !== "function") return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  const POLLY_BASE = (process.env.EXPO_PUBLIC_POLLY_URL || "").trim();

  globalThis.fetch = async (input: any, init?: any) => {
    const method = (init?.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : input?.url ? input.url : String(input);

    const isPolly = POLLY_BASE ? url.startsWith(POLLY_BASE) : url.includes("lambda-url");
    if (!isPolly) return originalFetch(input, init);

    const safeUrl = url.replace(/text=[^&]*/i, "text=<omitted>");

    console.log("\n=== POLLY REQUEST ===");
    console.log("[POLLY]", method, safeUrl);

    try {
      const res = await originalFetch(input, init);
      console.log("[POLLY]", "status", res.status);
      console.log("[POLLY]", "content-type", res.headers.get("content-type"));
      console.log(
        "[POLLY]",
        "isBase64",
        res.headers.get("content-type")?.includes("audio/") ? "audio" : "non-audio"
      );
      console.log("=====================\n");
      return res;
    } catch (e: any) {
      console.log("[POLLY]", "ERROR", e?.message || String(e));
      console.log("=====================\n");
      throw e;
    }
  };
}
