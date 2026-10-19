import { Controller, Delete, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { ConversationsService } from "./conversations.service";

@Controller("conversations")
@UseGuards(AuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
    @Query("assistantId") assistantId?: string,
  ) {
    return this.conversations.list(auth.userId, workspaceId, assistantId);
  }

  @Get(":conversationId/messages")
  messages(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.messages(auth.userId, conversationId);
  }

  @Delete()
  clear(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
  ) {
    return this.conversations.clear(auth.userId, workspaceId);
  }
}
