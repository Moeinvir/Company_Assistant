import { AlertCircle, CheckCircle2, FileStack, Loader2, Upload, Waves } from "lucide-react";
import { Badge, ProgressBar, type Tone } from "@/components/ui";
import type { DocumentRecord, DocumentStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";

/** The pipeline as the user experiences it, in order. */
export const PIPELINE_STAGES: { id: DocumentStatus; label: string; detail: string }[] = [
  { id: "uploading", label: "Uploading", detail: "Receiving the source content" },
  { id: "processing", label: "Extracting", detail: "Reading and cleaning source text" },
  { id: "chunking", label: "Chunking", detail: "Splitting into retrievable passages" },
  { id: "embedding", label: "Embedding", detail: "Turning passages into vectors" },
  { id: "indexing", label: "Indexing", detail: "Writing searchable vectors" },
  { id: "indexed", label: "Completed", detail: "Searchable by every attached assistant" },
];

const STATUS_META: Record<DocumentStatus, { label: string; tone: Tone; description: string }> = {
  queued: { label: "Queued", tone: "neutral", description: "Waiting for a worker" },
  uploading: { label: "Uploading", tone: "info", description: "Receiving content" },
  processing: { label: "Extracting", tone: "info", description: "Reading and cleaning source text" },
  chunking: { label: "Chunking", tone: "info", description: "Splitting into passages" },
  embedding: { label: "Embedding", tone: "warn", description: "Computing vectors" },
  indexing: { label: "Indexing", tone: "warn", description: "Writing vectors" },
  indexed: { label: "Completed", tone: "success", description: "Retrievable" },
  failed: { label: "Failed", tone: "danger", description: "Needs attention" },
};

export function statusMeta(status: DocumentStatus) {
  return STATUS_META[status];
}

export function isProcessing(status: DocumentStatus) {
  return status !== "indexed" && status !== "failed";
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const meta = STATUS_META[status];
  const Icon =
    status === "indexed"
      ? CheckCircle2
      : status === "failed"
        ? AlertCircle
        : isProcessing(status)
          ? Loader2
          : FileStack;

  return (
    <Badge
      tone={meta.tone}
      icon={
        <Icon
          className={cn("size-3", isProcessing(status) && "animate-spin-slow")}
          aria-hidden
        />
      }
    >
      {meta.label}
    </Badge>
  );
}

/** Compact stepper showing where a document sits in the pipeline. */
export function IngestPipeline({
  status,
  progress,
  className,
}: {
  status: DocumentStatus;
  progress: number;
  className?: string;
}) {
  if (status === "failed") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <AlertCircle className="size-3.5 shrink-0 text-danger" aria-hidden />
        <span className="text-2xs text-danger">Indexing failed</span>
      </div>
    );
  }

  const activeIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === status);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {PIPELINE_STAGES.map((stage, index) => {
          const done = index < activeIndex || status === "indexed";
          const active = index === activeIndex && status !== "indexed";
          return (
            <span key={stage.id} className="flex items-center gap-2">
              {index > 0 ? (
                <span
                  className={cn("h-px w-3", done || active ? "bg-accent/50" : "bg-hairline-strong")}
                  aria-hidden
                />
              ) : null}
              <span
                className={cn(
                  "flex items-center gap-1.5 text-2xs",
                  active ? "text-ink" : done ? "text-ink-soft" : "text-ink-faint",
                )}
                title={stage.detail}
              >
                {done ? (
                  <CheckCircle2 className="size-3 text-success" aria-hidden />
                ) : active ? (
                  <Loader2 className="size-3 animate-spin-slow text-accent" aria-hidden />
                ) : (
                  <span className="size-3 rounded-full border border-hairline-strong" aria-hidden />
                )}
                {stage.label}
              </span>
            </span>
          );
        })}
      </div>
      {status !== "indexed" ? <ProgressBar value={progress} label="Indexing progress" /> : null}
    </div>
  );
}

export function DocumentMetaLine({ document }: { document: DocumentRecord }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-faint">
      <span className="inline-flex items-center gap-1">
        <Waves className="size-3" aria-hidden />
        {document.source === "url" ? "URL" : document.source === "file" ? "File" : "Pasted text"}
      </span>
      <span aria-hidden>·</span>
      <span>{document.chunkCount} passages</span>
      <span aria-hidden>·</span>
      <span className="font-mono">{document.embeddingModel}</span>
      {document.tokenEstimate > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span>~{document.tokenEstimate.toLocaleString()} tokens</span>
        </>
      ) : null}
    </span>
  );
}

export function SourceIcon({ source }: { source: DocumentRecord["source"] }) {
  if (source === "url") return <Upload className="size-3.5" aria-hidden />;
  return <FileStack className="size-3.5" aria-hidden />;
}
