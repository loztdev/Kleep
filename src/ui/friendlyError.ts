/**
 * Low-level failures (a bare `fetch` rejection reads as "Failed to
 * fetch", a DNS/TLS error as something even less helpful) get a plain-
 * language message instead. Errors this app itself throws with a
 * specific, actionable message (e.g. "no model specified — pass
 * `model`...") are passed through as-is. Shared by `ChatScreen.tsx` and
 * `ModelPickerModal.tsx` — both hit the same class of network failure.
 */
export function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/fetch|network/i.test(raw)) {
    return "Couldn't reach the model provider. Check your connection and try again.";
  }
  return raw || "Something went wrong. Check your connection and try again.";
}
