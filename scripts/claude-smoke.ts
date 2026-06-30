/**
 * Manual smoke test for the Claude API client (NEXT-10 item #1).
 *
 * Exercises a real structured-output (tool-call) round trip against the
 * live Anthropic API. Not run by `npm test` — there's no API key in CI/dev
 * sandboxes — but should be run by hand whenever the client changes:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node scripts/claude-smoke.ts
 */

import { z } from "zod";
import { ClaudeClient } from "../src/claude";

const WeatherSchema = z.object({
  city: z.string().describe("The city name extracted from the request."),
  unit: z.enum(["celsius", "fahrenheit"]).describe("Temperature unit implied or stated by the request."),
});

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY before running this script.");
    process.exitCode = 1;
    return;
  }

  const client = new ClaudeClient({ apiKey });

  const { data, message } = await client.structured({
    messages: [{ role: "user", content: "What's the weather like in Paris? Give it to me in Celsius." }],
    tool: {
      name: "extract_weather_query",
      description: "Extract the city and unit from a weather request.",
      schema: WeatherSchema,
    },
  });

  console.log("Structured output:", data);
  console.log("Model:", message.model);
  console.log("Usage:", message.usage);
  console.log("Cost so far: $%s", client.costTracker.totalUsd().toFixed(6));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
