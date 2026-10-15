import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import {
  ProviderChatRequestDto,
  ProviderCheckDto,
  ProviderId,
  SetProviderKeyDto,
  VerifyProviderKeyDto,
} from "./providers.dto";
import { ProvidersService } from "./providers.service";

/**
 * Provider credentials and the server-side provider proxy.
 *
 * Keys are stored encrypted per workspace and are never returned; every call
 * that needs a vendor — connection check, model discovery, chat completion —
 * happens here, so the browser never holds a secret and no provider request
 * originates from the browser (which is what causes CORS failures).
 */
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

  /**
   * Discovery for the stored credential. The UI needs this to offer real model
   * ids (OpenRouter publishes hundreds, a custom gateway whatever it serves).
   */
  @Get(":provider/models")
  models(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("provider") provider: ProviderId,
    @Query("workspaceId") workspaceId: string,
    @Query("baseUrl") baseUrl?: string,
  ) {
    return this.providers.models(auth.userId, workspaceId, provider, baseUrl);
  }

  /** Probe a connection, optionally with a key that is not stored yet. */
  @Post(":provider/check")
  check(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("provider") provider: ProviderId,
    @Body() body: ProviderCheckDto,
  ) {
    return this.providers.check(auth.userId, body.workspaceId, provider, {
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
    });
  }

  /** Server-side chat completion: frontend → API → provider → API → frontend. */
  @Post(":provider/chat")
  chat(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("provider") provider: ProviderId,
    @Body() body: ProviderChatRequestDto,
  ) {
    return this.providers.chat(auth.userId, body.workspaceId, provider, {
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      topP: body.topP,
      baseUrl: body.baseUrl,
    });
  }

  /** Persist the outcome of a check onto the stored credential. */
  @Post(":provider/verify")
  verify(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Param("provider") provider: ProviderId,
    @Body() result: VerifyProviderKeyDto,
  ) {
    return this.providers.markVerified(auth.userId, result.workspaceId, provider, {
      ok: result.ok,
      message: result.message,
    });
  }
}
