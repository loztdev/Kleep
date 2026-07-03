/**
 * RealOpenRouterTransport — talks to the real OpenRouter API over `fetch`.
 *
 * No official OpenRouter SDK exists (their own docs recommend either the
 * `openai` package pointed at a custom `baseURL`, or raw HTTP) — `fetch` is
 * global in both Node and React Native, so this avoids an extra dependency
 * for what is, structurally, an OpenAI-compatible Chat Completions POST.
 *
 * Streaming drives the underlying SSE response exactly once and shares
 * that single pass between the async iterator and `finalMessage()` — the
 * Claude client's `FixtureTransport` originally got this wrong by letting
 * each side make its own independent call; this applies that lesson from
 * the start instead of repeating it.
 */

import type {
  OpenRouterMessageStream,
  OpenRouterRequest,
  OpenRouterRequestOptions,
  OpenRouterResponse,
  OpenRouterStreamChunk,
  OpenRouterTransport,
  OpenRouterUsage,
} from "./types";
import { OpenRouterApiError } from "./types";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Default per-request timeout. `send()` treats this as a hard deadline;
 * `stream()` treats it as an idle timeout (reset on every byte received)
 * so a long-but-active stream isn't killed just for taking a while.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Construction options for `RealOpenRouterTransport`. */
export interface RealOpenRouterTransportOptions {
  /** OpenRouter API key (`sk-or-...`). */
  apiKey: string;
  /** Override the API host. Defaults to `https://openrouter.ai/api/v1`. */
  baseURL?: string;
  /** Optional `HTTP-Referer` header — OpenRouter uses this for its public leaderboard attribution. */
  httpReferer?: string;
  /** Optional `X-Title` header — same purpose as `httpReferer`. */
  appTitle?: string;
  /** Request timeout in ms — a hard deadline for `send()`, an idle timeout for `stream()`. Default 60s. */
  timeoutMs?: number;
}

/** Production `OpenRouterTransport` — talks to the real OpenRouter API. */
export class RealOpenRouterTransport implements OpenRouterTransport {
  private readonly timeoutMs: number;

  constructor(private readonly opts: RealOpenRouterTransportOptions) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(request: OpenRouterRequest, opts?: OpenRouterRequestOptions): Promise<OpenRouterResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url(), {
        method: "POST",
        headers: this.headers(opts),
        body: JSON.stringify({ ...request, stream: false, usage: { include: true } }),
        signal: controller.signal,
      });
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as OpenRouterResponse;
    } catch (err) {
      throw toTimeoutError(err, this.timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  stream(request: OpenRouterRequest, opts?: OpenRouterRequestOptions): OpenRouterMessageStream {
    const url = this.url();
    const headers = this.headers(opts);
    const body = JSON.stringify({ ...request, stream: true, usage: { include: true } });
    const timeoutMs = this.timeoutMs;
    const controller = new AbortController();

    const queue: OpenRouterStreamChunk[] = [];
    let waiters: Array<() => void> = [];
    let finished = false;
    let hasFailure = false;
    let failureError: unknown;
    const acc = { id: "", model: request.model, content: "", finishReason: null as string | null, usage: undefined as OpenRouterUsage | undefined };

    const wake = (): void => {
      const w = waiters;
      waiters = [];
      w.forEach((resolve) => resolve());
    };

    (async () => {
      // Idle timeout, not a hard deadline: reset on every read so a slow-but-
      // active stream isn't killed, but a connection that stops sending
      // anything (server hang, dropped connection) gets aborted instead of
      // leaving the caller waiting forever.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const resetIdleTimer = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), timeoutMs);
      };
      try {
        resetIdleTimer();
        const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
        if (!res.ok) throw await toApiError(res);
        if (!res.body) throw new Error("OpenRouter streaming response had no body");
        for await (const chunk of parseSse(res.body, resetIdleTimer)) {
          acc.id = chunk.id || acc.id;
          acc.model = chunk.model || acc.model;
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) acc.content += delta.content;
          const finishReason = chunk.choices[0]?.finish_reason;
          if (finishReason) acc.finishReason = finishReason;
          if (chunk.usage) acc.usage = chunk.usage;
          queue.push(chunk);
          wake();
        }
      } catch (err) {
        hasFailure = true;
        failureError = toTimeoutError(err, timeoutMs);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        finished = true;
        wake();
      }
    })();

    async function* iterate(): AsyncGenerator<OpenRouterStreamChunk, void, void> {
      let i = 0;
      for (;;) {
        while (i < queue.length) yield queue[i++]!;
        if (finished) {
          if (hasFailure) throw failureError;
          return;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    }

    const final = (async (): Promise<OpenRouterResponse> => {
      while (!finished) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (hasFailure) throw failureError;
      return {
        id: acc.id,
        model: acc.model,
        choices: [{ index: 0, message: { role: "assistant", content: acc.content }, finish_reason: acc.finishReason }],
        ...(acc.usage ? { usage: acc.usage } : {}),
      };
    })();
    // `final` is created eagerly (not lazily inside finalMessage()), so a
    // caller who only consumes the async iterator — never calling
    // finalMessage() — would otherwise leave this rejection unhandled and
    // crash the process. Real consumption still happens through whichever
    // of `finalMessage()` / the iterator the caller actually uses.
    final.catch(() => undefined);

    return {
      [Symbol.asyncIterator]: () => iterate()[Symbol.asyncIterator](),
      finalMessage: () => final,
    };
  }

  private url(): string {
    return `${this.opts.baseURL ?? DEFAULT_BASE_URL}/chat/completions`;
  }

  private headers(opts?: OpenRouterRequestOptions): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.apiKey}`,
      "Content-Type": "application/json",
      ...(this.opts.httpReferer ? { "HTTP-Referer": this.opts.httpReferer } : {}),
      ...(this.opts.appTitle ? { "X-Title": this.opts.appTitle } : {}),
      ...(opts?.responseCacheTtlSeconds !== undefined
        ? { "X-OpenRouter-Cache": "true", "X-OpenRouter-Cache-TTL": String(opts.responseCacheTtlSeconds) }
        : {}),
    };
  }
}

async function toApiError(res: Response): Promise<OpenRouterApiError> {
  let message = `OpenRouter API error: HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Non-JSON error body — fall back to the generic message.
  }
  return new OpenRouterApiError(res.status, message);
}

/** Turn a `fetch` abort (from our own timeout, not a caller-supplied signal) into a clear, actionable error. */
function toTimeoutError(err: unknown, timeoutMs: number): unknown {
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
  }
  return err;
}

/**
 * Parse a `text/event-stream` body into `OpenRouterStreamChunk`s. SSE
 * events are separated by a blank line; lines starting with `:` are
 * heartbeat comments (OpenRouter sends `: OPENROUTER PROCESSING`) and are
 * ignored, as is the terminal `data: [DONE]` sentinel.
 *
 * `onActivity` fires on every raw read (not just parsed events) so a
 * caller can reset an idle timer on any byte received, not only on
 * complete SSE events.
 */
async function* parseSse(
  body: ReadableStream<Uint8Array>,
  onActivity?: () => void,
): AsyncGenerator<OpenRouterStreamChunk, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      onActivity?.();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const chunk = parseSseEvent(rawEvent);
        if (chunk) yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseEvent(rawEvent: string): OpenRouterStreamChunk | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;
  const data = dataLines.join("");
  if (data === "[DONE]") return null;
  return JSON.parse(data) as OpenRouterStreamChunk;
}
