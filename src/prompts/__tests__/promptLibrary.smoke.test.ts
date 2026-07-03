import * as fs from "fs";
import { parsePromptLibraryCsv } from "../promptLibrary";

// Smoke test against a real snapshot of the live dataset — only runs
// when the fixture file is present (manually downloaded, not committed).
const fixturePath = "/tmp/prompts-real.csv";
const hasFixture = fs.existsSync(fixturePath);

(hasFixture ? describe : describe.skip)("parsePromptLibraryCsv (real dataset smoke test)", () => {
  it("parses the full live CSV with no empty titles/contents", () => {
    const csv = fs.readFileSync(fixturePath, "utf-8");
    const entries = parsePromptLibraryCsv(csv);
    expect(entries.length).toBeGreaterThan(100);
    expect(entries.every((e) => e.title.trim().length > 0)).toBe(true);
    expect(entries.every((e) => e.content.trim().length > 0)).toBe(true);
  });
});
