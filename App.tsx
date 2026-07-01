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
      const kind = await loadActiveProvider();
      const apiKey = kind ? await loadApiKey(kind) : null;
      if (cancelled) return;
      if (kind && apiKey) {
        setState({ status: "connected", provider: buildLlmProvider({ kind, apiKey }) });
      } else {
        setState({ status: "disconnected" });
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
        loadActiveProvider().then((kind) => kind && clearApiKey(kind));
      }
      return { status: "disconnected" };
    });
  }, []);

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (state.status === "disconnected") {
    return (
      <View style={styles.flex}>
        <ConnectScreen onConnected={(provider) => setState({ status: "connected", provider })} />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ChatScreen provider={state.provider} onDisconnect={handleDisconnect} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
