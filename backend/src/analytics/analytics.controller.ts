import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { PrismaService } from "../prisma/prisma.service";

const RANGES = ["7d", "30d", "90d"] as const;
const LATENCY_BUCKETS = [
  { bucket: "<200ms", max: 200 },
  { bucket: "200–500ms", max: 500 },
  { bucket: "0.5–1s", max: 1_000 },
  { bucket: "1–3s", max: 3_000 },
  { bucket: ">3s", max: Number.POSITIVE_INFINITY },
];

/**
 * Usage analytics.
 *
 * Every number here is read from records the platform actually wrote —
 * `UsageEvent` for query/widget activity, `Document` for ingestion and
 * `Conversation` for threads. Nothing is a placeholder: an empty chart means
 * nothing has happened yet, which is the only honest way to render "no data".
 */
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
    const start = startOfDaysAgo(days - 1);

    const [events, indexedDocuments, conversations, assistants] = await Promise.all([
      this.prisma.usageEvent.findMany({
        where: { workspaceId, at: { gte: start } },
        select: {
          kind: true,
          at: true,
          latencyMs: true,
          promptTokens: true,
          completionTokens: true,
          provider: true,
          model: true,
          retrievedCount: true,
          topScore: true,
          assistantId: true,
          query: true,
        },
      }),
      this.prisma.document.findMany({
        where: { workspaceId, status: "indexed", indexedAt: { gte: start } },
        select: { indexedAt: true },
      }),
      this.prisma.conversation.findMany({
        where: { workspaceId, createdAt: { gte: start } },
        select: { id: true },
      }),
      this.prisma.assistant.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    ]);

    const queryEvents = events.filter(
      (event) => event.kind === "query" || event.kind === "widget_message",
    );
    const latencies = queryEvents.map((event) => event.latencyMs).sort((a, b) => a - b);
    const assistantNames = new Map(assistants.map((entry) => [entry.id, entry.name]));

    /* ------------------------------------------------------------- totals */
    const totals = {
      queries: queryEvents.length,
      tokens: events.reduce(
        (sum, event) => sum + event.promptTokens + event.completionTokens,
        0,
      ),
      documentsIndexed: indexedDocuments.length,
      conversations: conversations.length,
      errors: events.filter((event) => event.kind === "error").length,
      avgLatencyMs: average(latencies),
      p95LatencyMs: percentile(latencies, 0.95),
      avgRetrieved: average(queryEvents.map((event) => event.retrievedCount)),
      // The share of answers that were grounded in at least one passage, which
      // is the number that actually tells an operator whether the knowledge
      // base is doing its job.
      groundRate:
        queryEvents.length === 0
          ? 0
          : queryEvents.filter((event) => event.retrievedCount > 0).length / queryEvents.length,
    };

    /* ------------------------------------------------------------- series */
    const series = Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return { key: dayKey(date), date: dayKey(date), queries: 0, ingestions: 0, tokens: 0, errors: 0 };
    });
    const seriesByDay = new Map(series.map((point) => [point.key, point]));
    for (const event of events) {
      const point = seriesByDay.get(dayKey(event.at));
      if (!point) continue;
      if (event.kind === "query" || event.kind === "widget_message") point.queries += 1;
      if (event.kind === "error") point.errors += 1;
      point.tokens += event.promptTokens + event.completionTokens;
    }
    for (const document of indexedDocuments) {
      if (!document.indexedAt) continue;
      const point = seriesByDay.get(dayKey(document.indexedAt));
      if (point) point.ingestions += 1;
    }

    /* ---------------------------------------------------------- breakdowns */
    const byProvider = aggregate(queryEvents, (event) => event.provider ?? "unknown").map(
      ({ key, items }) => ({
        provider: key,
        queries: items.length,
        tokens: items.reduce((sum, event) => sum + event.promptTokens + event.completionTokens, 0),
      }),
    );

    const byAssistant = aggregate(
      queryEvents,
      (event) => event.assistantId ?? "unassigned",
    )
      .map(({ key, items }) => ({
        assistantId: key,
        name: assistantNames.get(key) ?? "Deleted assistant",
        queries: items.length,
        tokens: items.reduce((sum, event) => sum + event.promptTokens + event.completionTokens, 0),
      }))
      .sort((a, b) => b.queries - a.queries);

    const latencyBuckets = LATENCY_BUCKETS.map(({ bucket, max }) => ({
      bucket,
      count: latencies.filter((value) => value <= max).length,
    })).map((entry, index, all) => ({
      // Buckets are cumulative from the ladder above; report per-bucket counts.
      bucket: entry.bucket,
      count: entry.count - (index === 0 ? 0 : all[index - 1].count),
    }));

    const topQueries = aggregate(queryEvents, (event) =>
      (event.query ?? "").trim().toLowerCase(),
    )
      .filter(({ key }) => key.length > 0)
      .map(({ key, items }) => ({
        query: items[0].query?.trim() ?? key,
        count: items.length,
        avgScore: average(
          items.map((event) => event.topScore ?? 0).filter((score) => score > 0),
        ),
      }))
      .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore)
      .slice(0, 10);

    return {
      range,
      totals,
      series: series.map(({ key, ...point }) => point),
      byProvider,
      byAssistant,
      latencyBuckets,
      topQueries,
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
    return this.prisma.activityEvent
      .findMany({
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
      })
      .then((events) => events.map((event) => ({ ...event, at: event.at.toISOString() })));
  }

  private async requireWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new BadRequestException("Workspace not found");
  }
}

/* -------------------------------------------------------------------- utils */

function startOfDaysAgo(days: number) {
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Local calendar day, matching how the chart labels its axis. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Nearest-rank percentile; no interpolation, so it is a value that occurred. */
function percentile(sorted: number[], quantile: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

function aggregate<T>(items: T[], keyOf: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, items: group }));
}
