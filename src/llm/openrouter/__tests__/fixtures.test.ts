import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FixtureNotFoundError, FixtureTransport } from "../fixtures";
import type { OpenRouterRequest, OpenRouterResponse, OpenRouterTransport, OpenRouterMessageStream } from "../types";

function request(content: string): OpenRouterRequest {
  return { model: "openai/gpt-4o-mini", messages: [{ role: "user", content }] };
}

function reply(text: string): OpenRouterResponse {
  return {
    id: "gen_fixture",
    model: "openai/gpt-4o-mini",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.00002 },
  };
}

class CountingTransport implements OpenRouterTransport {
  calls = 0;
  constructor(private readonly response: OpenRouterResponse) {}
  async send(): Promise<OpenRouterResponse> {
    this.calls++;
    return this.response;
  }
  stream(): OpenRouterMessageStream {
    throw new Error("unused");
  }
}

describe("OpenRouter FixtureTransport", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kleep-openrouter-fixtures-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replay mode throws FixtureNotFoundError when nothing has been recorded", async () => {
    const transport = new FixtureTransport({ dir });
    await expect(transport.send(request("hello"))).rejects.toThrow(FixtureNotFoundError);
  });

  it("record mode calls through and persists a fixture; replay mode then reads it without calling through", async () => {
    const real = new CountingTransport(reply("recorded answer"));
    const recorder = new FixtureTransport({ dir, mode: "record", recordTransport: real });

    await recorder.send(request("hello"));
    expect(real.calls).toBe(1);

    const replayer = new FixtureTransport({ dir, mode: "replay" });
    const replayed = await replayer.send(request("hello"));
    expect(replayed.choices[0]?.message.content).toBe("recorded answer");
    expect(real.calls).toBe(1);
  });

  it("keys fixtures by request content — a different prompt misses", async () => {
    const real = new CountingTransport(reply("answer"));
    const recorder = new FixtureTransport({ dir, mode: "record", recordTransport: real });
    await recorder.send(request("prompt A"));

    const replayer = new FixtureTransport({ dir, mode: "replay" });
    await expect(replayer.send(request("prompt B"))).rejects.toThrow(FixtureNotFoundError);
  });

  it("stream() calls the underlying transport exactly once for both the iterator and finalMessage()", async () => {
    const real = new CountingTransport(reply("streamed text"));
    const recordingStream = new FixtureTransport({ dir, mode: "record", recordTransport: real });

    const stream = recordingStream.stream(request("hi"));
    const chunks: string[] = [];
    for await (const event of stream) {
      const content = event.choices[0]?.delta.content;
      if (content) chunks.push(content);
    }
    const final = await stream.finalMessage();

    expect(chunks.join("")).toBe("streamed text");
    expect(final.choices[0]?.message.content).toBe("streamed text");
    expect(real.calls).toBe(1);
  });
});
