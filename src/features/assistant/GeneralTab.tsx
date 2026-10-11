import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  CopyButton,
  DetailRow,
  Field,
  Input,
  SegmentedControl,
  Textarea,
} from "@/components/ui";
import { DraftBar, useAssistantDraft } from "./useAssistantDraft";
import { formatDateTime } from "@/lib/format";
import type { Assistant, AssistantDraft, AssistantStatus } from "@/lib/api/types";

export function GeneralTab({
  assistant,
  onSave,
  onDelete,
  onDuplicate,
}: {
  assistant: Assistant;
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>;
  onDelete: () => Promise<void>;
  onDuplicate: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const form = useAssistantDraft(assistant, onSave);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Identity"
          description="How this assistant is named and described inside the workspace."
        />
        <CardBody className="space-y-3.5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="general-name">
              <Input
                id="general-name"
                value={form.draft.name}
                onChange={(event) => form.set("name", event.target.value)}
              />
            </Field>
            <Field label="Status" hint="Draft assistants are hidden from the widget runtime.">
              <SegmentedControl
                value={form.draft.status}
                onChange={(value) => form.set("status", value as AssistantStatus)}
                options={[
                  { value: "active", label: "Active" },
                  { value: "draft", label: "Draft" },
                  { value: "paused", label: "Paused" },
                ]}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="general-description" optional>
            <Textarea
              id="general-description"
              rows={2}
              value={form.draft.description}
              onChange={(event) => form.set("description", event.target.value)}
              placeholder="What this assistant is for, and who should use it."
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Identifiers"
          description="Stable references used by the API and the embeddable widget."
          icon={<KeyRound className="size-3.5" aria-hidden />}
        />
        <CardBody>
          <dl>
            <DetailRow label="Assistant ID">
              <span className="flex items-center gap-2">
                <code className="font-mono text-2xs text-ink-soft">{assistant.id}</code>
                <CopyButton value={assistant.id} label="Copy assistant id" />
              </span>
            </DetailRow>
            <DetailRow
              label="Public widget key"
              hint="Not a secret: it identifies the assistant and is visible in the host page's source. Production deployments should restrict it to an origin allowlist."
            >
              <span className="flex items-center gap-2">
                <code className="font-mono text-2xs text-ink-soft">{assistant.publicKey}</code>
                <CopyButton value={assistant.publicKey} label="Copy public key" />
              </span>
            </DetailRow>
            <DetailRow label="Created">
              <span className="text-2xs">{formatDateTime(assistant.createdAt)}</span>
            </DetailRow>
            <DetailRow label="Last updated">
              <span className="text-2xs">{formatDateTime(assistant.updatedAt)}</span>
            </DetailRow>
            <DetailRow label="Conversations">
              <span className="text-2xs">
                {assistant.stats.conversations} conversations · {assistant.stats.messages} messages
              </span>
            </DetailRow>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lifecycle"
          description="Duplicate to iterate safely, or delete when the assistant is retired."
          icon={<ShieldAlert className="size-3.5" aria-hidden />}
        />
        <CardBody className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            iconLeft={<Copy className="size-3.5" aria-hidden />}
            onClick={() => void onDuplicate()}
          >
            Duplicate assistant
          </Button>
          <Button
            variant="danger"
            iconLeft={<Trash2 className="size-3.5" aria-hidden />}
            onClick={() => setConfirmDelete(true)}
          >
            Delete assistant
          </Button>
          <Badge tone="neutral" className="ms-auto">
            {assistant.knowledgeBaseIds.length} knowledge bases attached
          </Badge>
        </CardBody>
      </Card>

      <DraftBar
        dirty={form.dirty}
        saving={form.saving}
        error={form.error}
        onSave={() => void form.save()}
        onReset={form.reset}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        loading={deleting}
        title={`Delete “${assistant.name}”?`}
        description="This removes the assistant and its conversation history. Knowledge bases are untouched."
        confirmLabel="Delete assistant"
        onConfirm={async () => {
          setDeleting(true);
          try {
            await onDelete();
            navigate("/assistants");
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
