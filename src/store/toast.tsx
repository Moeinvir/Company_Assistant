import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. 0 keeps the toast until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastInput {
  id: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONE_CLASS = {
  success: "text-success",
  error: "text-danger",
  warning: "text-warn",
  info: "text-info",
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = `toast_${Math.random().toString(36).slice(2, 9)}`;
      const record: ToastRecord = { ...input, id, tone: input.tone ?? "info" };
      setToasts((current) => [...current.slice(-3), record]);
      const duration = input.duration ?? 5200;
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ title, description, tone: "success" }),
      error: (title, description) => push({ title, description, tone: "error", duration: 8000 }),
      info: (title, description) => push({ title, description, tone: "info" }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              aria-live="polite"
              className="surface-panel animate-fade-up pointer-events-auto flex gap-3 px-3.5 py-3"
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[toast.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-micro font-medium text-ink">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-2xs leading-relaxed text-ink-mute">{toast.description}</p>
                ) : null}
                {toast.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                    className="mt-2 text-2xs font-medium text-accent hover:text-accent-strong"
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-me-1 -mt-1 size-6 shrink-0 rounded-md text-ink-faint transition hover:bg-surface-3 hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="mx-auto size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
