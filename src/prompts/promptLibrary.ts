/**
 * Fetches the "awesome-chatgpt-prompts" community prompt library — a
 * well-known, actively-maintained public dataset of system prompts
 * (github.com/f/awesome-chatgpt-prompts), no auth needed. There's no
 * live "prompt catalog API" the way there is for LLM models (Tier
 * 7.4's model browser); this is a concrete, stable public CSV instead,
 * fetched with the same timeout/cancellation helper the model browser
 * uses (`withFetchTimeout`).
 */

import { withFetchTimeout } from "../util/fetchTimeout";

const PROMPT_LIBRARY_URL =
  "https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv";

export interface PromptLibraryEntry {
  id: string;
  title: string;
  content: string;
}

/** List every prompt in the community library. */
export async function listPromptLibrary(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PromptLibraryEntry[]> {
  return withFetchTimeout(async (timeoutSignal) => {
    const res = await fetchImpl(PROMPT_LIBRARY_URL, { signal: timeoutSignal });
    if (!res.ok) {
      throw new Error(`Failed to fetch prompt library: HTTP ${res.status}`);
    }
    const text = await res.text();
    return parsePromptLibraryCsv(text);
  }, signal);
}

/**
 * Pulls the `act`/`prompt` columns out of the CSV (ignoring `for_devs`/
 * `type`/`contributor`) and drops any row missing either. Exported
 * standalone so it's unit-testable without a network call.
 */
export function parsePromptLibraryCsv(csv: string): PromptLibraryEntry[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const actIdx = header.indexOf("act");
  const promptIdx = header.indexOf("prompt");
  if (actIdx === -1 || promptIdx === -1) return [];

  const entries: PromptLibraryEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const title = row[actIdx]?.trim();
    const content = row[promptIdx]?.trim();
    if (!title || !content) continue;
    entries.push({ id: `library-${i}`, title, content });
  }
  return entries;
}

/**
 * Minimal RFC4180-ish CSV parser: quoted fields, `""`-escaped quotes,
 * and commas/newlines embedded inside quoted fields (the library's
 * prompt text is full of both). No library dependency added for this —
 * the format this one dataset actually needs is small enough to parse
 * by hand correctly, which a naive `line.split(",")` would not do.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"' && field.length === 0) {
      // Only treat a quote as a field-opener when it's the field's first
      // character, per RFC4180 — a bare quote after other content has
      // already accumulated is a literal character, not a re-open.
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
