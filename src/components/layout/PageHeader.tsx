import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/store/language";

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { translate } = useLanguage();
  return (
    <div className={cn("mb-5 space-y-3", className)}>
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-2xs text-ink-faint">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
              {crumb.to ? (
                <Link to={crumb.to} className="transition-colors hover:text-ink-soft">
                  {translate(crumb.label)}
                </Link>
              ) : (
                <span className="text-ink-mute">{translate(crumb.label)}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-[-0.022em] text-ink">
            {typeof title === "string" ? translate(title) : title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-2xs leading-relaxed text-ink-mute">
              {typeof description === "string" ? translate(description) : description}
            </p>
          ) : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {children}
    </div>
  );
}
