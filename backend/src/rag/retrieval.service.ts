/**
 * Retrieval and grounded answering, on the server.
 *
 * Same three surfaces as the browser pipeline — playground, widget and the
 * assistant test tab — but reading the index this API built instead of
 * re-chunking and re-embedding documents on every query. The scoring functions
 * are the shared ports in `vector-store.ts`, so a question asked in the
 * playground and the same question asked in the widget rank the passages
 * identically.
 *
 * Generation has exactly one optional rung, as on the client: when the
 * workspace has no credential for the assistant's model provider (and the
 * provider needs none), the answer is assembled from the retrieved passages and
 * the response metadata says so, instead of inventing prose.
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ProviderId as WireProviderId } from "../providers/providers.dto";
import { ProvidersService } from "../providers/providers.service";
import { requiresApiKey } from "../providers/provider-wire";
import { createEmbedder } from "./embedder";
import { estimateTokens } from "./chunker";
import { SENTENCE_END } from "./text";
import { queryTerms, searchChunks } from "./vector-store";
import { toneInstruction } from "./tone";
import {
  DEFAULT_EMBEDDING,
  DEFAULT_RAG,
  withDefaults,
  type AssistantRuntimeConfig,
  type ChatMessage,
  type EmbeddingConfig,
  type ModelConfig,
  type QueryResponse,
  type RagConfig,
  type ResponseMetadata,
  type RetrievalStrategy,
  type RetrievedChunk,
  type StoredChunk,
} from "./rag.types";

/**
 * Provider ids are stored as JSON text on assistants and documents, so the
 * value read back is a plain string. The RAG layer works with the string union
 * in `rag.types.ts`; provider wiring uses its own enum. The two describe the
 * same set of providers, so this narrows the boundary instead of duplicating
 * the list.
 */
const wire = (provider: string) => provider as unknown as WireProviderId;

/** Upper bound on passages considered per query, so one huge index cannot stall the API. */
const MAX_SCANNED_CHUNKS = 20_000;
const MAX_CONTEXT_CHARACTERS = 12_000;

export interface QueryOverrides {
  topK?: number;
  scoreThreshold?: number;
  temperature?: number;
  strategy?: RetrievalStrategy;
}

export interface RetrievalOutcome {
  results: RetrievedChunk[];
  scanned: number;
  latencyMs: number;
  notes: string[];
  embeddingProvider: string;
  embeddingModel: string;
}

export interface AnswerInput {
  assistant: AssistantRuntimeConfig;
  question: string;
  history?: { role: "system" | "user" | "assistant"; content: string }[];
  overrides?: QueryOverrides;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  /* ------------------------------------------------------------- assistant */

  /** The assistant runtime config, optionally constrained to one workspace. */
  async loadAssistant(assistantId: string, workspaceId?: string): Promise<AssistantRuntimeConfig> {
    const assistant = await this.prisma.assistant.findFirst({
      where: { id: assistantId, ...(workspaceId ? { workspaceId } : {}) },
      include: { knowledgeBindings: { select: { knowledgeBaseId: true } } },
    });
    if (!assistant) throw new NotFoundException("Assistant not found");
    return this.toRuntimeConfig(assistant);
  }

  async toRuntimeConfig(assistant: {
    id: string;
    workspaceId: string;
    name: string;
    status: string;
    systemPrompt: string;
    model: Prisma.JsonValue;
    tone: Prisma.JsonValue | null;
    embedding: Prisma.JsonValue;
    rag: Prisma.JsonValue;
    knowledgeBindings: { knowledgeBaseId: string }[];
  }): Promise<AssistantRuntimeConfig> {
    return {
      id: assistant.id,
      workspaceId: assistant.workspaceId,
      name: assistant.name,
      status: assistant.status,
      systemPrompt: assistant.systemPrompt,
      tone: assistant.tone,
      model: withDefaults<ModelConfig>(assistant.model, {
        provider: "openai",
        model: "",
        temperature: 0.2,
        maxTokens: 1024,
        topP: 1,
        frequencyPenalty: 0,
      }),
      embedding: withDefaults<EmbeddingConfig>(assistant.embedding, DEFAULT_EMBEDDING),
      rag: withDefaults<RagConfig>(assistant.rag, DEFAULT_RAG),
      knowledgeBaseIds: assistant.knowledgeBindings.map(({ knowledgeBaseId }) => knowledgeBaseId),
    };
  }

