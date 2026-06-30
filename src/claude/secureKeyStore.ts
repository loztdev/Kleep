/**
 * Tier 5.5 — Anthropic API key storage via Expo SecureStore.
 *
 * Keeps the key out of plaintext storage (AsyncStorage, JS memory dumps)
 * on-device. This is app-boot code, not engine code: the Settings screen
 * (Tier 7.3/9) calls `saveApiKey` when the user enters a key, and reads it
 * back with `loadApiKey` to construct a `ClaudeClient`.
 *
 * `expo-secure-store` wraps a native module that doesn't exist outside an
 * Expo/React Native runtime, so this file is deliberately NOT re-exported
 * from `src/claude/index.ts` — importing it under plain Node (Jest) throws
 * at module-load time. Import it directly (`src/claude/secureKeyStore`)
 * from app code only.
 */

import * as SecureStore from "expo-secure-store";

const API_KEY_STORAGE_KEY = "kleep.anthropic_api_key";

/** Persist the Anthropic API key in the platform keychain/keystore. */
export async function saveApiKey(apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, apiKey);
}

/** Read the stored Anthropic API key, or `null` if none has been saved. */
export async function loadApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY_STORAGE_KEY);
}

/** Remove the stored Anthropic API key. */
export async function clearApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
}
