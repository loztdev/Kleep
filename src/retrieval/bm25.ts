/**
 * Okapi BM25 — exact-keyword channel of the fusion recall engine.
 *
 * Indexes any (id, text) pair so the same index can hold MemoryAsset
 * content, WorldBibleEntry summaries, etc. Add/remove are O(|tokens|);
 * search is O(|query terms| * |candidates|).
 *
 * Standard parameter defaults: k1 = 1.5, b = 0.75. Override per index
 * if a workload demands it.
 */

import { tokenize } from "./tokenize";

export interface Bm25SearchResult {
  id: string;
  score: number;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export class Bm25Index {
  private readonly k1: number;
  private readonly b: number;

  /** term → docId → term frequency in that doc */
  private postings = new Map<string, Map<string, number>>();
  /** docId → token count */
  private docLen = new Map<string, number>();
  private totalLen = 0;

  constructor(opts: Bm25Options = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
  }

  add(id: string, text: string): void {
    if (this.docLen.has(id)) this.remove(id);
    const tokens = tokenize(text);
    if (tokens.length === 0) {
      this.docLen.set(id, 0);
      return;
    }
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      bucket(this.postings, term).set(id, count);
    }
    this.docLen.set(id, tokens.length);
    this.totalLen += tokens.length;
  }

  remove(id: string): boolean {
    const len = this.docLen.get(id);
    if (len === undefined) return false;
    this.docLen.delete(id);
    this.totalLen -= len;
    for (const [term, plist] of this.postings) {
      if (plist.delete(id) && plist.size === 0) {
        this.postings.delete(term);
      }
    }
    return true;
  }

  size(): number {
    return this.docLen.size;
  }

  search(query: string, topK: number): Bm25SearchResult[] {
    if (topK <= 0 || this.docLen.size === 0) return [];
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const N = this.docLen.size;
    const avgdl = N === 0 ? 0 : this.totalLen / N;
    const scores = new Map<string, number>();

    for (const term of terms) {
      const plist = this.postings.get(term);
      if (!plist) continue;
      // BM25 IDF, +1 inside the log for non-negative IDF (Lucene variant).
      const df = plist.size;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      for (const [docId, tf] of plist) {
        const dl = this.docLen.get(docId) ?? 0;
        const norm = 1 - this.b + (this.b * dl) / (avgdl || 1);
        const tfPart = (tf * (this.k1 + 1)) / (tf + this.k1 * norm);
        scores.set(docId, (scores.get(docId) ?? 0) + idf * tfPart);
      }
    }

    const ranked = [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);
    return ranked.slice(0, topK);
  }
}

function bucket<K, V>(m: Map<K, Map<string, V>>, k: K): Map<string, V> {
  let s = m.get(k);
  if (!s) {
    s = new Map<string, V>();
    m.set(k, s);
  }
  return s;
}
