import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { ChatScreen } from "./src/ui/ChatScreen";
import { ConnectScreen } from "./src/ui/ConnectScreen";
import { buildLlmProvider, type LlmProvider } from "./src/llm";
import { clearApiKey, loadActiveProvider, loadApiKey } from "./src/llm/secureKeyStore";

type AppState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "connected"; provider: LlmProvider };

export default function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kind = await loadActiveProvider();
        const apiKey = kind ? await loadApiKey(kind) : null;
        if (cancelled) return;
        if (kind && apiKey) {
          setState({ status: "connected", provider: buildLlmProvider({ kind, apiKey }) });
        } else {
          setState({ status: "disconnected" });
        }
      } catch (err) {
        console.error("Failed to load stored provider:", err);
        if (!cancelled) setState({ status: "disconnected" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDisconnect = useCallback(() => {
    setState((prev) => {
      if (prev.status === "connected") {
        // Fire-and-forget: the UI shouldn't wait on SecureStore to clear.
        loadActiveProvider()
          .then((kind) => kind && clearApiKey(kind))
          .catch((err) => console.warn("Failed to clear stored API key:", err));
      }
      return { status: "disconnected" };
    });
  }, []);

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#8e8e93" />
        <StatusBar style="light" />
      </View>
    );
  }

  if (state.status === "disconnected") {
    return (
      <View style={styles.flex}>
        <ConnectScreen onConnected={(provider) => setState({ status: "connected", provider })} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ChatScreen provider={state.provider} onDisconnect={handleDisconnect} />
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
});
