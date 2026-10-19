import { Link } from "react-router-dom";
import {
  Activity,
  Bot,
  Clock,
  Coins,
  Gauge,
  Info,
  Percent,
  Target,
  TrendingUp,
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
  Table,
  TD,
  TH,
  TR,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { LatencyHistogram, TokenBarChart, UsageTrendChart } from "@/features/analytics/LazyCharts";
import { useWorkspaceData } from "@/store/workspaceData";
import { useSession } from "@/store/session";
import { providerLabel } from "@/lib/api/providers";
import { formatCompact, formatDuration, formatNumber, formatPercent } from "@/lib/format";

export default function AnalyticsPage() {
  const { workspace } = useSession();
  const { analytics, analyticsRange, setAnalyticsRange, loading, error, refresh } = useWorkspaceData();

  if (error && !analytics) {
    return (
      <>
        <PageHeader title="Analytics" description="Usage, latency and retrieval quality for this workspace." />
        <ErrorState
          message={error}
          action={
            <Button size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const totals = analytics?.totals;
  const hasData = Boolean(totals && totals.queries > 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Query volume, latency, retrieval quality and provider mix for ${workspace?.name ?? "this workspace"}.`}
        meta={
          <>
            <Badge tone="neutral">{analyticsRange} window</Badge>
            {analytics && analytics.byProvider.length > 0 ? (
              <Badge tone="accent">
                {`${analytics.byProvider.length} ${analytics.byProvider.length === 1 ? "provider" : "providers"} in use`}
              </Badge>
            ) : null}
            <span className="flex items-center gap-1.5 text-2xs text-ink-faint">
              <Info className="size-3" aria-hidden />
              Metrics are aggregated from recorded events, including flagged sample history.
            </span>
          </>
        }
        actions={
          <SegmentedControl
            value={analyticsRange}
            onChange={setAnalyticsRange}
            options={[
              { value: "7d", label: "7 days" },
              { value: "30d", label: "30 days" },
              { value: "90d", label: "90 days" },
            ]}
          />
        }
      />

      {loading && !analytics ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-24 rounded-card" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-card" />
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={<Activity className="size-4" aria-hidden />}
          title="No query activity in this window"
          description="Analytics are recorded from real usage: playground runs, widget conversations and ingestion events. Run a query in the playground to populate this view."
          action={
            <Link to="/playground" className="text-2xs font-medium text-accent hover:text-accent-strong">
              Open the playground →
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Queries"
              value={formatCompact(totals?.queries ?? 0)}
              icon={<Activity className="size-4" aria-hidden />}
              tone="accent"
              hint={`${analyticsRange} window`}
            />
            <StatCard
              label="Tokens"
              value={formatCompact(totals?.tokens ?? 0)}
              icon={<Coins className="size-4" aria-hidden />}
              hint="prompt + completion"
            />
            <StatCard
              label="Avg latency"
              value={formatDuration(totals?.avgLatencyMs ?? 0)}
              icon={<Clock className="size-4" aria-hidden />}
              hint={`p95 ${formatDuration(totals?.p95LatencyMs ?? 0)}`}
            />
            <StatCard
              label="Retrieval hit rate"
              value={formatPercent(totals?.groundRate ?? 0)}
              icon={<Target className="size-4" aria-hidden />}
              tone={(totals?.groundRate ?? 0) > 0.85 ? "success" : "warn"}
              hint="queries that returned a passage"
            />
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
            <Card className="overflow-hidden">
              <CardHeader
                title="Queries and errors"
                description="Assistant and widget traffic, with failures overlaid."
                icon={<TrendingUp className="size-3.5" aria-hidden />}
              />
              <CardBody>
                <UsageTrendChart series={analytics?.series ?? []} height={240} />
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3 sm:grid-cols-4">
                  <Metric value={totals?.conversations ?? 0} label="Conversations" />
                  <Metric value={totals?.documentsIndexed ?? 0} label="Documents indexed" />
                  <Metric value={totals?.errors ?? 0} label="Errors" />
                  <Metric value={(totals?.avgRetrieved ?? 0).toFixed(1)} label="Passages per query" />
                </div>
              </CardBody>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader
                title="Latency distribution"
                description="End-to-end time per query, including embedding and generation."
                icon={<Gauge className="size-3.5" aria-hidden />}
              />
              <CardBody>
                <LatencyHistogram buckets={analytics?.latencyBuckets ?? []} height={200} />
                <div className="mt-3 space-y-2 border-t border-hairline pt-3">
                  {(analytics?.latencyBuckets ?? []).map((bucket) => {
                    const max = Math.max(
                      ...(analytics?.latencyBuckets ?? []).map((entry) => entry.count),
                      1,
                    );
                    return (
                      <div key={bucket.bucket} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-[10px] text-ink-mute">{bucket.bucket}</span>
                        <div className="flex-1">
                          <ProgressBar
                            value={bucket.count / max}
                            tone="accent"
                            label={`${bucket.bucket} responses`}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-end font-mono text-[10px] tabular-nums text-ink-faint">
                          {bucket.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
            <Card className="overflow-hidden">
              <CardHeader
                title="Tokens per day"
                description="Prompt plus completion tokens billed by providers."
                icon={<Coins className="size-3.5" aria-hidden />}
              />
              <CardBody>
                <TokenBarChart series={analytics?.series ?? []} />
              </CardBody>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader
                title="Provider mix"
                description="Where generation requests were sent."
                icon={<Bot className="size-3.5" aria-hidden />}
              />
              <CardBody className="space-y-3">
                {(analytics?.byProvider ?? []).length === 0 ? (
                  <p className="text-2xs text-ink-faint">No provider activity recorded yet.</p>
                ) : (
                  (analytics?.byProvider ?? []).map((entry) => {
                    const total = analytics?.byProvider.reduce((sum, item) => sum + item.queries, 0) ?? 1;
                    return (
                      <div key={entry.provider}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-2xs text-ink-soft">{providerLabel(entry.provider)}</span>
                          <span className="font-mono text-[10px] tabular-nums text-ink-faint">
                            {formatCompact(entry.queries)} queries · {formatCompact(entry.tokens)} tokens
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <ProgressBar
                            value={entry.queries / total}
                            tone="accent"
                            label={`${providerLabel(entry.provider)} share`}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardBody>
            </Card>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader
                title="By assistant"
                description="Volume and token spend per assistant."
                icon={<Bot className="size-3.5" aria-hidden />}
              />
              <CardBody className="px-0 pb-0 sm:px-0">
                {(analytics?.byAssistant ?? []).length === 0 ? (
                  <p className="px-5 pb-4 text-2xs text-ink-faint">No assistant activity in this window.</p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <TH>Assistant</TH>
                        <TH className="text-end">Queries</TH>
                        <TH className="text-end">Tokens</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {(analytics?.byAssistant ?? []).map((entry) => (
                        <TR key={entry.assistantId}>
                          <TD>
                            <Link
                              to={`/assistants/${entry.assistantId}`}
                              className="text-2xs text-ink transition-colors hover:text-accent"
                            >
                              {entry.name}
                            </Link>
                          </TD>
                          <TD className="text-end font-mono text-2xs tabular-nums">
                            {formatNumber(entry.queries)}
                          </TD>
                          <TD className="text-end font-mono text-2xs tabular-nums">
                            {formatCompact(entry.tokens)}
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader
                title="Most frequent queries"
                description="What people actually ask, with the average top score."
                icon={<Percent className="size-3.5" aria-hidden />}
              />
              <CardBody className="px-0 pb-0 sm:px-0">
                {(analytics?.topQueries ?? []).length === 0 ? (
                  <p className="px-5 pb-4 text-2xs text-ink-faint">
                    Query text is recorded from playground and widget sessions. Nothing yet.
                  </p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <TH>Query</TH>
                        <TH className="text-end">Runs</TH>
                        <TH className="text-end">Avg score</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {(analytics?.topQueries ?? []).map((entry) => (
                        <TR key={entry.query}>
                          <TD className="max-w-[320px] truncate">{entry.query}</TD>
                          <TD className="text-end font-mono text-2xs tabular-nums">{entry.count}</TD>
                          <TD className="text-end">
                            <span
                              className={
                                entry.avgScore >= 0.5
                                  ? "font-mono text-2xs text-success"
                                  : entry.avgScore >= 0.3
                                    ? "font-mono text-2xs text-accent"
                                    : "font-mono text-2xs text-warn"
                              }
                            >
                              {(entry.avgScore * 100).toFixed(0)}%
                            </span>
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
