import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FileStack,
  FlaskConical,
  MessagesSquare,
  Plus,
  RefreshCw,
  Timer,
  Wifi,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Metric,
  ProgressBar,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatusDot,
  Table,
  TD,
  TH,
  TR,
  type Tone,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { UsageTrendChart } from "@/features/analytics/LazyCharts";
import { DocumentStatusBadge, IngestPipeline, isProcessing } from "@/features/knowledge/status";
import { useSession } from "@/store/session";
import { useWorkspaceData } from "@/store/workspaceData";
import { providerLabel } from "@/lib/api/providers";
import { cn } from "@/lib/cn";
import { formatCompact, formatDuration, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import type { AssistantStatus, Conversation } from "@/lib/api/types";

const STATUS_TONE: Record<AssistantStatus, Tone> = {
  active: "success",
  draft: "neutral",
  paused: "warn",
  error: "danger",
};

const STATUS_LABEL: Record<AssistantStatus, string> = {
  active: "Active",
  draft: "Draft",
  paused: "Paused",
  error: "Error",
};

interface Segment {
  key: string;
  value: number;
  className: string;
}

/** Thin stacked bar used as the secondary layer of every overview tile. */
function SegmentBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className="flex h-1 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
      {total > 0
        ? segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <span
                key={segment.key}
                className={cn("h-full rounded-full transition-[width] duration-500 ease-out-soft", segment.className)}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))
        : null}
    </div>
  );
}

/** Shared tile chrome so loading, error and empty tiles keep the same rhythm
 *  as a filled stat tile (label, icon plate, metric, secondary). */
