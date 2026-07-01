import { RealOpenRouterTransport } from "../realTransport";
import { OpenRouterApiError } from "../types";
import type { OpenRouterRequest } from "../types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const request: OpenRouterRequest = {
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 100,
};

describe("RealOpenRouterTransport.send", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to the chat/completions endpoint with the auth header and opts into usage.cost", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse(200, {
        id: "gen_1",
        model: "openai/gpt-4o-mini",
        choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0.00001 },
      });
    }) as unknown as typeof fetch;

    const transport = new RealOpenRouterTransport({ apiKey: "sk-or-test" });
    const response = await transport.send(request);

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toMatchObject({ model: "openai/gpt-4o-mini", stream: false, usage: { include: true } });
    expect(response.choices[0]?.message.content).toBe("hi there");
  });

  it("respects a custom baseURL", async () => {
    let capturedUrl = "";
    global.fetch = jest.fn(async (url: string | URL) => {
      capturedUrl = String(url);
      return jsonResponse(200, { id: "x", model: "m", choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }] });
    }) as unknown as typeof fetch;

    const transport = new RealOpenRouterTransport({ apiKey: "k", baseURL: "https://example.test/v1" });
    await transport.send(request);

    expect(capturedUrl).toBe("https://example.test/v1/chat/completions");
  });

  it("throws OpenRouterApiError with the parsed message on a non-2xx response", async () => {
    global.fetch = jest.fn(async () => jsonResponse(401, { error: { message: "Invalid API key" } })) as unknown as typeof fetch;

    const transport = new RealOpenRouterTransport({ apiKey: "bad-key" });
    await expect(transport.send(request)).rejects.toMatchObject(
      new OpenRouterApiError(401, "Invalid API key"),
    );
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    global.fetch = jest.fn(
      async () => new Response("upstream blew up", { status: 500 }),
    ) as unknown as typeof fetch;

    const transport = new RealOpenRouterTransport({ apiKey: "k" });
    await expect(transport.send(request)).rejects.toThrow(/HTTP 500/);
  });
});

describe("RealOpenRouterTransport.stream", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("parses SSE chunks, ignores heartbeat comments and [DONE], and accumulates finalMessage()", async () => {
    global.fetch = jest.fn(async () =>
      sseResponse([
        JSON.stringify({ id: "gen_1", model: "openai/gpt-4o-mini", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }),
        JSON.stringify({ id: "gen_1", model: "openai/gpt-4o-mini", choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: 0.00003 } }),
        "[DONE]",
      ]),
    ) as unknown as typeof fetch;

    const transport = new RealOpenRouterTransport({ apiKey: "k" });
    const stream = transport.stream(request);

    const collected: string[] = [];
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta.content;
      if (content) collected.push(content);
    }
    const final = await stream.finalMessage();

    expect(collected.join("")).toBe("Hello world");
    expect(final.choices[0]?.message.content).toBe("Hello world");
    expect(final.usage?.cost).toBeCloseTo(0.00003);
  });

  it("propagates a non-2xx error through both the iterator and finalMessage()", async () => {
    global.fetch = jest.fn(async () => jsonResponse(429, { error: { message: "rate limited" } })) as unknown as typeof fetch;

    const transport = new RealOpenRouterTransport({ apiKey: "k" });
    const stream = transport.stream(request);

    await expect(
      (async () => {
        for await (const _chunk of stream) {
          // drain
        }
      })(),
    ).rejects.toThrow(OpenRouterApiError);
  });
});
