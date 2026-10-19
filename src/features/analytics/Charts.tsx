import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsSnapshot } from "@/lib/api/types";
import { formatCompact } from "@/lib/format";

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="surface-panel px-2.5 py-2 text-2xs">
      <p className="mb-1 font-medium text-ink-soft">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-ink-mute">
          <span className="inline-block size-1.5 rounded-full" style={{ background: entry.color }} />
          <span className="flex-1">{entry.name}</span>
          <span className="font-mono tabular-nums text-ink">
            {typeof entry.value === "number" ? formatCompact(entry.value) : entry.value}
            {unit}
          </span>
        </p>
      ))}
    </div>
  );
}

const shortDate = (value: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function UsageTrendChart({
  series,
  showErrors = true,
  height = 220,
}: {
  series: AnalyticsSnapshot["series"];
  showErrors?: boolean;
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="queries-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.42} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: "#6f6f7b", fontSize: 10 }}
            axisLine={{ stroke: "rgba(255,255,255,0.07)" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: "#6f6f7b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(value: number) => formatCompact(value)}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "rgba(255,255,255,0.14)", strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="queries"
            name="Queries"
            stroke="var(--accent)"
            strokeWidth={1.6}
            fill="url(#queries-fill)"
            dot={false}
            activeDot={{ r: 3, fill: "var(--accent-strong)" }}
          />
          {showErrors ? (
            <Line
              type="monotone"
              dataKey="errors"
              name="Errors"
              stroke="#ff6259"
              strokeWidth={1.2}
              dot={false}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TokenBarChart({
  series,
  height = 200,
}: {
  series: AnalyticsSnapshot["series"];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: "#6f6f7b", fontSize: 10 }}
            axisLine={{ stroke: "rgba(255,255,255,0.07)" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: "#6f6f7b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(value: number) => formatCompact(value)}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="tokens" name="Tokens" fill="color-mix(in oklab, var(--accent) 62%, #2a2a33)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LatencyHistogram({
  buckets,
  height = 190,
}: {
  buckets: AnalyticsSnapshot["latencyBuckets"];
  height?: number;
}) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fill: "#6f6f7b", fontSize: 10 }}
            axisLine={{ stroke: "rgba(255,255,255,0.07)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#6f6f7b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="count" name="Responses" radius={[3, 3, 0, 0]}>
            {buckets.map((bucket, index) => {
              const intensity = 0.35 + (bucket.count / max) * 0.65;
              return (
                <Cell
                  key={bucket.bucket}
                  fill={`color-mix(in oklab, var(--accent) ${Math.round(intensity * 100)}%, #26262e)`}
                  opacity={index === 0 ? 0.9 : 1}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
