import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentSource } from "@prisma/client";
import { EventsService } from "../events/events.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AddFileDocumentDto,
  AddTextDocumentDto,
  AddUrlDocumentDto,
  CreateKnowledgeBaseDto,
  UpdateDocumentDto,
  UpdateKnowledgeBaseDto,
} from "./knowledge.dto";

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async list(userId: string, workspaceId: string) {
    await this.requireWorkspace(userId, workspaceId);
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: { workspaceId },
      include: { documents: { select: { chunkCount: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return knowledgeBases.map((knowledgeBase) => ({
      id: knowledgeBase.id,
      workspaceId: knowledgeBase.workspaceId,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      documentCount: knowledgeBase.documents.length,
      chunkCount: knowledgeBase.documents.reduce((total, document) => total + document.chunkCount, 0),
      createdAt: knowledgeBase.createdAt.toISOString(),
      updatedAt: knowledgeBase.updatedAt.toISOString(),
    }));
  }

  async create(userId: string, workspaceId: string, input: CreateKnowledgeBaseDto) {
    await this.requireWorkspace(userId, workspaceId);
    const knowledgeBase = await this.prisma.knowledgeBase.create({
      data: { workspaceId, name: input.name.trim(), description: input.description },
    });
    this.events.publish({ type: "knowledge.changed", workspaceId });
    return {
      id: knowledgeBase.id,
      workspaceId: knowledgeBase.workspaceId,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      documentCount: 0,
      chunkCount: 0,
      createdAt: knowledgeBase.createdAt.toISOString(),
      updatedAt: knowledgeBase.updatedAt.toISOString(),
    };
  }

  async update(userId: string, knowledgeBaseId: string, patch: UpdateKnowledgeBaseDto) {
    await this.requireKnowledgeBase(userId, knowledgeBaseId);
    const knowledgeBase = await this.prisma.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: patch,
    });
    this.events.publish({ type: "knowledge.changed", workspaceId: knowledgeBase.workspaceId });
    return {
      id: knowledgeBase.id,
      workspaceId: knowledgeBase.workspaceId,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      documentCount: await this.prisma.document.count({ where: { knowledgeBaseId } }),
      chunkCount: (await this.prisma.document.aggregate({
        where: { knowledgeBaseId },
        _sum: { chunkCount: true },
      }))._sum.chunkCount ?? 0,
      createdAt: knowledgeBase.createdAt.toISOString(),
      updatedAt: knowledgeBase.updatedAt.toISOString(),
    };
  }

  async remove(userId: string, knowledgeBaseId: string) {
    const knowledgeBase = await this.requireKnowledgeBase(userId, knowledgeBaseId);
    await this.prisma.knowledgeBase.delete({ where: { id: knowledgeBaseId } });
    this.events.publish({ type: "knowledge.changed", workspaceId: knowledgeBase.workspaceId });
  }

  async documents(userId: string, knowledgeBaseId: string) {
    await this.requireKnowledgeBase(userId, knowledgeBaseId);
    const documents = await this.prisma.document.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: "desc" },
    });
    return documents.map((document) => this.serializeDocument(document));
  }

  async addText(
    userId: string,
    knowledgeBaseId: string,
    input: AddTextDocumentDto,
  ) {
    const knowledgeBase = await this.requireKnowledgeBase(userId, knowledgeBaseId);
    return this.createDocument(knowledgeBase.workspaceId, knowledgeBaseId, {
      name: input.name,
      content: input.content,
      source: DocumentSource.text,
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(input.content, "utf8"),
      embedding: input.embedding,
    });
  }

  async addFile(
    userId: string,
    knowledgeBaseId: string,
    input: AddFileDocumentDto,
  ) {
    const knowledgeBase = await this.requireKnowledgeBase(userId, knowledgeBaseId);
    return this.createDocument(knowledgeBase.workspaceId, knowledgeBaseId, {
      name: input.file.name,
      content: input.file.text,
      source: DocumentSource.file,
      mimeType: input.file.type || "application/octet-stream",
      sizeBytes: input.file.size,
      embedding: input.embedding,
    });
  }

  async addUrl(userId: string, knowledgeBaseId: string, input: AddUrlDocumentDto) {
    const knowledgeBase = await this.requireKnowledgeBase(userId, knowledgeBaseId);
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new BadRequestException("A valid source URL is required");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new BadRequestException("Only HTTP and HTTPS sources are supported");
    }
    return this.createDocument(knowledgeBase.workspaceId, knowledgeBaseId, {
      name: url.hostname,
      content: "",
      source: DocumentSource.url,
      sourceUrl: url.toString(),
      mimeType: "text/html",
      sizeBytes: 0,
      embedding: input.embedding,
    });
  }

  async updateDocument(userId: string, documentId: string, patch: UpdateDocumentDto) {
    const document = await this.requireDocument(userId, documentId);
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.content !== undefined
          ? {
              content: patch.content,
              sizeBytes: Buffer.byteLength(patch.content, "utf8"),
              characters: patch.content.length,
              tokenEstimate: Math.ceil(patch.content.length / 4),
              status: "queued",
              progress: 0,
              chunkCount: 0,
              indexedAt: null,
            }
          : {}),
        ...(patch.embedding
          ? {
              embeddingProvider: String(patch.embedding.provider ?? "local"),
              embeddingModel: String(patch.embedding.model ?? "pyre-hash-384"),
              status: "queued",
              progress: 0,
              chunkCount: 0,
              indexedAt: null,
            }
          : {}),
      },
    });
    this.publishDocumentsChanged(document.workspaceId, document.knowledgeBaseId);
    return this.serializeDocument(updated);
  }

  async content(userId: string, documentId: string) {
    const document = await this.requireDocument(userId, documentId);
    return { content: document.content };
  }

  async removeDocument(userId: string, documentId: string) {
    const document = await this.requireDocument(userId, documentId);
    await this.prisma.document.delete({ where: { id: documentId } });
    this.publishDocumentsChanged(document.workspaceId, document.knowledgeBaseId);
  }

  async removeAllDocuments(userId: string, knowledgeBaseId: string) {
    const knowledgeBase = await this.requireKnowledgeBase(userId, knowledgeBaseId);
    await this.prisma.document.deleteMany({ where: { knowledgeBaseId } });
    this.publishDocumentsChanged(knowledgeBase.workspaceId, knowledgeBaseId);
  }

  async reindex(userId: string, knowledgeBaseId: string, embedding: Record<string, unknown>) {
    const knowledgeBase = await this.requireKnowledgeBase(userId, knowledgeBaseId);
    await this.prisma.document.updateMany({
      where: { knowledgeBaseId },
      data: {
        embeddingProvider: String(embedding.provider ?? "local"),
        embeddingModel: String(embedding.model ?? "pyre-hash-384"),
        status: "queued",
        progress: 0,
        chunkCount: 0,
        indexedAt: null,
      },
    });
    this.publishDocumentsChanged(knowledgeBase.workspaceId, knowledgeBaseId);
  }

  private async createDocument(
    workspaceId: string,
    knowledgeBaseId: string,
    input: {
      name: string;
      content: string;
      source: DocumentSource;
      sourceUrl?: string;
      mimeType: string;
      sizeBytes: number;
      embedding: Record<string, unknown>;
    },
  ) {
    const document = await this.prisma.document.create({
      data: {
        workspaceId,
        knowledgeBaseId,
        name: input.name,
        content: input.content,
        source: input.source,
        sourceUrl: input.sourceUrl,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        characters: input.content.length,
        tokenEstimate: Math.ceil(input.content.length / 4),
        embeddingProvider: String(input.embedding.provider ?? "local"),
        embeddingModel: String(input.embedding.model ?? "pyre-hash-384"),
        status: "queued",
        progress: 0,
      },
    });
    this.publishDocumentsChanged(workspaceId, knowledgeBaseId);
    return this.serializeDocument(document);
  }

  /** Ingestion runs client-side, so clients re-read the affected document list. */
  private publishDocumentsChanged(workspaceId: string, knowledgeBaseId: string) {
    this.events.publish({ type: "documents.changed", workspaceId, knowledgeBaseId });
  }

  private async requireWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new NotFoundException("Workspace not found");
  }

  private async requireKnowledgeBase(userId: string, knowledgeBaseId: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, workspace: { memberships: { some: { userId } } } },
      select: { id: true, workspaceId: true },
    });
    if (!knowledgeBase) throw new NotFoundException("Knowledge base not found");
    return knowledgeBase;
  }

  private async requireDocument(userId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, workspace: { memberships: { some: { userId } } } },
    });
    if (!document) throw new NotFoundException("Document not found");
    return document;
  }

  private serializeDocument(document: {
    id: string;
    workspaceId: string;
    knowledgeBaseId: string;
    name: string;
    source: DocumentSource;
    sourceUrl: string | null;
    mimeType: string;
    sizeBytes: number;
    characters: number;
    status: string;
    progress: number;
    chunkCount: number;
    tokenEstimate: number;
    embeddingProvider: string;
    embeddingModel: string;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    indexedAt: Date | null;
  }) {
    return {
      id: document.id,
      workspaceId: document.workspaceId,
      knowledgeBaseId: document.knowledgeBaseId,
      name: document.name,
      source: document.source,
      ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      characters: document.characters,
      status: document.status,
      progress: document.progress,
      chunkCount: document.chunkCount,
      tokenEstimate: document.tokenEstimate,
      embeddingProvider: document.embeddingProvider,
      embeddingModel: document.embeddingModel,
      error: document.error,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      indexedAt: document.indexedAt?.toISOString() ?? null,
    };
  }
}
