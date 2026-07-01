/**
 * Manual smoke test for the OpenRouter client.
 *
 * Exercises a real structured-output (function-calling) round trip and a
 * plain streamed reply against the live OpenRouter API. Not run by
 * `npm test` — this sandbox's egress policy blocks openrouter.ai outright
 * (confirmed via the proxy status endpoint — a hard policy denial, not a
 * transient failure), so this has only been verified against a mocked
 * `fetch` in src/llm/openrouter/__tests__/. Run it by hand somewhere with
 * network access to openrouter.ai:
 *
 *   OPENROUTER_API_KEY=sk-or-... npx ts-node scripts/openrouter-smoke.ts
 */

import { z } from "zod";
import { OpenRouterClient } from "../src/llm/openrouter";

const MODEL = "openai/gpt-4o-mini";

const WeatherSchema = z.object({
  city: z.string().describe("The city name extracted from the request."),
  unit: z.enum(["celsius", "fahrenheit"]).describe("Temperature unit implied or stated by the request."),
});

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Set OPENROUTER_API_KEY before running this script.");
    process.exitCode = 1;
    return;
  }

  const client = new OpenRouterClient({ apiKey, defaultModel: MODEL, appTitle: "Kleep" });

  console.log("--- sendMessage ---");
  const reply = await client.sendMessage({ messages: [{ role: "user", content: "Say hi in exactly three words." }] });
  console.log(reply);

  console.log("\n--- structured (function-calling) ---");
  const { data } = await client.structured({
    messages: [{ role: "user", content: "What's the weather like in Paris? Give it to me in Celsius." }],
    tool: {
      name: "extract_weather_query",
      description: "Extract the city and unit from a weather request.",
      schema: WeatherSchema,
    },
  });
  console.log(data);

  console.log("\n--- streamMessage ---");
  const handle = client.streamMessage({ messages: [{ role: "user", content: "Count from 1 to 5." }] });
  for await (const chunk of handle.chunks) process.stdout.write(chunk.text);
  const final = await handle.final;
  console.log("\n(final):", final.usage);

  console.log("\nTotal cost so far: $%s", client.costTracker.totalUsd().toFixed(6));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
