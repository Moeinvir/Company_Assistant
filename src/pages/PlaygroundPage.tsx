import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp,
  Bot,
  Eraser,
  FlaskConical,
  History,
  Loader2,
  MessageSquare,
  Search,
  Settings2,
  Sparkles,
  Timer,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  SegmentedControl,
  Select,
  Slider,
  StatusDot,
  TabBar,
  TabPanel,
  Textarea,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { RetrievedChunkList, SourceList } from "@/features/playground/RetrievedChunkList";
import { useWorkspaceData } from "@/store/workspaceData";
import { PROVIDER_MAP, providerLabel } from "@/lib/api/providers";
import { formatDuration, formatNumber, formatRelative } from "@/lib/format";
import type {
  ChatMessage,
  Conversation,
  QueryResponse,
  RetrievalStrategy,
  SearchResponse,
} from "@/lib/api/types";

type Tool = "chat" | "search";

interface Turn {
  role: "user" | "assistant";
  content: string;
  response?: QueryResponse;
}

export default function PlaygroundPage() {
  const {
    assistants,
    knowledgeBases,
    credentials,
    runQuery,
    runSearch,
    listConversations,
    conversationMessages,
    clearConversations,
    documentsByKb,
    loadDocuments,
  } = useWorkspaceData();

  const [tool, setTool] = useState<Tool>("chat");
  const [assistantId, setAssistantId] = useState<string>("");
  const [topK, setTopK] = useState<number | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<RetrievalStrategy | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const assistant = useMemo(
    () => assistants.find((entry) => entry.id === assistantId) ?? assistants[0],
    [assistants, assistantId],
  );

  useEffect(() => {
    if (assistant && assistant.id !== assistantId) setAssistantId(assistant.id);
  }, [assistant, assistantId]);

  useEffect(() => {
    for (const knowledgeBase of knowledgeBases) {
      if (assistant?.knowledgeBaseIds.includes(knowledgeBase.id) && !documentsByKb[knowledgeBase.id]) {
        void loadDocuments(knowledgeBase.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant?.id, knowledgeBases]);

  // Reset overrides whenever the assistant changes: each assistant has its own
  // retrieval policy and silently reusing another's overrides misleads.
  useEffect(() => {
    setTopK(null);
    setThreshold(null);
    setStrategy(null);
  }, [assistant?.id]);

  useEffect(() => {
    if (!assistant) return;
    let cancelled = false;
    void listConversations(assistant.id)
      .then((list) => {
        if (!cancelled) setConversations(list.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant?.id, turns.length]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, busy]);

  const effectiveTopK = topK ?? assistant?.rag.topK ?? 5;
  const effectiveThreshold = threshold ?? assistant?.rag.scoreThreshold ?? 0.2;
  const effectiveStrategy = strategy ?? assistant?.rag.strategy ?? "hybrid";

  const attachments = assistant
    ? knowledgeBases.filter((knowledgeBase) => assistant.knowledgeBaseIds.includes(knowledgeBase.id))
    : [];
  const passages = attachments.reduce((sum, knowledgeBase) => sum + knowledgeBase.chunkCount, 0);

  const connected = assistant
    ? Boolean(credentials[assistant.model.provider]?.apiKey) ||
      PROVIDER_MAP[assistant.model.provider]?.requiresKey === false
    : false;

  const send = async () => {
    const value = question.trim();
    if (!value || !assistant || busy) return;
    setBusy(true);
    setError(null);
    const nextTurns: Turn[] = [...turns, { role: "user", content: value }];
    setTurns(nextTurns);
    setQuestion("");
    try {
      const response = await runQuery({
        assistantId: assistant.id,
        question: value,
        // Prior turns only, both roles: the new question is appended by the pipeline.
        history: turns.map((turn) => ({ role: turn.role, content: turn.content })),
        topKOverride: topK ?? undefined,
        scoreThresholdOverride: threshold ?? undefined,
        strategyOverride: strategy ?? undefined,
      });
      setTurns([...nextTurns, { role: "assistant", content: response.message.content, response }]);
    } catch (caught) {
      setError((caught as Error).message);
      setTurns(nextTurns);
    } finally {
      setBusy(false);
    }
  };

  const runSearchQuery = async () => {
    const value = searchQuery.trim();
    if (!value || !assistant) return;
    setSearchBusy(true);
    setError(null);
    try {
      setSearch(
        await runSearch({
          assistantId: assistant.id,
          query: value,
          topK: effectiveTopK,
          strategy: effectiveStrategy,
        }),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSearchBusy(false);
    }
  };

  const loadConversation = async (conversation: Conversation) => {
    setBusy(true);
    setError(null);
    try {
      const messages = await conversationMessages(conversation.id);
      setTurns(
        messages
          .filter((message: ChatMessage) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content,
            response:
              message.retrieved && message.meta
                ? { message, retrieved: message.retrieved }
                : undefined,
          })),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (assistants.length === 0) {
    return (
      <>
        <PageHeader
          title="Playground"
          description="Inspect retrieval and generation before anything reaches your users."
        />
        <EmptyState
          icon={<FlaskConical className="size-4" aria-hidden />}
          title="No assistant to test yet"
          description="The playground runs real queries against an assistant's configuration and index. Create an assistant and attach a knowledge base to begin."
          action={
            <Link to="/assistants?new=1" className="text-2xs font-medium text-accent hover:text-accent-strong">
              Create an assistant →
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Playground"
        description="A laboratory for retrieval. Every run executes the real pipeline — the same chunking, embedding, scoring and prompting your users will hit."
        meta={
          assistant ? (
            <>
              <Badge tone="neutral">
                {providerLabel(assistant.model.provider)} · {assistant.model.model}
              </Badge>
              <Badge tone={connected ? "success" : "warn"}>
                {connected ? "Generation connected" : "Extractive mode — no provider key"}
              </Badge>
              <Badge tone="neutral">{formatNumber(passages)} passages in scope</Badge>
            </>
          ) : null
        }
        actions={
          <>
            <Select
              value={assistant?.id ?? ""}
              onChange={(event) => setAssistantId(event.target.value)}
              options={assistants.map((entry) => ({
                value: entry.id,
                label: `${entry.name} · ${entry.model.model}`,
              }))}
              aria-label="Assistant under test"
              className="min-w-[240px]"
            />
            <Button
              variant="outline"
              iconLeft={<Settings2 className="size-3.5" aria-hidden />}
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? "Hide overrides" : "Overrides"}
            </Button>
          </>
        }
      >
        <TabBar
          tabs={[
            { id: "chat", label: "Chat RAG", icon: <MessageSquare className="size-3.5" aria-hidden /> },
            { id: "search", label: "Semantic search", icon: <Search className="size-3.5" aria-hidden /> },
          ]}
          value={tool}
          onChange={setTool}
          className="mt-1"
        />
      </PageHeader>

      {showAdvanced && assistant ? (
        <Card className="mb-3">
          <CardHeader
            title="Run-level overrides"
            description="These apply to this session only and never change the saved assistant configuration."
          />
          <CardBody className="grid gap-5 sm:grid-cols-3">
            <Slider
              label="Top K"
              min={1}
              max={12}
              step={1}
              value={effectiveTopK}
              format={(value) => `${value} passages`}
              onChange={(value) => setTopK(value)}
            />
            <Slider
              label="Relevance threshold"
              min={0}
              max={0.8}
              step={0.01}
              value={effectiveThreshold}
              format={(value) => `≥ ${(value * 100).toFixed(0)}%`}
              onChange={(value) => setThreshold(value)}
            />
            <Field label="Strategy">
              <SegmentedControl
                value={effectiveStrategy}
                onChange={(value) => setStrategy(value)}
                options={[
                  { value: "hybrid", label: "Hybrid" },
                  { value: "vector", label: "Vector" },
                  { value: "keyword", label: "Keyword" },
                ]}
              />
            </Field>
            <div className="sm:col-span-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTopK(null);
                  setThreshold(null);
                  setStrategy(null);
                }}
              >
                Reset to the assistant's saved policy
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {error ? (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      ) : null}

      <TabPanel id="chat" active={tool === "chat"}>
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <Card className="flex min-h-[560px] flex-col">
            <CardHeader
              title="Conversation"
              description={
                assistant
                  ? `${assistant.rag.strategy} · top ${effectiveTopK} · ≥ ${(effectiveThreshold * 100).toFixed(0)}%`
                  : undefined
              }
              actions={
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<Eraser className="size-3.5" aria-hidden />}
                    onClick={() => setTurns([])}
                    disabled={turns.length === 0}
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmClearHistory(true)}
                  >
                    Clear history
                  </Button>
                </>
              }
            />

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 pb-2 sm:px-5">
              {turns.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Sparkles className="size-4" aria-hidden />}
                  title="Ask the assistant something"
                  description="Each answer shows the passages it used, the retrieval metadata and whether it was generated or extracted."
                />
              ) : null}

              {turns.map((turn, index) =>
                turn.role === "user" ? (
                  <div key={index} className="flex justify-end">
                    <p dir="auto" className="max-w-[80%] rounded-card border border-hairline bg-surface-2 px-3.5 py-2.5 text-micro leading-relaxed text-ink-soft">
                      {turn.content}
                    </p>
                  </div>
                ) : (
                  <div key={index} className="space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border border-hairline bg-black/30">
                        <Bot className="size-3.5 text-accent" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="whitespace-pre-wrap rounded-card border border-hairline bg-black/25 px-3.5 py-3 text-micro leading-relaxed text-ink-soft">
                          {turn.content}
                        </p>
                        {turn.response?.message.meta ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
                            <Badge tone={turn.response.message.meta.mode === "model" ? "accent" : "warn"}>
                              {turn.response.message.meta.mode === "model" ? "Generated" : "Extractive"}
                            </Badge>
                            <span className="inline-flex items-center gap-1">
                              <Timer className="size-3" aria-hidden />
                              {formatDuration(turn.response.message.meta.latencyMs)}
                            </span>
                            <span>{turn.response.message.meta.retrievedCount} passages</span>
                            <span>{turn.response.message.meta.totalTokens} tokens</span>
                            {turn.response.message.meta.topScore !== null ? (
                              <span>top score {(turn.response.message.meta.topScore * 100).toFixed(0)}%</span>
                            ) : null}
                            <span className="font-mono">
                              {turn.response.message.meta.provider}/{turn.response.message.meta.model}
                            </span>
                          </div>
                        ) : null}
                        {turn.response?.message.meta && turn.response.message.meta.notes.length > 0 ? (
                          <ul className="mt-2 space-y-1 rounded-card border border-warn/20 bg-warn/[0.05] px-3 py-2">
                            {turn.response.message.meta.notes.map((note) => (
                              <li key={note} className="text-[10px] leading-relaxed text-ink-soft">
                                {note}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>

                    {turn.response && turn.response.retrieved.length > 0 ? (
                      <div className="ms-8 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-2xs font-medium text-ink-soft">Retrieved passages</p>
                          <SourceList results={turn.response.retrieved} />
                        </div>
                        <RetrievedChunkList results={turn.response.retrieved} compact />
                      </div>
                    ) : null}
                  </div>
                ),
              )}

              {busy ? (
                <div className="ms-8 flex items-center gap-2 text-2xs text-ink-mute">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Retrieving and answering…
                </div>
              ) : null}
            </div>

            <div className="border-t border-hairline p-3 sm:p-4">
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask a question your knowledge base should answer… (Enter to send, Shift+Enter for a new line)"
                  aria-label="Question"
                  dir="auto"
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  size="lg"
                  disabled={busy || question.trim().length === 0}
                  onClick={() => void send()}
                  aria-label="Send question"
                  iconLeft={
                    busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />
                  }
                >
                  Run
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-3">
            <Card>
              <CardHeader
                title="Recent conversations"
                description="Recorded from playground and widget sessions."
                icon={<History className="size-3.5" aria-hidden />}
              />
              <CardBody className="space-y-1.5">
                {conversations.length === 0 ? (
                  <p className="text-2xs text-ink-faint">No conversations recorded for this assistant yet.</p>
                ) : (
                  conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => void loadConversation(conversation)}
                      className="w-full rounded-[10px] border border-hairline bg-black/20 px-2.5 py-2 text-start transition-colors hover:border-hairline-strong hover:bg-surface-2"
                    >
                      <span className="block truncate text-2xs text-ink-soft">{conversation.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-faint">
                        <StatusDot tone={conversation.channel === "widget" ? "accent" : "neutral"} />
                        {conversation.channel} · {conversation.messageCount} messages ·{" "}
                        {formatRelative(conversation.updatedAt)}
                      </span>
                    </button>
                  ))
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Retrieval scope" description="What this run can see." />
              <CardBody className="space-y-2">
                {attachments.length === 0 ? (
                  <p className="text-2xs text-ink-faint">
                    No knowledge base attached — retrieval will always return nothing.
                  </p>
                ) : (
                  attachments.map((knowledgeBase) => (
                    <div key={knowledgeBase.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-2xs text-ink-soft">{knowledgeBase.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                        {knowledgeBase.chunkCount} passages
                      </span>
                    </div>
                  ))
                )}
                <Link
                  to={`/assistants/${assistant?.id}`}
                  className="mt-1 block text-2xs font-medium text-accent hover:text-accent-strong"
                >
                  Edit knowledge attachments →
                </Link>
              </CardBody>
            </Card>
          </div>
        </div>
      </TabPanel>

      <TabPanel id="search" active={tool === "search"}>
        <Card>
          <CardHeader
            title="Semantic search"
            description="Retrieval only — no model call. Rankings come straight from vector similarity and BM25 scoring."
            actions={
              search ? (
                <>
                  <Badge tone="neutral">{formatNumber(search.scannedChunks)} scanned</Badge>
                  <Badge tone="neutral">{formatDuration(search.latencyMs)}</Badge>
                  <Badge tone="neutral">{search.strategy}</Badge>
                </>
              ) : null
            }
          />
          <CardBody className="space-y-3.5">
            <div className="flex items-end gap-2">
              <Field label="Query" htmlFor="search-query" className="flex-1">
                <Input
                  id="search-query"
                  dir="auto"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runSearchQuery();
                  }}
                  placeholder="e.g. how should I choose a chunk size"
                />
              </Field>
              <Button
                variant="primary"
                loading={searchBusy}
                disabled={searchQuery.trim().length === 0}
                onClick={() => void runSearchQuery()}
                iconLeft={<Search className="size-3.5" aria-hidden />}
              >
                Search
              </Button>
            </div>

            {search ? (
              search.results.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Search className="size-4" aria-hidden />}
                  title="No passages returned"
                  description={`${search.scannedChunks} passages were scanned and none scored above zero. Confirm documents are indexed and attached.`}
                />
              ) : (
                <RetrievedChunkList results={search.results} />
              )
            ) : (
              <EmptyState
                compact
                icon={<Search className="size-4" aria-hidden />}
                title="Run a query to inspect the index"
                description="Results show the blended score, the vector similarity and the keyword score for every passage, so you can see exactly why something ranked."
              />
            )}
          </CardBody>
        </Card>
      </TabPanel>

      <ConfirmDialog
        open={confirmClearHistory}
        onClose={() => setConfirmClearHistory(false)}
        title="Clear all conversation history?"
        description="Deletes every playground and widget conversation in this workspace, for all assistants."
        confirmLabel="Clear history"
        onConfirm={async () => {
          await clearConversations();
          setConfirmClearHistory(false);
        }}
      />
    </>
  );
}
