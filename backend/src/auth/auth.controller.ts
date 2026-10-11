import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";
import { SignInDto, SignUpDto } from "./auth.dto";
import { CurrentAuth } from "./current-auth.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("sign-up")
  signUp(@Body() input: SignUpDto) {
    return this.auth.signUp(input);
  }

  @Post("sign-in")
  signIn(@Body() input: SignInDto) {
    return this.auth.signIn(input);
  }

  @Get("session")
  @UseGuards(AuthGuard)
  restore(@CurrentAuth() auth: AuthenticatedRequest["auth"]) {
    return this.auth.restore(auth.userId, auth.tokenId);
  }

  @Post("sign-out")
  @UseGuards(AuthGuard)
  signOut(@CurrentAuth() auth: AuthenticatedRequest["auth"]) {
    return this.auth.signOut(auth.tokenId);
  }
}
