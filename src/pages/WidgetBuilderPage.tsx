import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Blocks,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Palette,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeBlock,
  Field,
  Input,
  SegmentedControl,
  Sheet,
  Slider,
  Switch,
  TabBar,
  TabPanel,
  Textarea,
} from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChatWidget } from "@/features/widget/ChatWidget";
import { useWorkspaceData } from "@/store/workspaceData";
import { cn } from "@/lib/cn";
import type { AssistantDraft, LauncherIcon, WidgetConfig, WidgetPosition, WidgetTheme } from "@/lib/api/types";

type Device = "desktop" | "mobile";
type SnippetTab = "html" | "javascript" | "react";

const POSITIONS: { value: WidgetPosition; label: string }[] = [
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
];

export default function WidgetBuilderPage() {
  const { assistantId } = useParams<{ assistantId: string }>();
  const navigate = useNavigate();
  const { assistants, updateAssistant, runQuery, loading } = useWorkspaceData();

  const assistant = useMemo(
    () => assistants.find((entry) => entry.id === assistantId) ?? assistants[0],
    [assistants, assistantId],
  );

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [snippetTab, setSnippetTab] = useState<SnippetTab>("html");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (assistant) setConfig(structuredClone(assistant.widget));
  }, [assistant?.id, assistant?.updatedAt, assistant]);

  // Live preview comes straight from local state; persistence is debounced so a
  // slider drag does not fire a request per pixel.
  const patch = useCallback(
    (partial: Partial<WidgetConfig>) => {
      setConfig((current) => (current ? { ...current, ...partial } : current));
    },
    [],
  );

  useEffect(() => {
    if (!assistant || !config) return;
    if (JSON.stringify(config) === JSON.stringify(assistant.widget)) return;
    setSaveState("saving");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void updateAssistant(assistant.id, { widget: config } as Partial<AssistantDraft>)
        .then(() => {
          setSaveState("saved");
          window.setTimeout(() => setSaveState("idle"), 1400);
        })
        .catch((caught) => {
          setSaveState("error");
          setError((caught as Error).message);
        });
    }, 650);
    return () => window.clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const publicKey = assistant?.publicKey ?? "";
  const widgetUrl = `${origin}/widget/${publicKey}`;

  const snippets = useMemo(() => {
    if (!config || !assistant) return { html: "", javascript: "", react: "" };
    const esc = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const attributes = [
      `data-assistant="${esc(publicKey)}"`,
      `data-position="${config.position}"`,
      `data-theme="${config.theme}"`,
      `data-label="${esc(config.launcherLabel)}"`,
      config.primaryColor ? `data-color="${esc(config.primaryColor)}"` : null,
    ]
      .filter(Boolean)
      .join("\n  ");

    return {
      html: `<!-- Parsis Bridge widget · ${assistant.name} -->\n<script\n  async\n  src="${origin}/embed.js"\n  ${attributes}\n></script>`,
      javascript: `// Mount the widget programmatically (single-page apps, consent gates).\nconst script = document.createElement("script");\nscript.async = true;\nscript.src = "${origin}/embed.js";\nscript.dataset.assistant = "${publicKey}";\nscript.dataset.position = "${config.position}";\nscript.dataset.theme = "${config.theme}";\nscript.dataset.label = ${JSON.stringify(config.launcherLabel)};\n${config.primaryColor ? `script.dataset.color = "${config.primaryColor}";\n` : ""}document.body.appendChild(script);\n\n// Optional: open the panel once the runtime is ready.\nwindow.addEventListener("parsis:widget:ready", () => window.parsis?.open());`,
      react: `// Drop-in React component that loads the same runtime.\nimport { useEffect } from "react";\n\nexport function ParsisWidget() {\n  useEffect(() => {\n    const script = document.createElement("script");\n    script.async = true;\n    script.src = "${origin}/embed.js";\n    script.dataset.assistant = "${publicKey}";\n    script.dataset.position = "${config.position}";\n    script.dataset.theme = "${config.theme}";\n    document.body.appendChild(script);\n    return () => {\n      script.remove();\n      document.querySelectorAll("[data-parsis-root]").forEach((node) => node.remove());\n    };\n  }, []);\n\n  return null;\n}`,
    };
  }, [assistant, config, origin, publicKey]);

  if (!assistant || !config) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-96 rounded-card" />
        {!loading ? (
          <p className="text-2xs text-ink-mute">
            No assistant available.{" "}
            <Link to="/assistants?new=1" className="text-accent">
              Create one first →
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Widget builder"
        description="Design the chat widget, watch it update live, then copy a snippet that belongs to this assistant alone."
        crumbs={[{ label: "Widget builder", to: "/widget-builder" }, { label: assistant.name }]}
        meta={
          <>
            <Badge tone={config.enabled ? "success" : "warn"}>
              {config.enabled ? "Widget enabled" : "Widget disabled"}
            </Badge>
            <span className="flex items-center gap-1.5 text-2xs text-ink-faint">
              {saveState === "saving" ? (
                <>
                  <Loader2 className="size-3 animate-spin" aria-hidden /> Saving…
                </>
              ) : saveState === "saved" ? (
                <>
                  <Check className="size-3 text-success" aria-hidden /> Saved
                </>
              ) : saveState === "error" ? (
                <span className="text-danger">Save failed — {error}</span>
              ) : (
                "Changes save automatically"
              )}
            </span>
          </>
        }
        actions={
          <>
            <select
              value={assistant.id}
              onChange={(event) => navigate(`/widget-builder/${event.target.value}`)}
              className="control h-9.5 min-w-[200px] cursor-pointer"
              aria-label="Assistant"
            >
              {assistants.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              iconLeft={<Eye className="size-3.5" aria-hidden />}
              onClick={() => setPreviewOpen(true)}
            >
              Full preview
            </Button>
            <Button
              variant="secondary"
              iconLeft={<ExternalLink className="size-3.5" aria-hidden />}
              onClick={() => window.open(widgetUrl, "_blank", "noopener")}
            >
              Open runtime
            </Button>
          </>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]">
        <div className="space-y-3">
          <Card>
            <CardHeader
              title="Placement"
              description="Where the launcher sits and how it clears fixed navigation on the host page."
              icon={<Blocks className="size-3.5" aria-hidden />}
            />
            <CardBody className="space-y-4">
              <Switch
                checked={config.enabled}
                onChange={(value) => patch({ enabled: value })}
                label="Widget is live"
                description="Disabling it makes the public runtime refuse new sessions for this assistant."
              />
              <Field label="Position">
                <div className="grid w-full max-w-[240px] grid-cols-2 gap-2">
                  {POSITIONS.map((position) => {
                    const active = position.value === config.position;
                    return (
                      <button
                        key={position.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => patch({ position: position.value })}
                        className={cn(
                          "relative h-16 rounded-[10px] border transition-colors",
                          active
                            ? "border-accent/50 bg-accent/[0.07]"
                            : "border-hairline bg-black/25 hover:border-hairline-strong",
                        )}
                      >
                        <span aria-hidden className="absolute inset-1 rounded-[8px] border border-dashed border-hairline" />
                        <span
                          aria-hidden
                          className={cn(
                            "absolute size-3.5 rounded-[4px]",
                            position.value.startsWith("top") ? "top-2" : "bottom-2",
                            position.value.endsWith("right") ? "right-2" : "left-2",
                            active ? "bg-accent" : "bg-surface-4",
                          )}
                        />
                        <span className="absolute inset-x-0 bottom-1 text-[9px] text-ink-faint">
                          {position.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Slider
                  label="Horizontal offset"
                  min={0}
                  max={80}
                  step={2}
                  value={config.offsetX}
                  format={(value) => `${value}px`}
                  onChange={(value) => patch({ offsetX: value })}
                />
                <Slider
                  label="Vertical offset"
                  min={0}
                  max={80}
                  step={2}
                  value={config.offsetY}
                  format={(value) => `${value}px`}
                  onChange={(value) => patch({ offsetY: value })}
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Identity and theme"
              description="The widget carries its own palette so a host page's styles can never leak in."
              icon={<Palette className="size-3.5" aria-hidden />}
            />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Assistant name in the header" htmlFor="builder-name">
                  <Input
                    id="builder-name"
                    value={config.assistantDisplayName}
                    onChange={(event) => patch({ assistantDisplayName: event.target.value })}
                  />
                </Field>
                <Field label="Avatar style">
                  <SegmentedControl
                    value={config.avatarStyle}
                    onChange={(value) =>
                      patch({ avatarStyle: value as WidgetConfig["avatarStyle"] })
                    }
                    options={[
                      { value: "gradient", label: "Gradient" },
                      { value: "initials", label: "Initials" },
                      { value: "image", label: "Image" },
                    ]}
                  />
                </Field>
              </div>
              {config.avatarStyle === "image" ? (
                <Field label="Avatar URL" htmlFor="builder-avatar">
                  <Input
                    id="builder-avatar"
                    value={config.avatarUrl}
                    onChange={(event) => patch({ avatarUrl: event.target.value })}
                    placeholder="https://cdn.example.com/avatar.png"
                  />
                </Field>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Surface theme">
                  <SegmentedControl
                    value={config.theme}
                    onChange={(value) => patch({ theme: value as WidgetTheme })}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                      { value: "auto", label: "Auto" },
                    ]}
                  />
                </Field>
                <Field label="Launcher icon">
                  <SegmentedControl
                    value={config.launcherIcon}
                    onChange={(value) => patch({ launcherIcon: value as LauncherIcon })}
                    options={[
                      { value: "spark", label: "Spark" },
                      { value: "flame", label: "Ember" },
                      { value: "orb", label: "Orb" },
                      { value: "chat", label: "Chat" },
                    ]}
                  />
                </Field>
              </div>

              <Field
                label="Primary colour"
                hint="Leave empty to inherit the workspace's active fire theme accent."
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-9 shrink-0 rounded-[10px] border border-hairline"
                    style={{ background: config.primaryColor || "var(--accent)" }}
                    aria-hidden
                  />
                  <Input
                    value={config.primaryColor}
                    onChange={(event) => patch({ primaryColor: event.target.value })}
                    placeholder="inherit"
                    className="font-mono"
                  />
                  <input
                    type="color"
                    value={config.primaryColor || "#ff7a18"}
                    onChange={(event) => patch({ primaryColor: event.target.value })}
                    className="h-9 w-9 shrink-0 cursor-pointer rounded-[10px] border border-hairline bg-transparent"
                    aria-label="Pick primary colour"
                  />
                </div>
              </Field>

              <Field label="Corner radius">
                <Slider
                  min={8}
                  max={28}
                  step={1}
                  value={config.cornerRadius}
                  format={(value) => `${value}px`}
                  onChange={(value) => patch({ cornerRadius: value })}
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Conversation copy" description="What a visitor reads first, and how answers cite sources." />
            <CardBody className="space-y-3.5">
              <Field label="Launcher label" htmlFor="builder-launcher">
                <Input
                  id="builder-launcher"
                  value={config.launcherLabel}
                  onChange={(event) => patch({ launcherLabel: event.target.value })}
                />
              </Field>
              <Field label="Welcome message" htmlFor="builder-welcome">
                <Textarea
                  id="builder-welcome"
                  rows={2}
                  value={config.welcomeMessage}
                  onChange={(event) => patch({ welcomeMessage: event.target.value })}
                />
              </Field>
              <Field label="Input placeholder" htmlFor="builder-placeholder">
                <Input
                  id="builder-placeholder"
                  value={config.placeholder}
                  onChange={(event) => patch({ placeholder: event.target.value })}
                />
              </Field>
              <Switch
                checked={config.showSources}
                onChange={(value) => patch({ showSources: value })}
                label="Show cited sources"
                description="Lists the documents behind each answer with their relevance score."
              />
              <Switch
                checked={config.showBranding}
                onChange={(value) => patch({ showBranding: value })}
                label="Show branding footer"
              />
              {config.showBranding ? (
                <Field label="Branding text" htmlFor="builder-branding">
                  <Input
                    id="builder-branding"
                    value={config.brandingText}
                    onChange={(event) => patch({ brandingText: event.target.value })}
                  />
                </Field>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Embed code"
              description="The snippet is bound to this assistant's public key. Copy it into the host page once."
              icon={<Terminal className="size-3.5" aria-hidden />}
              actions={
                <Badge tone="neutral" icon={<ShieldCheck className="size-3" aria-hidden />}>
                  isolated iframe
                </Badge>
              }
            />
            <CardBody className="space-y-3">
              <TabBar
                tabs={[
                  { id: "html", label: "HTML" },
                  { id: "javascript", label: "JavaScript" },
                  { id: "react", label: "React" },
                ]}
                value={snippetTab}
                onChange={setSnippetTab}
                size="sm"
              />
              <TabPanel id="html" active={snippetTab === "html"}>
                <CodeBlock code={snippets.html} filename="index.html" actions={<CopyPill value={snippets.html} />} />
              </TabPanel>
              <TabPanel id="javascript" active={snippetTab === "javascript"}>
                <CodeBlock code={snippets.javascript} filename="widget.js" actions={<CopyPill value={snippets.javascript} />} />
              </TabPanel>
              <TabPanel id="react" active={snippetTab === "react"}>
                <CodeBlock code={snippets.react} filename="ParsisWidget.tsx" actions={<CopyPill value={snippets.react} />} />
              </TabPanel>

              <div className="grid gap-3 sm:grid-cols-3">
                <InfoTile label="Public key" value={publicKey} mono />
                <InfoTile label="Runtime URL" value={`/widget/${publicKey}`} mono />
                <InfoTile label="Knowledge in scope" value={`${assistant.knowledgeBaseIds.length} base(s)`} />
              </div>

              <ul className="space-y-1.5 text-[10px] leading-relaxed text-ink-faint">
                <li>
                  • The loader injects a single iframe, so host styles cannot break the widget and the
                  widget cannot leak styles into the page.
                </li>
                <li>
                  • The public key is not a secret. In production, restrict it to an allowlist of
                  origins and apply per-key rate limits so a copied snippet cannot spend your budget.
                </li>
                <li>
                  • The widget talks only to the platform API; it never receives a provider key.
                </li>
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="xl:sticky xl:top-20 xl:h-fit">
          <Card className="overflow-hidden">
            <CardHeader
              title="Live preview"
              description="Runs real retrieval against this assistant's index."
              actions={
                <SegmentedControl
                  size="sm"
                  value={device}
                  onChange={setDevice}
                  options={[
                    { value: "desktop", label: "Desktop" },
                    { value: "mobile", label: "Mobile" },
                  ]}
                />
              }
            />
            <CardBody className="px-2.5 pb-2.5 sm:px-3">
              <div
                className={cn(
                  "relative mx-auto overflow-hidden rounded-panel border border-hairline bg-gradient-to-b from-[#0b0b0f] to-[#08080b]",
                  device === "desktop" ? "h-[560px]" : "h-[600px] w-[330px]",
                )}
              >
                {/* Faux host page so the widget's placement reads in context. */}
                <div className="grid-noise absolute inset-0 opacity-40" aria-hidden />
                <div className="absolute inset-x-0 top-0 h-9 border-b border-hairline/70 bg-black/30 px-3">
                  <div className="flex h-full items-center gap-1.5">
                    <span className="size-2 rounded-full bg-surface-4" aria-hidden />
                    <span className="size-2 rounded-full bg-surface-4" aria-hidden />
                    <span className="size-2 rounded-full bg-surface-4" aria-hidden />
                    <span className="ms-2 truncate text-[9px] text-ink-faint">your-site.com</span>
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />

                <div className="absolute inset-x-4 bottom-4 top-14">
                  <p className="text-[10px] leading-relaxed text-ink-faint">
                    Host page content sits behind the widget layer. The launcher never blocks clicks
                    outside its own hit area.
                  </p>
                </div>

                <div className="absolute inset-0 p-4 pt-14">
                  <ChatWidget
                    config={config}
                    title={assistant.name}
                    variant="floating"
                    hints={[]}
                    style={{
                      position: "absolute",
                      bottom: config.offsetY,
                      [config.position.endsWith("right") ? "right" : "left"]: config.offsetX,
                      top: config.position.startsWith("top") ? config.offsetY : undefined,
                    }}
                    send={async (question) => {
                      const response = await runQuery({
                        assistantId: assistant.id,
                        question,
                        topKOverride: assistant.rag.topK,
                      });
                      return {
                        content: response.message.content,
                        sources: response.retrieved,
                        mode: response.message.meta?.mode,
                      };
                    }}
                  />
                </div>
              </div>
              <p className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-ink-faint">
                <Sparkles className="size-3 shrink-0" aria-hidden />
                Preview answers come from your live index — history is not saved to the widget's
                conversations until you deploy.
              </p>
            </CardBody>
          </Card>

          <Card className="mt-3">
            <CardHeader title="Deployment checklist" />
            <CardBody className="space-y-2">
              <ChecklistItem done={assistant.knowledgeBaseIds.length > 0} label="At least one knowledge base attached" />
              <ChecklistItem
                done={assistant.knowledgeBaseIds.length > 0 && assistant.rag.enabled}
                label="Retrieval enabled with a tuned threshold"
              />
              <ChecklistItem done={config.enabled} label="Widget enabled" />
              <ChecklistItem
                done={config.welcomeMessage.trim().length > 0}
                label="Welcome message written"
              />
              <ChecklistItem done label="Embed snippet copied into the host page" />
              <div className="pt-1">
                <Link
                  to={`/assistants/${assistant.id}`}
                  className="text-2xs font-medium text-accent hover:text-accent-strong"
                >
                  Back to assistant configuration →
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <Sheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        width="lg"
        title={`${assistant.name} — widget preview`}
        description="Same component the embed runtime loads, rendered at full size."
      >
        <div className="relative h-[640px] overflow-hidden rounded-panel border border-hairline bg-base">
          <ChatWidget
            config={{ ...config, position: "bottom-right" }}
            title={assistant.name}
            variant="floating"
            initialOpen
            send={async (question) => {
              const response = await runQuery({ assistantId: assistant.id, question });
              return {
                content: response.message.content,
                sources: response.retrieved,
                mode: response.message.meta?.mode,
              };
            }}
          />
        </div>
      </Sheet>
    </>
  );
}

function CopyPill({ value }: { value: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      iconLeft={<Copy className="size-3" aria-hidden />}
      onClick={() => void navigator.clipboard.writeText(value).catch(() => undefined)}
    >
      Copy
    </Button>
  );
}

function InfoTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[10px] border border-hairline bg-black/20 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <p className={cn("mt-0.5 truncate text-2xs text-ink-soft", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          done ? "border-success/40 bg-success/15 text-success" : "border-hairline-strong text-ink-faint",
        )}
        aria-hidden
      >
        {done ? <Check className="size-2.5" /> : null}
      </span>
      <span className={cn("text-2xs", done ? "text-ink-soft" : "text-ink-faint")}>{label}</span>
    </div>
  );
}
