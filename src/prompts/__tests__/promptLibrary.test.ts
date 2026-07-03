import { listPromptLibrary, parsePromptLibraryCsv } from "../promptLibrary";

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/csv" } });
}

describe("parsePromptLibraryCsv", () => {
  it("parses a simple row", () => {
    const csv = 'act,prompt,for_devs\nLinux Terminal,"I want you to act as a linux terminal.",TRUE\n';
    expect(parsePromptLibraryCsv(csv)).toEqual([
      { id: "library-1", title: "Linux Terminal", content: "I want you to act as a linux terminal." },
    ]);
  });

  it("handles embedded commas inside quoted fields", () => {
    const csv = 'act,prompt\nChef,"Cook something with salt, pepper, and butter."\n';
    expect(parsePromptLibraryCsv(csv)).toEqual([
      { id: "library-1", title: "Chef", content: "Cook something with salt, pepper, and butter." },
    ]);
  });

  it("handles escaped double-quotes inside quoted fields", () => {
    const csv = 'act,prompt\nTranslator,"Reply only in English, e.g. ""hello there""."\n';
    expect(parsePromptLibraryCsv(csv)).toEqual([
      { id: "library-1", title: "Translator", content: 'Reply only in English, e.g. "hello there".' },
    ]);
  });

  it("handles embedded newlines inside quoted fields", () => {
    const csv = 'act,prompt\nPoet,"Line one.\nLine two."\n';
    expect(parsePromptLibraryCsv(csv)).toEqual([
      { id: "library-1", title: "Poet", content: "Line one.\nLine two." },
    ]);
  });

  it("ignores extra columns (for_devs/type/contributor) and reorders by header", () => {
    const csv = 'type,act,contributor,prompt\nTEXT,Pirate,f,"Talk like a pirate."\n';
    expect(parsePromptLibraryCsv(csv)).toEqual([
      { id: "library-1", title: "Pirate", content: "Talk like a pirate." },
    ]);
  });

  it("skips rows missing act or prompt", () => {
    const csv = 'act,prompt\n,"No title here."\nHas Title,\n';
    expect(parsePromptLibraryCsv(csv)).toEqual([]);
  });

  it("returns [] for an empty or headerless CSV", () => {
    expect(parsePromptLibraryCsv("")).toEqual([]);
  });

  it("returns [] when the header is missing act/prompt columns", () => {
    expect(parsePromptLibraryCsv("foo,bar\n1,2\n")).toEqual([]);
  });

  it("handles a file with no trailing newline", () => {
    const csv = 'act,prompt\nPirate,"Talk like a pirate."';
    expect(parsePromptLibraryCsv(csv)).toEqual([
      { id: "library-1", title: "Pirate", content: "Talk like a pirate." },
    ]);
  });
});

describe("listPromptLibrary", () => {
  it("fetches and parses the public CSV", async () => {
    const fetchMock = jest.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv");
      return textResponse(200, 'act,prompt\nPirate,"Talk like a pirate."\n');
    }) as unknown as typeof fetch;

    const entries = await listPromptLibrary(fetchMock);
    expect(entries).toEqual([{ id: "library-1", title: "Pirate", content: "Talk like a pirate." }]);
  });

  it("throws a clear error on a non-2xx response", async () => {
    const fetchMock = jest.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(listPromptLibrary(fetchMock)).rejects.toThrow(/HTTP 503/);
  });
});
