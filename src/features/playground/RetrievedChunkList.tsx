import { useState } from "react";
import { ChevronDown, FileText, Search } from "lucide-react";
import { Badge, EmptyState, ScoreMeter } from "@/components/ui";
import type { RetrievedChunk } from "@/lib/api/types";
import { cn } from "@/lib/cn";

export function RetrievedChunkCard({
  result,
  rank,
  defaultOpen,
}: {
  result: RetrievedChunk;
  rank: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <div className="rounded-card border border-hairline bg-black/25">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-start transition-colors hover:bg-white/[0.02]"
      >
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-2 font-mono text-[10px] text-ink-mute">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-2xs font-medium text-ink">{result.documentName}</span>
            <Badge>{result.knowledgeBaseName}</Badge>
            <span className="font-mono text-[10px] text-ink-faint">chunk #{result.index + 1}</span>
          </span>
          <span
            className={cn(
              "mt-1 block text-2xs leading-relaxed text-ink-mute",
              !open && "line-clamp-2",
            )}
          >
            {result.content}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <ScoreMeter score={result.score} />
          <ChevronDown
            className={cn("size-3.5 text-ink-faint transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {open ? (
        <div className="grid gap-2 border-t border-hairline px-3 py-2.5 sm:grid-cols-4">
          <Metric label="Blended score" value={result.score.toFixed(3)} />
          <Metric label="Vector similarity" value={result.vectorScore.toFixed(3)} />
          <Metric label="Keyword (BM25)" value={result.keywordScore.toFixed(3)} />
          <Metric label="Tokens" value={String(result.tokens)} />
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-2xs tabular-nums text-ink-soft">{value}</p>
    </div>
  );
}

export function RetrievedChunkList({
  results,
  emptyHint,
  compact,
}: {
  results: RetrievedChunk[];
  emptyHint?: string;
  compact?: boolean;
}) {
  if (results.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Search className="size-4" aria-hidden />}
        title="No passages retrieved"
        description={
          emptyHint ??
          "Nothing cleared the relevance threshold. Lower it in the assistant's RAG settings, or confirm the knowledge base is attached."
        }
      />
    );
  }

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      {results.map((result, index) => (
        <RetrievedChunkCard
          key={result.chunkId}
          result={result}
          rank={index + 1}
          defaultOpen={index === 0 && !compact}
        />
      ))}
    </div>
  );
}

export function SourceList({ results }: { results: RetrievedChunk[] }) {
  const unique = new Map<string, RetrievedChunk>();
  for (const result of results) {
    if (!unique.has(result.documentId)) unique.set(result.documentId, result);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...unique.values()].map((result) => (
        <span
          key={result.documentId}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-[10px] text-ink-mute"
          title={`${result.documentName} · best score ${result.score.toFixed(3)}`}
        >
          <FileText className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{result.documentName}</span>
        </span>
      ))}
    </div>
  );
}
