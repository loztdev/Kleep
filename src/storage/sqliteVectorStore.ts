/**
 * SQLite-backed `VectorStore` (Tier 6.2, scoped) — same contract as
 * `InMemoryVectorStore`, verified against the identical contract test
 * suite. Embeddings are stored as JSON arrays and scored in JS via the
 * exact same cosine-similarity linear scan the in-memory impl uses —
 * this deliberately does NOT use the `sqlite-vec` extension (that would
 * need a native SQLite extension bundled through an Expo config plugin,
 * unverifiable from this sandbox and a real jump in risk for a lore-book
 * size this app will realistically hold). What persistence buys here is
 * durability across restarts, not query-time acceleration; revisit if
 * lore volume ever makes a linear scan too slow.
 */

import type { LoreSnippet, Network } from "../schema";
import type { SqlDatabase } from "./sql/types";
import type { VectorQueryFilter, VectorSearchResult, VectorStore } from "./types";

interface Row {
  id: string;
  embedding: string;
  data: string;
}

function asArray<T>(v: T | readonly T[] | undefined): readonly T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? (v as readonly T[]) : ([v as T] as const);
}

/** Cosine similarity in [-1, 1]; throws on dimension mismatch — mirrors `InMemoryVectorStore`. */
function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`embedding dimensionality mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** SQLite `VectorStore` — durable, same contract as the in-memory reference impl. */
export class SqliteVectorStore implements VectorStore {
  private dim: number | null = null;

  constructor(private readonly db: SqlDatabase) {}

  upsert(snippet: LoreSnippet): void {
    if (!snippet.embedding || snippet.embedding.length === 0) {
      throw new Error(`LoreSnippet ${snippet.id} cannot be upserted without an embedding`);
    }
    const dim = this.dimension();
    if (dim === null) {
      this.dim = snippet.embedding.length;
    } else if (snippet.embedding.length !== dim) {
      throw new Error(`embedding dim ${snippet.embedding.length} does not match store dim ${dim}`);
    }

    this.db.runSync(
      `INSERT INTO lore_snippets (id, network, viewpoint_holder, embedding, data)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         network = excluded.network,
         viewpoint_holder = excluded.viewpoint_holder,
         embedding = excluded.embedding,
         data = excluded.data`,
      [
        snippet.id,
        snippet.network,
        snippet.viewpoint_holder ?? null,
        JSON.stringify(snippet.embedding),
        JSON.stringify(snippet),
      ],
    );
    this.db.runSync("DELETE FROM lore_snippet_tags WHERE snippet_id = ?", [snippet.id]);
    for (const tag of snippet.tags) {
      this.db.runSync("INSERT INTO lore_snippet_tags (snippet_id, tag) VALUES (?, ?)", [
        snippet.id,
        tag,
      ]);
    }
  }

  get(id: string): LoreSnippet | undefined {
    const row = this.db.getFirstSync<Row>(
      "SELECT id, embedding, data FROM lore_snippets WHERE id = ?",
      [id],
    );
    return row ? (JSON.parse(row.data) as LoreSnippet) : undefined;
  }

  query(
    embedding: readonly number[],
    topK: number,
    filter?: VectorQueryFilter,
  ): VectorSearchResult[] {
    if (topK <= 0) return [];
    if (this.size() === 0) return [];
    const dim = this.dimension();
    if (dim !== null && embedding.length !== dim) {
      throw new Error(`query embedding dim ${embedding.length} does not match store dim ${dim}`);
    }

    const joins: string[] = [];
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter?.tag !== undefined) {
      joins.push("JOIN lore_snippet_tags lt ON lt.snippet_id = ls.id AND lt.tag = ?");
      params.push(filter.tag);
    }
    const networks = asArray(filter?.network) as readonly Network[] | undefined;
    if (networks?.length) {
      where.push(`ls.network IN (${networks.map(() => "?").join(", ")})`);
      params.push(...networks);
    }
    if (filter?.viewpoint_holder !== undefined) {
      where.push("ls.viewpoint_holder = ?");
      params.push(filter.viewpoint_holder);
    }

    const sql = [
      "SELECT DISTINCT ls.id, ls.embedding, ls.data FROM lore_snippets ls",
      ...joins,
      where.length ? `WHERE ${where.join(" AND ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const rows = this.db.getAllSync<Row>(sql, params);
    const scored: VectorSearchResult[] = rows.map((row) => ({
      snippet: JSON.parse(row.data) as LoreSnippet,
      score: cosine(embedding, JSON.parse(row.embedding) as number[]),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  delete(id: string): boolean {
    const result = this.db.runSync("DELETE FROM lore_snippets WHERE id = ?", [id]);
    this.db.runSync("DELETE FROM lore_snippet_tags WHERE snippet_id = ?", [id]);
    return result.changes > 0;
  }

  size(): number {
    const row = this.db.getFirstSync<{ count: number }>(
      "SELECT COUNT(*) as count FROM lore_snippets",
      [],
    );
    return row?.count ?? 0;
  }

  /** Dimension locked at first upsert, or inferred from an existing row after a reload. */
  private dimension(): number | null {
    if (this.dim !== null) return this.dim;
    const row = this.db.getFirstSync<{ embedding: string }>(
      "SELECT embedding FROM lore_snippets LIMIT 1",
      [],
    );
    if (row) this.dim = (JSON.parse(row.embedding) as number[]).length;
    return this.dim;
  }
}
