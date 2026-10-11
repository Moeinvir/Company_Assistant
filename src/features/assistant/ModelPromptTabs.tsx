/** Model and system-prompt configuration tabs. */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Braces, Cpu, Info } from "lucide-react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  SegmentedControl,
  Select,
  Slider,
  Textarea,
  type SelectOption,
} from "@/components/ui";
import { CHAT_PROVIDERS, PROVIDER_MAP, modelsFor } from "@/lib/api/providers";
import { estimateTokens } from "@/lib/rag/chunker";
import { DraftBar, useAssistantDraft } from "./useAssistantDraft";
import { useWorkspaceData } from "@/store/workspaceData";
import type { Assistant, AssistantDraft, ProviderId } from "@/lib/api/types";
import { cn } from "@/lib/cn";

export function ModelTab({
  assistant,
  onSave,
}: {
  assistant: Assistant;
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>;
}) {
  const form = useAssistantDraft(assistant, onSave);
  const { providerKeys, credentials } = useWorkspaceData();

  const definition = PROVIDER_MAP[form.draft.model.provider];
  const keyRecord = providerKeys.find((entry) => entry.provider === form.draft.model.provider);
  const hasCredentials = Boolean(credentials[form.draft.model.provider]?.apiKey);
  const needsKey = Boolean(definition?.requiresKey) && !hasCredentials;

  const modelOptions: SelectOption[] = modelsFor(form.draft.model.provider, "chat").map((option) => ({
    value: option.id,
    label: `${option.label} · ${(option.contextWindow / 1000).toFixed(0)}K context`,
  }));

  const selected = modelsFor(form.draft.model.provider, "chat").find(
    (option) => option.id === form.draft.model.model,
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="AI provider"
          description="The vendor that generates answers. Retrieval runs locally and is provider-independent."
          icon={<Cpu className="size-3.5" aria-hidden />}
          actions={
            <Badge tone={needsKey ? "warn" : "success"}>
              {needsKey ? "No key on this device" : definition?.requiresKey ? "Key stored" : "No key needed"}
            </Badge>
          }
        />
        <CardBody className="space-y-3.5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Provider" htmlFor="model-provider">
              <Select
                id="model-provider"
                value={form.draft.model.provider}
                onChange={(event) => {
                  const next = event.target.value as ProviderId;
                  form.merge("model", {
                    provider: next,
                    model: modelsFor(next, "chat")[0]?.id ?? "",
                  });
                }}
                options={CHAT_PROVIDERS.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  group: entry.vendor,
                }))}
              />
            </Field>
            <Field label="Model" htmlFor="model-name" className="sm:col-span-2">
              <Select
                id="model-name"
                value={form.draft.model.model}
                onChange={(event) => form.merge("model", { model: event.target.value })}
                options={modelOptions}
              />
            </Field>
          </div>

          {needsKey ? (
            <div className="flex items-start gap-2.5 rounded-card border border-warn/25 bg-warn/[0.06] px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              <p className="text-2xs leading-relaxed text-ink-soft">
                <span className="font-medium text-warn">
                  {definition?.name} is selected but no key is stored
                </span>{" "}
                — queries still run, retrieve and score passages, and the answer is returned as an
                extract from those passages. Add a key to enable real generation.{" "}
                <Link to="/integrations" className="text-accent hover:text-accent-strong">
                  Connect a provider →
                </Link>
              </p>
            </div>
          ) : null}

          {keyRecord?.note ? (
            <p className="flex items-start gap-2 text-2xs leading-relaxed text-ink-mute">
              <Info className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
              Last verification: {keyRecord.note}
            </p>
          ) : null}

          {definition?.browserAccess === "restricted" ? (
            <p className="text-2xs leading-relaxed text-warn">
              {definition.name} blocks browser-origin requests. Route it through your platform API
              before relying on it in production.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Generation settings"
          description="How the model behaves once retrieval has supplied the context."
        />
        <CardBody className="space-y-4">
          <Slider
            label="Temperature"
            hint="Lower values stay closer to the retrieved passages. Above 0.6 the model starts embellishing."
            min={0}
            max={1}
            step={0.01}
            value={form.draft.model.temperature}
            format={(value) => value.toFixed(2)}
            onChange={(value) => form.merge("model", { temperature: value })}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Max output tokens" htmlFor="model-maxtokens">
              <Input
                id="model-maxtokens"
                type="number"
                min={128}
                max={32000}
                step={64}
                value={form.draft.model.maxTokens}
                onChange={(event) =>
                  form.merge("model", { maxTokens: Number(event.target.value) || 0 })
                }
              />
            </Field>
            <Field label="Top P" htmlFor="model-topp" hint="Nucleus sampling cutoff.">
              <Input
                id="model-topp"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={form.draft.model.topP}
                onChange={(event) => form.merge("model", { topP: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="Frequency penalty" htmlFor="model-freq" hint="Discourages repetition.">
              <Input
                id="model-freq"
                type="number"
                min={-2}
                max={2}
                step={0.1}
                value={form.draft.model.frequencyPenalty}
                onChange={(event) =>
                  form.merge("model", { frequencyPenalty: Number(event.target.value) || 0 })
                }
              />
            </Field>
          </div>

          <div className="rounded-card border border-hairline bg-black/20 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Effective context budget
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-mute">
              {selected
                ? `${selected.label} accepts roughly ${(selected.contextWindow / 1000).toFixed(0)}K tokens. Each query sends the system prompt, up to ${form.draft.rag.topK} passages and the conversation so far.`
                : "Select a model to see its context window."}
            </p>
          </div>
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

export function PromptTab({
  assistant,
  onSave,
}: {
  assistant: Assistant;
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>;
}) {
  const form = useAssistantDraft(assistant, onSave);

  const composed = useMemo(() => {
    return [
      form.draft.systemPrompt.trim(),
      form.draft.rag.instruction.trim(),
      "<context>\n[…retrieved passages inserted here…]\n</context>",
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [form.draft.systemPrompt, form.draft.rag.instruction]);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="System prompt"
          description="The assistant's role, voice and constraints. Retrieval instructions are appended automatically."
        />
        <CardBody className="space-y-3.5">
          <Textarea
            rows={9}
            value={form.draft.systemPrompt}
            onChange={(event) => form.set("systemPrompt", event.target.value)}
            aria-label="System prompt"
            className="font-mono text-2xs leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
            <Badge tone="neutral">{estimateTokens(form.draft.systemPrompt)} tokens</Badge>
            <span>Composed once per request and sent before the conversation.</span>
            <button
              type="button"
              className="ms-auto text-accent transition-colors hover:text-accent-strong"
              onClick={() =>
                form.set(
                  "systemPrompt",
                  "You are a precise, helpful assistant. Answer using the retrieved context and cite the passage numbers you rely on. If the context does not contain the answer, say so plainly.",
                )
              }
            >
              Use a safe default
            </button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Grounded-answer instruction"
          description="Prepended to the system prompt above every retrieved passage. Keep it short — it costs tokens on each request."
          icon={<Braces className="size-3.5" aria-hidden />}
        />
        <CardBody className="space-y-3.5">
          <Textarea
            rows={4}
            value={form.draft.rag.instruction}
            onChange={(event) => form.merge("rag", { instruction: event.target.value })}
            aria-label="Grounded answer instruction"
            className="font-mono text-2xs leading-relaxed"
          />
          <Field label="Behaviour when nothing matches">
            <SegmentedControl
              value={form.draft.rag.noAnswerBehavior}
              onChange={(value) =>
                form.merge("rag", { noAnswerBehavior: value as "refuse" | "answer-without-context" })
              }
              options={[
                { value: "refuse", label: "Refuse to answer" },
                { value: "answer-without-context", label: "Answer from general knowledge" },
              ]}
            />
          </Field>
          <Field
            label="Refusal message"
            htmlFor="prompt-refusal"
            hint="Returned verbatim when nothing clears the relevance threshold, so write it for the end user."
          >
            <Input
              id="prompt-refusal"
              value={form.draft.rag.noAnswerMessage}
              onChange={(event) => form.merge("rag", { noAnswerMessage: event.target.value })}
              disabled={form.draft.rag.noAnswerBehavior !== "refuse"}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Composed prompt"
          description="Exactly what the model receives, minus the retrieved passages themselves."
        />
        <CardBody>
          <pre
            className={cn(
              "max-h-64 overflow-auto rounded-card border border-hairline bg-black/40 p-3.5",
              "font-mono text-2xs leading-relaxed text-ink-mute whitespace-pre-wrap",
            )}
          >
            {composed}
          </pre>
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
