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
  OpenRouterResponse,
  OpenRouterStreamChunk,
  OpenRouterTransport,
  OpenRouterUsage,
} from "./types";
import { OpenRouterApiError } from "./types";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

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
}

/** Production `OpenRouterTransport` — talks to the real OpenRouter API. */
export class RealOpenRouterTransport implements OpenRouterTransport {
  constructor(private readonly opts: RealOpenRouterTransportOptions) {}

  async send(request: OpenRouterRequest): Promise<OpenRouterResponse> {
    const res = await fetch(this.url(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ...request, stream: false, usage: { include: true } }),
    });
    if (!res.ok) throw await toApiError(res);
    return (await res.json()) as OpenRouterResponse;
  }

  stream(request: OpenRouterRequest): OpenRouterMessageStream {
    const url = this.url();
    const headers = this.headers();
    const body = JSON.stringify({ ...request, stream: true, usage: { include: true } });

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
      try {
        const res = await fetch(url, { method: "POST", headers, body });
        if (!res.ok) throw await toApiError(res);
        if (!res.body) throw new Error("OpenRouter streaming response had no body");
        for await (const chunk of parseSse(res.body)) {
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
        failureError = err;
      } finally {
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

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.apiKey}`,
      "Content-Type": "application/json",
      ...(this.opts.httpReferer ? { "HTTP-Referer": this.opts.httpReferer } : {}),
      ...(this.opts.appTitle ? { "X-Title": this.opts.appTitle } : {}),
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

/**
 * Parse a `text/event-stream` body into `OpenRouterStreamChunk`s. SSE
 * events are separated by a blank line; lines starting with `:` are
 * heartbeat comments (OpenRouter sends `: OPENROUTER PROCESSING`) and are
 * ignored, as is the terminal `data: [DONE]` sentinel.
 */
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<OpenRouterStreamChunk, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
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
