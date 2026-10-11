import { useState } from "react";
import { Loader2, MessageSquare, Play, Search, Sparkles, Timer, TrendingUp } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
} from "@/components/ui";
import { RetrievedChunkList, SourceList } from "@/features/playground/RetrievedChunkList";
import { useWorkspaceData } from "@/store/workspaceData";
import { formatDuration, formatNumber } from "@/lib/format";
import type { Assistant, QueryResponse, SearchResponse } from "@/lib/api/types";

type Mode = "chat" | "search";

const SUGGESTIONS = [
  "How does retrieval decide which passages to use?",
  "What should I check when an answer seems wrong?",
  "How do I change the embedding model?",
];

export function TestingTab({ assistant }: { assistant: Assistant }) {
  const { runQuery, runSearch, knowledgeBases, documentsByKb } = useWorkspaceData();
  const [mode, setMode] = useState<Mode>("chat");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<QueryResponse | null>(null);
  const [search, setSearch] = useState<SearchResponse | null>(null);

  const attached = knowledgeBases.filter((knowledgeBase) =>
    assistant.knowledgeBaseIds.includes(knowledgeBase.id),
  );
  const passages = attached.reduce((sum, knowledgeBase) => sum + knowledgeBase.chunkCount, 0);
  const processing = attached.some((knowledgeBase) =>
    (documentsByKb[knowledgeBase.id] ?? []).some(
      (document) => document.status !== "indexed" && document.status !== "failed",
    ),
  );

  const run = async () => {
    const value = question.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "chat") {
        setChat(await runQuery({ assistantId: assistant.id, question: value }));
      } else {
        setSearch(
          await runSearch({
            assistantId: assistant.id,
            query: value,
            topK: assistant.rag.topK,
            strategy: assistant.rag.strategy,
          }),
        );
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Test this assistant"
          description="Runs against the saved configuration and the live index — the same pipeline the widget uses."
          icon={<Play className="size-3.5" aria-hidden />}
          actions={
            <SegmentedControl
              size="sm"
              value={mode}
              onChange={(value) => setMode(value)}
              options={[
                { value: "chat", label: "Chat RAG" },
                { value: "search", label: "Semantic search" },
              ]}
            />
          }
        />
        <CardBody className="space-y-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{passages.toLocaleString()} passages indexed</Badge>
            <Badge tone="neutral">
              {`${attached.length} knowledge ${attached.length === 1 ? "base" : "bases"}`}
            </Badge>
            <Badge tone="neutral">
              {assistant.rag.strategy} · top {assistant.rag.topK} · ≥
              {(assistant.rag.scoreThreshold * 100).toFixed(0)}%
            </Badge>
            {processing ? <Badge tone="warn">documents still indexing</Badge> : null}
          </div>

          <Field label="Question" htmlFor="testing-question">
            <div className="flex items-center gap-2">
              <Input
                id="testing-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void run();
                }}
                placeholder="Ask something your knowledge base should answer…"
              />
              <Button
                variant="primary"
                onClick={() => void run()}
                disabled={busy || question.trim().length === 0}
                iconLeft={
                  busy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : mode === "chat" ? (
                    <MessageSquare className="size-3.5" aria-hidden />
                  ) : (
                    <Search className="size-3.5" aria-hidden />
                  )
                }
              >
                Run
              </Button>
            </div>
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setQuestion(suggestion)}
                className="rounded-full border border-hairline px-2.5 py-1 text-[10px] text-ink-mute transition-colors hover:border-accent/40 hover:text-ink-soft"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {error ? (
            <p className="rounded-[10px] border border-danger/25 bg-danger/[0.07] px-3 py-2 text-2xs text-danger">
              {error}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {mode === "chat" ? (
        chat ? (
          <Card>
            <CardHeader
              title="Response"
              description={
                chat.message.meta?.mode === "extractive"
                  ? "Extractive answer — assembled from the retrieved passages, not generated by a model."
                  : "Generated from the retrieved passages."
              }
              actions={
                <Badge tone={chat.message.meta?.grounded ? "success" : "warn"}>
                  {chat.message.meta?.grounded ? "Grounded with citations" : "No citations"}
                </Badge>
              }
            />
            <CardBody className="space-y-3.5">
              <div className="rounded-card border border-hairline bg-black/25 p-3.5">
                <p className="whitespace-pre-wrap text-micro leading-relaxed text-ink-soft">
                  {chat.message.content}
                </p>
              </div>

              {chat.message.meta ? (
                <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3 sm:grid-cols-4">
                  <MetaStat label="Latency" value={formatDuration(chat.message.meta.latencyMs)} icon={<Timer className="size-3" aria-hidden />} />
                  <MetaStat label="Passages used" value={String(chat.message.meta.retrievedCount)} icon={<TrendingUp className="size-3" aria-hidden />} />
                  <MetaStat label="Tokens" value={formatNumber(chat.message.meta.totalTokens)} />
                  <MetaStat
                    label="Top score"
                    value={chat.message.meta.topScore !== null ? `${(chat.message.meta.topScore * 100).toFixed(0)}%` : "—"}
                  />
                </div>
              ) : null}

              {chat.message.meta && chat.message.meta.notes.length > 0 ? (
                <ul className="space-y-1 rounded-card border border-warn/20 bg-warn/[0.05] px-3 py-2.5">
                  {chat.message.meta.notes.map((note) => (
                    <li key={note} className="text-[10px] leading-relaxed text-ink-soft">
                      {note}
                    </li>
                  ))}
                </ul>
              ) : null}

              {chat.retrieved.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-2xs font-medium text-ink-soft">Retrieved passages</p>
                    <SourceList results={chat.retrieved} />
                  </div>
                  <RetrievedChunkList results={chat.retrieved} />
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : (
          <EmptyState
            icon={<Sparkles className="size-4" aria-hidden />}
            title="No test run yet"
            description="Ask a question to see the answer, the passages behind it and the response metadata. This runs the real retrieval pipeline against your index."
          />
        )
      ) : search ? (
        <Card>
          <CardHeader
            title="Search results"
            description={`${formatNumber(search.scannedChunks)} passages scanned in ${formatDuration(search.latencyMs)} using ${search.embeddingModel}.`}
            actions={<Badge tone="neutral">{search.strategy}</Badge>}
          />
          <CardBody>
            <RetrievedChunkList
              results={search.results}
              emptyHint="No passage scored above zero. Confirm the knowledge base is attached and indexed."
            />
          </CardBody>
        </Card>
      ) : (
        <EmptyState
          icon={<Search className="size-4" aria-hidden />}
          title="Ready to search"
          description="Enter a query to inspect exactly which passages match, how strongly, and from which document."
        />
      )}
    </div>
  );
}

function MetaStat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 font-mono text-2xs tabular-nums text-ink-soft">{value}</p>
    </div>
  );
}
