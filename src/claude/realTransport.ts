/**
 * RealTransport — wraps `@anthropic-ai/sdk` for production use.
 *
 * `maxRetries: 0` on the underlying SDK client is deliberate: `ClaudeClient`
 * owns retry/jitter itself (see `retry.ts`) so behavior is the same whether
 * a request goes through `RealTransport` or `FixtureTransport` in tests.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "./types";

/** Construction options for `RealTransport`. */
export interface RealTransportOptions {
  /** Anthropic API key. Loading it from SecureStore is the caller's job — see `src/llm/secureKeyStore.ts`. */
  apiKey: string;
  /** Override the API host, e.g. for a proxy. */
  baseURL?: string;
}

/** Production `ClaudeTransport` — talks to the real Anthropic API. */
export class RealTransport implements ClaudeTransport {
  private readonly sdk: Anthropic;

  constructor(opts: RealTransportOptions) {
    this.sdk = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: 0,
    });
  }

  send(request: ClaudeRequest): Promise<Anthropic.Message> {
    return this.sdk.messages.create({ ...request, stream: false });
  }

  stream(request: ClaudeRequest): ClaudeMessageStream {
    return this.sdk.messages.stream(request);
  }
}
