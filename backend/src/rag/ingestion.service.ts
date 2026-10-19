/**
 * Document ingestion — the server half of the knowledge pipeline.
 *
 * This is what turns an uploaded document into something retrievable. It runs
 * the same chunker and the same default embedder as the web client, writes the
 * resulting passages (with their vectors) into `DocumentChunk`, and drives the
 * document through the status ladder the UI renders: queued → processing →
 * chunking → embedding → indexing → indexed, or failed with a reason.
 *
 * Ingestion is deliberately queued rather than run inline with the HTTP
 * request: a large document can take seconds to embed, and the upload endpoint
 * should answer immediately with a `queued` document, exactly as the UI
 * expects. Every state change publishes `documents.changed` so the knowledge
 * screen updates live over the SSE channel instead of polling.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { Document, DocumentStatus, Prisma } from "@prisma/client";
import { EventsService } from "../events/events.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.service";
import { createEmbedder } from "./embedder";
import { chunkText } from "./chunker";
import { fetchSourceText, SourceFetchError } from "./net";

/** Documents waiting for the worker, in arrival order. */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly queue: string[] = [];
  private readonly pending = new Set<string>();
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly providers: ProvidersService,
  ) {}

  /**
   * Queue a document for (re-)indexing and return immediately. A document that
   * is already queued is left alone: the existing run will read the current row
   * and therefore the newest content and settings.
   */
  schedule(documentId: string) {
    if (this.pending.has(documentId)) return;
    this.pending.add(documentId);
    this.queue.push(documentId);
    void this.drain();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const documentId = this.queue.shift()!;
        this.pending.delete(documentId);
        try {
          await this.run(documentId);
        } catch (error) {
          // `run` records its own failures; this guards the worker itself so a
          // single bad document can never stall the queue.
          this.logger.error(
            `ingestion worker failed document=${documentId} error=${(error as Error).message}`,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    // Deleted while it sat in the queue.
    if (!document) return;

    const started = Date.now();
    try {
      await this.stage(document, "processing", 0.08);

      const text = await this.resolveText(document);
      if (!text.trim()) {
        throw new Error("This source contained no text that could be indexed.");
      }
      await this.stage(document, "chunking", 0.28);

      const pieces = chunkText(text, {
        chunkSize: document.chunkSize,
        chunkOverlap: document.chunkOverlap,
      });
      if (pieces.length === 0) {
        throw new Error("Document contained no indexable text after cleaning.");
      }

      await this.stage(document, "embedding", 0.5);
      const dimensions = document.embeddingDimensions || 384;
      const credentials = await this.providers.credentials(
        document.workspaceId,
        document.embeddingProvider as never,
      );
      const embedder = createEmbedder(
        {
          provider: document.embeddingProvider,
          model: document.embeddingModel,
          dimensions,
        },
        () => credentials ?? undefined,
      );
      const vectors = await embedder.embed(pieces.map((piece) => piece.content));

      await this.stage(document, "indexing", 0.9);

      const rows = pieces.map((piece, index) => ({
        workspaceId: document.workspaceId,
        knowledgeBaseId: document.knowledgeBaseId,
        documentId: document.id,
        index,
        content: piece.content,
        tokens: piece.tokens,
        dimensions: vectors[index]?.length ?? 0,
        vector: vectors[index] ?? [],
      }));

      // Replace the previous index atomically: a reader either sees the whole
      // old index or the whole new one, never a half-deleted document.
      await this.prisma.$transaction([
        this.prisma.documentChunk.deleteMany({ where: { documentId: document.id } }),
        this.prisma.documentChunk.createMany({ data: rows }),
        this.prisma.document.update({
          where: { id: document.id },
          data: {
            // Persist the extracted text: a `url` source had none until now,
            // which is what made its content viewer and its index empty.
            content: text,
            characters: text.length,
            sizeBytes:
              document.source === "url"
                ? Buffer.byteLength(text, "utf8")
                : document.sizeBytes,
            tokenEstimate: Math.ceil(text.length / 4),
            chunkCount: rows.length,
            status: "indexed",
            progress: 1,
            error: null,
            indexedAt: new Date(),
          },
        }),
      ]);

      await this.recordActivity(document, "document.indexed", `Indexed "${document.name}"`, `${rows.length} passages`);
      this.logger.log(
        `indexed document=${document.id} source=${document.source} chunks=${rows.length} embedder=${embedder.provider}/${embedder.model} latency=${Date.now() - started}ms`,
      );
      this.publish(document);
    } catch (error) {
      const message =
        error instanceof SourceFetchError || error instanceof Error
          ? (error as Error).message
          : "Indexing failed.";
      await this.prisma.document
        .update({
          where: { id: document.id },
          data: { status: "failed", progress: 0, chunkCount: 0, error: message.slice(0, 500), indexedAt: null },
        })
        .catch(() => undefined);
      await this.recordActivity(document, "document.failed", `Failed to index "${document.name}"`, message);
      this.logger.warn(
        `indexing failed document=${document.id} source=${document.source} reason=${message}`,
      );
      this.publish(document);
    }
  }

  /**
   * The text a document should be indexed from. Uploaded text was extracted in
   * the browser and stored at upload time; a URL source is fetched here, on the
   * server, where there is no CORS restriction on the target.
   */
  private async resolveText(document: Document): Promise<string> {
    if (document.source === "url" && document.sourceUrl) {
      return fetchSourceText(document.sourceUrl);
    }
    return document.content ?? "";
  }

  private async stage(document: Document, status: DocumentStatus, progress: number) {
    await this.prisma.document.update({
      where: { id: document.id },
      data: { status, progress },
    });
    this.publish(document);
  }

  private publish(document: { workspaceId: string; knowledgeBaseId: string }) {
    this.events.publish({
      type: "documents.changed",
      workspaceId: document.workspaceId,
      knowledgeBaseId: document.knowledgeBaseId,
    });
  }

  private async recordActivity(
    document: Document,
    kind: "document.indexed" | "document.failed",
    summary: string,
    detail: string,
  ) {
    await this.prisma.activityEvent
      .create({
        data: {
          workspaceId: document.workspaceId,
          kind,
          summary,
          detail: detail.slice(0, 500),
          actor: "System",
          isSample: false,
        },
      })
      .catch((error: unknown) =>
        this.logger.warn(`activity write failed document=${document.id} ${String(error)}`),
      );
  }
}

/** Prisma payload type for the chunk insert, kept close to its use. */
export type DocumentChunkInsert = Prisma.DocumentChunkCreateManyInput;
