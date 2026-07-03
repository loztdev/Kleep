/**
 * First-run "connect a provider" screen — the minimum viable slice of
 * Tier 7.3's settings screen (API key entry only; disposition sliders and
 * the cost dashboard come later). Saves the key to SecureStore so this
 * only has to happen once per device.
 */

import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { buildLlmProvider, type LlmProvider, type LlmProviderKind } from "../llm";
import { saveActiveProvider, saveApiKey } from "../llm/secureKeyStore";
import type { PromptStore } from "../storage";
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
  ) => void;
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
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [promptPickerVisible, setPromptPickerVisible] = useState(false);

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
      const provider = buildLlmProvider({ kind, apiKey: trimmedKey, ...(trimmedModel ? { model: trimmedModel } : {}) });
      await saveApiKey(kind, trimmedKey);
      await saveActiveProvider(kind);
      onConnected(provider, kind, trimmedModel || undefined, trimmedSystemPrompt || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect — check the key and try again.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <View style={styles.container}>
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
          style={[styles.input, styles.modelInput]}
          placeholder="Default system prompt (optional)"
          placeholderTextColor={MUTED}
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          editable={!connecting}
        />
        <Pressable
          style={styles.browseButton}
          onPress={() => setPromptPickerVisible(true)}
          disabled={connecting}
          accessibilityRole="button"
          accessibilityLabel="Browse system prompts"
        >
          <Text style={styles.browseButtonText}>Browse</Text>
        </Pressable>
      </View>

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
        visible={promptPickerVisible}
        promptStore={promptStore}
        onSelect={setSystemPrompt}
        onClose={() => setPromptPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
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
