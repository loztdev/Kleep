import { listClaudeModels } from "../models";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("listClaudeModels", () => {
  it("sends the required headers and normalizes the response to ModelInfo", async () => {
    const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.anthropic.com/v1/models");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      return jsonResponse(200, {
        data: [
          { id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
          { id: "claude-haiku-4-5" },
        ],
      });
    }) as unknown as typeof fetch;

    const models = await listClaudeModels("sk-ant-test", fetchMock);

    expect(models).toEqual([
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-haiku-4-5", label: "claude-haiku-4-5" },
    ]);
  });

  it("throws a clear error on a non-2xx response", async () => {
    const fetchMock = jest.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(listClaudeModels("bad-key", fetchMock)).rejects.toThrow(/HTTP 401/);
  });
});
