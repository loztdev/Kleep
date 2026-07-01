/**
 * Provider API key storage via Expo SecureStore — keeps keys out of
 * plaintext storage (AsyncStorage, JS memory dumps) on-device.
 *
 * This is app-boot code, not engine code: the connect/settings screen
 * calls `saveApiKey` when the user enters a key, and `loadApiKey` /
 * `loadActiveProvider` to decide what to build on next launch.
 *
 * SecureStore has no web implementation — there's no browser equivalent
 * of a platform keychain, and calling it on web throws rather than
 * degrading (confirmed by hand: `getValueWithKeyAsync is not a function`).
 * Rather than fake persistence with `localStorage` (a real key sitting in
 * a place any XSS can read isn't "secure storage" — it'd just be a
 * misleading name), every function here is a no-op read/write on web:
 * the connect screen asks for a key every session there, which is the
 * honest behavior for what's a debug/testing target anyway — the real
 * distribution target is iOS/Android.
 *
 * `expo-secure-store` wraps a native module that doesn't exist outside an
 * Expo/React Native runtime, so this file is deliberately NOT re-exported
 * from `src/llm/index.ts` — importing it under plain Node (Jest) throws at
 * module-load time. Import it directly (`src/llm/secureKeyStore`) from
 * app code only.
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/** Which `LlmProvider` implementation a saved key belongs to. */
export type LlmProviderKind = "claude" | "openrouter";

const ACTIVE_PROVIDER_KEY = "kleep.llm_active_provider";
const IS_WEB = Platform.OS === "web";

function apiKeyStorageKey(provider: LlmProviderKind): string {
  return `kleep.llm_api_key.${provider}`;
}

/** Persist an API key for `provider` in the platform keychain/keystore. No-op on web — see module doc. */
export async function saveApiKey(provider: LlmProviderKind, apiKey: string): Promise<void> {
  if (IS_WEB) return;
  await SecureStore.setItemAsync(apiKeyStorageKey(provider), apiKey);
}

/** Read the stored API key for `provider`, or `null` if none has been saved (always `null` on web). */
export async function loadApiKey(provider: LlmProviderKind): Promise<string | null> {
  if (IS_WEB) return null;
  return SecureStore.getItemAsync(apiKeyStorageKey(provider));
}

/** Remove the stored API key for `provider`. No-op on web. */
export async function clearApiKey(provider: LlmProviderKind): Promise<void> {
  if (IS_WEB) return;
  await SecureStore.deleteItemAsync(apiKeyStorageKey(provider));
}

/** Remember which provider the user picked, so the app can reconnect to it automatically next launch. No-op on web. */
export async function saveActiveProvider(provider: LlmProviderKind): Promise<void> {
  if (IS_WEB) return;
  await SecureStore.setItemAsync(ACTIVE_PROVIDER_KEY, provider);
}

/** Read back the last-active provider, or `null` if none has been chosen yet (always `null` on web). */
export async function loadActiveProvider(): Promise<LlmProviderKind | null> {
  if (IS_WEB) return null;
  const value = await SecureStore.getItemAsync(ACTIVE_PROVIDER_KEY);
  return value === "claude" || value === "openrouter" ? value : null;
}
