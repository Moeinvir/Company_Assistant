/**
 * The RAG pipeline.
 *
 * One implementation, used by three surfaces: the knowledge ingestion worker,
 * the playground, and the embeddable widget. It performs real chunking, real
 * embedding and real similarity search. The only optional rung is text
 * generation — when no generation provider is configured the pipeline returns
 * an extractive answer assembled from the retrieved passages and says so in the
 * response metadata, rather than inventing output from a model that is not
 * there.
 */

import { chunkText, estimateTokens } from "./chunker";
import { queryTerms, searchChunks } from "./vectorStore";
import { PROVIDER_MAP, ProviderError, chatComplete, providerLabel } from "../api/providers";
import { isProviderProxyActive } from "../api/providerProxy";
import { createEmbedder, type Embedder, type EmbedderKeySource } from "../api/embedder";
import { toneInstruction } from "./tone";
import { SENTENCE_END } from "./text";
import type {
  Assistant,
  Chunk,
  ChatMessage,
  EmbeddingConfig,
  QueryResponse,
  RetrievedChunk,
  ResponseMetadata,
  RetrievalStrategy,
} from "../api/types";

export interface IngestStageEvent {
  stage: "chunking" | "embedding";
  progress: number;
  detail: string;
}

export interface IngestedChunk {
  content: string;
  tokens: number;
  vector: number[];
}

export interface IngestResult {
  chunks: IngestedChunk[];
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number;
  durationMs: number;
}

export interface IngestOptions {
  text: string;
  embedding: EmbeddingConfig;
  getCredentials: EmbedderKeySource;
  onStage?: (event: IngestStageEvent) => void;
}

/** Chunk and embed a document. Throws `ProviderError` when embedding fails. */
export async function ingestText(options: IngestOptions): Promise<IngestResult> {
  const started = performance.now();
  const { text, embedding, getCredentials, onStage } = options;

  onStage?.({ stage: "chunking", progress: 0.1, detail: "Splitting into passages" });
  const pieces = chunkText(text, {
    chunkSize: embedding.chunkSize,
    chunkOverlap: embedding.chunkOverlap,
  });
  if (pieces.length === 0) {
    throw new Error("Document contained no indexable text after cleaning.");
  }

  const embedder = createEmbedder(embedding, getCredentials);
  onStage?.({
    stage: "embedding",
    progress: 0.35,
    detail: `Embedding ${pieces.length} passages with ${embedder.offline ? "the offline embedder" : providerLabel(embedder.provider)}`,
  });

  const vectors = await embedder.embed(pieces.map((piece) => piece.content));
  onStage?.({ stage: "embedding", progress: 0.9, detail: "Writing vectors" });

  const chunks: IngestedChunk[] = pieces.map((piece, index) => ({
    content: piece.content,
    tokens: piece.tokens,
    vector: vectors[index] ?? [],
  }));

  return {
    chunks,
    embeddingProvider: embedder.provider,
    embeddingModel: embedder.model,
    dimensions: embedder.dimensions,
    durationMs: Math.round(performance.now() - started),
  };
}

/* ------------------------------------------------------------- retrieval */

export interface RetrievalInput {
  question: string;
  chunks: Chunk[];
  assistant: Assistant;
  embedder: Embedder;
  kbNames: Map<string, string>;
  documentNames: Map<string, string>;
  topK?: number;
  threshold?: number;
  strategy?: RetrievalStrategy;
}

