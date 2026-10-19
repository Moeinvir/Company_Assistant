import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Depth primitives. Cards stay quiet: a hairline border, a whisper of a top
 * highlight and a soft shadow. Fire belongs to the background layer, not to
 * every container.
 */
export function Card({ className, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "surface-card",
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-hairline-strong hover:shadow-pop active:translate-y-0 active:shadow-card",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-ink-mute">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-micro font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-mute">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4 sm:px-5", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-hairline px-4 py-3 sm:px-5",
        className,
      )}
      {...rest}
    />
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader title={title} description={description} actions={actions} icon={icon} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export type TrendDirection = "up" | "down" | "flat";

export function StatCard({
  label,
  value,
  unit,
  hint,
  trend,
  trendLabel,
  icon,
  tone = "neutral",
  loading,
  footer,
  interactive,
  glow,
  href,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  trend?: TrendDirection;
  trendLabel?: string;
  icon?: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warn" | "danger";
  loading?: boolean;
  /** Secondary block under the hint (distribution bars, footnotes). */
  footer?: ReactNode;
  /** Lifts on hover and warms the icon plate — for tiles that lead somewhere. */
  interactive?: boolean;
  /** Small ember ring for tiles that represent a live/active state. */
  glow?: boolean;
  /** Makes the whole tile a router link, keeping focus and keyboard behaviour. */
  href?: string;
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const trendTone =
    trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-ink-faint";

  const toneRing: Record<string, string> = {
    neutral: "text-ink-mute",
    accent: "text-accent",
    success: "text-success",
    warn: "text-warn",
    danger: "text-danger",
  };

  const tile = (
    <Card
      className={cn(
        "group relative overflow-hidden p-4",
        interactive &&
          "transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-px hover:border-hairline-strong hover:shadow-pop active:translate-y-0 active:shadow-card",
        glow && "ember-glow",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-medium uppercase tracking-[0.13em] text-ink-faint transition-colors duration-200 group-hover:text-ink-mute">
          {label}
        </p>
        {icon ? (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 transition-[border-color,background-color,box-shadow] duration-200",
              toneRing[tone],
              interactive &&
                "group-hover:border-accent/40 group-hover:bg-accent/[0.07] group-hover:shadow-[0_0_16px_-8px_var(--accent-glow)]",
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 skeleton" />
      ) : (
        <p className="mt-2.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tracking-[-0.02em] text-ink tabular-nums">{value}</span>
          {unit ? <span className="text-micro text-ink-mute">{unit}</span> : null}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {trend ? (
          <span className={cn("inline-flex items-center gap-0.5 text-2xs font-medium", trendTone)}>
            <TrendIcon className="size-3" aria-hidden />
            {trendLabel}
          </span>
        ) : null}
        {hint ? <span className="truncate text-2xs text-ink-faint">{hint}</span> : null}
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </Card>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="block rounded-card transition-transform duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.995]"
      >
        {tile}
      </Link>
    );
  }

  return tile;
}

/** Two-column definition row used across settings and detail panes. */
export function DetailRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-hairline py-2.5 last:border-0 sm:grid-cols-[190px_1fr] sm:gap-4">
      <dt className="text-2xs font-medium text-ink-mute">{label}</dt>
      <dd className="min-w-0 text-micro text-ink-soft">
        {children}
        {hint ? <span className="mt-1 block text-2xs text-ink-faint">{hint}</span> : null}
      </dd>
    </div>
  );
}
