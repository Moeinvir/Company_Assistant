import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export type Tone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-hairline-strong bg-surface-3 text-ink-soft",
  accent: "border-accent/35 bg-accent/10 text-accent",
  success: "border-success/30 bg-success/10 text-success",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-2xs font-medium leading-none",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral", pulse }: { tone?: Tone; pulse?: boolean }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-ink-faint",
    accent: "bg-accent",
    success: "bg-success",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
  };
  return (
    <span className="relative inline-flex size-2 shrink-0 items-center justify-center">
      <span className={cn("size-2 rounded-full", colors[tone])} />
      {pulse ? (
        <span
          className={cn("absolute inset-0 animate-ping rounded-full opacity-60", colors[tone])}
          style={{ animationDuration: "2.4s" }}
        />
      ) : null}
    </span>
  );
}

export function ProgressBar({
  value,
  tone = "accent",
  className,
  label,
}: {
  /** 0–1 */
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const percent = Math.max(0, Math.min(1, value)) * 100;
  const fills: Record<Tone, string> = {
    neutral: "bg-ink-faint",
    accent: "bg-accent",
    success: "bg-success",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
  };
  return (
    <div
      className={cn("relative h-1 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out-soft", fills[tone])}
        style={{ width: `${percent}%`, transitionTimingFunction: "var(--ease-out-soft)" }}
      />
    </div>
  );
}

/** Relevance meter used by search and retrieved-passage views. */
export function ScoreMeter({ score, className }: { score: number; className?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const tone: Tone = percent >= 60 ? "success" : percent >= 35 ? "accent" : percent >= 20 ? "warn" : "neutral";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "success" ? "bg-success" : tone === "accent" ? "bg-accent" : tone === "warn" ? "bg-warn" : "bg-ink-faint",
          )}
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-end font-mono text-2xs tabular-nums text-ink-mute">
        {percent}%
      </span>
    </div>
  );
}

export function Avatar({
  name,
  size = "md",
  src,
  variant = "gradient",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  src?: string;
  variant?: "gradient" | "initials" | "image";
  className?: string;
}) {
  const sizes = {
    xs: "size-5 text-[9px]",
    sm: "size-7 text-[10px]",
    md: "size-9 text-2xs",
    lg: "size-12 text-sm",
  };
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  if (variant === "image" && src) {
    return (
      <img
        src={src}
        alt=""
        className={cn("shrink-0 rounded-full border border-hairline object-cover", sizes[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-white/10 font-semibold tracking-tight",
        sizes[size],
        variant === "gradient"
          ? "text-accent-contrast"
          : "bg-surface-3 text-ink-soft",
        className,
      )}
      style={
        variant === "gradient"
          ? {
              backgroundImage:
                "linear-gradient(145deg, var(--accent-strong), color-mix(in oklab, var(--accent) 55%, #12060a))",
            }
          : undefined
      }
    >
      {letters || "?"}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-hairline-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-mute">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-hairline px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-10 items-center justify-center rounded-xl border border-hairline bg-surface-2 text-ink-mute">
          {icon}
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-micro font-medium text-ink">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-2xs leading-relaxed text-ink-mute">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  action,
}: {
  title?: string;
  message: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-danger/25 bg-danger/[0.06] p-4">
      <p className="text-micro font-medium text-danger">{title}</p>
      <p className="mt-1 text-2xs leading-relaxed text-ink-soft">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- table */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-start">{children}</table>
    </div>
  );
}

export function TH({ children, className, ...rest }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-hairline px-3 py-2 text-2xs font-medium uppercase tracking-[0.1em] text-ink-faint whitespace-nowrap",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ children, className, ...rest }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-b border-hairline px-3 py-2.5 align-middle text-micro text-ink-soft", className)} {...rest}>
      {children}
    </td>
  );
}

export function TR({ children, className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition-colors hover:bg-white/[0.015]", className)} {...rest}>
      {children}
    </tr>
  );
}

export function Metric({ value, label, hint }: { value: number | string; label: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-micro tabular-nums text-ink">
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      <p className="mt-0.5 truncate text-2xs text-ink-faint" title={hint ?? label}>
        {label}
      </p>
    </div>
  );
}