  /* ------------------------------------------------------------- retrieval */

  /**
   * Passages for an assistant, read from the persisted index. A knowledge base
   * with no indexed documents simply contributes nothing, which is why an
   * assistant whose ingestion is still running answers "nothing relevant"
   * rather than failing.
   */
  async retrieve(
    assistant: AssistantRuntimeConfig,
    question: string,
    overrides: QueryOverrides = {},
  ): Promise<RetrievalOutcome> {
    const started = Date.now();
    const notes: string[] = [];
    const strategy = overrides.strategy ?? assistant.rag.strategy ?? "hybrid";
    const topK = clampInt(overrides.topK ?? assistant.rag.topK, 1, 50, 4);
    const threshold = clampNumber(
      overrides.scoreThreshold ?? assistant.rag.scoreThreshold,
      0,
      1,
      0,
    );

    const knowledgeBaseIds = assistant.knowledgeBaseIds;
    const embedder = createEmbedder(assistant.embedding, () => undefined);
    if (knowledgeBaseIds.length === 0) {
      return {
        results: [],
        scanned: 0,
        latencyMs: Date.now() - started,
        notes,
        embeddingProvider: embedder.provider,
        embeddingModel: embedder.model,
      };
    }

    const [rows, knowledgeBases] = await Promise.all([
      this.prisma.documentChunk.findMany({
        // Scoped by workspace as well as by knowledge base, so a binding that
        // somehow pointed across tenants still could not read another's data.
        where: {
          workspaceId: assistant.workspaceId,
          knowledgeBaseId: { in: knowledgeBaseIds },
          document: { status: "indexed" },
        },
        orderBy: [{ documentId: "asc" }, { index: "asc" }],
        take: MAX_SCANNED_CHUNKS,
        select: {
          id: true,
          documentId: true,
          knowledgeBaseId: true,
          workspaceId: true,
          index: true,
          content: true,
          tokens: true,
          vector: true,
          document: { select: { name: true } },
        },
      }),
      this.prisma.knowledgeBase.findMany({
        where: { id: { in: knowledgeBaseIds }, workspaceId: assistant.workspaceId },
        select: { id: true, name: true },
      }),
    ]);

    if (rows.length === 0) {
      return {
        results: [],
        scanned: 0,
        latencyMs: Date.now() - started,
        notes,
        embeddingProvider: embedder.provider,
        embeddingModel: embedder.model,
      };
    }

    // Never truncate in silence: an operator whose index outgrew the scan
    // budget needs to know the answer may be missing passages.
    if (rows.length >= MAX_SCANNED_CHUNKS) {
      notes.push(
        `This knowledge base holds at least ${MAX_SCANNED_CHUNKS} passages, which is this API's per-query scan limit; passages beyond that were not considered.`,
      );
    }

    const kbNames = new Map(knowledgeBases.map((entry) => [entry.id, entry.name]));
    const documentNames = new Map(rows.map((row) => [row.documentId, row.document.name]));

    // The vector half is skipped honestly when it cannot be produced: a vendor
    // embedder without a stored key, or a query vector whose width does not
    // match the index, would otherwise silently score zero everywhere.
    let queryVector: number[] | null = null;
    if (strategy !== "keyword") {
      const availability = await this.embedderAvailability(assistant);
      if (!availability.ok) {
        notes.push(
          `${availability.reason} This search used keyword matching only, so results may be narrower than usual.`,
        );
      } else {
        queryVector = (await embedder.embed([question], "query"))[0] ?? null;
      }
    }

    const candidates: StoredChunk[] = rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      knowledgeBaseId: row.knowledgeBaseId,
      workspaceId: row.workspaceId,
      index: row.index,
      content: row.content,
      tokens: row.tokens,
      vector: row.vector ?? [],
    }));

    if (queryVector) {
      const comparable = candidates.filter((chunk) => chunk.vector.length === queryVector!.length).length;
      if (comparable < candidates.length) {
        notes.push(
          `${candidates.length - comparable} of ${candidates.length} passages were indexed with a different embedding width than this assistant uses, so they could only be matched by keyword. Re-index the knowledge base to compare them numerically.`,
        );
      }
    }

    const { results, scanned } = searchChunks(candidates, question, {
      topK,
      strategy,
      threshold,
      queryVector,
    });

    const mapped: RetrievedChunk[] = results.map(({ chunk, score, vectorScore, keywordScore }) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: documentNames.get(chunk.documentId) ?? "Unknown document",
      knowledgeBaseId: chunk.knowledgeBaseId,
      knowledgeBaseName: kbNames.get(chunk.knowledgeBaseId) ?? "Knowledge base",
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
      latencyMs: Date.now() - started,
      notes,
      embeddingProvider: embedder.provider,
      embeddingModel: embedder.model,
    };
  }

  /* -------------------------------------------------------------- answering */

  async answer(input: AnswerInput): Promise<QueryResponse> {
    const started = Date.now();
    const { assistant, question } = input;
    const overrides = input.overrides ?? {};
    const ragEnabled = assistant.rag.enabled !== false;

    const retrieval = ragEnabled
      ? await this.retrieve(assistant, question, overrides)
      : {
          results: [] as RetrievedChunk[],
          scanned: 0,
          latencyMs: 0,
          notes: [] as string[],
          embeddingProvider: assistant.embedding.provider,
          embeddingModel: assistant.embedding.model,
        };

    const notes = [...retrieval.notes];
    if (!ragEnabled) {
      notes.push(
        "Retrieval is disabled for this assistant; the answer uses the system prompt alone.",
      );
    }

    const threshold = clampNumber(
      overrides.scoreThreshold ?? assistant.rag.scoreThreshold,
      0,
      1,
      0,
    );
    if (ragEnabled && retrieval.results.length === 0) {
      notes.push(
        `No passage scored above the ${(threshold * 100).toFixed(0)}% threshold across ${retrieval.scanned} indexed passages.`,
      );
    }

    const generate = await this.generationAvailability(assistant);
    const refuse =
      ragEnabled && retrieval.results.length === 0 && assistant.rag.noAnswerBehavior === "refuse";

    let content = "";
    let mode: ResponseMetadata["mode"] = "model";
    let promptTokens = 0;
    let completionTokens = 0;

    if (refuse) {
      mode = "extractive";
      content = assistant.rag.noAnswerMessage || DEFAULT_RAG.noAnswerMessage;
    } else if (!ragEnabled || retrieval.results.length === 0 || generate.ok) {
      if (!ragEnabled || retrieval.results.length === 0) {
        // Nothing retrieved and the assistant is allowed to answer anyway.
        const result = await this.tryGenerate(assistant, question, input.history, "", notes);
        if (result) {
          content = result.text;
          promptTokens = result.promptTokens;
          completionTokens = result.completionTokens;
        } else {
          mode = "extractive";
          content =
            retrieval.results.length > 0
              ? this.extractiveAnswer(question, retrieval.results)
              : "I could not find anything relevant in the connected knowledge bases for that question.";
        }
      } else {
        const context = buildContextBlock(retrieval.results, MAX_CONTEXT_CHARACTERS);
        const result = await this.tryGenerate(assistant, question, input.history, context, notes);
        if (result) {
          content = result.text;
          promptTokens = result.promptTokens;
          completionTokens = result.completionTokens;
        } else {
          mode = "extractive";
          content = this.extractiveAnswer(question, retrieval.results);
        }
      }
    } else {
      // A generation provider is configured but unusable for this workspace.
      mode = "extractive";
      content =
        retrieval.results.length > 0
          ? this.extractiveAnswer(question, retrieval.results)
          : "I could not find anything relevant in the connected knowledge bases for that question.";
      if (retrieval.results.length > 0) {
        notes.push(
          `${generate.reason} This answer was assembled directly from the retrieved passages instead of being generated.`,
        );
      }
    }

    const grounded = mode === "model" && /\[\d+\]/.test(content);
    const metadata: ResponseMetadata = {
      provider: assistant.model.provider,
      model: assistant.model.model,
      mode,
      latencyMs: Date.now() - started,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      retrievedCount: retrieval.results.length,
      contextCharacters: retrieval.results.reduce((sum, entry) => sum + entry.content.length, 0),
      scoreThreshold: threshold,
      topScore: retrieval.results[0]?.score ?? null,
      grounded,
      notes,
    };

    const message: ChatMessage = {
      id: `msg_${Math.random().toString(36).slice(2, 11)}`,
      role: "assistant",
      content: content || "No answer was produced.",
      createdAt: new Date().toISOString(),
      retrieved: retrieval.results,
      meta: metadata,
    };

    return { message, retrieved: retrieval.results };
  }

  /**
   * Persist the usage row the analytics screen and assistant stats read. The
   * question is kept so the "most asked" panel can rank real questions.
   */
  async recordUsage(
    assistant: AssistantRuntimeConfig,
    metadata: ResponseMetadata,
    kind: "query" | "widget_message",
    query?: string,
  ) {
    await this.prisma.usageEvent
      .create({
        data: {
          workspaceId: assistant.workspaceId,
          assistantId: assistant.id,
          kind,
          query: query?.slice(0, 2_000) ?? null,
          latencyMs: metadata.latencyMs,
          promptTokens: metadata.promptTokens,
          completionTokens: metadata.completionTokens,
          provider: metadata.provider,
          model: metadata.model,
          retrievedCount: metadata.retrievedCount,
          topScore: metadata.topScore,
        },
      })
      .catch((error: unknown) =>
        this.logger.warn(`usage write failed assistant=${assistant.id} ${String(error)}`),
      );
  }

  /* ---------------------------------------------------------------- helpers */

  /**
   * Whether the query can be embedded at all. The offline embedder always can;
   * a vendor embedder needs a stored key, and a provider whose wire format this
   * server does not implement is reported as such.
   */
  private async embedderAvailability(
    assistant: AssistantRuntimeConfig,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const provider = assistant.embedding.provider;
    if (!provider || provider === "local") return { ok: true };
    if (!(await this.providers.hasCredential(assistant.workspaceId, wire(provider)))) {
      return {
        ok: false,
        reason: `No ${provider} key is stored for this workspace, so the question could not be embedded.`,
      };
    }
    return { ok: true };
  }

  private async generationAvailability(
    assistant: AssistantRuntimeConfig,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const provider = assistant.model.provider;
    if (!provider) return { ok: false, reason: "This assistant has no model provider configured." };
    if (!assistant.model.model) {
      return { ok: false, reason: "This assistant has no model id configured." };
    }
    if (!requiresApiKey(wire(provider))) return { ok: true };
    if (!(await this.providers.hasCredential(assistant.workspaceId, wire(provider)))) {
      return {
        ok: false,
        reason: `No ${provider} key is stored for this workspace.`,
      };
    }
    return { ok: true };
  }

  private async tryGenerate(
    assistant: AssistantRuntimeConfig,
    question: string,
    history: AnswerInput["history"],
    context: string,
    notes: string[],
  ): Promise<{ text: string; promptTokens: number; completionTokens: number } | null> {
    const availability = await this.generationAvailability(assistant);
    if (!availability.ok) return null;

    const messages = buildGroundedMessages({ assistant, question, history: history ?? [], context });
    try {
      const result = await this.providers.chatForWorkspace(
        assistant.workspaceId,
        assistant.model.provider as never,
        {
          model: assistant.model.model,
          messages,
          temperature: assistant.model.temperature,
          maxTokens: assistant.model.maxTokens,
          topP: assistant.model.topP,
        },
      );
      if (result.finishReason === "length") {
        notes.push("The model hit the max token limit; the answer may be truncated.");
      }
      const text = result.text.trim();
      if (!text) {
        // A 200 with no usable text is still a failed answer: report it and let
        // the caller fall back to the extractive path rather than showing an
        // empty bubble.
        notes.push(
          "The model returned an empty response. This answer was assembled directly from the retrieved passages instead.",
        );
        return null;
      }
      return {
        text,
        promptTokens: result.promptTokens || estimateTokens(messages.map((m) => m.content).join(" ")),
        completionTokens: result.completionTokens || estimateTokens(result.text),
      };
    } catch (error) {
      // A vendor outage or a revoked key must not turn into an empty reply: the
      // caller falls back to the extractive answer and reports the reason.
      const message = (error as Error)?.message ?? "Generation failed.";
      notes.push(`Generation failed: ${message}`);
      return null;
    }
  }

  /**
   * Pick the sentences across the retrieved passages with the strongest
   * query-term coverage and present them with citations. Ported from
   * `extractiveAnswer` so both modes read the same.
   */
  private extractiveAnswer(question: string, results: RetrievedChunk[], limit = 3) {
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
}

/* ------------------------------------------------------------------ prompting */

export function buildContextBlock(results: RetrievedChunk[], maxCharacters = MAX_CONTEXT_CHARACTERS) {
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
  assistant: AssistantRuntimeConfig;
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

/* -------------------------------------------------------------------- numbers */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
