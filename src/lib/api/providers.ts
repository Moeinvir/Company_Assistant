/**
 * Provider architecture.
 *
 * The platform is deliberately not built around a single vendor. A provider is
 * described by data (models, base URL, browser access, docs) and implemented by
 * a thin adapter that performs the real HTTP call. Adding a provider means
 * adding a definition plus — only if its wire format is new — one adapter.
 *
 * Security note: these calls go directly from the browser, which is fine for a
 * locally-run workspace where the key belongs to the operator. The
 * `browserAccess` flag records which vendors block cross-origin requests, and
 * the UI tells the user when a server-side proxy is required. Production
 * deployments should route through the platform API so keys never reach the
 * client.
 */

import type {
  ModelOption,
  ProviderCapability,
  ProviderDefinition,
  ProviderId,
} from "./types";
import {
  ProxyError,
  providerProxyContext,
  providerProxyPaths,
  proxyRequest,
} from "./providerProxy";

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;
  readonly hint?: string;

  constructor(
    provider: ProviderId,
    message: string,
    status?: number,
    hint?: string,
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.hint = hint;
  }
}

const chatModel = (
  id: string,
  label: string,
  contextWindow: number,
  tier: ModelOption["tier"],
): ModelOption => ({ id, label, contextWindow, tier });

const embedModel = (
  id: string,
  label: string,
  dimensions: number,
  tier: ModelOption["tier"] = "balanced",
): ModelOption => ({
  id,
  label,
  contextWindow: 8192,
  dimensions,
  tier,
});

