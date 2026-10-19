/**
 * Retrieval scoring — a faithful port of `src/lib/rag/vector-store.ts`.
 *
 * Vector similarity is a real cosine calculation over normalised embeddings.
 * The lexical side is a compact BM25 over the same tokenisation, which lets the
 * hybrid strategy be a genuine blend instead of a cosmetic toggle.
 */

import { STOP_WORDS, tokenizeWords } from "./text";

export interface ScorableChunk {
  id: string;
  index: number;
  content: string;
  vector: number[];
}

export function cosineSimilarity(a: number[], b: number[]) {
  // Vectors from different embedding models/dimensions are not comparable.
  if (a.length === 0 || a.length !== b.length) return 0;
  const length = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ScoredChunk<T extends ScorableChunk = ScorableChunk> {
  chunk: T;
  vectorScore: number;
  keywordScore: number;
  score: number;
}

export function queryTerms(text: string) {
  return tokenizeWords(text).filter((token) => !STOP_WORDS.has(token));
}

const documentTerms = new Map<string, string[]>();
const DOCUMENT_TERM_CACHE_LIMIT = 6000;

function termsOf(chunk: ScorableChunk) {
  // The cache key includes the vector length so a re-embedded chunk cannot be
  // served stale terms from a previous revision of the same row id.
  const key = `${chunk.id}:${chunk.content.length}`;
  const cached = documentTerms.get(key);
  if (cached) return cached;
  const terms = queryTerms(chunk.content);
  if (documentTerms.size > DOCUMENT_TERM_CACHE_LIMIT) documentTerms.clear();
  documentTerms.set(key, terms);
  return terms;
}

export function clearLexicalCache() {
  documentTerms.clear();
}

/**
 * BM25 (k1 = 1.2, b = 0.75) over the candidate set. Scores are normalised to
 * 0–1 so they can be blended with cosine similarity.
 */
function bm25(candidates: ScorableChunk[], terms: string[]): Map<string, number> {
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map<string, number>();
  if (candidates.length === 0) return scores;

  const docTerms = new Map<string, string[]>();
  const df = new Map<string, number>();
  let totalLength = 0;

  for (const chunk of candidates) {
    const chunkTerms = termsOf(chunk);
    docTerms.set(chunk.id, chunkTerms);
    totalLength += chunkTerms.length;
    for (const term of new Set(chunkTerms)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const avgLength = totalLength / candidates.length || 1;
  const total = candidates.length;
  let max = 0;

  for (const chunk of candidates) {
    const chunkTerms = docTerms.get(chunk.id) ?? [];
    const length = chunkTerms.length || 1;
    const counts = new Map<string, number>();
    for (const term of chunkTerms) counts.set(term, (counts.get(term) ?? 0) + 1);

    let score = 0;
    for (const term of new Set(terms)) {
      const frequency = counts.get(term) ?? 0;
      if (frequency === 0) continue;
      const documentFrequency = df.get(term) ?? 0;
      const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
      score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * length) / avgLength)));
    }
    scores.set(chunk.id, score);
    if (score > max) max = score;
  }

  if (max > 0) for (const [id, score] of scores) scores.set(id, score / max);
  return scores;
}

export type RetrievalStrategy = "hybrid" | "vector" | "keyword";

export interface SearchOptions {
  topK: number;
  strategy: RetrievalStrategy;
  /** Minimum blended score to keep. */
  threshold?: number;
  queryVector?: number[] | null;
}

export interface SearchOutcome<T extends ScorableChunk = ScorableChunk> {
  results: ScoredChunk<T>[];
  scanned: number;
}

/** Blend vector and lexical signals into a single ranked list. */
export function searchChunks<T extends ScorableChunk>(
  candidates: T[],
  query: string,
  options: SearchOptions,
): SearchOutcome<T> {
  const terms = queryTerms(query);
  const lexical = bm25(candidates, terms);
  const scored: ScoredChunk<T>[] = [];
  const useVector = options.strategy !== "keyword" && Boolean(options.queryVector);

  for (const chunk of candidates) {
    const vectorScore =
      useVector && options.queryVector ? cosineSimilarity(options.queryVector, chunk.vector) : 0;
    const keywordScore = lexical.get(chunk.id) ?? 0;

    let score: number;
    if (options.strategy === "vector") score = Math.max(0, vectorScore);
    else if (options.strategy === "keyword") score = keywordScore;
    else score = Math.max(0, vectorScore) * 0.72 + keywordScore * 0.28;

    if (score <= 0) continue;
    if (options.threshold !== undefined && score < options.threshold) continue;
    scored.push({ chunk, vectorScore, keywordScore, score });
  }

  scored.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
  return { results: scored.slice(0, Math.max(1, options.topK)), scanned: candidates.length };
}
