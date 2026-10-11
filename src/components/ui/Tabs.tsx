import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabDefinition<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  count?: number;
  hint?: string;
}

/**
 * Tab bar with roving tabindex and arrow-key navigation. Content is rendered by
 * the caller, which keeps panels independently routable.
 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  className,
  size = "md",
}: {
  tabs: TabDefinition<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let next = activeIndex;
    if (event.key === "ArrowRight") next = (activeIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (activeIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        "no-scrollbar -mb-px flex items-center gap-0.5 overflow-x-auto border-b border-hairline",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            title={tab.hint}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 border-b-2 transition-colors duration-150",
              size === "sm" ? "px-3 py-2 text-2xs" : "px-3.5 py-2.5 text-micro",
              active
                ? "border-accent text-ink"
                : "border-transparent text-ink-mute hover:border-hairline-strong hover:text-ink-soft",
            )}
          >
            {tab.icon ? <span className="shrink-0 opacity-90">{tab.icon}</span> : null}
            <span className="font-medium whitespace-nowrap">{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                  active ? "bg-accent/15 text-accent" : "bg-surface-3 text-ink-faint",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
  className,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      className={cn("animate-fade-up", className)}
    >
      {children}
    </div>
  );
}
