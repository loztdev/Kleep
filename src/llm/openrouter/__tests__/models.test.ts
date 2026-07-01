import { listOpenRouterModels } from "../models";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("listOpenRouterModels", () => {
  it("fetches the public catalog and normalizes it to ModelInfo", async () => {
    const fetchMock = jest.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/models");
      return jsonResponse(200, {
        data: [
          { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o-mini", description: "Fast and cheap." },
          { id: "z-ai/glm-5.2" },
        ],
      });
    }) as unknown as typeof fetch;

    const models = await listOpenRouterModels(fetchMock);

    expect(models).toEqual([
      { id: "openai/gpt-4o-mini", label: "OpenAI: GPT-4o-mini", description: "Fast and cheap." },
      { id: "z-ai/glm-5.2", label: "z-ai/glm-5.2" },
    ]);
  });

  it("throws a clear error on a non-2xx response", async () => {
    const fetchMock = jest.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(listOpenRouterModels(fetchMock)).rejects.toThrow(/HTTP 503/);
  });
});
