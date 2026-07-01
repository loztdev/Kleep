/**
 * Fixture record/replay harness for `OpenRouterClient` tests — mirrors
 * `src/claude/fixtures.ts`. Node `fs`-only, so deliberately not
 * re-exported from `src/llm/openrouter/index.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fnv1aHash } from "../../util/hash";
import type {
  OpenRouterMessageStream,
  OpenRouterRequest,
  OpenRouterResponse,
  OpenRouterStreamChunk,
  OpenRouterTransport,
} from "./types";

export type FixtureMode = "replay" | "record";

export interface FixtureTransportOptions {
  dir: string;
  mode?: FixtureMode;
  recordTransport?: OpenRouterTransport;
}

interface FixtureFile {
  request: OpenRouterRequest;
  response: OpenRouterResponse;
}

export class FixtureNotFoundError extends Error {
  constructor(
    public readonly key: string,
    public readonly file: string,
  ) {
    super(`no fixture recorded for request (key=${key}, expected file=${file})`);
    this.name = "FixtureNotFoundError";
  }
}

export class FixtureTransport implements OpenRouterTransport {
  private readonly mode: FixtureMode;

  constructor(private readonly opts: FixtureTransportOptions) {
    this.mode = opts.mode ?? "replay";
  }

  async send(request: OpenRouterRequest): Promise<OpenRouterResponse> {
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

  stream(request: OpenRouterRequest): OpenRouterMessageStream {
    const transport = this;
    let cached: Promise<OpenRouterResponse> | null = null;
    const getMessage = (): Promise<OpenRouterResponse> => {
      cached ??= transport.send(request);
      return cached;
    };

    async function* iterate(): AsyncGenerator<OpenRouterStreamChunk, void, void> {
      const response = await getMessage();
      const content = response.choices[0]?.message.content;
      if (content) {
        yield {
          id: response.id,
          model: response.model,
          choices: [{ index: 0, delta: { content }, finish_reason: response.choices[0]?.finish_reason ?? null }],
        };
      }
    }

    return {
      [Symbol.asyncIterator]: () => iterate()[Symbol.asyncIterator](),
      finalMessage: getMessage,
    };
  }
}

function fixtureKey(request: OpenRouterRequest): string {
  return fnv1aHash(stableStringify(request)).toString(16).padStart(8, "0");
}

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
