import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { FixtureNotFoundError, FixtureTransport } from "../fixtures";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "../types";

function request(content: string): ClaudeRequest {
  return {
    model: "claude-opus-4-8",
    max_tokens: 256,
    messages: [{ role: "user", content }],
  };
}

function reply(text: string): Anthropic.Message {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message;
}

class CountingTransport implements ClaudeTransport {
  calls = 0;
  constructor(private readonly response: Anthropic.Message) {}
  async send(): Promise<Anthropic.Message> {
    this.calls++;
    return this.response;
  }
  stream(): ClaudeMessageStream {
    throw new Error("unused");
  }
}

describe("FixtureTransport", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kleep-claude-fixtures-"));
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

    const recorded = await recorder.send(request("hello"));
    expect(recorded.content[0]).toMatchObject({ text: "recorded answer" });
    expect(real.calls).toBe(1);
    expect(fs.readdirSync(dir)).toHaveLength(1);

    const replayer = new FixtureTransport({ dir, mode: "replay" });
    const replayed = await replayer.send(request("hello"));
    expect(replayed.content[0]).toMatchObject({ text: "recorded answer" });
    // Still only ever hit the real transport once.
    expect(real.calls).toBe(1);
  });

  it("keys fixtures by request content — a different prompt misses", async () => {
    const real = new CountingTransport(reply("answer"));
    const recorder = new FixtureTransport({ dir, mode: "record", recordTransport: real });
    await recorder.send(request("prompt A"));

    const replayer = new FixtureTransport({ dir, mode: "replay" });
    await expect(replayer.send(request("prompt B"))).rejects.toThrow(FixtureNotFoundError);
  });

  it("stream() replays the recorded text as a single chunk and resolves finalMessage", async () => {
    const real = new CountingTransport(reply("streamed text"));
    const recorder = new FixtureTransport({ dir, mode: "record", recordTransport: real });
    await recorder.send(request("hi"));

    const replayer = new FixtureTransport({ dir, mode: "replay" });
    const stream = replayer.stream(request("hi"));

    const chunks: string[] = [];
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        chunks.push(event.delta.text);
      }
    }
    const final = await stream.finalMessage();

    expect(chunks.join("")).toBe("streamed text");
    expect(final.content[0]).toMatchObject({ text: "streamed text" });
  });

  it("stream() calls the underlying transport exactly once even when both the iterator and finalMessage() are consumed", async () => {
    // Regression: stream() used to call transport.send() once from the
    // chunk iterator and again from finalMessage() — in record mode that
    // meant two real API calls (and two fixture-file writes) per logical
    // streamed request.
    const real = new CountingTransport(reply("only once, please"));
    const recordingStream = new FixtureTransport({ dir, mode: "record", recordTransport: real });

    const stream = recordingStream.stream(request("hi"));
    for await (const _event of stream) {
      // drain
    }
    await stream.finalMessage();

    expect(real.calls).toBe(1);
  });
});
