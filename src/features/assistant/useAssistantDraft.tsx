import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { Check, Loader2, RotateCcw } from "lucide-react";
import type { Assistant, AssistantDraft } from "@/lib/api/types";

export function toDraft(assistant: Assistant): AssistantDraft {
  return {
    name: assistant.name,
    description: assistant.description,
    status: assistant.status,
    systemPrompt: assistant.systemPrompt,
    model: assistant.model,
    embedding: assistant.embedding,
    rag: assistant.rag,
    widget: assistant.widget,
    knowledgeBaseIds: assistant.knowledgeBaseIds,
  };
}

/** Only the keys that actually changed are sent to the API. */
function buildPatch(draft: AssistantDraft, snapshot: AssistantDraft): Partial<AssistantDraft> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof AssistantDraft)[]) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(snapshot[key])) {
      patch[key] = draft[key];
    }
  }
  return patch as Partial<AssistantDraft>;
}

/**
 * Local draft state for a configuration form.
 *
 * Changes stay local until saved, so a half-finished edit never hits the API.
 * The snapshot resets the draft whenever the server state changes, which keeps
 * two tabs open on the same assistant consistent.
 */
export function useAssistantDraft(
  assistant: Assistant,
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>,
) {
  // Keyed by content, not identity: a background refresh that returns an equal
  // record must not wipe what the user is typing, and a real change must reset.
  const snapshotJson = JSON.stringify(toDraft(assistant));
  const snapshot = useMemo<AssistantDraft>(() => JSON.parse(snapshotJson), [snapshotJson]);
  const [draft, setDraft] = useState<AssistantDraft>(snapshot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(snapshot);
  }, [snapshot]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(snapshot),
    [draft, snapshot],
  );

  const set = useCallback(<K extends keyof AssistantDraft>(key: K, value: AssistantDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  /** Merge a partial change into one of the nested configuration objects. */
  const merge = useCallback(
    <K extends "model" | "embedding" | "rag" | "widget">(
      key: K,
      partial: Partial<AssistantDraft[K]>,
    ) => {
      setDraft((current) => ({ ...current, [key]: { ...current[key], ...partial } }));
    },
    [],
  );

  const reset = useCallback(() => {
    setDraft(snapshot);
    setError(null);
  }, [snapshot]);

  const save = useCallback(async (): Promise<boolean> => {
    const patch = buildPatch(draft, snapshot);
    if (Object.keys(patch).length === 0) return true;
    setSaving(true);
    setError(null);
    try {
      await onSave(patch);
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, snapshot, onSave]);

  return { draft, snapshot, set, merge, dirty, reset, save, saving, error, replace: setDraft };
}

/** Sticky unsaved-changes bar shown at the bottom of a configuration tab. */
export function DraftBar({
  dirty,
  saving,
  error,
  onSave,
  onReset,
  label = "Unsaved changes",
}: {
  dirty: boolean;
  saving: boolean;
  error?: string | null;
  onSave: () => void;
  onReset: () => void;
  label?: string;
}) {
  if (!dirty && !error) return null;

  return (
    <div className="sticky bottom-4 z-20 mt-4">
      <div className="surface-panel flex flex-wrap items-center gap-3 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)]" />
          <span className="truncate text-2xs text-ink-soft">{error ?? label}</span>
        </span>
        <div className="ms-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            iconLeft={<RotateCcw className="size-3.5" aria-hidden />}
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onSave}
            disabled={saving}
            iconLeft={
              saving ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )
            }
          >
            {saving ? "Saving" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
