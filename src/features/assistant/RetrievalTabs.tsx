import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Database,
  Layers,
  Link2Off,
  RefreshCw,
  Sliders,
  Sparkles,
  Target,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  SegmentedControl,
  Slider,
  Switch,
  Textarea,
} from "@/components/ui";
import { DraftBar, useAssistantDraft } from "./useAssistantDraft";
import { useWorkspaceData } from "@/store/workspaceData";
import type { Assistant, AssistantDraft, RetrievalStrategy } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";

export function RagTab({
  assistant,
  onSave,
}: {
  assistant: Assistant;
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>;
}) {
  const form = useAssistantDraft(assistant, onSave);
  const { knowledgeBases, reindexKnowledgeBase } = useWorkspaceData();
  const [reindexing, setReindexing] = useState(false);

  const attached = knowledgeBases.filter((knowledgeBase) =>
    form.draft.knowledgeBaseIds.includes(knowledgeBase.id),
  );
  const totalPassages = attached.reduce((sum, knowledgeBase) => sum + knowledgeBase.chunkCount, 0);

  const embeddingChanged =
    form.draft.embedding.chunkSize !== form.snapshot.embedding.chunkSize ||
    form.draft.embedding.chunkOverlap !== form.snapshot.embedding.chunkOverlap ||
    form.draft.embedding.provider !== form.snapshot.embedding.provider ||
    form.draft.embedding.model !== form.snapshot.embedding.model;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Retrieval policy"
          description="How many passages are considered, how relevant they must be, and how they are ranked."
          icon={<Sliders className="size-3.5" aria-hidden />}
        />
        <CardBody className="space-y-4">
          <Switch
            checked={form.draft.rag.enabled}
            onChange={(value) => form.merge("rag", { enabled: value })}
            label="Use retrieval for this assistant"
            description="When disabled the assistant answers from its system prompt alone. Useful as an A/B baseline in the playground."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Strategy"
              hint="Hybrid blends cosine similarity with BM25 keyword scoring; keywords catch exact identifiers."
            >
              <SegmentedControl
                value={form.draft.rag.strategy}
                onChange={(value) => form.merge("rag", { strategy: value as RetrievalStrategy })}
                options={[
                  { value: "hybrid", label: "Hybrid" },
                  { value: "vector", label: "Vector" },
                  { value: "keyword", label: "Keyword" },
                ]}
              />
            </Field>
            <Field label="Reranking" hint="Not available in this build — the control reflects the capability, not a hidden step.">
              <Switch
                checked={form.draft.rag.rerank}
                onChange={(value) => form.merge("rag", { rerank: value })}
                label="Two-stage reranking"
                description="Unavailable: no reranker is configured for this workspace."
                disabled
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Slider
              label="Top K passages"
              hint="Each extra passage costs context tokens and gives the model more to be distracted by."
              min={1}
              max={12}
              step={1}
              value={form.draft.rag.topK}
              format={(value) => `${value} passages`}
              onChange={(value) => form.merge("rag", { topK: value })}
            />
            <Slider
              label="Relevance threshold"
              hint="Minimum blended score a passage must reach. Raise it when answers are vague; lower it when the assistant claims it does not know."
              min={0}
              max={0.8}
              step={0.01}
              value={form.draft.rag.scoreThreshold}
              format={(value) => `≥ ${(value * 100).toFixed(0)}%`}
              onChange={(value) => form.merge("rag", { scoreThreshold: value })}
            />
          </div>

          <div className="rounded-card border border-hairline bg-black/20 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              <Target className="size-3" aria-hidden />
              Current index reach
            </p>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-mute">
              {attached.length === 0
                ? "No knowledge base is attached, so retrieval always returns nothing."
                : `${formatNumber(totalPassages)} passages across ${attached.length} knowledge ${
                    attached.length === 1 ? "base" : "bases"
                  } will be scanned per query, keeping the top ${form.draft.rag.topK} above ${(
                    form.draft.rag.scoreThreshold * 100
                  ).toFixed(0)}%.`}
            </p>
          </div>

          <Field label="Grounding instruction" hint="Added above the retrieved context on every request.">
            <Textarea
              rows={3}
              value={form.draft.rag.instruction}
              onChange={(event) => form.merge("rag", { instruction: event.target.value })}
              className="text-2xs leading-relaxed"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Chunking and embedding"
          description="Applies at ingestion time. Changing either value requires re-indexing the attached knowledge bases."
          icon={<Layers className="size-3.5" aria-hidden />}
        />
        <CardBody className="space-y-4">
          <div className="grid gap-5 sm:grid-cols-2">
            <Slider
              label="Chunk size"
              hint="Characters per passage. Large chunks retrieve broad context but dilute the signal."
              min={300}
              max={2000}
              step={50}
              value={form.draft.embedding.chunkSize}
              format={(value) => `${value} chars`}
              onChange={(value) => form.merge("embedding", { chunkSize: value })}
            />
            <Slider
              label="Chunk overlap"
              hint="Characters repeated at the start of the next passage so context is not lost at a boundary."
              min={0}
              max={400}
              step={10}
              value={form.draft.embedding.chunkOverlap}
              format={(value) => `${value} chars`}
              onChange={(value) => form.merge("embedding", { chunkOverlap: value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-mute">
            <Badge tone="neutral">{form.draft.embedding.provider}</Badge>
            <span className="font-mono">{form.draft.embedding.model}</span>
            <span aria-hidden>·</span>
            <span>{form.draft.embedding.dimensions} dimensions</span>
            <Link to="/integrations" className="ms-auto text-accent hover:text-accent-strong">
              Change embedding model →
            </Link>
          </div>

          {embeddingChanged ? (
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-warn/25 bg-warn/[0.06] px-3 py-2.5">
              <RefreshCw className="size-3.5 shrink-0 text-warn" aria-hidden />
              <p className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-soft">
                Embedding or chunking changed. Save, then re-index so every passage is embedded with
                the new settings — existing vectors would otherwise be stale.
              </p>
              <Button
                size="sm"
                variant="outline"
                loading={reindexing}
                disabled={attached.length === 0}
                onClick={async () => {
                  setReindexing(true);
                  try {
                    // Re-index only with settings that were actually saved.
                    if (!(await form.save())) return;
                    for (const knowledgeBase of attached) {
                      await reindexKnowledgeBase(knowledgeBase.id, form.draft.embedding);
                    }
                  } finally {
                    setReindexing(false);
                  }
                }}
              >
                Save and re-index
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <DraftBar
        dirty={form.dirty}
        saving={form.saving}
        error={form.error}
        onSave={() => void form.save()}
        onReset={form.reset}
      />
    </div>
  );
}

export function KnowledgeTab({
  assistant,
  onSave,
}: {
  assistant: Assistant;
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>;
}) {
  const form = useAssistantDraft(assistant, onSave);
  const { knowledgeBases, documentsByKb, loadDocuments, reindexKnowledgeBase } = useWorkspaceData();
  const [busyId, setBusyId] = useState<string | null>(null);

  const attachedIds = form.draft.knowledgeBaseIds;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Attached knowledge bases"
          description="An assistant can only ever retrieve from the bases listed here. Documents are shared, not copied."
          icon={<Database className="size-3.5" aria-hidden />}
          actions={
            <Badge tone={attachedIds.length === 0 ? "warn" : "accent"}>
              {attachedIds.length} attached
            </Badge>
          }
        />
        <CardBody className="space-y-2">
          {knowledgeBases.length === 0 ? (
            <EmptyState
              compact
              icon={<Database className="size-4" aria-hidden />}
              title="No knowledge bases in this workspace"
              description="Create one in the knowledge centre, upload documents, then attach it here."
              action={
                <Link
                  to="/knowledge"
                  className="text-2xs font-medium text-accent hover:text-accent-strong"
                >
                  Open knowledge centre →
                </Link>
              }
            />
          ) : (
            knowledgeBases.map((knowledgeBase) => {
              const attached = attachedIds.includes(knowledgeBase.id);
              const documents = documentsByKb[knowledgeBase.id];
              return (
                <div
                  key={knowledgeBase.id}
                  className="rounded-card border border-hairline bg-black/20 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Checkbox
                        checked={attached}
                        onChange={(next) =>
                          form.set(
                            "knowledgeBaseIds",
                            next
                              ? [...attachedIds, knowledgeBase.id]
                              : attachedIds.filter((id) => id !== knowledgeBase.id),
                          )
                        }
                        label={knowledgeBase.name}
                        description={
                          knowledgeBase.description ||
                          `${knowledgeBase.documentCount} documents · ${formatNumber(knowledgeBase.chunkCount)} passages`
                        }
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void loadDocuments(knowledgeBase.id)}
                      >
                        Inspect
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyId === knowledgeBase.id}
                        disabled={!attached || knowledgeBase.documentCount === 0}
                        onClick={async () => {
                          setBusyId(knowledgeBase.id);
                          try {
                            await reindexKnowledgeBase(knowledgeBase.id, form.draft.embedding);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        Re-index
                      </Button>
                      {!attached ? <Link2Off className="size-3.5 text-ink-faint" aria-hidden /> : null}
                    </div>
                  </div>

                  {documents && documents.length > 0 ? (
                    <ul className="mt-2.5 space-y-1 border-t border-hairline pt-2.5">
                      {documents.slice(0, 4).map((document) => (
                        <li key={document.id} className="flex items-center gap-2 text-[10px] text-ink-faint">
                          <span className="min-w-0 flex-1 truncate">{document.name}</span>
                          <span className="shrink-0 font-mono">{document.chunkCount} chunks</span>
                          <span className="shrink-0">{document.status}</span>
                        </li>
                      ))}
                      {documents.length > 4 ? (
                        <li className="text-[10px] text-ink-faint">
                          +{documents.length - 4} more documents
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <div className="flex items-start gap-2.5 rounded-card border border-hairline bg-black/20 px-3.5 py-3">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
        <p className="text-2xs leading-relaxed text-ink-mute">
          Only the knowledge bases attached here are scanned at query time, and they must belong to
          this workspace. Isolation is enforced in the data layer, not in the interface.
        </p>
      </div>

      <DraftBar
        dirty={form.dirty}
        saving={form.saving}
        error={form.error}
        onSave={() => void form.save()}
        onReset={form.reset}
      />
    </div>
  );
}