function TileLabel({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="text-2xs font-medium uppercase tracking-[0.13em] text-ink-faint">{label}</p>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-ink-mute">
        {icon}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { workspace, client } = useSession();
  const {
    loading,
    error,
    assistants,
    knowledgeBases,
    analytics,
    analyticsRange,
    setAnalyticsRange,
    activity,
    documentsByKb,
    loadDocuments,
    knowledgeBaseById,
    listConversations,
    refresh,
  } = useWorkspaceData();

  /* Conversation history is fetched separately from the analytics rollup so the
     dashboard can distinguish "no conversations" from "not loaded yet". */
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const listRef = useRef(listConversations);
  listRef.current = listConversations;

  const loadConversations = useCallback(async () => {
    try {
      const list = await listRef.current();
      setConversations(list);
      setConversationsError(null);
    } catch (caught) {
      setConversationsError((caught as Error).message);
    }
  }, []);

  useEffect(() => {
    // Conversation history belongs to one workspace: clear it before loading
    // so the previous workspace's counts are never shown.
    setConversations(null);
    setConversationsError(null);
    void loadConversations();
  }, [loadConversations, workspace?.id]);

  // Manual refresh: drives the loading → success/error indicator in the header.
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [, setClockTick] = useState(0);

  const handleRefresh = useCallback(async () => {
    setSyncing(true);
    try {
      await Promise.all([refresh(), loadConversations()]);
      setSyncedAt(Date.now());
    } finally {
      setSyncing(false);
    }
  }, [refresh, loadConversations]);

  const handleRetryConversations = useCallback(async () => {
    setRetrying(true);
    try {
      await loadConversations();
    } finally {
      setRetrying(false);
    }
  }, [loadConversations]);

  // Mark the first successful load, then keep the relative "synced" label alive.
  useEffect(() => {
    if (!loading) setSyncedAt((previous) => previous ?? Date.now());
  }, [loading]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  // Track every knowledge base so ingestion state is visible here, not only on
  // the knowledge page.
  useEffect(() => {
    for (const knowledgeBase of knowledgeBases) {
      if (!documentsByKb[knowledgeBase.id]) void loadDocuments(knowledgeBase.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeBases]);

  const allDocuments = useMemo(
    () => knowledgeBases.flatMap((knowledgeBase) => documentsByKb[knowledgeBase.id] ?? []),
    [knowledgeBases, documentsByKb],
  );
  const processingDocs = allDocuments.filter((document) => isProcessing(document.status));
  const failedDocs = allDocuments.filter((document) => document.status === "failed");
  const indexedDocs = allDocuments.filter((document) => document.status === "indexed").length;
  const totalChunks = useMemo(
    () => knowledgeBases.reduce((sum, kb) => sum + kb.chunkCount, 0),
    [knowledgeBases],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<AssistantStatus, number> = { active: 0, draft: 0, paused: 0, error: 0 };
    for (const assistant of assistants) counts[assistant.status] += 1;
    return counts;
  }, [assistants]);

  const totals = analytics?.totals;
  const conversationCount = Math.max(totals?.conversations ?? 0, conversations?.length ?? 0);
  const messageCount = conversations?.reduce((sum, entry) => sum + entry.messageCount, 0) ?? 0;
  const latestConversationAt = conversations?.[0]?.updatedAt ?? null;
  const channelCounts = useMemo(() => {
    const counts: Record<Conversation["channel"], number> = { playground: 0, widget: 0, api: 0 };
    for (const entry of conversations ?? []) counts[entry.channel] += 1;
    return counts;
  }, [conversations]);
  const hasTraffic = (totals?.queries ?? 0) > 0;
  const latencyBuckets = analytics?.latencyBuckets ?? [];
  const maxLatencyBucket = Math.max(1, ...latencyBuckets.map((bucket) => bucket.count));
  const documentsLoaded = knowledgeBases.every((kb) => Boolean(documentsByKb[kb.id]));

  const syncBadge = error ? (
    <Badge tone="danger" icon={<AlertTriangle className="size-3" aria-hidden />}>
      Refresh failed
    </Badge>
  ) : syncing || loading ? (
    <Badge tone="neutral" icon={<RefreshCw className="size-3 animate-spin-slow" aria-hidden />}>
      Syncing
    </Badge>
  ) : syncedAt ? (
    <Badge tone="success" icon={<CheckCircle2 className="size-3" aria-hidden />}>
      Synced {formatRelative(syncedAt)}
    </Badge>
  ) : null;

  if (error && !analytics) {
    return (
      <>
        <PageHeader title="Dashboard" description="Platform health and usage for this workspace." />
        <ErrorState
          title="Dashboard unavailable"
          message={error}
          action={
            <Button size="sm" loading={syncing} onClick={() => void handleRefresh()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {/* ---------------------------------------------------- 1. overview header */}
      <PageHeader
        title="Dashboard"
        description={`Health, retrieval quality and ingestion state for ${workspace?.name ?? "this workspace"}.`}
        meta={
          <>
            <Badge tone={workspace?.isSample ? "warn" : "success"} icon={<Wifi className="size-3" aria-hidden />}>
              {client.mode === "demo" ? "Local data layer" : "Connected API"}
            </Badge>
            {syncBadge}
            <Badge tone="neutral">{knowledgeBases.length} knowledge bases</Badge>
            <Badge tone="neutral">{formatNumber(totalChunks)} indexed passages</Badge>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              loading={syncing}
              iconLeft={<RefreshCw className="size-3.5" aria-hidden />}
              onClick={() => void handleRefresh()}
            >
              Refresh
            </Button>
            <Button
              variant="outline"
              iconLeft={<FlaskConical className="size-3.5" aria-hidden />}
              onClick={() => navigate("/playground")}
            >
              Open playground
            </Button>
            <Button
              variant="primary"
              iconLeft={<Plus className="size-3.5" aria-hidden />}
              onClick={() => navigate("/assistants?new=1")}
            >
              New assistant
            </Button>
          </>
        }
      />

      {error && analytics ? (
        <div className="mb-3">
          <ErrorState
            title="Last refresh failed"
            message={error}
            action={
              <Button size="sm" loading={syncing} onClick={() => void handleRefresh()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : null}

      {/* ------------------------------------- 2/3/4. assistant · knowledge · conversations */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Assistants"
          value={formatNumber(assistants.length)}
          icon={<Bot className="size-4" aria-hidden />}
          tone="accent"
          interactive
          href="/assistants"
          glow={statusCounts.active > 0}
          loading={loading && assistants.length === 0}
          hint={
            assistants.length === 0
              ? "none created yet"
              : [
                  `${statusCounts.active} active`,
                  statusCounts.draft ? `${statusCounts.draft} draft` : null,
                  statusCounts.paused ? `${statusCounts.paused} paused` : null,
                  statusCounts.error ? `${statusCounts.error} error` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          footer={
            <SegmentBar
              segments={[
                { key: "active", value: statusCounts.active, className: "bg-accent/70" },
                { key: "draft", value: statusCounts.draft, className: "bg-surface-4" },
                { key: "paused", value: statusCounts.paused, className: "bg-warn/70" },
                { key: "error", value: statusCounts.error, className: "bg-danger/70" },
              ]}
            />
          }
        />

        <StatCard
          label="Knowledge"
          value={formatNumber(indexedDocs)}
          unit="indexed"
          icon={<Database className="size-4" aria-hidden />}
          tone={failedDocs.length > 0 ? "danger" : "neutral"}
          interactive
          href="/knowledge"
          glow={processingDocs.length > 0}
          loading={loading && !documentsLoaded}
          hint={
            knowledgeBases.length === 0
              ? "no bases yet"
              : [
                  `${knowledgeBases.length} base${knowledgeBases.length === 1 ? "" : "s"}`,
                  `${formatNumber(totalChunks)} passages`,
                  processingDocs.length ? `${processingDocs.length} processing` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          footer={
            <SegmentBar
              segments={[
                { key: "indexed", value: indexedDocs, className: "bg-success/70" },
                { key: "processing", value: processingDocs.length, className: "bg-accent/70" },
                { key: "failed", value: failedDocs.length, className: "bg-danger/70" },
              ]}
            />
          }
        />

        {/* Conversation tile carries its own loading, error and empty states. */}
        {conversations === null ? (
          conversationsError ? (
            <Card className="h-full p-4">
              <TileLabel label="Conversations" icon={<MessagesSquare className="size-4" aria-hidden />} />
              <div className="mt-3 rounded-card border border-danger/25 bg-danger/[0.06] px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-2xs font-medium text-danger">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  Conversation history unavailable
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-soft">
                  {conversationsError}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2.5"
                  loading={retrying}
                  onClick={() => void handleRetryConversations()}
                >
                  Try again
                </Button>
              </div>
              <div className="mt-3">
                <SegmentBar segments={[]} />
              </div>
            </Card>
          ) : (
            <Card className="h-full p-4">
              <TileLabel label="Conversations" icon={<MessagesSquare className="size-4" aria-hidden />} />
              <Skeleton className="mt-3 h-7 w-24" />
              <Skeleton className="mt-3 h-3.5 w-44" />
              <div className="mt-3">
                <Skeleton className="h-1 w-full" />
              </div>
            </Card>
          )
        ) : conversationCount === 0 ? (
          <Card className="h-full p-4">
            <TileLabel label="Conversations" icon={<MessagesSquare className="size-4" aria-hidden />} />
            <p className="mt-2.5 text-micro font-semibold text-ink">No conversations yet</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-mute">
                Playground and widget chats land here with message counts and latency.
              </p>
              <Button
                size="sm"
                variant="primary"
                iconLeft={<FlaskConical className="size-3.5" aria-hidden />}
                onClick={() => navigate("/playground")}
              >
                Run a query
              </Button>
            </div>
            <div className="mt-3">
              <SegmentBar segments={[]} />
            </div>
          </Card>
        ) : (
          <StatCard
            label="Conversations"
            value={formatNumber(conversationCount)}
            icon={<MessagesSquare className="size-4" aria-hidden />}
            interactive
            href="/playground"
            glow={Boolean(latestConversationAt) && Date.now() - new Date(latestConversationAt ?? 0).getTime() < 86_400_000}
            hint={`${formatNumber(messageCount)} messages · ${
              latestConversationAt ? formatRelative(latestConversationAt) : "this window"
            }`}
            footer={
              <SegmentBar
                segments={[
                  { key: "playground", value: channelCounts.playground, className: "bg-accent/70" },
                  { key: "widget", value: channelCounts.widget, className: "bg-accent/45" },
                  { key: "api", value: channelCounts.api, className: "bg-accent/25" },
                ]}
              />
            }
          />
        )}
      </div>

      {/* --------------------------------------------------------- 5. API usage */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card interactive className="overflow-hidden">
          <CardHeader
            title="API usage"
            description="Query volume, tokens and latency recorded by this workspace."
            icon={<Activity className="size-3.5" aria-hidden />}
            actions={
              <SegmentedControl
                size="sm"
                value={analyticsRange}
                onChange={(value) => setAnalyticsRange(value)}
                options={[
                  { value: "7d", label: "7d" },
                  { value: "30d", label: "30d" },
                  { value: "90d", label: "90d" },
                ]}
              />
            }
          />
          <CardBody>
            {loading && !analytics ? (
              <Skeleton className="h-[248px] w-full" />
            ) : !hasTraffic ? (
              <EmptyState
                compact
                icon={<Activity className="size-4" aria-hidden />}
                title="No API traffic yet"
                description="Every playground run, widget message and ingestion job is recorded here with latency, token spend and retrieval quality."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    iconLeft={<FlaskConical className="size-3.5" aria-hidden />}
                    onClick={() => navigate("/playground")}
                  >
                    Send a test query
                  </Button>
                }
              />
            ) : (
              <>
                <UsageTrendChart series={analytics?.series ?? []} />
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Metric value={formatNumber(totals?.queries ?? 0)} label="Queries" />
                  <Metric value={formatCompact(totals?.tokens ?? 0)} label="Tokens" hint="prompt + completion" />
                  <Metric value={formatDuration(totals?.avgLatencyMs ?? 0)} label="Avg latency" />
                  <Metric value={formatDuration(totals?.p95LatencyMs ?? 0)} label="p95 latency" />
                  <Metric value={formatPercent(totals?.groundRate ?? 0)} label="Hit rate" hint="queries with a passing passage" />
                  <Metric value={formatNumber(totals?.errors ?? 0)} label="Errors" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-hairline pt-3">
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                    Providers
                  </span>
                  {(analytics?.byProvider ?? []).map((entry) => (
                    <Badge key={entry.provider} tone="neutral">
                      {providerLabel(entry.provider)} · {formatCompact(entry.queries)} q
                    </Badge>
                  ))}
                  <Link
                    to="/analytics"
                    className="ms-auto text-2xs font-medium text-accent transition-colors hover:text-accent-strong"
                  >
                    Full analytics →
                  </Link>
                </div>

                {latencyBuckets.length > 0 ? (
                  <div className="mt-3 border-t border-hairline pt-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                        Latency distribution
                      </p>
                      <p className="text-[10px] text-ink-faint">
                        end-to-end per query · p95 {formatDuration(totals?.p95LatencyMs ?? 0)}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {latencyBuckets.map((bucket) => (
                        <div key={bucket.bucket} className="flex items-center gap-2.5">
                          <span className="w-16 shrink-0 text-[10px] text-ink-mute">{bucket.bucket}</span>
                          <div className="min-w-0 flex-1">
                            <ProgressBar
                              value={bucket.count / maxLatencyBucket}
                              tone="accent"
                              label={`${bucket.bucket} responses`}
                            />
                          </div>
                          <span className="w-8 shrink-0 text-end font-mono text-[10px] tabular-nums text-ink-faint">
                            {bucket.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardBody>
        </Card>

        {/* --------------------------------------------------- 6. recent activity */}
        <Card interactive className="overflow-hidden">
          <CardHeader
            title="Recent activity"
            description="Every change in this workspace, newest first."
            icon={<Timer className="size-3.5" aria-hidden />}
          />
          <CardBody className="space-y-3">
            {loading && activity.length === 0 ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-3/4" />
              </div>
            ) : activity.length === 0 ? (
              <EmptyState
                compact
                icon={<Activity className="size-4" aria-hidden />}
                title="No activity recorded"
                description="Upload a document or run a playground query and it will appear here."
                action={
                  <Button
                    size="sm"
                    iconLeft={<FlaskConical className="size-3.5" aria-hidden />}
                    onClick={() => navigate("/playground")}
                  >
                    Open playground
                  </Button>
                }
              />
            ) : (
              activity.slice(0, 8).map((entry) => (
                <div key={entry.id} className="flex gap-3">
                  <span className="mt-1.5">
                    <StatusDot
                      tone={
                        entry.kind === "document.failed"
                          ? "danger"
                          : entry.kind === "document.indexed"
                            ? "success"
                            : entry.kind.startsWith("assistant")
                              ? "accent"
                              : "neutral"
                      }
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs leading-relaxed text-ink-soft">{entry.summary}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-faint">
                      <span>{entry.actor}</span>
                      <span aria-hidden>·</span>
                      <span>{formatRelative(entry.at)}</span>
                      {entry.isSample ? <Badge tone="warn">sample</Badge> : null}
                    </p>
                    {entry.detail ? (
                      <p className="mt-1 line-clamp-2 text-[10px] text-ink-faint">{entry.detail}</p>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      {/* --------------------------------------- 7/8. assistant status · knowledge processing */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card interactive className="overflow-hidden">
          <CardHeader
            title="Assistant status"
            description="Operational state, model and traffic for every assistant."
            icon={<Bot className="size-3.5" aria-hidden />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate("/assistants")}>
                Manage
              </Button>
            }
          />
          <CardBody className="px-0 pb-0 sm:px-0">
            {loading && assistants.length === 0 ? (
              <div className="space-y-2 px-4 pb-4 sm:px-5">
                <Skeleton className="h-12 w-full rounded-card" />
                <Skeleton className="h-12 w-full rounded-card" />
                <Skeleton className="h-12 w-2/3 rounded-card" />
              </div>
            ) : assistants.length === 0 ? (
              <div className="px-4 pb-4 sm:px-5">
                <EmptyState
                  compact
                  icon={<Bot className="size-4" aria-hidden />}
                  title="No assistants yet"
                  description="An assistant binds a model, a prompt and one or more knowledge bases together. Create your first one to start testing retrieval."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      iconLeft={<Plus className="size-3.5" aria-hidden />}
                      onClick={() => navigate("/assistants?new=1")}
                    >
                      Create assistant
                    </Button>
                  }
                />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
                  <Badge tone="accent" className={statusCounts.active > 0 ? "ember-glow" : undefined}>
                    {statusCounts.active} active
                  </Badge>
                  {statusCounts.draft ? <Badge tone="neutral">{statusCounts.draft} draft</Badge> : null}
                  {statusCounts.paused ? <Badge tone="warn">{statusCounts.paused} paused</Badge> : null}
                  {statusCounts.error ? <Badge tone="danger">{statusCounts.error} error</Badge> : null}
                </div>

                <Table>
                  <thead>
                    <tr>
                      <TH>Assistant</TH>
                      <TH className="hidden md:table-cell">Knowledge</TH>
                      <TH className="text-end">Conversations</TH>
                      <TH className="hidden lg:table-cell">Last activity</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {assistants.slice(0, 6).map((assistant) => (
                      <TR key={assistant.id}>
                        <TD>
                          <Link
                            to={`/assistants/${assistant.id}`}
                            className="group/row flex items-center gap-2.5 transition-colors hover:text-ink"
                          >
                            <StatusDot
                              tone={STATUS_TONE[assistant.status]}
                              pulse={assistant.status === "active"}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-micro font-medium text-ink">
                                {assistant.name}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] text-ink-faint">
                                {STATUS_LABEL[assistant.status]} · {assistant.model.model}
                              </span>
                            </span>
                          </Link>
                        </TD>
                        <TD className="hidden md:table-cell">
                          <span className="text-2xs text-ink-mute">
                            {`${assistant.knowledgeBaseIds.length} ${assistant.knowledgeBaseIds.length === 1 ? "base" : "bases"}`}
                          </span>
                        </TD>
                        <TD className="text-end font-mono text-2xs tabular-nums text-ink-soft">
                          {formatNumber(assistant.stats.conversations)}
                        </TD>
                        <TD className="hidden lg:table-cell text-2xs text-ink-faint">
                          {assistant.stats.lastActivityAt
                            ? formatRelative(assistant.stats.lastActivityAt)
                            : "—"}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>

                {assistants.length > 6 ? (
                  <div className="border-t border-hairline px-4 py-2.5 sm:px-5">
                    <Link
                      to="/assistants"
                      className="text-2xs font-medium text-accent transition-colors hover:text-accent-strong"
                    >
                      View all {assistants.length} assistants →
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </CardBody>
        </Card>

        <Card interactive className={cn("overflow-hidden", processingDocs.length > 0 && "ember-glow")}>
          <CardHeader
            title="Knowledge processing"
            description="Ingestion queue across every knowledge base."
            icon={<FileStack className="size-3.5" aria-hidden />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate("/knowledge")}>
                Knowledge centre
              </Button>
            }
          />
          <CardBody>
            {knowledgeBases.length === 0 ? (
              <EmptyState
                compact
                icon={<Database className="size-4" aria-hidden />}
                title="No knowledge bases yet"
                description="A knowledge base groups documents that belong together — a product handbook, a support runbook. Assistants retrieve from the bases you attach to them."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    iconLeft={<Plus className="size-3.5" aria-hidden />}
                    onClick={() => navigate("/knowledge")}
                  >
                    Create knowledge base
                  </Button>
                }
              />
            ) : !documentsLoaded && loading ? (
              <div className="space-y-2.5">
                <Skeleton className="h-16 w-full rounded-card" />
                <Skeleton className="h-16 w-full rounded-card" />
              </div>
            ) : processingDocs.length === 0 && failedDocs.length === 0 ? (
              <EmptyState
                compact
                icon={<CheckCircle2 className="size-4 text-success" aria-hidden />}
                title="Everything is indexed"
                description={`${indexedDocs} document${indexedDocs === 1 ? "" : "s"} searchable across ${knowledgeBases.length} base${knowledgeBases.length === 1 ? "" : "s"} · ${formatNumber(totalChunks)} passages ready for retrieval.`}
              />
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">{indexedDocs} indexed</Badge>
                  {processingDocs.length ? (
                    <Badge tone="accent" className="ember-glow">
                      {processingDocs.length} processing
                    </Badge>
                  ) : null}
                  {failedDocs.length ? <Badge tone="danger">{failedDocs.length} failed</Badge> : null}
                </div>

                {[...processingDocs, ...failedDocs].slice(0, 4).map((document) => (
                  <div
                    key={document.id}
                    className="rounded-card border border-hairline bg-black/20 p-2.5 transition-colors duration-200 hover:border-hairline-strong"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-2xs text-ink">{document.name}</p>
                      <DocumentStatusBadge status={document.status} />
                    </div>
                    <p className="mt-1 truncate text-[10px] text-ink-faint">
                      {knowledgeBaseById(document.knowledgeBaseId)?.name ?? "Knowledge base"} ·{" "}
                      {document.chunkCount} passages
                    </p>
                    <IngestPipeline
                      className="mt-2"
                      status={document.status}
                      progress={document.progress}
                    />
                    {document.error ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-danger">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span className="line-clamp-2">{document.error}</span>
                      </p>
                    ) : null}
                  </div>
                ))}

                {processingDocs.length + failedDocs.length > 4 ? (
                  <Link
                    to="/knowledge"
                    className="block text-2xs font-medium text-accent transition-colors hover:text-accent-strong"
                  >
                    {processingDocs.length + failedDocs.length - 4} more in the queue →
                  </Link>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
