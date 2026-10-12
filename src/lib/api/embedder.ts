/**
 * Embedding layer.
 *
 * `ParsisLocalEmbedder` is a genuine, deterministic embedding function: signed
 * feature hashing of unigrams and bigrams with sublinear term weighting, L2
 * normalised so cosine similarity is a dot product. It requires no key and no
 * network, which makes retrieval testable offline.
 *
 * Vendor embedders route through `embedWithProvider` and fail loudly with an
 * actionable message when a key is missing.
 */

import { ProviderError, embedWithProvider } from "./providers";
import { tokenizeWords } from "../rag/text";
import type { ProviderId } from "./types";

export const LOCAL_EMBEDDING_MODEL = "pyre-hash-384";
const DEFAULT_DIMENSIONS = 384;
const TOKEN_CACHE_LIMIT = 2400;
const tokenCache = new Map<string, Map<string, number>>();

function tokenize(text: string): Map<string, number> {
  const cached = tokenCache.get(text);
  if (cached) return cached;

  const words = tokenizeWords(text);

  const counts = new Map<string, number>();
  const bump = (token: string, weight: number) =>
    counts.set(token, (counts.get(token) ?? 0) + weight);

  for (const word of words) bump(word, 1);
  for (let i = 0; i < words.length - 1; i += 1) bump(`${words[i]}\u0000${words[i + 1]}`, 0.85);

  if (tokenCache.size > TOKEN_CACHE_LIMIT) tokenCache.clear();
  tokenCache.set(text, counts);
  return counts;
}

/** FNV-1a — fast, well-distributed 32-bit string hash. */
function hashString(input: string, seed: number) {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function embedLocal(text: string, dimensions = DEFAULT_DIMENSIONS): number[] {
  const dims = Math.max(64, Math.min(2048, Math.round(dimensions)));
  const counts = tokenize(text);
  const vector = new Float64Array(dims);

  for (const [token, count] of counts) {
    // Sublinear tf keeps a repeated word from dominating the vector.
    const weight = 1 + Math.log(1 + count);
    const h1 = hashString(token, 0x811c9dc5);
    const h2 = hashString(token, 0x9e3779b9);
    const sign = (h1 & 0x80000000) === 0 ? 1 : -1;
    // Two positions per token halves the collision bias that single-hash
    // feature hashing suffers from at this dimensionality.
    vector[h1 % dims] += sign * weight;
    vector[h2 % dims] += sign * weight * 0.55;
  }

  let norm = 0;
  for (let i = 0; i < dims; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dims);
  for (let i = 0; i < dims; i += 1) out[i] = vector[i] / norm;
  return out;
}

export interface EmbedderKeySource {
  (provider: ProviderId): { apiKey?: string; baseUrl?: string } | undefined;
}

export interface Embedder {
  provider: ProviderId;
  model: string;
  dimensions: number;
  offline: boolean;
  /** `kind` lets asymmetric models embed queries differently from documents. */
  embed(texts: string[], kind?: "document" | "query"): Promise<number[][]>;
}

const BATCH_SIZE = 64;

function l2Normalize(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

export function createEmbedder(
  config: { provider: ProviderId; model: string; dimensions: number },
  getCredentials: EmbedderKeySource,
): Embedder {
  if (config.provider === "local") {
    return {
      provider: "local",
      model: LOCAL_EMBEDDING_MODEL,
      dimensions: config.dimensions || DEFAULT_DIMENSIONS,
      offline: true,
      async embed(texts) {
        return texts.map((text) => embedLocal(text, config.dimensions || DEFAULT_DIMENSIONS));
      },
    };
  }

  const credentials = getCredentials(config.provider) ?? {};
  return {
    provider: config.provider,
    model: config.model,
    dimensions: config.dimensions,
    offline: false,
    async embed(texts, kind = "document") {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const vectors = await embedWithProvider({
          provider: config.provider,
          model: config.model,
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          texts: batch,
          dimensions: config.dimensions || undefined,
          kind,
        });
        if (vectors.length !== batch.length) {
          throw new ProviderError(
            config.provider,
            `Expected ${batch.length} embeddings, received ${vectors.length}.`,
          );
        }
        // Quantised storage and cosine scoring assume unit vectors.
        out.push(...vectors.map(l2Normalize));
      }
      return out;
    },
  };
}
