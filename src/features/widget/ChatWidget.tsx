import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { AlertTriangle, ArrowUp, Bot, Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import type { RetrievedChunk, WidgetConfig } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/hooks";

export interface WidgetTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: RetrievedChunk[];
  mode?: "model" | "extractive";
  error?: string;
}

export interface WidgetSendResult {
  content: string;
  sources?: RetrievedChunk[];
  mode?: "model" | "extractive";
}

export interface ChatWidgetProps {
  config: WidgetConfig;
  /** Display name shown in the header. */
  title: string;
  /** Runs the question. The widget never talks to a provider directly. */
  send: (question: string, history: WidgetTurn[]) => Promise<WidgetSendResult>;
  hints?: string[];
  /** "floating" renders a launcher; "inline" is panel-only for previews. */
  variant?: "floating" | "inline";
  /** Start with the panel open (used by the standalone runtime page). */
  initialOpen?: boolean;
  /** Called when the visitor closes the panel (inline runtime asks the host page to close it). */
  onClose?: () => void;
  className?: string;
  style?: CSSProperties;
}

const PALETTE = {
  dark: {
    panel: "#121218",
    header: "#17171e",
    border: "rgba(255,255,255,0.09)",
    text: "#f3f3f5",
    muted: "#9b9ba6",
    bubbleUser: "#1e1e26",
    bubbleAssistant: "rgba(255,255,255,0.03)",
    input: "rgba(0,0,0,0.35)",
  },
  light: {
    panel: "#ffffff",
    header: "#f7f7f9",
    border: "rgba(15,15,20,0.10)",
    text: "#16161c",
    muted: "#5f5f6c",
    bubbleUser: "#f1f1f4",
    bubbleAssistant: "#ffffff",
    input: "#f4f4f6",
  },
} as const;

const LAUNCHER_ICON = {
  spark: Sparkles,
  flame: Bot,
  orb: Sparkles,
  chat: MessageSquare,
} as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The embeddable chat widget.
 *
 * One component serves both the builder preview and the standalone runtime that
 * the iframe loads, so what you preview is exactly what ships. It carries its
 * own palette rather than depending on application tokens, because it executes
 * inside a customer's page.
 */
