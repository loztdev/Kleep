/**
 * First-run "connect a provider" screen — the minimum viable slice of
 * Tier 7.3's settings screen (API key entry only; disposition sliders and
 * the cost dashboard come later). Saves the key to SecureStore so this
 * only has to happen once per device.
 */

import Slider from "@react-native-community/slider";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { buildLlmProvider, type LlmProvider, type LlmProviderKind } from "../llm";
import { saveActiveProvider, saveApiKey } from "../llm/secureKeyStore";
import type { PromptStore, SavedPromptKind } from "../storage";
import type { CacheSettings } from "./chatReply";
import { ModelPickerModal } from "./ModelPickerModal";
import { PromptPickerModal } from "./PromptPickerModal";
import { ACCENT, BG, BORDER, ERROR, MUTED, SURFACE, TEXT } from "./theme";

interface ConnectScreenProps {
  promptStore: PromptStore;
  onConnected: (
    provider: LlmProvider,
    kind: LlmProviderKind,
    model?: string,
    defaultSystemPrompt?: string,
    cacheSettings?: CacheSettings,
    defaultJailbreakPrompt?: string,
  ) => void;
}

const CACHE_TTL_OPTIONS: Array<{ value: "5m" | "1h"; label: string }> = [
  { value: "5m", label: "5 minutes" },
  { value: "1h", label: "1 hour" },
];

const MIN_RESPONSE_CACHE_SECONDS = 1;
const MAX_RESPONSE_CACHE_SECONDS = 86400; // OpenRouter's own limit — see X-OpenRouter-Cache-TTL docs.
const DEFAULT_RESPONSE_CACHE_SECONDS = 300;

/** Formats a seconds count the way a human would say it — "45s", "5m", "2h 30m", "1d". */
function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

const PROVIDERS: Array<{ kind: LlmProviderKind; label: string; keyHint: string }> = [
  { kind: "openrouter", label: "OpenRouter", keyHint: "sk-or-..." },
  { kind: "claude", label: "Claude (Anthropic)", keyHint: "sk-ant-..." },
];

