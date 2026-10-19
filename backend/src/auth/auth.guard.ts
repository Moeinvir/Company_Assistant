import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

export interface AuthenticatedRequest extends Request {
  auth: { userId: string; tokenId: string };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? "").split(" ");
    // `EventSource` cannot set headers, so the SSE channel passes its token as
    // `?token=`. Header auth stays preferred everywhere else.
    const queryToken =
      typeof request.query?.token === "string" ? request.query.token : undefined;
    const bearer = scheme === "Bearer" && token ? token : undefined;
    const sessionToken = bearer ?? queryToken;
    if (!sessionToken) throw new UnauthorizedException("Bearer token required");

    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; jti: string }>(sessionToken);
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }
    const session = await this.prisma.session.findFirst({
      where: { tokenId: payload.jti, userId: payload.sub, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedException("Session expired");
    request.auth = { userId: payload.sub, tokenId: payload.jti };
    return true;
  }
}
