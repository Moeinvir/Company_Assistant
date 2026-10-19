import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { EventsService } from "../events/events.service";
import { CreateWorkspaceDto, UpdateWorkspaceDto } from "./workspaces.dto";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly events: EventsService,
  ) {}

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

  /**
   * Live change feed for one workspace. `EventSource` cannot send headers, so
   * this route is authenticated with the `?token=` query parameter that the web
   * client appends; membership is verified before any event is streamed.
   */
  @Sse(":workspaceId/events")
  async eventStream(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("workspaceId") workspaceId: string,
  ): Promise<Observable<MessageEvent>> {
    await this.workspaces.requireMembership(auth.userId, workspaceId);
    return this.events.stream(workspaceId);
  }

  @Get(":workspaceId/members")
  members(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.workspaces.members(auth.userId, workspaceId);
  }

  /**
   * Remove every record this workspace is flagged as sample data.
   *
   * A workspace created through this API holds no sample records, so the honest
   * answer is "nothing to remove" rather than an error — but the route exists
   * because the settings screen calls it, and a 404 there reads like a bug.
   * Only rows explicitly flagged `isSample` are touched: real content is never
   * deleted by this endpoint.
   */
  @Post("sample-data/clear")
  clearSampleData(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
  ) {
    return this.workspaces.clearSampleData(auth.userId, workspaceId);
  }
}
