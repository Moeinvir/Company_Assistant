/**
 * Provider proxy transport.
 *
 * When the app runs against the platform API, every call to an AI vendor goes
 * `browser → API → provider`. Two problems disappear that way:
 *
 *  • CORS. Providers and self-hosted gateways (LiteLLM, vLLM, Voyage, Groq) are
 *    free to refuse browser origins; a server-side call is not a browser call.
 *  • Secrets. The key is stored encrypted against the workspace and is resolved
 *    on the server, so the client never needs to hold it — and never pretends
 *    it is missing because it cannot see it.
 *
 * The offline (demo) backend keeps calling providers straight from the browser,
 * which is honest for a single-operator workspace: the key belongs to whoever is
 * sitting at the machine. `getApiClient()` decides which mode is active.
 */

export class ProxyError extends Error {
  readonly status?: number;
  readonly upstreamStatus?: number;
  readonly hint?: string;

  constructor(message: string, options: { status?: number; upstreamStatus?: number; hint?: string } = {}) {
    super(message);
    this.name = "ProxyError";
    this.status = options.status;
    this.upstreamStatus = options.upstreamStatus;
    this.hint = options.hint;
  }
}

export const providerProxyPaths = {
  chat: (provider: string) => `/provider-keys/${provider}/chat`,
  models: (provider: string) => `/provider-keys/${provider}/models`,
  check: (provider: string) => `/provider-keys/${provider}/check`,
};

interface ProxyState {
  baseUrl: string | null;
  token: string | null;
  workspaceId: string | null;
}

const state: ProxyState = { baseUrl: null, token: null, workspaceId: null };

/** Called by `getApiClient()`: which API, if any, should proxy provider calls. */
export function setProviderProxyBase(baseUrl: string | null) {
  state.baseUrl = baseUrl?.replace(/\/+$/, "") ?? null;
}

/** Called by the session provider whenever the token or workspace changes. */
export function setProviderProxySession(session: { token: string; workspaceId: string } | null) {
  state.token = session?.token ?? null;
  state.workspaceId = session?.workspaceId ?? null;
}

export function providerProxyContext(): { baseUrl: string; token: string; workspaceId: string } | null {
  if (!state.baseUrl || !state.token || !state.workspaceId) return null;
  return { baseUrl: state.baseUrl, token: state.token, workspaceId: state.workspaceId };
}

export function isProviderProxyActive() {
  return providerProxyContext() !== null;
}

/** Test seam: drop all proxy state (a fresh sign-in rebuilds it). */
export function resetProviderProxy() {
  state.baseUrl = null;
  state.token = null;
  state.workspaceId = null;
}

/**
 * Perform one proxied provider call. Transport and validation failures become
 * `ProxyError`s carrying the API's actionable message, so callers can surface
 * exactly what the server said without translating it back into guesswork.
 */
export async function proxyRequest<T>(
  path: string,
  init: {
    method: "GET" | "POST";
    query?: Record<string, string | undefined>;
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<T> {
  const context = providerProxyContext();
  if (!context) throw new ProxyError("No platform API is configured for provider calls.");

  const url = new URL(`${context.baseUrl}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method,
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${context.token}`,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ProxyError("The provider request was cancelled.", { status: 499 });
    }
    throw new ProxyError(
      "The platform API could not be reached. Check that the backend is running and that its address in VITE_PYRE_API_URL is correct.",
      { status: 0 },
    );
  }

  const raw = await response.text().catch(() => "");

  if (!response.ok) {
    const payload = safeParse(raw) as { message?: string | string[]; hint?: string; upstreamStatus?: number };
    const message = Array.isArray(payload?.message)
      ? payload.message.join(", ")
      : (payload?.message ?? `The platform API returned HTTP ${response.status}.`);
    throw new ProxyError(message, {
      status: response.status,
      upstreamStatus: payload?.upstreamStatus,
      hint: payload?.hint,
    });
  }

  return (raw ? safeParse(raw) : undefined) as T;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
