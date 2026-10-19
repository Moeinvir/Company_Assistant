import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeBlock,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  Modal,
  StatusDot,
  Table,
  TD,
  TH,
  TR,
  type Tone,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
  verifyProviderKey,
  type KeyCheckResult,
} from "@/lib/api/providers";
import { useWorkspaceData } from "@/store/workspaceData";
import { useSession } from "@/store/session";
import { formatRelative } from "@/lib/format";
import type { ProviderDefinition, ProviderId, ProviderKeyRecord } from "@/lib/api/types";

const STATUS_TONE: Record<string, Tone> = {
  unset: "neutral",
  configured: "info",
  verified: "success",
  invalid: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  unset: "Not connected",
  configured: "Stored, unverified",
  verified: "Verified",
  invalid: "Rejected",
};

export default function IntegrationsPage() {
  const { workspace, client } = useSession();
  const {
    providerKeys,
    saveProviderKey,
    removeProviderKey,
    markProviderVerified,
    assistants,
  } = useWorkspaceData();

  const [editing, setEditing] = useState<ProviderDefinition | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<KeyCheckResult | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ProviderKeyRecord | null>(null);

  const keyFor = (provider: ProviderId) => providerKeys.find((entry) => entry.provider === provider);

  const usageByProvider = useMemo(() => {
    const map = new Map<ProviderId, number>();
    for (const assistant of assistants) {
      map.set(assistant.model.provider, (map.get(assistant.model.provider) ?? 0) + 1);
    }
    return map;
  }, [assistants]);

  const openEditor = (provider: ProviderDefinition) => {
    const existing = keyFor(provider.id);
    setEditing(provider);
    setApiKey("");
    setBaseUrl(existing?.baseUrl ?? "");
    setError(null);
    setCheck(null);
  };

  const verify = async () => {
    if (!editing) return;
    const value = apiKey.trim() || undefined;
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      const result = await verifyProviderKey(editing.id, value, baseUrl.trim() || undefined);
      setCheck(result);
      // A check result can only be recorded against a key that is actually
      // stored. Testing a pasted-but-unsaved key is a pure connection probe —
      // asking the API to store its outcome would fail with “key not found”.
      if (value && keyFor(editing.id)) {
        await markProviderVerified(editing.id, { ok: result.ok, message: result.message });
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await saveProviderKey({
        provider: editing.id,
        // Local runtimes need no secret; send nothing rather than an empty one.
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      // Now that the row exists, the outcome of the check just run for this key
      // is recorded too — otherwise a verified key would read “Stored,
      // unverified” the moment it is saved.
      if (check) await markProviderVerified(editing.id, { ok: check.ok, message: check.message });
      setEditing(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const curlExample = `curl ${typeof window !== "undefined" ? window.location.origin : "https://your-host"}/api/playground/query \\
  -H "authorization: Bearer $PARSIS_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{
    "assistantId": "${assistants[0]?.id ?? "ast_…"}",
    "question": "How should I choose a chunk size?"
  }'`;

  return (
    <>
      <PageHeader
        title="API & Integrations"
        description="Connect model providers, choose embedding models and manage the public widget access for this workspace."
        meta={
          <>
            <Badge tone="neutral">{CHAT_PROVIDERS.length} chat providers</Badge>
            <Badge tone="neutral">{EMBEDDING_PROVIDERS.length} embedding providers</Badge>
            <Badge tone="accent">workspace-scoped keys</Badge>
          </>
        }
      />

      <div className="mb-3 flex items-start gap-2.5 rounded-card border border-info/25 bg-info/[0.06] px-3.5 py-3">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
        <p className="text-2xs leading-relaxed text-ink-soft">
          {client.mode === "http"
            ? "Keys are encrypted on the API server and never sent to this browser; only a masked tail is shown here. Every provider call — verification, model discovery and generation — runs server-side, so a vendor that refuses browser origins cannot break the workspace."
            : "Keys are held for this browser profile so the offline build can call providers directly, and only a masked tail is ever shown to the interface. A hosted deployment keeps them on the server and proxies every provider call — the interface is built for that boundary and never logs, displays or embeds a key in a URL."}
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {[
          { title: "Chat providers", description: "Generation models available to assistants.", providers: CHAT_PROVIDERS },
          {
            title: "Embedding providers",
            description: "Models that turn passages and queries into vectors.",
            providers: EMBEDDING_PROVIDERS,
          },
        ].map((group) => (
          <Card key={group.title} className="overflow-hidden">
            <CardHeader
              title={group.title}
              description={group.description}
              icon={<PlugZap className="size-3.5" aria-hidden />}
            />
            <CardBody className="space-y-2 px-0 pb-3 sm:px-0">
              {group.providers.map((provider) => {
                const record = keyFor(provider.id);
                const status = record?.status ?? (provider.requiresKey ? "unset" : "verified");
                const inUse = usageByProvider.get(provider.id) ?? 0;
                return (
                  <div
                    key={provider.id}
                    className="mx-4 flex flex-wrap items-start justify-between gap-3 rounded-card border border-hairline bg-black/20 px-3 py-2.5 sm:mx-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusDot tone={STATUS_TONE[status]} />
                        <p className="text-2xs font-medium text-ink">{provider.name}</p>
                        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                        {inUse > 0 ? <Badge tone="neutral">{inUse} assistant(s)</Badge> : null}
                        {provider.browserAccess === "restricted" ? (
                          <Badge tone="warn" icon={<AlertTriangle className="size-3" aria-hidden />}>
                            needs proxy
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-ink-mute">
                        {provider.models.length} models
                        {record?.maskedKey ? ` · key ${record.maskedKey}` : ""}
                        {record?.lastCheckedAt
                          ? ` · checked ${formatRelative(record.lastCheckedAt)}`
                          : ""}
                        {provider.note ? ` · ${provider.note}` : ""}
                      </p>
                      {record?.note && record.status === "invalid" ? (
                        <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-relaxed text-danger">
                          <XCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {record.note}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-ink-faint transition-colors hover:text-ink-soft"
                      >
                        Docs
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                      <Button size="sm" variant="secondary" onClick={() => openEditor(provider)}>
                        {record?.maskedKey ? "Replace" : provider.requiresKey ? "Connect" : "Configure"}
                      </Button>
                      {record ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPendingRemove(record)}
                          aria-label={`Remove ${provider.name} key`}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Provider capability matrix"
            description="What each vendor supports and whether the browser may call it directly."
            icon={<KeyRound className="size-3.5" aria-hidden />}
          />
          <CardBody className="px-0 pb-0 sm:px-0">
            <Table>
              <thead>
                <tr>
                  <TH>Provider</TH>
                  <TH>Role</TH>
                  <TH className="hidden sm:table-cell">Key</TH>
                  <TH className="hidden sm:table-cell">Browser access</TH>
                  <TH className="text-end">Models</TH>
                </tr>
              </thead>
              <tbody>
                {[...CHAT_PROVIDERS, ...EMBEDDING_PROVIDERS].map((provider, index) => (
                  <TR key={`${provider.id}-${index}`}>
                    <TD className="text-2xs text-ink">{provider.name}</TD>
                    <TD className="text-2xs">{provider.capability}</TD>
                    <TD className="hidden sm:table-cell text-2xs">
                      {provider.requiresKey ? "required" : "not required"}
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Badge
                        tone={
                          provider.browserAccess === "supported"
                            ? "success"
                            : provider.browserAccess === "local"
                              ? "info"
                              : "warn"
                        }
                      >
                        {provider.browserAccess}
                      </Badge>
                    </TD>
                    <TD className="text-end text-2xs tabular-nums">{provider.models.length}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Platform API"
            description="How a server integrates with this workspace."
            icon={<PlugZap className="size-3.5" aria-hidden />}
          />
          <CardBody className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-2xs font-medium text-ink-soft">Workspace</p>
              <p className="font-mono text-2xs text-ink-mute">{workspace?.id}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-2xs font-medium text-ink-soft">Query endpoint</p>
              <p className="font-mono text-2xs text-ink-mute">POST /api/playground/query</p>
            </div>
            <CodeBlock code={curlExample} filename="query.sh" maxHeight={220} />
            <p className="text-[10px] leading-relaxed text-ink-faint">
              Route names mirror the client interface in{" "}
              <code className="font-mono text-ink-mute">src/lib/api/httpClient.ts</code>: assistants,
              knowledge bases, documents, provider keys, playground, conversations and analytics all
              map one-to-one. Point{" "}
              <code className="font-mono text-ink-mute">VITE_PYRE_API_URL</code> at a service that
              implements them and the interface runs unchanged.
            </p>
            <Link to="/widget-builder" className="block text-2xs font-medium text-accent hover:text-accent-strong">
              Public widget access is configured per assistant →
            </Link>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Connect ${editing.name}` : "Connect provider"}
        description={
          editing?.requiresKey
            ? client.mode === "http"
              ? "Paste the key you generated with the vendor. It is encrypted and stored on the API server; the browser never keeps a copy, and the connection test runs server-side."
              : "Paste the key you generated with the vendor. Offline demo mode keeps it in this browser profile and calls the vendor directly."
            : "This provider runs locally and needs no key."
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              loading={busy}
              onClick={() => void verify()}
              iconLeft={<RefreshCw className="size-3.5" aria-hidden />}
            >
              Verify
            </Button>
            {editing?.requiresKey ? (
              <Button variant="primary" loading={busy} disabled={!apiKey.trim()} onClick={() => void save()}>
                Store key
              </Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={() => void save()}>
                Save
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3.5">
          {editing?.requiresKey ? (
            <Field label="API key" htmlFor="provider-key" hint={`Format: ${editing.keyPlaceholder}`}>
              <Input
                id="provider-key"
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  // A result belongs to the key it was measured against.
                  setCheck(null);
                }}
                placeholder={editing.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          ) : null}

          <Field
            label="Base URL"
            htmlFor="provider-base"
            optional
            hint={editing?.defaultBaseUrl ? `Default: ${editing.defaultBaseUrl}` : undefined}
          >
            <Input
              id="provider-base"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setCheck(null);
              }}
              placeholder={editing?.defaultBaseUrl ?? "https://…"}
            />
          </Field>

          {editing?.note ? (
            <p className="flex items-start gap-2 rounded-[10px] border border-warn/25 bg-warn/[0.06] px-3 py-2 text-2xs leading-relaxed text-ink-soft">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              {editing.note}
            </p>
          ) : null}

          {check ? (
            <div
              className={`rounded-[10px] border px-3 py-2.5 text-2xs leading-relaxed ${
                check.ok
                  ? "border-success/25 bg-success/[0.06] text-ink-soft"
                  : "border-danger/25 bg-danger/[0.07] text-ink-soft"
              }`}
            >
              <p className="flex items-center gap-2">
                {check.ok ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                ) : (
                  <XCircle className="size-3.5 shrink-0 text-danger" aria-hidden />
                )}
                <span className="font-medium">{check.ok ? "Connection verified" : "Verification failed"}</span>
                <span className="ms-auto font-mono text-[10px] text-ink-faint">{check.latencyMs} ms</span>
              </p>
              <p className="mt-1">{check.message}</p>
              <p className="mt-1.5 text-[10px] text-ink-faint">
                {client.mode === "http"
                  ? "This is a real request to the provider's own API, made from the API server with the key above — a browser CORS restriction cannot affect it."
                  : "This is a real request to the provider's own API from this browser. Results are reported verbatim — a CORS failure means the provider refuses browser origins and must be proxied."}
              </p>
            </div>
          ) : null}

          {error ? <ErrorState message={error} /> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onClose={() => setPendingRemove(null)}
        title={`Remove the ${pendingRemove?.provider} key?`}
        description="Assistants configured for this provider will fall back to extractive answers until a key is stored again."
        confirmLabel="Remove key"
        onConfirm={async () => {
          if (!pendingRemove) return;
          await removeProviderKey(pendingRemove.provider);
          setPendingRemove(null);
        }}
      />
    </>
  );
}
