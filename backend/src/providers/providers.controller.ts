import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { ProviderId, SetProviderKeyDto, VerifyProviderKeyDto } from "./providers.dto";
import { ProvidersService } from "./providers.service";

@Controller("provider-keys")
@UseGuards(AuthGuard)
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
  ) {
    return this.providers.list(auth.userId, workspaceId);
  }

  @Post()
  set(@CurrentAuth() auth: AuthenticatedRequest["auth"], @Body() input: SetProviderKeyDto) {
    return this.providers.set(auth.userId, input);
  }

  @Delete(":provider")
  remove(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("provider") provider: ProviderId,
    @Query("workspaceId") workspaceId: string,
  ) {
    return this.providers.remove(auth.userId, workspaceId, provider);
  }

  @Post(":provider/verify")
  verify(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("provider") provider: ProviderId,
    @Body() result: VerifyProviderKeyDto,
  ) {
    return this.providers.markVerified(auth.userId, result.workspaceId, provider, result);
  }
}