export function ChatWidget({
  config,
  title,
  send,
  hints = [],
  variant = "floating",
  initialOpen,
  onClose,
  className,
  style,
}: ChatWidgetProps) {
  const [open, setOpen] = useState(initialOpen ?? variant === "inline");
  const [turns, setTurns] = useState<WidgetTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const prefersLight = useMediaQuery("(prefers-color-scheme: light)");
  const isLight = config.theme === "light" || (config.theme === "auto" && prefersLight);
  const palette = isLight ? PALETTE.light : PALETTE.dark;
  const accent = config.primaryColor || "var(--accent, #ff7a18)";
  const accentText = config.primaryColor ? "#ffffff" : "var(--accent-contrast, #140a05)";

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;

    const userTurn: WidgetTurn = { id: `u${Date.now()}`, role: "user", content: question };
    const history = [...turns, userTurn];
    setTurns(history);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const result = await send(question, history);
      setTurns((current) => [
        ...current,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          content: result.content,
          sources: result.sources,
          mode: result.mode,
        },
      ]);
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      setTurns((current) => [
        ...current,
        { id: `e${Date.now()}`, role: "assistant", content: "", error: message },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const radius = Math.max(8, Math.min(28, config.cornerRadius));
  const positionClass = {
    "bottom-right": "bottom-0 right-0",
    "bottom-left": "bottom-0 left-0",
    "top-right": "top-0 right-0",
    "top-left": "top-0 left-0",
  }[config.position];

  const LauncherIcon = LAUNCHER_ICON[config.launcherIcon] ?? Sparkles;

  const panel = (
    <div
      id={panelId}
      role="dialog"
      aria-label={`${config.assistantDisplayName || title} chat`}
      style={{
        width: variant === "floating" ? 352 : "100%",
        height: variant === "floating" ? 500 : "100%",
        maxWidth: "100%",
        maxHeight: "100%",
        background: palette.panel,
        border: `1px solid ${palette.border}`,
        borderRadius: radius,
        color: palette.text,
        boxShadow: "0 24px 60px -20px rgba(0,0,0,0.75)",
      }}
      className={cn(
        "flex flex-col overflow-hidden",
        variant === "floating" &&
          "absolute animate-fade-up",
        variant === "floating" && (config.position.startsWith("top") ? "top-0" : "bottom-14"),
        variant === "floating" && (config.position.endsWith("right") ? "right-0" : "left-0"),
      )}
    >
      <header
        className="flex items-center gap-2.5 px-3.5 py-3"
        style={{ background: palette.header, borderBottom: `1px solid ${palette.border}` }}
      >
        {config.avatarStyle === "image" && config.avatarUrl ? (
          <img src={config.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
        ) : (
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{
              background:
                config.avatarStyle === "initials"
                  ? palette.bubbleUser
                  : `linear-gradient(145deg, ${accent}, color-mix(in oklab, ${accent} 45%, #000))`,
              color: config.avatarStyle === "initials" ? palette.text : accentText,
            }}
            aria-hidden
          >
            {initials(config.assistantDisplayName || title)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">
            {config.assistantDisplayName || title}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px]" style={{ color: palette.muted }}>
            <span className="inline-block size-1.5 rounded-full bg-emerald-400" aria-hidden />
            Answers from indexed knowledge
          </p>
        </div>
        {variant === "floating" || onClose ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onClose?.();
            }}
            aria-label="Close chat"
            className="rounded-md p-1 transition-colors hover:bg-black/10"
            style={{ color: palette.muted }}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3" aria-live="polite">
        <div
          dir="auto"
          className="rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed"
          style={{ background: palette.bubbleAssistant, border: `1px solid ${palette.border}` }}
        >
          {config.welcomeMessage}
        </div>

        {turns.length === 0 && hints.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {hints.slice(0, 3).map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => setDraft(hint)}
                className="rounded-full px-2.5 py-1 text-[11px] transition-colors hover:opacity-80"
                style={{ border: `1px solid ${palette.border}`, color: palette.muted }}
              >
                {hint}
              </button>
            ))}
          </div>
        ) : null}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="flex justify-end">
              <div
                dir="auto"
                className="max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed"
                style={{ background: palette.bubbleUser }}
              >
                {turn.content}
              </div>
            </div>
          ) : turn.error ? (
            <div
              key={turn.id}
              className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12px] leading-relaxed"
              style={{ border: "1px solid rgba(255,98,89,0.35)", color: "#ff8a80" }}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {turn.error}
                <br />
                <span style={{ color: palette.muted }}>
                  This widget talks to the platform API. Check the assistant is enabled and the key
                  is allowed on this origin.
                </span>
              </span>
            </div>
          ) : (
            <div key={turn.id} className="space-y-2">
              <div
                dir="auto"
                className="whitespace-pre-wrap rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed"
                style={{ background: palette.bubbleAssistant, border: `1px solid ${palette.border}` }}
              >
                {turn.content}
                {turn.mode === "extractive" ? (
                  <p className="mt-2 text-[10px]" style={{ color: palette.muted }}>
                    Extracted directly from your knowledge base — no generation model connected.
                  </p>
                ) : null}
              </div>
              {config.showSources && turn.sources && turn.sources.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-[0.12em]" style={{ color: palette.muted }}>
                    Sources
                  </p>
                  <ul className="space-y-1">
                    {turn.sources.slice(0, 3).map((source, index) => (
                      <li
                        key={source.chunkId}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]"
                        style={{ border: `1px solid ${palette.border}` }}
                      >
                        <span
                          className="flex size-4 shrink-0 items-center justify-center rounded font-mono text-[9px]"
                          style={{ background: palette.bubbleUser }}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{source.documentName}</span>
                        <span className="shrink-0 font-mono text-[9px]" style={{ color: palette.muted }}>
                          {(source.score * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ),
        )}

        {busy ? (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[11.5px]"
            style={{ background: palette.bubbleAssistant, border: `1px solid ${palette.border}`, color: palette.muted }}
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Searching your knowledge base…
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="px-3.5 pb-2 text-[10px]" style={{ color: palette.muted }}>
          Errors are surfaced verbatim. Nothing is retried silently.
        </p>
      ) : null}

      <form
        onSubmit={submit}
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ borderTop: `1px solid ${palette.border}` }}
      >
        <input
          ref={inputRef}
          dir="auto"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={config.placeholder}
          aria-label="Message"
          className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-[12.5px] outline-none"
          style={{ background: palette.input, border: `1px solid ${palette.border}`, color: palette.text }}
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          aria-label="Send message"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg transition-opacity disabled:opacity-40"
          style={{ background: accent, color: accentText }}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />}
        </button>
      </form>

      {config.showBranding ? (
        <div
          className="flex items-center justify-center gap-1.5 py-1.5 text-[10px]"
          style={{ borderTop: `1px solid ${palette.border}`, color: palette.muted }}
        >
          <Sparkles className="size-2.5" aria-hidden />
          {config.brandingText}
        </div>
      ) : null}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className={cn("h-full w-full", className)} style={style}>
        {panel}
      </div>
    );
  }

  return (
    <div className={cn("relative", positionClass, className)} style={style}>
      {open ? panel : null}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? "Close chat" : config.launcherLabel}
        className="flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[12.5px] font-medium transition-transform duration-200 hover:-translate-y-0.5"
        style={{
          background: accent,
          color: accentText,
          boxShadow: `0 12px 34px -12px color-mix(in oklab, ${accent} 60%, transparent)`,
        }}
      >
        {open ? (
          <X className="size-4" aria-hidden />
        ) : (
          <LauncherIcon className="size-4" aria-hidden />
        )}
        <span className="hidden sm:inline">{open ? "Close" : config.launcherLabel}</span>
      </button>
    </div>
  );
}
