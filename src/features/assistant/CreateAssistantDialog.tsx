import { useMemo, useState } from "react";
import { Bot, Database, Gauge, Sparkles, Target, Layers } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  type SelectOption,
} from "@/components/ui";
import { CHAT_PROVIDERS, EMBEDDING_PROVIDERS, modelsFor } from "@/lib/api/providers";
import { defaultAssistantDraft } from "@/lib/api/localBackend";
import type { AssistantDraft, EmbeddingConfig, KnowledgeBase, ProviderId } from "@/lib/api/types";
import { cn } from "@/lib/cn";

type PresetId = "balanced" | "precise" | "broad";

const PRESETS: {
  id: PresetId;
  label: string;
  blurb: string;
  icon: typeof Target;
  rag: Pick<AssistantDraft["rag"], "topK" | "scoreThreshold" | "strategy">;
  embedding: Pick<EmbeddingConfig, "chunkSize" | "chunkOverlap">;
}[] = [
  {
    id: "balanced",
    label: "Balanced",
    blurb: "Good starting point for product and support documentation.",
    icon: Gauge,
    rag: { topK: 5, scoreThreshold: 0.22, strategy: "hybrid" },
    embedding: { chunkSize: 900, chunkOverlap: 150 },
  },
  {
    id: "precise",
    label: "Precise",
    blurb: "Tighter threshold and smaller chunks for reference material.",
    icon: Target,
    rag: { topK: 4, scoreThreshold: 0.35, strategy: "hybrid" },
    embedding: { chunkSize: 600, chunkOverlap: 100 },
  },
  {
    id: "broad",
    label: "Broad",
    blurb: "More passages, looser threshold, for exploratory questions.",
    icon: Layers,
    rag: { topK: 7, scoreThreshold: 0.14, strategy: "vector" },
    embedding: { chunkSize: 1200, chunkOverlap: 200 },
  },
];

