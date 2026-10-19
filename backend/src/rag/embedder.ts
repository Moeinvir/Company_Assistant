/**
 * Server-side embedding.
 *
 * The primary embedder is the built-in offline one (`pyre-hash-384`), ported
 * byte-for-byte from `src/lib/api/embedder.ts`. It is a genuine, deterministic
 * embedding function: signed feature hashing of unigrams and bigrams with
 * sublinear term weighting, L2 normalised so cosine similarity is a dot
 * product. It needs no key and no network, which is what lets a document be
 * indexed the moment it is uploaded and lets the demo run with no configuration
 * at all — and because the browser uses the same function, a query embedded on
 * either side scores against either index.
 *
 * When the workspace selects a vendor embedder, the OpenAI-compatible
 * `/embeddings` endpoint is used with the workspace's stored credential. That
 * covers OpenAI, Mistral, Groq, OpenRouter and custom gateways. A vendor whose
 * embedding wire format is not implemented fails the document with an
 * actionable message rather than writing an index nobody can query.
 */

import { tokenizeWords } from "./text";

export const LOCAL_EMBEDDING_MODEL = "pyre-hash-384";
export const DEFAULT_DIMENSIONS = 384;

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

export interface EmbeddingConfigLike {
  provider: string;
  model: string;
  dimensions: number;
}

export interface EmbedCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface EmbedderKeySource {
  (provider: string): EmbedCredentials | undefined;
}

export interface Embedder {
  provider: string;
  model: string;
  dimensions: number;
  offline: boolean;
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

/** Providers whose embedder speaks OpenAI's `POST /embeddings`. */
const OPENAI_COMPATIBLE_EMBEDDERS = new Set([
  "openai",
  "mistral",
  "groq",
  "openrouter",
  "custom",
]);

const EMBEDDING_TIMEOUT_MS = 60_000;

export function createEmbedder(
  config: EmbeddingConfigLike,
  getCredentials: EmbedderKeySource,
): Embedder {
  if (config.provider === "local" || !config.provider) {
    const dimensions = config.dimensions || DEFAULT_DIMENSIONS;
    return {
      provider: "local",
      model: LOCAL_EMBEDDING_MODEL,
      dimensions,
      offline: true,
      async embed(texts) {
        return texts.map((text) => embedLocal(text, dimensions));
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
      if (!OPENAI_COMPATIBLE_EMBEDDERS.has(config.provider)) {
        throw new Error(
          `The server cannot embed with ${config.provider} yet. Point this assistant at the built-in embedder (${LOCAL_EMBEDDING_MODEL}), or a provider with an OpenAI-compatible /embeddings endpoint.`,
        );
      }
      if (!credentials.apiKey) {
        throw new Error(
          `No ${config.provider} key is stored for this workspace, so this document cannot be embedded. Save the key in API & Integrations.`,
        );
      }
      const base = resolveEmbeddingBase(config.provider, credentials.baseUrl);

      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const response = await fetch(`${base}/embeddings`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${credentials.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            input: batch,
            ...(config.dimensions ? { dimensions: config.dimensions } : {}),
          }),
          signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
        });
        const raw = await response.text().catch(() => "");
        if (!response.ok) {
          throw new Error(
            `${config.provider} rejected the embedding request (HTTP ${response.status})${raw ? `: ${raw.slice(0, 200)}` : "."}`,
          );
        }
        let payload: { data?: { index: number; embedding: number[] }[] };
        try {
          payload = JSON.parse(raw) as { data?: { index: number; embedding: number[] }[] };
        } catch {
          throw new Error(`${config.provider} returned an embedding response that was not JSON.`);
        }
        const vectors = (payload.data ?? [])
          .sort((a, b) => a.index - b.index)
          .map((entry) => entry.embedding);
        if (vectors.length !== batch.length) {
          throw new Error(
            `${config.provider} returned ${vectors.length} embeddings for ${batch.length} inputs.`,
          );
        }
        void kind;
        // Quantised storage and cosine scoring assume unit vectors.
        out.push(...vectors.map(l2Normalize));
      }
      return out;
    },
  };
}

function resolveEmbeddingBase(provider: string, baseUrl?: string) {
  const fallback: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    mistral: "https://api.mistral.ai/v1",
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
  };
  const candidate = (baseUrl ?? "").trim() || fallback[provider] || "";
  if (!candidate) throw new Error(`No base URL is configured for ${provider} embeddings.`);
  return candidate.replace(/\/+$/, "");
}
