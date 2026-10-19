import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary.
 *
 * A render failure anywhere in the tree should present a recoverable screen
 * rather than a blank page, and it should say what actually broke.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[parsis] render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-base p-6">
        <div className="w-full max-w-lg rounded-panel border border-danger/25 bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-danger/30 bg-danger/10">
              <AlertTriangle className="size-4 text-danger" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-ink">The interface hit an error</h1>
              <p className="mt-1 text-2xs leading-relaxed text-ink-mute">
                Nothing you created was lost — data lives in the local data layer. Reload to continue;
                the message below is the raw error.
              </p>
              <pre className="mt-3 max-h-40 overflow-auto rounded-card border border-hairline bg-black/40 p-3 font-mono text-2xs text-ink-mute">
                {error.message}
              </pre>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-accent px-3.5 py-2 text-2xs font-semibold text-accent-contrast"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Reload the interface
                </button>
                <button
                  type="button"
                  onClick={() => this.setState({ error: null })}
                  className="rounded-[10px] border border-hairline-strong px-3.5 py-2 text-2xs text-ink-soft transition-colors hover:text-ink"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
