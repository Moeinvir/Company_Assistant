import { Suspense, lazy, type ComponentProps } from "react";

// recharts is ~400 kB; loading it lazily lets pages paint immediately and the
// chart fill in a moment later instead of blocking the whole route.
const Trend = lazy(() => import("./Charts").then((m) => ({ default: m.UsageTrendChart })));
const Tokens = lazy(() => import("./Charts").then((m) => ({ default: m.TokenBarChart })));
const Latency = lazy(() => import("./Charts").then((m) => ({ default: m.LatencyHistogram })));

function ChartFallback({ height = 200 }: { height?: number }) {
  return <div className="skeleton w-full rounded-card" style={{ height }} aria-busy="true" />;
}

export function UsageTrendChart(props: ComponentProps<typeof Trend>) {
  return (
    <Suspense fallback={<ChartFallback height={(props as { height?: number }).height} />}>
      <Trend {...props} />
    </Suspense>
  );
}
export function TokenBarChart(props: ComponentProps<typeof Tokens>) {
  return (
    <Suspense fallback={<ChartFallback height={(props as { height?: number }).height} />}>
      <Tokens {...props} />
    </Suspense>
  );
}
export function LatencyHistogram(props: ComponentProps<typeof Latency>) {
  return (
    <Suspense fallback={<ChartFallback height={(props as { height?: number }).height} />}>
      <Latency {...props} />
    </Suspense>
  );
}
