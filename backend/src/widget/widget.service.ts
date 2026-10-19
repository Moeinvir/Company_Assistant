import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EventsService } from "../events/events.service";
import { PrismaService } from "../prisma/prisma.service";
import { RetrievalService } from "../rag/retrieval.service";
import type { QueryResponse } from "../rag/rag.types";

/**
 * The embeddable widget's public API.
 *
 * Everything here is reached without a session, keyed only by an assistant's
 * public key, so three rules hold:
 *  • the key identifies exactly one assistant and nothing else — a query reads
 *    only the knowledge bases that assistant is bound to, inside its own
 *    workspace;
 *  • a caller may only continue a conversation belonging to the same assistant
 *    on the widget channel, so a guessed id cannot read or extend a thread it
 *    does not own;
 *  • nothing about the workspace, its other assistants, its keys or its
 *    membership is ever included in a response.
 */
@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly events: EventsService,
  ) {}

  /** Presentation and capability data for the widget runtime. */
  async config(publicKey: string) {
    const assistant = await this.requireAssistant(publicKey);
    const knowledgeBaseIds = assistant.knowledgeBindings.map(
      ({ knowledgeBaseId }) => knowledgeBaseId,
    );

    const knowledgeBaseCount = await this.prisma.knowledgeBase.count({
      where: { id: { in: knowledgeBaseIds }, workspaceId: assistant.workspaceId },
    });
    const documentWhere: Prisma.DocumentWhereInput = {
      knowledgeBaseId: { in: knowledgeBaseIds },
      workspaceId: assistant.workspaceId,
      status: "indexed",
    };
    const [documentCount, documentNames] = await Promise.all([
      this.prisma.document.count({ where: documentWhere }),
      this.prisma.document.findMany({
        where: documentWhere,
        orderBy: { createdAt: "asc" },
        take: 3,
        select: { name: true },
      }),
    ]);

    return {
      assistantId: assistant.id,
      name: assistant.name,
      description: assistant.description,
      widget: assistant.widget,
      publicKey,
      knowledgeBaseCount,
      documentCount,
      hints: documentNames.map((document) => `What does "${document.name}" cover?`),
    };
  }

  /** Answer one visitor message, persisting the conversation for follow-ups. */
  async query(publicKey: string, input: { question: string; conversationId?: string }) {
    const assistant = await this.requireAssistant(publicKey);
    const question = input.question.trim();
    if (!question) throw new NotFoundException("Type a question first.");

    // Ownership check: a conversation id is honoured only when it belongs to
    // this assistant on this channel.
    const owned = input.conversationId
      ? await this.prisma.conversation.findFirst({
          where: { id: input.conversationId, assistantId: assistant.id, channel: "widget" },
          select: { id: true },
        })
      : null;

    // The most recent turns, oldest first — the same window the client keeps.
    const history = owned
      ? (
          await this.prisma.message.findMany({
            where: { conversationId: owned.id },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { role: true, content: true },
          })
        )
          .reverse()
          .map((message) => ({
            role: message.role as "system" | "user" | "assistant",
            content: message.content,
          }))
      : [];

    const runtime = await this.retrieval.toRuntimeConfig(assistant);
    const response = await this.retrieval.answer({ assistant: runtime, question, history });
    const metadata = response.message.meta;

    const conversationId = await this.persistTurn({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      question,
      response,
      conversationId: owned?.id,
    });

    if (metadata) {
      await this.retrieval.recordUsage(runtime, metadata, "widget_message", question);
    }
    await this.prisma.activityEvent
      .create({
        data: {
          workspaceId: assistant.workspaceId,
          kind: "query.run",
          summary: `Widget question answered for "${assistant.name}"`,
          detail: `${metadata?.retrievedCount ?? 0} passage(s) retrieved`,
          actor: "Widget",
          isSample: false,
        },
      })
      .catch(() => undefined);

    // Signed-in members watching the dashboard see the activity live.
    this.events.publish({ type: "assistants.changed", workspaceId: assistant.workspaceId });
    this.events.publish({ type: "activity.changed", workspaceId: assistant.workspaceId });

    return { response, conversationId };
  }

  private async persistTurn(input: {
    assistantId: string;
    workspaceId: string;
    question: string;
    response: QueryResponse;
    conversationId?: string;
  }): Promise<string> {
    const { assistantId, workspaceId, question, response } = input;

    const conversation = input.conversationId
      ? await this.prisma.conversation.update({
          where: { id: input.conversationId },
          data: { updatedAt: new Date() },
          select: { id: true },
        })
      : await this.prisma.conversation.create({
          data: { workspaceId, assistantId, title: question.slice(0, 60), channel: "widget" },
          select: { id: true },
        });

    await this.prisma.message.createMany({
      data: [
        { conversationId: conversation.id, role: "user", content: question },
        {
          conversationId: conversation.id,
          role: "assistant",
          content: response.message.content,
          metadata: (response.message.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      ],
    });

    return conversation.id;
  }

  /**
   * Resolve a public key to a servable assistant.
   *
   * Two switches decide whether the widget serves visitors, and both are
   * operator controls: the per-assistant "Widget is live" toggle in the widget
   * builder, and the assistant's own status. `draft` is a configuration state
   * (the assistant is being built) and does not gate the public surface — the
   * widget switch does — while `paused` is an explicit kill switch and always
   * refuses. An unknown key is a 404 that confirms nothing about the workspace.
   */
  private async requireAssistant(publicKey: string) {
    const assistant = await this.prisma.assistant.findUnique({
      where: { publicKey },
      include: { knowledgeBindings: { select: { knowledgeBaseId: true } } },
    });
    if (!assistant) {
      this.logger.warn("widget request for an unknown public key");
      throw new NotFoundException("This widget key is not recognised.");
    }

    const widget = (assistant.widget ?? {}) as { enabled?: boolean };
    if (widget.enabled === false) {
      throw new ForbiddenException("This widget is currently disabled by its owner.");
    }
    if (assistant.status === "paused") {
      throw new ForbiddenException("This assistant is paused.");
    }
    return assistant;
  }
}