export async function retrieve(input: RetrievalInput): Promise<{
  results: RetrievedChunk[];
  scanned: number;
  queryVector: number[] | null;
  latencyMs: number;
}> {
  const started = performance.now();
  const strategy = input.strategy ?? input.assistant.rag.strategy;
  const topK = input.topK ?? input.assistant.rag.topK;
  const threshold = input.threshold ?? input.assistant.rag.scoreThreshold;

  // Keyword search needs no vectors, so don't spend an embedding call on it.
  const queryVector =
    strategy === "keyword" ? null : ((await input.embedder.embed([input.question], "query"))[0] ?? null);

  const { results, scanned } = searchChunks(input.chunks, input.question, {
    topK,
    strategy,
    threshold,
    queryVector,
  });

  const mapped: RetrievedChunk[] = results.map(({ chunk, score, vectorScore, keywordScore }) => ({
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentName: input.documentNames.get(chunk.documentId) ?? "Unknown document",
    knowledgeBaseId: chunk.knowledgeBaseId,
    knowledgeBaseName: input.kbNames.get(chunk.knowledgeBaseId) ?? "Knowledge base",
    index: chunk.index,
    content: chunk.content,
    score: Number(score.toFixed(4)),
    vectorScore: Number(vectorScore.toFixed(4)),
    keywordScore: Number(keywordScore.toFixed(4)),
    tokens: chunk.tokens,
  }));

  return {
    results: mapped,
    scanned,
    queryVector,
    latencyMs: Math.round(performance.now() - started),
  };
}

/* ------------------------------------------------------------- prompting */

export function buildContextBlock(results: RetrievedChunk[], maxCharacters = 12_000) {
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const header = `[${i + 1}] ${result.documentName} · ${result.knowledgeBaseName} · relevance ${(result.score * 100).toFixed(1)}%`;
    const block = `${header}\n${result.content}`;
    if (used + block.length > maxCharacters) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n\n---\n\n");
}

export function buildGroundedMessages(input: {
  assistant: Assistant;
  question: string;
  history: { role: "system" | "user" | "assistant"; content: string }[];
  context: string;
}) {
  const { assistant, question, history, context } = input;
  const system = [
    assistant.systemPrompt.trim(),
    toneInstruction(assistant.tone),
    assistant.rag.instruction.trim(),
    context
      ? [
          "Use the numbered context passages below to answer.",
          "Cite the passages you rely on with their bracket numbers, for example [1].",
          "If the passages do not contain the answer, say so plainly instead of guessing.",
          "",
          "<context>",
          context,
          "</context>",
        ].join("\n")
      : "No context passages were retrieved for this question. Answer from general knowledge and say that the knowledge base returned nothing relevant.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system" as const, content: system },
    ...history.slice(-8),
    { role: "user" as const, content: question },
  ];
}

/**
 * Extractive answering: pick the sentences across the retrieved passages with
 * the strongest query-term coverage and present them with citations. This is
 * what runs when no generation provider is connected — genuine retrieval, no
 * fabricated prose.
 */