export const CHAT_PROVIDERS: ProviderDefinition[] = [
  {
    id: "openai",
    name: "OpenAI",
    vendor: "OpenAI",
    capability: "chat",
    requiresKey: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    browserAccess: "supported",
    keyPlaceholder: "sk-…",
    models: [
      chatModel("gpt-4.1", "GPT-4.1", 1_047_576, "flagship"),
      chatModel("gpt-4.1-mini", "GPT-4.1 mini", 1_047_576, "balanced"),
      chatModel("gpt-4o", "GPT-4o", 128_000, "flagship"),
      chatModel("gpt-4o-mini", "GPT-4o mini", 128_000, "fast"),
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    vendor: "Anthropic",
    capability: "chat",
    requiresKey: true,
    defaultBaseUrl: "https://api.anthropic.com",
    docsUrl: "https://docs.anthropic.com/en/api/messages",
    browserAccess: "supported",
    keyPlaceholder: "sk-ant-…",
    models: [
      chatModel("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000, "flagship"),
      chatModel("claude-haiku-4-5", "Claude Haiku 4.5", 200_000, "fast"),
      chatModel("claude-opus-4-1", "Claude Opus 4.1", 200_000, "flagship"),
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    vendor: "Google",
    capability: "chat",
    requiresKey: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    browserAccess: "supported",
    keyPlaceholder: "AIza…",
    models: [
      chatModel("gemini-2.5-pro", "Gemini 2.5 Pro", 1_048_576, "flagship"),
      chatModel("gemini-2.5-flash", "Gemini 2.5 Flash", 1_048_576, "balanced"),
      chatModel("gemini-2.0-flash", "Gemini 2.0 Flash", 1_048_576, "fast"),
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    vendor: "Mistral AI",
    capability: "chat",
    requiresKey: true,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    docsUrl: "https://docs.mistral.ai/api/",
    browserAccess: "supported",
    keyPlaceholder: "…",
    models: [
      chatModel("mistral-large-latest", "Mistral Large", 131_072, "flagship"),
      chatModel("mistral-small-latest", "Mistral Small", 131_072, "balanced"),
    ],
  },
  {
    id: "groq",
    name: "Groq",
    vendor: "Groq",
    capability: "chat",
    requiresKey: true,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    docsUrl: "https://console.groq.com/docs/api-reference",
    browserAccess: "supported",
    keyPlaceholder: "gsk_…",
    models: [
      chatModel(
        "llama-3.3-70b-versatile",
        "Llama 3.3 70B",
        131_072,
        "balanced",
      ),
      chatModel("llama-3.1-8b-instant", "Llama 3.1 8B", 131_072, "fast"),
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    vendor: "OpenRouter",
    capability: "chat",
    requiresKey: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/docs/api-reference/overview",
    browserAccess: "supported",
    keyPlaceholder: "sk-or-…",
    models: [
      chatModel(
        "openai/gpt-4.1-mini",
        "GPT-4.1 mini (routed)",
        1_047_576,
        "balanced",
      ),
      chatModel(
        "anthropic/claude-sonnet-4.5",
        "Claude Sonnet 4.5 (routed)",
        200_000,
        "flagship",
      ),
      chatModel(
        "meta-llama/llama-3.3-70b-instruct",
        "Llama 3.3 70B (routed)",
        131_072,
        "fast",
      ),
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    vendor: "Local runtime",
    capability: "chat",
    requiresKey: false,
    defaultBaseUrl: "http://localhost:11434",
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md",
    browserAccess: "local",
    keyPlaceholder: "no key required",
    models: [
      chatModel("llama3.2", "llama3.2 (local)", 131_072, "balanced"),
      chatModel("qwen2.5:7b", "qwen2.5 7B (local)", 32_768, "fast"),
      chatModel("mistral-nemo", "mistral-nemo (local)", 128_000, "balanced"),
    ],
    note: "Runs on your machine. The browser talks to 127.0.0.1 — nothing leaves the device.",
  },
  {
    id: "custom",
    name: "Custom",
    vendor: "Custom",
    capability: "chat",
    requiresKey: true,
    defaultBaseUrl: "https://racode-llm.partschool.ir/v1",
    docsUrl: "https://racode-llm.partschool.ir",
    browserAccess: "supported",
    keyPlaceholder: "sk-…",
    models: [], // به‌صورت پویا از /models گرفته می‌شود
    note: "مدل‌ها مستقیم از API خوانده می‌شوند.",
  },
];

export const EMBEDDING_PROVIDERS: ProviderDefinition[] = [
  {
    id: "local",
    name: "Parsis Bridge local embedder",
    vendor: "Built in",
    capability: "embedding",
    requiresKey: false,
    docsUrl: "/docs#local-embedder",
    browserAccess: "local",
    keyPlaceholder: "no key required",
    models: [
      embedModel("pyre-hash-384", "Parsis Hash 384 (offline)", 384, "fast"),
    ],
    note: "Deterministic hashed bag-of-words vectors. Runs offline with no key and no network — ideal for evaluating retrieval before connecting a vendor.",
  },
  {
    id: "openai",
    name: "OpenAI Embeddings",
    vendor: "OpenAI",
    capability: "embedding",
    requiresKey: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/docs/guides/embeddings",
    browserAccess: "supported",
    keyPlaceholder: "sk-…",
    models: [
      embedModel(
        "text-embedding-3-large",
        "text-embedding-3-large",
        3072,
        "flagship",
      ),
      embedModel("text-embedding-3-small", "text-embedding-3-small", 1536),
    ],
  },
  {
    id: "google",
    name: "Google Embeddings",
    vendor: "Google",
    capability: "embedding",
    requiresKey: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    docsUrl: "https://ai.google.dev/gemini-api/docs/embeddings",
    browserAccess: "supported",
    keyPlaceholder: "AIza…",
    models: [embedModel("text-embedding-004", "text-embedding-004", 768)],
  },
  {
    id: "cohere",
    name: "Cohere Embed",
    vendor: "Cohere",
    capability: "embedding",
    requiresKey: true,
    defaultBaseUrl: "https://api.cohere.com",
    docsUrl: "https://docs.cohere.com/reference/embed",
    browserAccess: "supported",
    keyPlaceholder: "…",
    models: [
      embedModel("embed-v4.0", "embed-v4.0", 1536, "flagship"),
      embedModel("embed-english-v3.0", "embed-english-v3.0", 1024),
    ],
  },
  {
    id: "voyage",
    name: "Voyage AI",
    vendor: "Voyage AI",
    capability: "embedding",
    requiresKey: true,
    defaultBaseUrl: "https://api.voyageai.com",
    docsUrl: "https://docs.voyageai.com/reference/embeddings-api",
    browserAccess: "restricted",
    keyPlaceholder: "pa-…",
    models: [embedModel("voyage-3-large", "voyage-3-large", 1024, "flagship")],
    note: "Voyage does not accept browser-origin requests. Route this provider through your platform API in production.",
  },
  {
    id: "ollama",
    name: "Ollama Embeddings",
    vendor: "Local runtime",
    capability: "embedding",
    requiresKey: false,
    defaultBaseUrl: "http://localhost:11434",
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md",
    browserAccess: "local",
    keyPlaceholder: "no key required",
    models: [embedModel("nomic-embed-text", "nomic-embed-text (local)", 768)],
  },
];

export const PROVIDER_MAP: Record<ProviderId, ProviderDefinition> = [
  ...CHAT_PROVIDERS,
  ...EMBEDDING_PROVIDERS,
].reduce(
  (acc, provider) => {
    // Chat definitions win when a vendor appears in both roles — the capability
    // list is read from the collections above.
    acc[provider.id] = acc[provider.id] ?? provider;
    return acc;
  },
  {} as Record<ProviderId, ProviderDefinition>,
);

export function providersFor(capability: ProviderCapability) {
  return capability === "chat" ? CHAT_PROVIDERS : EMBEDDING_PROVIDERS;
}

export function modelsFor(
  provider: ProviderId,
  capability: ProviderCapability,
): ModelOption[] {
  return (
    providersFor(capability).find((entry) => entry.id === provider)?.models ??
    []
  );
}

export function modelLabel(modelId: string) {
  const found = [...CHAT_PROVIDERS, ...EMBEDDING_PROVIDERS]
    .flatMap((entry) => entry.models)
    .find((model) => model.id === modelId);
  return found?.label ?? modelId;
}

export const OPENAI_COMPATIBLE: ProviderId[] = [
  "openai",
  "mistral",
  "groq",
  "openrouter",
  // A custom provider *is* an OpenAI-compatible endpoint the operator runs.
  "custom",
];

/** Where each vendor lists models; used when the browser talks to it directly. */
const MODELS_PATH: Partial<Record<ProviderId, string>> = {
  anthropic: "/v1/models",
  google: "/v1beta/models",
  ollama: "/api/tags",
  local: "/api/tags",
  cohere: "/v1/models",
  voyage: "/v1/models",
};

/** Turn a proxy failure into the `ProviderError` the rest of the app expects. */
function asProviderError(provider: ProviderId, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof ProxyError) {
    return new ProviderError(provider, error.message, error.status, error.hint);
  }
  return new ProviderError(provider, (error as Error)?.message ?? `${provider} request failed.`);
}

/* ----------------------------------------------------------------- requests */

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  finishReason: string | null;
}

const TIMEOUT_MS = 60_000;

async function request(
  provider: ProviderId,
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", onAbort);
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new ProviderError(
          provider,
          timedOut
            ? `Request to ${provider} timed out after ${TIMEOUT_MS / 1000}s.`
            : `Request to ${provider} was cancelled.`,
        );
      }
      throw new ProviderError(
        provider,
        `Could not reach ${provider}. This is usually a network or CORS restriction.`,
        undefined,
        "Verify the API key and base URL, then check the browser console for a CORS error. Providers that block browser origins must be proxied through your platform API.",
      );
    }

    // The timeout stays armed while the body is read.
    const raw = await response.text().catch(() => "");

    if (!response.ok) {
      let detail = "";
      try {
        const body = JSON.parse(raw) as {
          error?: { message?: string } | string;
          message?: string;
        };
        detail =
          typeof body.error === "string"
            ? body.error
            : (body.error?.message ?? body.message ?? "");
      } catch {
        detail = raw;
      }
      const hint =
        response.status === 401
          ? "The key was rejected. Check that it is active and has access to this model."
          : response.status === 429
            ? "Rate limited by the provider. Retry shortly or lower the request rate."
            : response.status >= 500
              ? "The provider reported a server error. Retry in a moment."
              : undefined;
      throw new ProviderError(
        provider,
        `${provider} returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`,
        response.status,
        hint,
      );
    }

    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new ProviderError(
        provider,
        `${provider} returned a response that was not valid JSON.`,
        response.status,
      );
    }
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function trimBase(baseUrl?: string, fallback?: string) {
  const value = (baseUrl || fallback || "").replace(/\/+$/, "");
  return value;
}

/** Map vendor stop reasons onto "length" so truncation is detected everywhere. */
function normalizeFinish(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const lower = reason.toLowerCase();
  return lower === "max_tokens" || lower === "length" ? "length" : reason;
}

/** Each vendor accepts a different temperature range. */
function clampTemperature(provider: ProviderId, value: number): number {
  const max = provider === "anthropic" ? 1 : provider === "mistral" ? 1.5 : 2;
  if (!Number.isFinite(value)) return 0.2;
  return Math.min(max, Math.max(0, value));
}

/**
 * Perform a chat completion against the configured provider.
 *
 * Against the platform API the call is proxied: the server resolves the
 * workspace key and performs the request, so a browser CORS restriction or a
 * key that only exists server-side can never break generation. In offline mode
 * the browser calls the provider directly with the operator's own key.
 */
export async function chatComplete(input: ChatRequest): Promise<ChatResult> {
  const req: ChatRequest = {
    ...input,
    temperature: clampTemperature(input.provider, input.temperature),
  };
  const definition = PROVIDER_MAP[req.provider];
  const base = trimBase(req.baseUrl, definition?.defaultBaseUrl);

  if (!req.model?.trim()) {
    throw new ProviderError(
      req.provider,
      `No model is selected for ${definition?.name ?? req.provider}.`,
      undefined,
      "Pick a model in the assistant's Model tab (or create the assistant again and choose one).",
    );
  }

  const proxy = providerProxyContext();
  if (proxy) {
    try {
      const result = await proxyRequest<{
        text?: string;
        promptTokens?: number;
        completionTokens?: number;
        model?: string;
        finishReason?: string | null;
      }>(providerProxyPaths.chat(req.provider), {
        method: "POST",
        body: {
          workspaceId: proxy.workspaceId,
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          maxTokens: req.maxTokens,
          topP: req.topP,
          baseUrl: req.baseUrl,
        },
        signal: req.signal,
      });
      return {
        text: result?.text ?? "",
        promptTokens: result?.promptTokens ?? 0,
        completionTokens: result?.completionTokens ?? 0,
        model: result?.model ?? req.model,
        finishReason: result?.finishReason ?? null,
      };
    } catch (error) {
      throw asProviderError(req.provider, error);
    }
  }

  if (definition?.requiresKey && !req.apiKey) {
    throw new ProviderError(
      req.provider,
      `${definition.name} requires an API key.`,
      undefined,
      "Add the key in API / Integrations → Provider keys.",
    );
  }

  if (req.provider === "anthropic") {
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = req.messages.filter((m) => m.role !== "system");
    const body = await request(
      req.provider,
      `${base}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": req.apiKey ?? "",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          ...(system ? { system } : {}),
          messages: rest.map((m) => ({ role: m.role, content: m.content })),
        }),
      },
      req.signal,
    );
    const data = body as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    return {
      text: (data.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(""),
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      model: req.model,
      finishReason: normalizeFinish(data.stop_reason),
    };
  }

  if (req.provider === "google") {
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const data = (await request(
      req.provider,
      `${base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": req.apiKey ?? "",
        },
        body: JSON.stringify({
          contents,
          ...(system
            ? { systemInstruction: { parts: [{ text: system }] } }
            : {}),
          generationConfig: {
            temperature: req.temperature,
            maxOutputTokens: req.maxTokens,
            topP: req.topP,
          },
        }),
      },
      req.signal,
    )) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const candidate = data.candidates?.[0];
    return {
      text: (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join(""),
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      model: req.model,
      finishReason: normalizeFinish(candidate?.finishReason),
    };
  }

  if (req.provider === "ollama") {
    const data = (await request(
      req.provider,
      `${base}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: false,
          options: {
            temperature: req.temperature,
            num_predict: req.maxTokens,
            top_p: req.topP,
          },
        }),
      },
      req.signal,
    )) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
    };
    return {
      text: data.message?.content ?? "",
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      model: req.model,
      finishReason: normalizeFinish(data.done_reason),
    };
  }

  // OpenAI-compatible wire format (OpenAI, Mistral, Groq, OpenRouter).
  const data = (await request(
    req.provider,
    `${base}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {}),
        ...(req.provider === "openrouter"
          ? { "x-title": "Parsis Bridge", "http-referer": window.location.origin }
          : {}),
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        top_p: req.topP,
      }),
    },
    req.signal,
  )) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? req.model,
    finishReason: normalizeFinish(data.choices?.[0]?.finish_reason),
  };
}

