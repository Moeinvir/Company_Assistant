import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bot, CornerDownLeft, Library, Search } from "lucide-react";
import { Kbd } from "@/components/ui";
import { NAV_ITEMS } from "./nav";
import { useWorkspaceData } from "@/store/workspaceData";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/store/language";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { translate } = useLanguage();
  const { assistants, knowledgeBases } = useWorkspaceData();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    return [
      ...NAV_ITEMS.map((item) => ({
        id: `nav-${item.to}`,
        label: translate(item.label),
        hint: translate(item.description),
        group: translate("Navigate"),
        icon: <item.icon className="size-3.5" aria-hidden />,
        run: go(item.to),
      })),
      ...assistants.map((assistant) => ({
        id: `assistant-${assistant.id}`,
        label: assistant.name,
        hint: `${assistant.model.provider} · ${assistant.model.model}`,
        group: translate("Assistants"),
        icon: <Bot className="size-3.5" aria-hidden />,
        run: go(`/assistants/${assistant.id}`),
      })),
      ...knowledgeBases.map((knowledgeBase) => ({
        id: `kb-${knowledgeBase.id}`,
        label: knowledgeBase.name,
        hint: `${knowledgeBase.documentCount} documents · ${knowledgeBase.chunkCount} passages`,
        group: translate("Knowledge"),
        icon: <Library className="size-3.5" aria-hidden />,
        run: go(`/knowledge/${knowledgeBase.id}`),
      })),
      {
        id: "action-new-assistant",
        label: translate("Create a new assistant"),
        hint: translate("Opens the assistants page"),
        group: translate("Actions"),
        icon: <ArrowRight className="size-3.5" aria-hidden />,
        run: go("/assistants?new=1"),
      },
      {
        id: "action-playground",
        label: translate("Run a retrieval test"),
        hint: translate("Open the playground"),
        group: translate("Actions"),
        icon: <ArrowRight className="size-3.5" aria-hidden />,
        run: go("/playground"),
      },
    ];
  }, [assistants, knowledgeBases, navigate, onClose, translate]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands.slice(0, 9);
    return commands
      .map((command) => {
        const haystack = `${command.label} ${command.hint ?? ""} ${command.group}`.toLowerCase();
        const direct = haystack.indexOf(term);
        return { command, score: direct === -1 ? -1 : direct === 0 ? 0 : 1 + direct / 100 };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (results.length ? (current + 1) % results.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
      } else if (event.key === "Enter") {
        const target = results[activeIndex];
        if (target) {
          event.preventDefault();
          target.run();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, activeIndex, onClose]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px] animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={translate("Command palette")}
        className="surface-panel animate-rise relative z-10 flex max-h-[64vh] w-full max-w-xl flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("Jump to a page, assistant or knowledge base…")}
            className="flex-1 bg-transparent text-micro text-ink outline-none placeholder:text-ink-faint"
            aria-label={translate("Search commands")}
            autoComplete="off"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-2 py-6 text-center text-2xs text-ink-faint">
              No matches for “{query}”.
            </p>
          ) : (
            results.map((command, index) => {
              const showGroup = command.group !== lastGroup;
              lastGroup = command.group;
              return (
                <div key={command.id}>
                  {showGroup ? (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                      {command.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    data-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={command.run}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-start transition-colors",
                      index === activeIndex ? "bg-surface-3" : "hover:bg-white/[0.03]",
                    )}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-mute">
                      {command.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-micro text-ink">{command.label}</span>
                      {command.hint ? (
                        <span className="block truncate text-[10px] text-ink-faint">{command.hint}</span>
                      ) : null}
                    </span>
                    {index === activeIndex ? (
                      <CornerDownLeft className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}
