import { cn } from "@/lib/cn";

/**
 * The Parsis Bridge mark: a contained ember, not a roaring flame. It inherits the active
 * fire theme, so the brand re-tints with the user's chosen temperature.
 */
export function EmberMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-[10px] border border-white/10",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundImage:
          "radial-gradient(120% 120% at 30% 15%, color-mix(in oklab, var(--accent-strong) 34%, transparent), transparent 60%), linear-gradient(160deg, #16161b, #0b0b0e)",
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} aria-hidden>
        <defs>
          <linearGradient id="ember-mark" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent-strong)" />
            <stop offset="0.55" stopColor="var(--accent)" />
            <stop offset="1" stopColor="color-mix(in oklab, var(--accent) 45%, transparent)" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.6c1.7 3.4.6 5.3-.7 7-1.6 2-3.4 3.7-3.4 6.4a4.7 4.7 0 0 0 9.4 0c0-1.9-.8-3.1-1.6-4.2-.3 1-.8 1.6-1.6 2 .6-3.2-.8-6.2-2.1-7.9Z"
          fill="url(#ember-mark)"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <EmberMark size={compact ? 24 : 28} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
          Parsis Bridge
        </span>
        {compact ? null : (
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">
            AI platform
          </span>
        )}
      </span>
    </span>
  );
}
