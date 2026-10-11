import { Controller, Get, Query, UseGuards, BadRequestException } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { PrismaService } from "../prisma/prisma.service";

const RANGES = ["7d", "30d", "90d"] as const;

@Controller("analytics")
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  async overview(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
    @Query("range") range: string,
  ) {
    await this.requireWorkspace(auth.userId, workspaceId);
    if (!RANGES.includes(range as (typeof RANGES)[number])) {
      throw new BadRequestException("range must be 7d, 30d, or 90d");
    }
    const days = Number.parseInt(range, 10);
    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    const indexedDocuments = await this.prisma.document.count({
      where: { workspaceId, status: "indexed", indexedAt: { gte: start } },
    });
    const series = Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        queries: 0,
        ingestions: 0,
        tokens: 0,
        errors: 0,
      };
    });
    return {
      range,
      totals: {
        queries: 0,
        tokens: 0,
        documentsIndexed: indexedDocuments,
        conversations: 0,
        errors: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        avgRetrieved: 0,
        groundRate: 0,
      },
      series,
      byProvider: [],
      byAssistant: [],
      latencyBuckets: [],
      topQueries: [],
    };
  }

  @Get("activity")
  async activity(
    @CurrentAuth() auth: AuthenticatedRequest["auth"],
    @Query("workspaceId") workspaceId: string,
    @Query("limit") limit = "12",
  ) {
    await this.requireWorkspace(auth.userId, workspaceId);
    const boundedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 12));
    return this.prisma.activityEvent.findMany({
      where: { workspaceId },
      orderBy: { at: "desc" },
      take: boundedLimit,
      select: {
        id: true,
        workspaceId: true,
        at: true,
        kind: true,
        summary: true,
        detail: true,
        actor: true,
        isSample: true,
      },
    }).then((events) => events.map((event) => ({
      ...event,
      at: event.at.toISOString(),
    })));
  }

  private async requireWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new BadRequestException("Workspace not found");
  }
}
