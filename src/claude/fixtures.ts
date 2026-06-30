/**
 * Tier 5.5 — fixture record/replay harness for `ClaudeClient` tests.
 *
 * `FixtureTransport` is a `ClaudeTransport` that reads/writes JSON files
 * under a directory instead of talking to the network. In "replay" mode
 * (the default, used by the test suite) it throws `FixtureNotFoundError`
 * for any request it doesn't have a recording for — tests stay fully
 * deterministic and never depend on a live API key. In "record" mode it
 * wraps a real transport, saves what comes back, and is meant to be run
 * once by hand against a real key to (re)generate fixtures.
 *
 * This module uses Node's `fs`/`path`, so it's test/tooling-only — it is
 * deliberately not re-exported from `src/claude/index.ts`, which is the
 * barrel the app (and Metro) sees.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { fnv1aHash } from "../util/hash";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "./types";

/** "replay" (default) reads recorded fixtures; "record" calls a real transport and saves the result. */
export type FixtureMode = "replay" | "record";

/** Construction options for `FixtureTransport`. */
export interface FixtureTransportOptions {
  /** Directory containing one `<key>.json` file per recorded request. */
  dir: string;
  /** Defaults to `"replay"`. */
  mode?: FixtureMode;
  /** Required when `mode === "record"` — the transport whose responses get recorded. */
  recordTransport?: ClaudeTransport;
}

interface FixtureFile {
  request: ClaudeRequest;
  response: Anthropic.Message;
}

/** Thrown in replay mode when no fixture file matches the request. */
export class FixtureNotFoundError extends Error {
  constructor(
    public readonly key: string,
    public readonly file: string,
  ) {
    super(`no fixture recorded for request (key=${key}, expected file=${file})`);
    this.name = "FixtureNotFoundError";
  }
}

/** `ClaudeTransport` backed by on-disk JSON fixtures — deterministic replay or one-shot recording. */
export class FixtureTransport implements ClaudeTransport {
  private readonly mode: FixtureMode;

  constructor(private readonly opts: FixtureTransportOptions) {
    this.mode = opts.mode ?? "replay";
  }

  async send(request: ClaudeRequest): Promise<Anthropic.Message> {
    const key = fixtureKey(request);
    const file = fixturePath(this.opts.dir, key);

    if (this.mode === "record") {
      if (!this.opts.recordTransport) {
        throw new Error("FixtureTransport in record mode requires `recordTransport`");
      }
      const response = await this.opts.recordTransport.send(request);
      writeFixture(file, { request, response });
      return response;
    }

    const fixture = readFixture(file);
    if (!fixture) throw new FixtureNotFoundError(key, file);
    return fixture.response;
  }

  stream(request: ClaudeRequest): ClaudeMessageStream {
    const transport = this;
    // Both the chunk iterator and finalMessage() resolve from this single
    // cached call, so a consumer that does both (the normal pattern — see
    // ClaudeClient.streamMessage) only ever triggers one `send()`: one real
    // API call in record mode, one fixture read in replay mode.
    let cached: Promise<Anthropic.Message> | null = null;
    const getMessage = (): Promise<Anthropic.Message> => {
      cached ??= transport.send(request);
      return cached;
    };

    async function* iterate(): AsyncGenerator<Anthropic.MessageStreamEvent, void, void> {
      const message = await getMessage();
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text) {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        } as Anthropic.MessageStreamEvent;
      }
    }

    return {
      [Symbol.asyncIterator]: () => iterate()[Symbol.asyncIterator](),
      finalMessage: getMessage,
    };
  }
}

/** Deterministic content hash of the request shape — same logical request always maps to the same fixture file. */
function fixtureKey(request: ClaudeRequest): string {
  return fnv1aHash(stableStringify(request)).toString(16).padStart(8, "0");
}

/** `JSON.stringify` with object keys sorted at every nesting level, so key order never affects the hash. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixturePath(dir: string, key: string): string {
  return path.join(dir, `${key}.json`);
}

function readFixture(file: string): FixtureFile | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as FixtureFile;
}

function writeFixture(file: string, fixture: FixtureFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2));
}
