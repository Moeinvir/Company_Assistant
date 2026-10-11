import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { CreateWorkspaceDto, UpdateWorkspaceDto } from "./workspaces.dto";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentAuth() auth: AuthenticatedRequest["auth"]) {
    return this.workspaces.list(auth.userId);
  }

  @Post()
  create(@CurrentAuth() auth: AuthenticatedRequest["auth"], @Body() input: CreateWorkspaceDto) {
    return this.workspaces.create(auth.userId, input);
  }

  @Patch(":workspaceId")
  update(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("workspaceId") workspaceId: string,
    @Body() patch: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(auth.userId, workspaceId, patch);
  }

  @Delete(":workspaceId")
  remove(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.workspaces.remove(auth.userId, workspaceId);
  }

  @Get(":workspaceId/members")
  members(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.workspaces.members(auth.userId, workspaceId);
  }
}