export interface EmbedRequest {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  texts: string[];
  /** For providers that support Matryoshka truncation. */
  dimensions?: number;
  /** Queries and documents are embedded differently by asymmetric models. */
  kind?: "document" | "query";
  signal?: AbortSignal;
}

/** Embed a batch of texts with the configured provider. */
export async function embedWithProvider(
  req: EmbedRequest,
): Promise<number[][]> {
  const definition = PROVIDER_MAP[req.provider];
  const base = trimBase(req.baseUrl, definition?.defaultBaseUrl);
  if (definition?.requiresKey && !req.apiKey) {
    throw new ProviderError(
      req.provider,
      `${definition?.name ?? req.provider} requires an API key for embeddings.`,
      undefined,
      providerProxyContext()
        ? "This build proxies generation through the API but still embeds in the browser. Switch this assistant to the built-in offline embedder, or run without a backend to embed with a vendor key."
        : "Connect the provider in API / Integrations, or switch this assistant to the built-in offline embedder.",
    );
  }

  if (req.provider === "openai") {
    const data = (await request(
      req.provider,
      `${base}/embeddings`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${req.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model: req.model,
          input: req.texts,
          ...(req.dimensions ? { dimensions: req.dimensions } : {}),
        }),
      },
      req.signal,
    )) as { data?: { index: number; embedding: number[] }[] };
    return (data.data ?? [])
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.embedding);
  }

  if (req.provider === "google") {
    const data = (await request(
      req.provider,
      `${base}/v1beta/models/${encodeURIComponent(req.model)}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": req.apiKey ?? "",
        },
        body: JSON.stringify({
          requests: req.texts.map((text) => ({
            model: `models/${req.model}`,
            content: { parts: [{ text }] },
            taskType:
              req.kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
            ...(req.dimensions ? { outputDimensionality: req.dimensions } : {}),
          })),
        }),
      },
      req.signal,
    )) as { embeddings?: { values: number[] }[] };
    return (data.embeddings ?? []).map((entry) => entry.values);
  }

  if (req.provider === "cohere") {
    const data = (await request(
      req.provider,
      `${base}/v2/embed`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${req.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model: req.model,
          texts: req.texts,
          input_type: req.kind === "query" ? "search_query" : "search_document",
          embedding_types: ["float"],
        }),
      },
      req.signal,
    )) as { embeddings?: { float?: number[][] } };
    return data.embeddings?.float ?? [];
  }

  if (req.provider === "voyage") {
    const data = (await request(
      req.provider,
      `${base}/v1/embeddings`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${req.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model: req.model,
          input: req.texts,
          input_type: req.kind === "query" ? "query" : "document",
        }),
      },
      req.signal,
    )) as { data?: { embedding: number[] }[] };
    return (data.data ?? []).map((entry) => entry.embedding);
  }

  if (req.provider === "ollama") {
    const data = (await request(
      req.provider,
      `${base}/api/embed`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: req.model, input: req.texts }),
      },
      req.signal,
    )) as { embeddings?: number[][] };
    return data.embeddings ?? [];
  }

  throw new ProviderError(
    req.provider,
    `${req.provider} does not implement an embedding endpoint in this build.`,
    undefined,
    "Choose a different embedding provider.",
  );
}

export interface KeyCheckResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  status?: number;
}

/**
 * Verify a key against the provider's own API. Results are reported verbatim,
 * including CORS failures — the UI never claims a connection works when the
 * request did not succeed.
 */
export async function verifyProviderKey(
  provider: ProviderId,
  apiKey: string | undefined,
  baseUrl?: string,
): Promise<KeyCheckResult> {
  const definition = PROVIDER_MAP[provider];
  const base = trimBase(baseUrl, definition?.defaultBaseUrl);
  const started = performance.now();

  // Against the platform API the probe runs server-side, with the key that was
  // just pasted *or* the stored one — never a browser call to the vendor.
  const proxy = providerProxyContext();
  if (proxy) {
    try {
      const result = await proxyRequest<{ ok?: boolean; message?: string; latencyMs?: number }>(
        providerProxyPaths.check(provider),
        {
          method: "POST",
          body: {
            workspaceId: proxy.workspaceId,
            apiKey: apiKey?.trim() || undefined,
            baseUrl: baseUrl?.trim() || undefined,
          },
        },
      );
      return {
        ok: result?.ok !== false,
        message: result?.message ?? "Key accepted by the provider.",
        latencyMs: result?.latencyMs ?? Math.round(performance.now() - started),
      };
    } catch (error) {
      const proxyError = error instanceof ProxyError ? error : null;
      return {
        ok: false,
        message: proxyError?.message ?? (error as Error).message,
        status: proxyError?.status,
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }

  try {
    if (provider === "ollama") {
      const data = (await request(provider, `${base}/api/tags`, {
        method: "GET",
      })) as {
        models?: { name: string }[];
      };
      const count = data.models?.length ?? 0;
      return {
        ok: true,
        message: `Local runtime reachable — ${count} model${count === 1 ? "" : "s"} installed.`,
        latencyMs: Math.round(performance.now() - started),
      };
    }
    if (!apiKey) {
      return {
        ok: false,
        message: "No key stored for this provider.",
        latencyMs: 0,
      };
    }
    if (provider === "google") {
      await request(provider, `${base}/v1beta/models?pageSize=1`, {
        headers: { "x-goog-api-key": apiKey },
      });
    } else if (provider === "anthropic") {
      await request(provider, `${base}/v1/models`, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
    } else if (provider === "cohere") {
      await request(provider, `${base}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
    } else if (provider === "voyage") {
      await request(provider, `${base}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
    } else {
      await request(provider, `${base}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
    }
    return {
      ok: true,
      message: "Key accepted by the provider.",
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;
    return {
      ok: false,
      message: providerError?.message ?? (error as Error).message,
      status: providerError?.status,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * List the models a provider actually serves.
 *
 * Against the platform API the server asks the vendor with the stored key (the
 * browser never sees it); offline this is a direct browser call, which only
 * works for vendors that allow browser origins.
 */
export async function fetchProviderModels(
  provider: ProviderId,
  apiKey?: string,
  baseUrl?: string,
): Promise<ModelOption[]> {
  const proxy = providerProxyContext();
  if (proxy) {
    try {
      return await proxyRequest<ModelOption[]>(providerProxyPaths.models(provider), {
        method: "GET",
        query: { workspaceId: proxy.workspaceId, baseUrl: baseUrl?.trim() || undefined },
      });
    } catch (error) {
      throw asProviderError(provider, error);
    }
  }

  const definition = PROVIDER_MAP[provider];
  const base = trimBase(baseUrl, definition?.defaultBaseUrl);
  const path = MODELS_PATH[provider] ?? "/models";
  const data = (await request(provider, `${base}${path}`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  })) as {
    data?: { id?: string; name?: string; display_name?: string }[];
    models?: { id?: string; name?: string; model?: string; displayName?: string }[];
  };

  const entries = provider === "ollama" || provider === "local"
    ? (data.models ?? []).map((entry) => ({ id: entry.model ?? entry.name ?? entry.id ?? "", label: entry.name ?? entry.model ?? "" }))
    : provider === "google"
      ? (data.models ?? []).map((entry) => ({
          id: (entry.name ?? entry.id ?? "").replace(/^models\//, ""),
          label: entry.displayName ?? entry.name ?? "",
        }))
      : (data.data ?? []).map((entry) => ({
          id: entry.id ?? entry.name ?? "",
          label: entry.display_name ?? entry.name ?? entry.id ?? "",
        }));

  return entries
    .filter((entry) => entry.id.trim().length > 0)
    .map((entry) => ({
      id: entry.id,
      label: entry.label || entry.id,
      contextWindow: 0,
      tier: "balanced" as const,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function providerLabel(provider: ProviderId) {
  return PROVIDER_MAP[provider]?.name ?? provider;
}