export function ConnectScreen({ promptStore, onConnected }: ConnectScreenProps) {
  const [kind, setKind] = useState<LlmProviderKind>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [jailbreakPrompt, setJailbreakPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  // Same modal instance, one kind at a time — persona icon opens it in
  // `persona` mode, jailbreak icon in `jailbreak` mode. `null` hides it.
  const [promptPickerKind, setPromptPickerKind] = useState<SavedPromptKind | null>(null);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [cacheTtl, setCacheTtl] = useState<"5m" | "1h">("5m");
  const [responseCacheEnabled, setResponseCacheEnabled] = useState(false);
  const [responseCacheSeconds, setResponseCacheSeconds] = useState(DEFAULT_RESPONSE_CACHE_SECONDS);

  const handleConnect = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setError("Enter an API key first.");
      return;
    }
    setError(null);
    setConnecting(true);
    try {
      const trimmedModel = model.trim();
      const trimmedSystemPrompt = systemPrompt.trim();
      const trimmedJailbreakPrompt = jailbreakPrompt.trim();
      const provider = buildLlmProvider({ kind, apiKey: trimmedKey, ...(trimmedModel ? { model: trimmedModel } : {}) });
      await saveApiKey(kind, trimmedKey);
      await saveActiveProvider(kind);
      const cacheSettings: CacheSettings = {
        enabled: cacheEnabled,
        ttl: cacheTtl,
        // Response caching is an OpenRouter-only feature — see CacheSettings' doc.
        ...(kind === "openrouter" && responseCacheEnabled ? { responseCacheTtlSeconds: responseCacheSeconds } : {}),
      };
      onConnected(
        provider,
        kind,
        trimmedModel || undefined,
        trimmedSystemPrompt || undefined,
        cacheSettings,
        trimmedJailbreakPrompt || undefined,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect — check the key and try again.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Connect Kleep</Text>
        <Text style={styles.subtitle}>Pick a provider and paste an API key to start chatting.</Text>

        <View style={styles.providerRow}>
          {PROVIDERS.map((p) => (
            <Pressable
              key={p.kind}
              onPress={() => setKind(p.kind)}
              disabled={connecting}
              style={[styles.providerButton, kind === p.kind && styles.providerButtonActive]}
            >
              <Text style={[styles.providerButtonText, kind === p.kind && styles.providerButtonTextActive]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder={PROVIDERS.find((p) => p.kind === kind)?.keyHint}
          placeholderTextColor={MUTED}
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!connecting}
        />
        <View style={styles.modelRow}>
          <TextInput
            style={[styles.input, styles.modelInput]}
            placeholder="Model override (optional)"
            placeholderTextColor={MUTED}
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!connecting}
          />
          <Pressable
            style={styles.browseButton}
            onPress={() => setPickerVisible(true)}
            disabled={connecting}
            accessibilityRole="button"
            accessibilityLabel="Browse models"
          >
            <Text style={styles.browseButtonText}>Browse</Text>
          </Pressable>
        </View>

        <View style={styles.modelRow}>
          <TextInput
            style={[styles.input, styles.modelInput, styles.systemPromptInput]}
            placeholder="Default system prompt (optional)"
            placeholderTextColor={MUTED}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
            editable={!connecting}
          />
          <Pressable
            style={styles.browseButton}
            onPress={() => setPromptPickerKind("persona")}
            disabled={connecting}
            accessibilityRole="button"
            accessibilityLabel="Browse system prompts"
          >
            <Text style={styles.browseButtonText}>Browse</Text>
          </Pressable>
        </View>

        <View style={styles.modelRow}>
          <TextInput
            style={[styles.input, styles.modelInput, styles.systemPromptInput]}
            placeholder="Default jailbreak prompt (optional, prepended before persona)"
            placeholderTextColor={MUTED}
            value={jailbreakPrompt}
            onChangeText={setJailbreakPrompt}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
            editable={!connecting}
          />
          <Pressable
            style={styles.browseButton}
            onPress={() => setPromptPickerKind("jailbreak")}
            disabled={connecting}
            accessibilityRole="button"
            accessibilityLabel="Browse jailbreak prompts"
          >
            <Text style={styles.browseButtonText}>Browse</Text>
          </Pressable>
        </View>

        <View style={styles.cacheSection}>
          <View style={styles.cacheRow}>
            <View style={styles.cacheLabelGroup}>
              <Text style={styles.cacheLabel}>Prompt caching</Text>
              <Text style={styles.cacheHint}>
                Reuses the provider's cache of earlier turns instead of reprocessing them — cheaper, faster replies
                as a chat grows.
              </Text>
            </View>
            <Switch value={cacheEnabled} onValueChange={setCacheEnabled} disabled={connecting} />
          </View>
          {cacheEnabled ? (
            <View style={styles.ttlRow}>
              {CACHE_TTL_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setCacheTtl(opt.value)}
                  disabled={connecting}
                  style={[styles.ttlButton, cacheTtl === opt.value && styles.ttlButtonActive]}
                >
                  <Text style={[styles.ttlButtonText, cacheTtl === opt.value && styles.ttlButtonTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {kind === "openrouter" ? (
          <View style={styles.cacheSection}>
            <View style={styles.cacheRow}>
              <View style={styles.cacheLabelGroup}>
                <Text style={styles.cacheLabel}>Response caching</Text>
                <Text style={styles.cacheHint}>
                  OpenRouter-only: reuses the exact same response if you send the exact same request again (e.g. an
                  accidental double regenerate). Won't help normal back-and-forth, since every turn's request
                  differs.
                </Text>
              </View>
              <Switch value={responseCacheEnabled} onValueChange={setResponseCacheEnabled} disabled={connecting} />
            </View>
            {responseCacheEnabled ? (
              <View style={styles.sliderRow}>
                <Slider
                  style={styles.slider}
                  minimumValue={MIN_RESPONSE_CACHE_SECONDS}
                  maximumValue={MAX_RESPONSE_CACHE_SECONDS}
                  step={1}
                  value={responseCacheSeconds}
                  onValueChange={setResponseCacheSeconds}
                  disabled={connecting}
                  minimumTrackTintColor={ACCENT}
                />
                <Text style={styles.sliderValue}>{formatDuration(responseCacheSeconds)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.connectButton} onPress={handleConnect} disabled={connecting}>
          {connecting ? <ActivityIndicator color="#fff" /> : <Text style={styles.connectButtonText}>Connect</Text>}
        </Pressable>

        <ModelPickerModal
          visible={pickerVisible}
          kind={kind}
          apiKey={apiKey}
          onSelect={setModel}
          onClose={() => setPickerVisible(false)}
        />
        <PromptPickerModal
          visible={promptPickerKind !== null}
          kind={promptPickerKind ?? "persona"}
          promptStore={promptStore}
          onSelect={promptPickerKind === "jailbreak" ? setJailbreakPrompt : setSystemPrompt}
          onClose={() => setPromptPickerKind(null)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: TEXT,
  },
  subtitle: {
    fontSize: 14,
    color: MUTED,
    marginBottom: 12,
  },
  providerRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  providerButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  providerButtonActive: {
    borderColor: ACCENT,
    backgroundColor: "#132038",
  },
  providerButtonText: {
    color: MUTED,
    fontWeight: "600",
  },
  providerButtonTextActive: {
    color: "#7ea6f5",
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT,
  },
  modelRow: {
    flexDirection: "row",
    gap: 8,
  },
  modelInput: {
    flex: 1,
  },
  systemPromptInput: {
    maxHeight: 100,
  },
  browseButton: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  browseButtonText: {
    color: TEXT,
    fontWeight: "600",
  },
  cacheSection: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  cacheRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cacheLabelGroup: {
    flex: 1,
    gap: 2,
  },
  cacheLabel: {
    color: TEXT,
    fontWeight: "600",
    fontSize: 15,
  },
  cacheHint: {
    color: MUTED,
    fontSize: 12,
  },
  ttlRow: {
    flexDirection: "row",
    gap: 8,
  },
  ttlButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  ttlButtonActive: {
    borderColor: ACCENT,
    backgroundColor: "#132038",
  },
  ttlButtonText: {
    color: MUTED,
    fontWeight: "600",
    fontSize: 13,
  },
  ttlButtonTextActive: {
    color: "#7ea6f5",
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  slider: {
    flex: 1,
  },
  sliderValue: {
    color: TEXT,
    fontWeight: "600",
    fontSize: 13,
    minWidth: 56,
    textAlign: "right",
  },
  error: {
    color: ERROR,
  },
  connectButton: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  connectButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
});
