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

interface ConnectScreenProps {
  onConnected: (provider: LlmProvider) => void;
}

const PROVIDERS: Array<{ kind: LlmProviderKind; label: string; keyHint: string }> = [
  { kind: "openrouter", label: "OpenRouter", keyHint: "sk-or-..." },
  { kind: "claude", label: "Claude (Anthropic)", keyHint: "sk-ant-..." },
];

export function ConnectScreen({ onConnected }: ConnectScreenProps) {
  const [kind, setKind] = useState<LlmProviderKind>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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
      const provider = buildLlmProvider({ kind, apiKey: trimmedKey, ...(trimmedModel ? { model: trimmedModel } : {}) });
      await saveApiKey(kind, trimmedKey);
      await saveActiveProvider(kind);
      onConnected(provider);
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
        placeholderTextColor="#8e8e93"
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        editable={!connecting}
      />
      <TextInput
        style={styles.input}
        placeholder="Model override (optional)"
        placeholderTextColor="#8e8e93"
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!connecting}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.connectButton} onPress={handleConnect} disabled={connecting}>
        {connecting ? <ActivityIndicator color="#fff" /> : <Text style={styles.connectButtonText}>Connect</Text>}
      </Pressable>
    </View>
  );
}

const BG = "#000000";
const SURFACE = "#1c1c1e";
const BORDER = "#2c2c2e";
const TEXT = "#ececec";
const MUTED = "#8e8e93";
const ACCENT = "#2563eb";

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
  error: {
    color: "#ff453a",
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