export function extractiveAnswer(question: string, results: RetrievedChunk[], limit = 3) {
  if (results.length === 0) return "";
  const terms = new Set(queryTerms(question));
  const scored: { text: string; score: number; order: number; citation: number }[] = [];
  let order = 0;

  results.forEach((result, resultIndex) => {
    const sentences = result.content.split(SENTENCE_END);
    for (const sentence of sentences) {
      const clean = sentence.trim();
      if (clean.length < 40) continue;
      const words = queryTerms(clean);
      if (words.length === 0) continue;
      const hits = words.filter((word) => terms.has(word)).length;
      if (hits === 0) continue;
      const density = hits / Math.sqrt(words.length);
      scored.push({
        text: clean,
        score: density * (0.6 + result.score * 0.7),
        order: order++,
        citation: resultIndex + 1,
      });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, limit).sort((a, b) => a.order - b.order);
  if (picked.length === 0) return results[0].content.slice(0, 480);

  return picked.map((entry) => `${entry.text} [${entry.citation}]`).join(" ");
}

/* --------------------------------------------------------------- answering */

export interface AnswerInput {
  assistant: Assistant;
  question: string;
  history?: { role: "system" | "user" | "assistant"; content: string }[];
  chunks: Chunk[];
  kbNames: Map<string, string>;
  documentNames: Map<string, string>;
  getCredentials: EmbedderKeySource;
  overrides?: {
    topK?: number;
    threshold?: number;
    temperature?: number;
    strategy?: RetrievalStrategy;
  };
}

export async function answerQuestion(input: AnswerInput): Promise<QueryResponse> {
  const started = performance.now();
  const { assistant, question, getCredentials } = input;
  const embedder = createEmbedder(assistant.embedding, getCredentials);
  const notes: string[] = [];

  const ragEnabled = assistant.rag.enabled !== false;
  const retrieval = await retrieve({
    question,
    chunks: ragEnabled ? input.chunks : [],
    assistant,
    embedder,
    kbNames: input.kbNames,
    documentNames: input.documentNames,
    topK: input.overrides?.topK,
    threshold: input.overrides?.threshold,
    strategy: input.overrides?.strategy,
  });

  const results = retrieval.results;
  const credentials = getCredentials(assistant.model.provider) ?? {};
  // Generation is possible when this browser holds a key, when the provider
  // needs none, or when the platform API will resolve the workspace key for us.
  const canGenerate =
    Boolean(credentials.apiKey) ||
    PROVIDER_MAP[assistant.model.provider]?.requiresKey === false ||
    isProviderProxyActive();

  let content = "";
  let mode: ResponseMetadata["mode"] = "model";
  let promptTokens = 0;
  let completionTokens = 0;

  if (!ragEnabled) {
    notes.push("Retrieval is disabled for this assistant; the answer uses the system prompt alone.");
  } else if (results.length === 0) {
    notes.push(
      `No passage scored above the ${((input.overrides?.threshold ?? assistant.rag.scoreThreshold) * 100).toFixed(0)}% threshold across ${retrieval.scanned} indexed passages.`,
    );
  }

  const refuse = ragEnabled && results.length === 0 && assistant.rag.noAnswerBehavior === "refuse";
  const needsGeneration = !refuse && (!ragEnabled || results.length === 0 || canGenerate);

  if (refuse) {
    content = assistant.rag.noAnswerMessage;
    mode = "extractive";
  } else if (!canGenerate) {
    // No generation provider: answer extractively, or say nothing matched.
    mode = "extractive";
    content =
      results.length > 0
        ? extractiveAnswer(question, results)
        : "I could not find anything relevant in the connected knowledge bases for that question.";
    if (results.length > 0) {
      notes.push(
        `${providerLabel(assistant.model.provider)} is not connected, so no generation call was made. This answer is assembled directly from the retrieved passages.`,
      );
    }
  } else if (needsGeneration) {
    const context = buildContextBlock(results);
    const messages = buildGroundedMessages({
      assistant,
      question,
      history: input.history ?? [],
      context,
    });
    try {
      const result = await chatComplete({
        provider: assistant.model.provider,
        model: assistant.model.model,
        apiKey: credentials.apiKey,
        baseUrl: credentials.baseUrl,
        temperature: input.overrides?.temperature ?? assistant.model.temperature,
        maxTokens: assistant.model.maxTokens,
        topP: assistant.model.topP,
        messages,
      });
      content = result.text.trim();
      promptTokens = result.promptTokens || estimateTokens(messages.map((m) => m.content).join(" "));
      completionTokens = result.completionTokens || estimateTokens(content);
      if (result.finishReason === "length") {
        notes.push("The model hit the max token limit; the answer may be truncated.");
      }
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : null;
      mode = "extractive";
      content = results.length > 0 ? extractiveAnswer(question, results) : "";
      notes.push(`Generation failed: ${providerError?.message ?? (error as Error).message}`);
      if (providerError?.hint) notes.push(providerError.hint);
    }
  }

  const latencyMs = Math.round(performance.now() - started);
  const grounded = mode === "model" && /\[\d+\]/.test(content);

  const metadata: ResponseMetadata = {
    provider: assistant.model.provider,
    model: assistant.model.model,
    mode,
    latencyMs,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    retrievedCount: results.length,
    contextCharacters: results.reduce((sum, result) => sum + result.content.length, 0),
    scoreThreshold: input.overrides?.threshold ?? assistant.rag.scoreThreshold,
    topScore: results[0]?.score ?? null,
    grounded,
    notes,
  };

  const message: ChatMessage = {
    id: `msg_${Math.random().toString(36).slice(2, 11)}`,
    role: "assistant",
    content: content || "No answer was produced.",
    createdAt: new Date().toISOString(),
    retrieved: results,
    meta: metadata,
  };

  return { message, retrieved: results };
}
