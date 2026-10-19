import { Link } from "react-router-dom";
import { Blocks, Palette, Sparkles, UserRound } from "lucide-react";
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  SegmentedControl,
  Slider,
  Switch,
  Textarea,
} from "@/components/ui";
import { DraftBar, useAssistantDraft } from "./useAssistantDraft";
import type { Assistant, AssistantDraft, LauncherIcon, WidgetPosition, WidgetTheme } from "@/lib/api/types";
import { useFireTheme } from "@/fire/FireThemeProvider";
import { cn } from "@/lib/cn";

const POSITIONS: { value: WidgetPosition; label: string }[] = [
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
];

function PositionPicker({
  value,
  onChange,
}: {
  value: WidgetPosition;
  onChange: (next: WidgetPosition) => void;
}) {
  return (
    <div className="grid w-full max-w-[220px] grid-cols-2 gap-2">
      {POSITIONS.map((position) => {
        const active = position.value === value;
        return (
          <button
            key={position.value}
            type="button"
            aria-label={position.label}
            aria-pressed={active}
            onClick={() => onChange(position.value)}
            className={cn(
              "group relative h-16 rounded-[10px] border transition-colors",
              active ? "border-accent/50 bg-accent/[0.07]" : "border-hairline bg-black/25 hover:border-hairline-strong",
            )}
          >
            <span
              className={cn(
                "absolute size-3.5 rounded-[4px]",
                position.value.startsWith("top") ? "top-2" : "bottom-2",
                position.value.endsWith("right") ? "end-2" : "start-2",
                active ? "bg-accent" : "bg-surface-4",
              )}
              aria-hidden
            />
            <span className="absolute inset-1 rounded-[8px] border border-dashed border-hairline" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function AppearanceTab({
  assistant,
  onSave,
}: {
  assistant: Assistant;
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>;
}) {
  const form = useAssistantDraft(assistant, onSave);
  const { theme } = useFireTheme();
  const widget = form.draft.widget;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Identity in the widget"
          description="What visitors see in the chat header and launcher."
          icon={<UserRound className="size-3.5" aria-hidden />}
        />
        <CardBody className="space-y-3.5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" htmlFor="appearance-name">
              <Input
                id="appearance-name"
                value={widget.assistantDisplayName}
                onChange={(event) => form.merge("widget", { assistantDisplayName: event.target.value })}
              />
            </Field>
            <Field label="Avatar style">
              <SegmentedControl
                value={widget.avatarStyle}
                onChange={(value) =>
                  form.merge("widget", { avatarStyle: value as AssistantDraft["widget"]["avatarStyle"] })
                }
                options={[
                  { value: "gradient", label: "Gradient" },
                  { value: "initials", label: "Initials" },
                  { value: "image", label: "Image" },
                ]}
              />
            </Field>
          </div>

          {widget.avatarStyle === "image" ? (
            <Field
              label="Avatar URL"
              htmlFor="appearance-avatar"
              hint="Served from your own CDN. The widget does not proxy or store images."
            >
              <Input
                id="appearance-avatar"
                value={widget.avatarUrl}
                onChange={(event) => form.merge("widget", { avatarUrl: event.target.value })}
                placeholder="https://cdn.example.com/agent-avatar.png"
              />
            </Field>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Theme and colour"
          description="The widget inherits the active fire theme unless you pin a brand colour."
          icon={<Palette className="size-3.5" aria-hidden />}
        />
        <CardBody className="space-y-4">
          <Field label="Surface theme">
            <SegmentedControl
              value={widget.theme}
              onChange={(value) => form.merge("widget", { theme: value as WidgetTheme })}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "auto", label: "Auto" },
              ]}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Primary colour"
              hint={`Leave empty to inherit the fire theme accent (currently ${theme.name}).`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="size-9 shrink-0 rounded-[10px] border border-hairline"
                  style={{
                    background: widget.primaryColor || "var(--accent)",
                  }}
                  aria-hidden
                />
                <Input
                  value={widget.primaryColor}
                  onChange={(event) => form.merge("widget", { primaryColor: event.target.value })}
                  placeholder="inherit"
                  className="font-mono"
                  aria-label="Primary colour hex value"
                />
                <input
                  type="color"
                  value={widget.primaryColor || "#ff7a18"}
                  onChange={(event) => form.merge("widget", { primaryColor: event.target.value })}
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
                value={widget.cornerRadius}
                format={(value) => `${value}px`}
                onChange={(value) => form.merge("widget", { cornerRadius: value })}
              />
            </Field>
          </div>

          <div className="rounded-card border border-hairline bg-black/20 p-3.5">
            <p className="mb-2.5 text-[10px] uppercase tracking-[0.12em] text-ink-faint">Header preview</p>
            <div
              className="flex items-center gap-2.5 rounded-xl border border-hairline p-2.5"
              style={{ background: widget.theme === "light" ? "#f7f7f9" : "#17171e" }}
            >
              <Avatar
                name={widget.assistantDisplayName || form.draft.name}
                size="sm"
                variant={widget.avatarStyle === "image" ? "image" : widget.avatarStyle}
                src={widget.avatarUrl}
                className={widget.avatarStyle === "gradient" ? "" : undefined}
              />
              <div className="min-w-0">
                <p
                  className="truncate text-2xs font-semibold"
                  style={{ color: widget.theme === "light" ? "#16161c" : "#f3f3f5" }}
                >
                  {widget.assistantDisplayName || form.draft.name}
                </p>
                <p className="text-[10px]" style={{ color: widget.theme === "light" ? "#5f5f6c" : "#9b9ba6" }}>
                  Answers from indexed knowledge
                </p>
              </div>
              <span
                className="ms-auto size-4 shrink-0 rounded-md"
                style={{ background: widget.primaryColor || "var(--accent)" }}
                aria-hidden
              />
            </div>
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

export function WidgetTab({
  assistant,
  onSave,
}: {
  assistant: Assistant;
  onSave: (patch: Partial<AssistantDraft>) => Promise<unknown>;
}) {
  const form = useAssistantDraft(assistant, onSave);
  const widget = form.draft.widget;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Launcher"
          description="How the widget announces itself on the host page."
          icon={<Blocks className="size-3.5" aria-hidden />}
          actions={
            <Badge tone={widget.enabled ? "success" : "warn"}>
              {widget.enabled ? "Enabled" : "Disabled"}
            </Badge>
          }
        />
        <CardBody className="space-y-3.5">
          <Switch
            checked={widget.enabled}
            onChange={(value) => form.merge("widget", { enabled: value })}
            label="Widget is live"
            description="When disabled, the public runtime refuses new sessions for this assistant."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Launcher label" htmlFor="widget-label">
              <Input
                id="widget-label"
                value={widget.launcherLabel}
                onChange={(event) => form.merge("widget", { launcherLabel: event.target.value })}
              />
            </Field>
            <Field label="Launcher icon">
              <SegmentedControl
                value={widget.launcherIcon}
                onChange={(value) => form.merge("widget", { launcherIcon: value as LauncherIcon })}
                options={[
                  { value: "spark", label: "Spark" },
                  { value: "flame", label: "Ember" },
                  { value: "orb", label: "Orb" },
                  { value: "chat", label: "Chat" },
                ]}
              />
            </Field>
          </div>

          <Field label="Position">
            <PositionPicker
              value={widget.position}
              onChange={(value) => form.merge("widget", { position: value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Horizontal offset" hint="Pixels from the viewport edge.">
              <Slider
                min={0}
                max={80}
                step={2}
                value={widget.offsetX}
                format={(value) => `${value}px`}
                onChange={(value) => form.merge("widget", { offsetX: value })}
              />
            </Field>
            <Field label="Vertical offset" hint="Increase when the host page has a fixed footer.">
              <Slider
                min={0}
                max={80}
                step={2}
                value={widget.offsetY}
                format={(value) => `${value}px`}
                onChange={(value) => form.merge("widget", { offsetY: value })}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Conversation copy" description="The first thing a visitor reads." />
        <CardBody className="space-y-3.5">
          <Field label="Welcome message">
            <Textarea
              rows={2}
              value={widget.welcomeMessage}
              onChange={(event) => form.merge("widget", { welcomeMessage: event.target.value })}
            />
          </Field>
          <Field label="Input placeholder" htmlFor="widget-placeholder">
            <Input
              id="widget-placeholder"
              value={widget.placeholder}
              onChange={(event) => form.merge("widget", { placeholder: event.target.value })}
            />
          </Field>
          <Switch
            checked={widget.showSources}
            onChange={(value) => form.merge("widget", { showSources: value })}
            label="Show cited sources"
            description="Lists the documents behind each answer with their relevance score."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Branding" description="Footer attribution shown inside the chat panel." />
        <CardBody className="space-y-3.5">
          <Switch
            checked={widget.showBranding}
            onChange={(value) => form.merge("widget", { showBranding: value })}
            label="Show branding footer"
          />
          <Field label="Branding text" htmlFor="widget-branding">
            <Input
              id="widget-branding"
              value={widget.brandingText}
              onChange={(event) => form.merge("widget", { brandingText: event.target.value })}
              disabled={!widget.showBranding}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Deployment" description="Public key and the snippet that renders this widget." />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-hairline bg-black/30 px-2 py-1 font-mono text-2xs text-ink-soft">
              {assistant.publicKey}
            </code>
            <Link
              to={`/widget-builder/${assistant.id}`}
              className="inline-flex items-center gap-1.5 text-2xs font-medium text-accent hover:text-accent-strong"
            >
              <Sparkles className="size-3.5" aria-hidden />
              Open the widget builder
            </Link>
          </div>
          <p className="text-2xs leading-relaxed text-ink-mute">
            The snippet belongs to this assistant only. It loads an isolated iframe, so host page
            styles can never break the widget and the widget never leaks styles back.
          </p>
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