export function CreateAssistantDialog({
  open,
  onClose,
  knowledgeBases,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  knowledgeBases: KnowledgeBase[];
  onCreate: (draft: AssistantDraft) => Promise<unknown>;
}) {
  const base = useMemo(() => defaultAssistantDraft(), []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(base.systemPrompt);
  const [provider, setProvider] = useState<ProviderId>(base.model.provider);
  const [model, setModel] = useState(base.model.model);
  const [temperature, setTemperature] = useState(base.model.temperature);
  const [embeddingProvider, setEmbeddingProvider] = useState<ProviderId>(base.embedding.provider);
  const [embeddingModel, setEmbeddingModel] = useState(base.embedding.model);
  const [presetId, setPresetId] = useState<PresetId>("balanced");
  const [selectedBases, setSelectedBases] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatModelOptions: SelectOption[] = modelsFor(provider, "chat").map((option) => ({
    value: option.id,
    label: `${option.label} · ${(option.contextWindow / 1000).toFixed(0)}K context`,
  }));

  const embeddingModelOptions: SelectOption[] = modelsFor(embeddingProvider, "embedding").map(
    (option) => ({
      value: option.id,
      label: `${option.label}${option.dimensions ? ` · ${option.dimensions} dims` : ""}`,
    }),
  );

  const reset = () => {
    setName("");
    setDescription("");
    setSystemPrompt(base.systemPrompt);
    setProvider(base.model.provider);
    setModel(base.model.model);
    setTemperature(base.model.temperature);
    setEmbeddingProvider(base.embedding.provider);
    setEmbeddingModel(base.embedding.model);
    setPresetId("balanced");
    setSelectedBases([]);
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Give the assistant a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const preset = PRESETS.find((entry) => entry.id === presetId)!;
    const embeddingModelMeta = modelsFor(embeddingProvider, "embedding").find(
      (option) => option.id === embeddingModel,
    );
    try {
      await onCreate({
        ...base,
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim() || base.systemPrompt,
        model: { ...base.model, provider, model, temperature },
        embedding: {
          ...base.embedding,
          provider: embeddingProvider,
          model: embeddingModel,
          dimensions: embeddingModelMeta?.dimensions ?? base.embedding.dimensions,
          chunkSize: preset.embedding.chunkSize,
          chunkOverlap: preset.embedding.chunkOverlap,
        },
        rag: { ...base.rag, ...preset.rag },
        widget: { ...base.widget, assistantDisplayName: name.trim(), welcomeMessage: `Hi — I'm ${name.trim()}. Ask me anything about our documentation.` },
        knowledgeBaseIds: selectedBases,
      });
      reset();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create an assistant"
      description="A model, a prompt and the knowledge it is allowed to read. Everything is editable afterwards."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()} iconLeft={<Sparkles className="size-3.5" aria-hidden />}>
            Create assistant
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="assistant-name">
            <Input
              id="assistant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Handbook Guide"
              autoFocus
            />
          </Field>
          <Field label="Description" htmlFor="assistant-description" optional>
            <Input
              id="assistant-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Answers product questions with citations"
            />
          </Field>
        </div>

        <Field
          label="System prompt"
          htmlFor="assistant-prompt"
          hint="Sets the assistant's voice and constraints. Retrieval instructions are added automatically."
        >
          <Textarea
            id="assistant-prompt"
            rows={3}
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="AI provider" htmlFor="assistant-provider">
            <Select
              id="assistant-provider"
              value={provider}
              onChange={(event) => {
                const next = event.target.value as ProviderId;
                setProvider(next);
                setModel(modelsFor(next, "chat")[0]?.id ?? "");
              }}
              options={CHAT_PROVIDERS.map((entry) => ({ value: entry.id, label: entry.name }))}
            />
          </Field>
          <Field label="Model" htmlFor="assistant-model" className="sm:col-span-2">
            <Select
              id="assistant-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              options={chatModelOptions}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Embedding provider" htmlFor="assistant-embed-provider">
            <Select
              id="assistant-embed-provider"
              value={embeddingProvider}
              onChange={(event) => {
                const next = event.target.value as ProviderId;
                setEmbeddingProvider(next);
                setEmbeddingModel(modelsFor(next, "embedding")[0]?.id ?? "");
              }}
              options={EMBEDDING_PROVIDERS.map((entry) => ({ value: entry.id, label: entry.name }))}
            />
          </Field>
          <Field
            label="Embedding model"
            htmlFor="assistant-embed-model"
            className="sm:col-span-2"
            hint="The built-in offline embedder needs no key, which makes it ideal for a first pass."
          >
            <Select
              id="assistant-embed-model"
              value={embeddingModel}
              onChange={(event) => setEmbeddingModel(event.target.value)}
              options={embeddingModelOptions}
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-2xs font-medium text-ink-soft">Retrieval preset</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PRESETS.map((preset) => {
              const Icon = preset.icon;
              const active = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPresetId(preset.id)}
                  className={cn(
                    "rounded-card border p-3 text-start transition-colors",
                    active
                      ? "border-accent/45 bg-accent/[0.07]"
                      : "border-hairline bg-black/25 hover:border-hairline-strong",
                  )}
                >
                  <span className="flex items-center gap-2 text-2xs font-medium text-ink">
                    <Icon className="size-3.5 text-accent" aria-hidden />
                    {preset.label}
                  </span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-ink-mute">
                    {preset.blurb}
                  </span>
                  <span className="mt-2 block font-mono text-[10px] text-ink-faint">
                    top {preset.rag.topK} · ≥{(preset.rag.scoreThreshold * 100).toFixed(0)}% ·{" "}
                    {preset.embedding.chunkSize} chars
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-2xs font-medium text-ink-soft">Knowledge bases</p>
            <Badge tone="neutral" icon={<Database className="size-3" aria-hidden />}>
              {selectedBases.length} attached
            </Badge>
          </div>
          {knowledgeBases.length === 0 ? (
            <p className="rounded-card border border-dashed border-hairline px-3 py-3 text-2xs text-ink-mute">
              No knowledge bases yet. Create one in the knowledge centre — you can attach it here
              afterwards.
            </p>
          ) : (
            <div className="space-y-2">
              {knowledgeBases.map((knowledgeBase) => (
                <div key={knowledgeBase.id} className="rounded-card border border-hairline bg-black/20 px-3 py-2.5">
                  <Checkbox
                    checked={selectedBases.includes(knowledgeBase.id)}
                    onChange={(next) =>
                      setSelectedBases((current) =>
                        next
                          ? [...current, knowledgeBase.id]
                          : current.filter((id) => id !== knowledgeBase.id),
                      )
                    }
                    label={knowledgeBase.name}
                    description={`${knowledgeBase.documentCount} documents · ${knowledgeBase.chunkCount} passages`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-card border border-hairline bg-black/20 px-3 py-2.5">
          <Bot className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
          <p className="text-[10px] leading-relaxed text-ink-faint">
            Temperature starts at {temperature.toFixed(2)} — low values keep answers close to the
            retrieved passages. You can tune it in the Model tab.
          </p>
        </div>

        {error ? (
          <p className="rounded-[10px] border border-danger/25 bg-danger/[0.07] px-3 py-2 text-2xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
