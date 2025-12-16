// metro.config.js
// Expo SDK 54: extend Metro asset extensions so local .glb/.gltf files can be required/imported.
// After saving, restart Metro with cache clear:
//   npx expo start -c

const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

// Ensure GLB/GLTF are treated as assets (so require("./assets/avatar.glb") works)
const assetExts = config.resolver?.assetExts ?? [];
config.resolver = config.resolver || {};
config.resolver.assetExts = Array.from(new Set([...assetExts, "glb", "gltf"]));

module.exports = config;
