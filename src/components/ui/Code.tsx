import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCopyToClipboard } from "@/lib/hooks";
import { IconButton } from "./Button";

export function CopyButton({
  value,
  label = "Copy",
  size = "icon-sm",
  className,
}: {
  value: string;
  label?: string;
  size?: "icon" | "icon-sm";
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <IconButton
      label={copied ? "Copied" : label}
      size={size}
      variant="ghost"
      className={cn(copied && "text-success", className)}
      onClick={() => void copy(value)}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </IconButton>
  );
}

export function CodeBlock({
  code,
  language,
  filename,
  actions,
  className,
  maxHeight = 360,
}: {
  code: string;
  language?: string;
  filename?: string;
  actions?: ReactNode;
  className?: string;
  maxHeight?: number;
}) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-hairline bg-black/45", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-accent/70" aria-hidden />
          <span className="truncate font-mono text-2xs text-ink-mute">
            {filename ?? language ?? "snippet"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <CopyButton value={code} label="Copy code" />
        </div>
      </div>
      <pre
        className="overflow-auto p-3.5 font-mono text-2xs leading-relaxed text-ink-soft"
        style={{ maxHeight }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
