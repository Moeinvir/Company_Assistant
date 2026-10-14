import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { EventsService } from "../events/events.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssistantDto, UpdateAssistantDto } from "./assistants.dto";

const EMPTY_STATS = {
  conversations: 0,
  messages: 0,
  tokensUsed: 0,
  avgLatencyMs: 0,
  lastActivityAt: null,
};

@Injectable()
export class AssistantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async list(userId: string, workspaceId: string) {
    await this.requireWorkspace(userId, workspaceId);
    const assistants = await this.prisma.assistant.findMany({
      where: { workspaceId },
      include: { knowledgeBindings: { select: { knowledgeBaseId: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return assistants.map((assistant) => this.serialize(assistant));
  }

  async get(userId: string, assistantId: string) {
    return this.serialize(await this.requireAssistant(userId, assistantId));
  }

  async create(userId: string, workspaceId: string, input: CreateAssistantDto) {
    await this.requireWorkspace(userId, workspaceId);
    await this.validateKnowledgeBases(workspaceId, input.knowledgeBaseIds);
    const assistant = await this.prisma.assistant.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        description: input.description,
        status: input.status,
        systemPrompt: input.systemPrompt,
        model: input.model as Prisma.InputJsonValue,
        tone: input.tone as Prisma.InputJsonValue | undefined,
        embedding: input.embedding as Prisma.InputJsonValue,
        rag: input.rag as Prisma.InputJsonValue,
        widget: input.widget as Prisma.InputJsonValue,
        stats: EMPTY_STATS,
        publicKey: randomUUID(),
        knowledgeBindings: {
          create: input.knowledgeBaseIds.map((knowledgeBaseId) => ({ knowledgeBaseId })),
        },
      },
      include: { knowledgeBindings: { select: { knowledgeBaseId: true } } },
    });
    this.publishChanged(workspaceId);
    return this.serialize(assistant);
  }

  async update(userId: string, assistantId: string, patch: UpdateAssistantDto) {
    const current = await this.requireAssistant(userId, assistantId);
    if (patch.knowledgeBaseIds) {
      await this.validateKnowledgeBases(current.workspaceId, patch.knowledgeBaseIds);
    }
    const data: Prisma.AssistantUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.systemPrompt !== undefined) data.systemPrompt = patch.systemPrompt;
    if (patch.model !== undefined) data.model = patch.model as Prisma.InputJsonValue;
    if (patch.tone !== undefined) data.tone = patch.tone as Prisma.InputJsonValue;
    if (patch.embedding !== undefined) data.embedding = patch.embedding as Prisma.InputJsonValue;
    if (patch.rag !== undefined) data.rag = patch.rag as Prisma.InputJsonValue;
    if (patch.widget !== undefined) data.widget = patch.widget as Prisma.InputJsonValue;
    if (patch.knowledgeBaseIds !== undefined) {
      data.knowledgeBindings = {
        deleteMany: {},
        create: patch.knowledgeBaseIds.map((knowledgeBaseId) => ({ knowledgeBaseId })),
      };
    }
    const assistant = await this.prisma.assistant.update({
      where: { id: assistantId },
      data,
      include: { knowledgeBindings: { select: { knowledgeBaseId: true } } },
    });
    this.publishChanged(assistant.workspaceId);
    return this.serialize(assistant);
  }

  async duplicate(userId: string, assistantId: string) {
    const source = await this.requireAssistant(userId, assistantId);
    const duplicate = await this.prisma.assistant.create({
      data: {
        workspaceId: source.workspaceId,
        name: `${source.name} copy`,
        description: source.description,
        status: "draft",
        systemPrompt: source.systemPrompt,
        model: source.model as Prisma.InputJsonValue,
        ...(source.tone ? { tone: source.tone as Prisma.InputJsonValue } : {}),
        embedding: source.embedding as Prisma.InputJsonValue,
        rag: source.rag as Prisma.InputJsonValue,
        widget: source.widget as Prisma.InputJsonValue,
        stats: EMPTY_STATS,
        publicKey: randomUUID(),
        knowledgeBindings: {
          create: source.knowledgeBindings.map(({ knowledgeBaseId }) => ({ knowledgeBaseId })),
        },
      },
      include: { knowledgeBindings: { select: { knowledgeBaseId: true } } },
    });
    this.publishChanged(duplicate.workspaceId);
    return this.serialize(duplicate);
  }

  async remove(userId: string, assistantId: string) {
    const assistant = await this.requireAssistant(userId, assistantId);
    await this.prisma.assistant.delete({ where: { id: assistantId } });
    this.publishChanged(assistant.workspaceId);
  }

  private publishChanged(workspaceId: string) {
    this.events.publish({ type: "assistants.changed", workspaceId });
  }

  private async requireWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new NotFoundException("Workspace not found");
  }

  private async requireAssistant(userId: string, assistantId: string) {
    const assistant = await this.prisma.assistant.findFirst({
      where: { id: assistantId, workspace: { memberships: { some: { userId } } } },
      include: { knowledgeBindings: { select: { knowledgeBaseId: true } } },
    });
    if (!assistant) throw new NotFoundException("Assistant not found");
    return assistant;
  }

  private async validateKnowledgeBases(workspaceId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const count = await this.prisma.knowledgeBase.count({
      where: { id: { in: uniqueIds }, workspaceId },
    });
    if (count !== uniqueIds.length) throw new NotFoundException("Knowledge base not found in workspace");
  }

  private serialize(assistant: {
    id: string;
    workspaceId: string;
    name: string;
    description: string;
    status: string;
    systemPrompt: string;
    model: Prisma.JsonValue;
    tone: Prisma.JsonValue | null;
    embedding: Prisma.JsonValue;
    rag: Prisma.JsonValue;
    widget: Prisma.JsonValue;
    publicKey: string;
    stats: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
    knowledgeBindings: { knowledgeBaseId: string }[];
  }) {
    return {
      id: assistant.id,
      workspaceId: assistant.workspaceId,
      name: assistant.name,
      description: assistant.description,
      status: assistant.status,
      systemPrompt: assistant.systemPrompt,
      model: assistant.model,
      ...(assistant.tone ? { tone: assistant.tone } : {}),
      embedding: assistant.embedding,
      rag: assistant.rag,
      widget: assistant.widget,
      knowledgeBaseIds: assistant.knowledgeBindings.map(({ knowledgeBaseId }) => knowledgeBaseId),
      publicKey: assistant.publicKey,
      stats: assistant.stats,
      createdAt: assistant.createdAt.toISOString(),
      updatedAt: assistant.updatedAt.toISOString(),
    };
  }
}
