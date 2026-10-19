import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bot,
  Copy,
  Cpu,
  Library,
  MessageSquare,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dropdown,
  EmptyState,
  IconButton,
  Input,
  MenuItem,
  MenuSeparator,
  SegmentedControl,
  Skeleton,
  StatusDot,
  type Tone,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreateAssistantDialog } from "@/features/assistant/CreateAssistantDialog";
import { useWorkspaceData } from "@/store/workspaceData";
import { formatNumber, formatRelative } from "@/lib/format";
import type { Assistant, AssistantStatus } from "@/lib/api/types";

const STATUS_TONE: Record<AssistantStatus, Tone> = {
  active: "success",
  draft: "neutral",
  paused: "warn",
  error: "danger",
};

const STATUS_FILTERS: { value: "all" | AssistantStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
  { value: "error", label: "Error" },
];

function AssistantCard({
  assistant,
  onDuplicate,
  onDelete,
  onToggleStatus,
}: {
  assistant: Assistant;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}) {
  const knowledgeBaseLabel = `${assistant.knowledgeBaseIds.length} knowledge ${
    assistant.knowledgeBaseIds.length === 1 ? "base" : "bases"
  }`;

  return (
    <Card interactive className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-hairline bg-black/30">
            <Bot className="size-4 text-accent" aria-hidden />
          </span>
          <div className="min-w-0">
            <Link
              to={`/assistants/${assistant.id}`}
              className="block truncate text-micro font-semibold text-ink transition-colors hover:text-accent"
            >
              {assistant.name}
            </Link>
            <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-mute">
              {assistant.description || "No description yet."}
            </p>
          </div>
        </div>
        <Dropdown
          width={220}
          renderTrigger={(props) => (
            <IconButton label="Assistant actions" variant="ghost" size="icon-sm" {...props}>
              <MoreVertical className="size-3.5" aria-hidden />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem onSelect={() => { onToggleStatus(); close(); }} icon={assistant.status === "active" ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}>
                {assistant.status === "active" ? "Pause assistant" : assistant.status === "paused" ? "Resume assistant" : "Activate assistant"}
              </MenuItem>
              <MenuItem onSelect={() => { onDuplicate(); close(); }} icon={<Copy className="size-3.5" aria-hidden />}>
                Duplicate
              </MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={() => { onDelete(); close(); }} icon={<Trash2 className="size-3.5" aria-hidden />}>
                Delete assistant
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>

      <dl className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-hairline pt-3.5">
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">Model</dt>
          <dd className="mt-0.5 truncate font-mono text-2xs text-ink-soft">{assistant.model.model}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">Embedding</dt>
          <dd className="mt-0.5 truncate font-mono text-2xs text-ink-soft">
            {assistant.embedding.model}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">Knowledge</dt>
          <dd className="mt-0.5 truncate text-2xs text-ink-soft">{knowledgeBaseLabel}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">Conversations</dt>
          <dd className="mt-0.5 font-mono text-2xs tabular-nums text-ink-soft">
            {formatNumber(assistant.stats.conversations)}
          </dd>
        </div>
      </dl>

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-hairline pt-3">
        <span className="flex items-center gap-2">
          <StatusDot tone={STATUS_TONE[assistant.status]} pulse={assistant.status === "active"} />
          <Badge tone={STATUS_TONE[assistant.status]}>{assistant.status}</Badge>
          <span className="truncate text-[10px] text-ink-faint">
            {assistant.stats.lastActivityAt
              ? `active ${formatRelative(assistant.stats.lastActivityAt)}`
              : "no activity yet"}
          </span>
        </span>
        <Link
          to={`/assistants/${assistant.id}`}
          className="shrink-0 text-2xs font-medium text-accent transition-colors hover:text-accent-strong"
        >
          Configure →
        </Link>
      </div>
    </Card>
  );
}

export default function AssistantsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const {
    assistants,
    knowledgeBases,
    loading,
    createAssistant,
    updateAssistant,
    duplicateAssistant,
    deleteAssistant,
  } = useWorkspaceData();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AssistantStatus>("all");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Assistant | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (params.get("new") === "1") {
      setCreating(true);
      params.delete("new");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return assistants.filter((assistant) => {
      if (statusFilter !== "all" && assistant.status !== statusFilter) return false;
      if (!term) return true;
      return `${assistant.name} ${assistant.description} ${assistant.model.model}`
        .toLowerCase()
        .includes(term);
    });
  }, [assistants, query, statusFilter]);

  const counts = useMemo(
    () => ({
      all: assistants.length,
      active: assistants.filter((entry) => entry.status === "active").length,
      draft: assistants.filter((entry) => entry.status === "draft").length,
      paused: assistants.filter((entry) => entry.status === "paused").length,
      error: assistants.filter((entry) => entry.status === "error").length,
    }),
    [assistants],
  );

  return (
    <>
      <PageHeader
        title="Assistants"
        description="Each assistant binds a model, a system prompt and the knowledge bases it may read. Retrieval, appearance and the embeddable widget are configured per assistant."
        actions={
          <Button
            variant="primary"
            iconLeft={<Plus className="size-3.5" aria-hidden />}
            onClick={() => setCreating(true)}
          >
            Create assistant
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search assistants…"
              className="ps-8"
              aria-label="Search assistants"
            />
          </div>
          <SegmentedControl
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTERS.map((filter) => ({
              value: filter.value,
              label: `${filter.label}${filter.value === "all" ? ` (${counts.all})` : counts[filter.value] ? ` (${counts[filter.value]})` : ""}`,
            }))}
          />
        </div>
      </PageHeader>

      {loading && assistants.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Card key={index} className="space-y-3 p-4">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={assistants.length === 0 ? <Bot className="size-4" aria-hidden /> : <Search className="size-4" aria-hidden />}
          title={assistants.length === 0 ? "No assistants in this workspace" : "No assistants match those filters"}
          description={
            assistants.length === 0
              ? "Create an assistant to bind a model to your knowledge, then test it in the playground before you ship the widget."
              : "Clear the search or choose a different status filter."
          }
          action={
            assistants.length === 0 ? (
              <Button variant="primary" size="sm" iconLeft={<Plus className="size-3.5" aria-hidden />} onClick={() => setCreating(true)}>
                Create assistant
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                Reset filters
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((assistant) => (
            <AssistantCard
              key={assistant.id}
              assistant={assistant}
              onDuplicate={() => void duplicateAssistant(assistant.id)}
              onDelete={() => setPendingDelete(assistant)}
              onToggleStatus={() =>
                void updateAssistant(assistant.id, {
                  // Anything that is not running yet (draft or paused) is
                  // activated by this action; only a running assistant pauses.
                  status: assistant.status === "active" ? "paused" : "active",
                })
              }
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-2xs text-ink-faint">
        <Cpu className="size-3.5" aria-hidden />
        <span>
          Model and embedding choices are abstracted from the vendor: switch provider at any time and
          re-index.
        </span>
        <Link to="/integrations" className="text-accent hover:text-accent-strong">
          Manage provider keys →
        </Link>
      </div>

      <CreateAssistantDialog
        open={creating}
        onClose={() => setCreating(false)}
        knowledgeBases={knowledgeBases}
        onCreate={async (draft) => {
          const assistant = await createAssistant(draft);
          navigate(`/assistants/${assistant.id}`);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        loading={deleting}
        title={`Delete “${pendingDelete?.name}”?`}
        description="The assistant and its conversation history are removed. Knowledge bases and their documents are not affected."
        confirmLabel="Delete assistant"
        onConfirm={async () => {
          if (!pendingDelete) return;
          setDeleting(true);
          try {
            await deleteAssistant(pendingDelete.id);
            setPendingDelete(null);
          } finally {
            setDeleting(false);
          }
        }}
      >
        <p className="flex items-start gap-2 text-2xs leading-relaxed text-ink-soft">
          <Library className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
          <span>
            {pendingDelete?.stats.conversations ?? 0} conversations and{" "}
            {formatNumber(pendingDelete?.stats.messages ?? 0)} messages will be deleted. Its published
            widget will stop responding.
          </span>
        </p>
      </ConfirmDialog>

      <div className="mt-6 flex items-center gap-2 rounded-card border border-hairline bg-black/20 px-3.5 py-3">
        <MessageSquare className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
        <p className="text-2xs leading-relaxed text-ink-mute">
          Tip: open an assistant and use the <span className="text-ink-soft">Testing</span> tab to send
          a real query without leaving the configuration screen.
        </p>
      </div>
    </>
  );
}
