import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { QueryDto, SearchDto } from "./playground.dto";
import { PlaygroundService } from "./playground.service";

/**
 * Playground surface. Authenticated, and every request is scoped to the
 * assistant's own workspace, so one tenant can never query another's index.
 */
@Controller("playground")
@UseGuards(AuthGuard)
export class PlaygroundController {
  constructor(private readonly playground: PlaygroundService) {}

  @Post("query")
  query(@CurrentAuth() auth: AuthenticatedRequest["auth"], @Body() input: QueryDto) {
    return this.playground.query(auth.userId, input);
  }

  @Post("search")
  search(@CurrentAuth() auth: AuthenticatedRequest["auth"], @Body() input: SearchDto) {
    return this.playground.search(auth.userId, input);
  }
}
