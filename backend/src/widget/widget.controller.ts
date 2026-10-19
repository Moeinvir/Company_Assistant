import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { WidgetQueryDto } from "./widget.dto";
import { WidgetService } from "./widget.service";

/**
 * Public widget surface — deliberately NOT guarded by `AuthGuard`.
 *
 * The iframe runtime that `public/embed.js` mounts on a customer's site has no
 * session and no cookie; the assistant's public key is the only credential, and
 * it grants access to exactly one assistant's knowledge and nothing else. Every
 * route here is scoped by that key inside `WidgetService`.
 *
 * Because the surface is unauthenticated it carries its own abuse controls:
 * the DTO bounds how large a single message may be, and a per-IP sliding
 * window bounds how many messages one caller can push through an expensive
 * retrieval + generation pipeline per minute. A generous window keeps real
 * conversations uninterrupted while stopping a scripted flood.
 */

/** Messages allowed per IP inside the rolling window. */
const QUERY_LIMIT = Number(process.env.WIDGET_RATE_LIMIT ?? 30);
/** Rolling window length in milliseconds (one minute by default). */
const WINDOW_MS = Number(process.env.WIDGET_RATE_WINDOW_MS ?? 60_000);

/** Simple in-memory sliding window — one bucket per client address. */
class QueryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Returns true when the caller still has budget, false when it is exhausted. */
  consume(key: string): boolean {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > windowStart);
    if (recent.length >= QUERY_LIMIT) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Opportunistic sweep so abandoned buckets cannot grow without bound.
    if (this.hits.size > 5_000) {
      for (const [bucket, times] of this.hits) {
        if (times.every((time) => time <= windowStart)) this.hits.delete(bucket);
      }
    }
    return true;
  }
}

@Controller("public/widget")
export class WidgetController {
  private readonly limiter = new QueryRateLimiter();

  constructor(private readonly widget: WidgetService) {}

  @Get(":publicKey")
  config(@Param("publicKey") publicKey: string) {
    return this.widget.config(publicKey);
  }

  @Post(":publicKey/query")
  @HttpCode(HttpStatus.CREATED)
  query(
    @Param("publicKey") publicKey: string,
    @Body() input: WidgetQueryDto,
    @Req() req: Request,
  ) {
    // Address first, key second: one noisy visitor is throttled even when it
    // rotates through several public keys.
    const address = req.ip || req.socket?.remoteAddress || "unknown";
    if (!this.limiter.consume(`${address}:${publicKey}`)) {
      throw new HttpException(
        "Too many messages in a short time. Wait a moment and try again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.widget.query(publicKey, input);
  }
}
