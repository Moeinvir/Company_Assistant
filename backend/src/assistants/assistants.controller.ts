import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { AssistantsService } from "./assistants.service";
import { CreateAssistantDto, UpdateAssistantDto } from "./assistants.dto";

@Controller("assistants")
@UseGuards(AuthGuard)
export class AssistantsController {
  constructor(private readonly assistants: AssistantsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
  ) {
    return this.assistants.list(auth.userId, workspaceId);
  }

  @Get(":assistantId")
  get(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("assistantId") assistantId: string,
  ) {
    return this.assistants.get(auth.userId, assistantId);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Body() input: CreateAssistantDto & { workspaceId: string },
  ) {
    return this.assistants.create(auth.userId, input.workspaceId, input);
  }

  @Patch(":assistantId")
  update(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("assistantId") assistantId: string,
    @Body() patch: UpdateAssistantDto,
  ) {
    return this.assistants.update(auth.userId, assistantId, patch);
  }

  @Post(":assistantId/duplicate")
  duplicate(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("assistantId") assistantId: string,
  ) {
    return this.assistants.duplicate(auth.userId, assistantId);
  }

  @Delete(":assistantId")
  remove(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("assistantId") assistantId: string,
  ) {
    return this.assistants.remove(auth.userId, assistantId);
  }
}
