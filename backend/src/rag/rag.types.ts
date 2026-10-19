/**
 * Domain shapes shared by the server-side RAG services.
 *
 * These mirror `src/lib/api/types.ts` on the web client, because the API is the
 * same contract in both directions: the browser sends an assistant draft and
 * receives a `QueryResponse` with exactly these fields.
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "groq"
  | "openrouter"
  | "ollama"
  | "cohere"
  | "voyage"
  | "local"
  | "custom";

export type RetrievalStrategy = "hybrid" | "vector" | "keyword";

export interface ModelConfig {
  provider: ProviderId;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
}

export interface EmbeddingConfig {
  provider: ProviderId;
  model: string;
  dimensions: number;
  chunkSize: number;
  chunkOverlap: number;
}

export interface RagConfig {
  enabled: boolean;
  topK: number;
  scoreThreshold: number;
  strategy: RetrievalStrategy;
  rerank: boolean;
  instruction: string;
  noAnswerBehavior: "refuse" | "answer-without-context";
  noAnswerMessage: string;
}

/** The defaults a document is indexed with when the assistant config is absent. */
export const DEFAULT_EMBEDDING: EmbeddingConfig = {
  provider: "local",
  model: "pyre-hash-384",
  dimensions: 384,
  chunkSize: 900,
  chunkOverlap: 150,
};

export const DEFAULT_RAG: RagConfig = {
  enabled: true,
  topK: 4,
  scoreThreshold: 0.2,
  strategy: "hybrid",
  rerank: false,
  instruction: "",
  noAnswerBehavior: "refuse",
  noAnswerMessage: "I could not find that in the knowledge base.",
};

export interface StoredChunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  workspaceId: string;
  index: number;
  content: string;
  tokens: number;
  vector: number[];
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  index: number;
  content: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
  tokens: number;
}

export interface ResponseMetadata {
  provider: ProviderId;
  model: string;
  mode: "model" | "extractive";
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retrievedCount: number;
  contextCharacters: number;
  scoreThreshold: number;
  topScore: number | null;
  grounded: boolean;
  notes: string[];
}

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
  retrieved?: RetrievedChunk[];
  meta?: ResponseMetadata;
}

export interface QueryResponse {
  message: ChatMessage;
  retrieved: RetrievedChunk[];
}

/** Shape of the assistant row the retrieval service reads. */
export interface AssistantRuntimeConfig {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  systemPrompt: string;
  model: ModelConfig;
  tone: unknown;
  embedding: EmbeddingConfig;
  rag: RagConfig;
  knowledgeBaseIds: string[];
}

/**
 * Merge a stored JSON column with its defaults, so a row written before a field
 * existed still produces a complete configuration instead of `undefined`.
 */
export function withDefaults<T extends object>(value: unknown, defaults: T): T {
  if (!value || typeof value !== "object") return { ...defaults };
  return { ...defaults, ...(value as Partial<T>) };
}
