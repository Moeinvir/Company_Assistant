import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, workspaceId: string, assistantId?: string) {
    await this.requireWorkspace(userId, workspaceId);
    const conversations = await this.prisma.conversation.findMany({
      where: {
        workspaceId,
        ...(assistantId ? { assistantId } : {}),
      },
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return conversations.map((conversation) => ({
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      assistantId: conversation.assistantId,
      title: conversation.title,
      channel: conversation.channel,
      messageCount: conversation._count.messages,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    }));
  }

  async messages(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        workspace: { memberships: { some: { userId } } },
      },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    }));
  }

  async clear(userId: string, workspaceId: string) {
    await this.requireWorkspace(userId, workspaceId);
    await this.prisma.conversation.deleteMany({ where: { workspaceId } });
  }

  private async requireWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new NotFoundException("Workspace not found");
  }
}
