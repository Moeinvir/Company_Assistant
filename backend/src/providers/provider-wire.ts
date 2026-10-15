/**
 * Provider wire format.
 *
 * Everything vendor-specific about talking to an LLM provider lives here: base
 * URLs, endpoint suffixes, auth headers, request/response shapes and error
 * translation. The code is deliberately pure (no Nest, no database, no global
 * state) so it can be exercised directly by tests — the provider proxy in
 * `providers.service.ts` is then only credential lookup plus one `fetch`.
 *
 * Two rules drive the design:
 *  • A key is a secret. Nothing in this file may put a key into a URL, a log
 *    line or an error message that is handed back to a client.
 *  • A request that leaves the server must go where the operator intended, so
 *    user-configured base URLs are validated before use.
 */

import { BadRequestException, BadGatewayException } from "@nestjs/common";
import { ProviderId } from "./providers.dto";

export interface ProviderEndpoints {
  /** Default API root. `custom` has none — the workspace must supply one. */
  baseUrl?: string;
  /** Path appended to the base URL for model discovery. */
  modelsPath?: string;
}

/**
 * OpenRouter is OpenAI-compatible, so it needs no special request shaping — only
 * its own base URL and attribution headers.
 */
export const PROVIDER_ENDPOINTS: Record<ProviderId, ProviderEndpoints> = {
  openai: { baseUrl: "https://api.openai.com/v1", modelsPath: "/models" },
  anthropic: { baseUrl: "https://api.anthropic.com", modelsPath: "/v1/models" },
  google: { baseUrl: "https://generativelanguage.googleapis.com", modelsPath: "/v1beta/models" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", modelsPath: "/models" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", modelsPath: "/models" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", modelsPath: "/models" },
  ollama: { baseUrl: "http://localhost:11434", modelsPath: "/api/tags" },
  cohere: { baseUrl: "https://api.cohere.com", modelsPath: "/v1/models" },
  voyage: { baseUrl: "https://api.voyageai.com", modelsPath: "/v1/models" },
  local: { baseUrl: "http://localhost:11434", modelsPath: "/api/tags" },
  // Self-hosted, OpenAI-compatible gateways (LiteLLM, vLLM, LM Studio, …).
  // No default: the operator's own URL is the only correct one.
  custom: {},
};

/** Providers whose chat wire format is OpenAI's `POST /chat/completions`. */
export const OPENAI_COMPATIBLE: ProviderId[] = [
  ProviderId.openai,
  ProviderId.mistral,
  ProviderId.groq,
  ProviderId.openrouter,
  ProviderId.custom,
];

/** Providers that need no key and are expected to live on the operator's host. */
export const KEYLESS_PROVIDERS: ProviderId[] = [ProviderId.ollama, ProviderId.local];

export function requiresApiKey(provider: ProviderId) {
  return !KEYLESS_PROVIDERS.includes(provider);
}

/* ------------------------------------------------------------------ the URL */

/**
 * Append an endpoint path to a base URL without duplicating segments.
 *
 * Users paste all of these, and every one must work:
 *   https://openrouter.ai/api          + /chat/completions
 *   https://openrouter.ai/api/v1       + /chat/completions
 *   https://openrouter.ai/api/v1       + /v1/chat/completions
 *   https://openrouter.ai/api/v1/chat/completions + /chat/completions
 */
export function joinEndpoint(baseUrl: string, path: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const suffix = path.trim().replace(/^\/+|\/+$/g, "");
  if (!suffix) return base;
  if (!base) throw new BadRequestException("A provider base URL is required.");

  const baseSegments = base.split("/").map((segment) => segment.toLowerCase());
  const suffixSegments = suffix.split("/").map((segment) => segment.toLowerCase());

  // A base that already names the endpoint is complete — users paste the whole
  // `/chat/completions` URL as often as they paste the API root.
  const tail = baseSegments.slice(-suffixSegments.length);
  if (tail.length === suffixSegments.length && tail.every((segment, i) => segment === suffixSegments[i])) {
    return base;
  }

  // Otherwise drop the suffix segments the base already ends with, which is
  // what removes a duplicated `/v1` from `…/v1` + `/v1/chat/completions`.
  let remaining = suffixSegments;
  while (
    remaining.length > 0 &&
    baseSegments[baseSegments.length - 1] === remaining[0]
  ) {
    remaining = remaining.slice(1);
  }
  if (remaining.length === 0) return base;

  // Rebuild from the original casing so ids in the path are not lowercased.
  const original = suffix.split("/");
  return `${base}/${original.slice(original.length - remaining.length).join("/")}`;
}

/**
 * Validate a user-supplied base URL before the server fetches it.
 *
 * This blocks the request-forgery classes that matter for a multi-tenant
 * service: non-HTTP schemes, embedded credentials and cloud metadata endpoints.
 * Private ranges and loopback stay allowed on purpose — Ollama and self-hosted
 * gateways (LiteLLM, vLLM) legitimately run there, and an operator who cannot
 * reach their own inference box cannot use the product at all.
 */
export function assertSafeBaseUrl(rawUrl: string, provider: ProviderId) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new BadRequestException(`"${rawUrl}" is not a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BadRequestException("Provider URLs must use http or https.");
  }
  if (url.username || url.password) {
    throw new BadRequestException(
      `The ${providerName(provider)} base URL must not contain embedded credentials.`,
    );
  }

  const host = url.hostname.toLowerCase();
  const metadataHosts = [
    "169.254.169.254", // AWS/GCP/Azure instance metadata
    "metadata.google.internal",
    "metadata.goog",
  ];
  const linkLocal = /^169\.254\./.test(host);
  if (metadataHosts.includes(host) || linkLocal) {
    throw new BadRequestException("That host is not allowed as a provider endpoint.");
  }
  return url;
}

/**
 * The base URL a request will use: the workspace override when present,
 * otherwise the vendor default. `custom` has no default by design.
 */
export function resolveBaseUrl(provider: ProviderId, override?: string | null) {
  const candidate = (override ?? "").trim() || PROVIDER_ENDPOINTS[provider]?.baseUrl || "";
  if (!candidate) {
    throw new BadRequestException(
      `No base URL is configured for ${provider}. Save the endpoint your gateway is served from.`,
    );
  }
  assertSafeBaseUrl(candidate, provider);
  return candidate.trim().replace(/\/+$/, "");
}

export function modelsEndpoint(provider: ProviderId, baseUrl: string) {
  const path = PROVIDER_ENDPOINTS[provider]?.modelsPath ?? "/models";
  return joinEndpoint(baseUrl, path);
}

export function chatEndpoint(provider: ProviderId, baseUrl: string, model: string) {
  switch (provider) {
    case "anthropic":
      return joinEndpoint(baseUrl, "/v1/messages");
    case "google":
      return joinEndpoint(baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent`);
    case "ollama":
    case "local":
      // Both are served by an Ollama-compatible runtime on the operator's host.
      return joinEndpoint(baseUrl, "/api/chat");
    default:
      return joinEndpoint(baseUrl, "/chat/completions");
  }
}

/* --------------------------------------------------------------- the request */

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatParams {
  model: string;
  messages: ChatMessageInput[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  finishReason: string | null;
}

/** Vendor ranges differ; keep the value acceptable to every provider. */
export function clampTemperature(provider: ProviderId, value: number | undefined) {
  const max = provider === "anthropic" ? 1 : provider === "mistral" ? 1.5 : 2;
  if (value === undefined || !Number.isFinite(value)) return 0.2;
  return Math.min(max, Math.max(0, value));
}

export function buildHeaders(
  provider: ProviderId,
  apiKey: string | null,
  options: { referer?: string } = {},
): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  switch (provider) {
    case "anthropic":
      if (apiKey) headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      break;
    case "google":
      if (apiKey) headers["x-goog-api-key"] = apiKey;
      break;
    case "openrouter":
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      // OpenRouter attributes traffic by title/referer. Never the key.
      headers["x-title"] = "Parsis Bridge";
      headers["http-referer"] = options.referer ?? "http://localhost:3000";
      break;
    default:
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      break;
  }
  return headers;
}

export function buildChatBody(provider: ProviderId, params: ChatParams): Record<string, unknown> {
  const temperature = clampTemperature(provider, params.temperature);
  const maxTokens = params.maxTokens && params.maxTokens > 0 ? params.maxTokens : 1024;

  switch (provider) {
    case "anthropic": {
      const system = params.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      return {
        model: params.model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: params.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role, content: message.content })),
      };
    }
    case "google": {
      const system = params.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      return {
        contents: params.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(params.topP !== undefined ? { topP: params.topP } : {}),
        },
      };
    }
    case "ollama":
    case "local":
      return {
        model: params.model,
        messages: params.messages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
          ...(params.topP !== undefined ? { top_p: params.topP } : {}),
        },
      };
    default:
      // OpenAI-compatible: OpenAI, Mistral, Groq, OpenRouter and custom gateways.
      return {
        model: params.model,
        messages: params.messages,
        temperature,
        max_tokens: maxTokens,
        ...(params.topP !== undefined ? { top_p: params.topP } : {}),
      };
  }
}

function normalizeFinish(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.toLowerCase() === "max_tokens" || reason.toLowerCase() === "length"
    ? "length"
    : reason;
}

export function parseChatResponse(
  provider: ProviderId,
  payload: Record<string, unknown>,
  requestedModel: string,
): ChatResult {
  const json = payload as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
    model?: string;
    content?: { type?: string; text?: string }[];
    stop_reason?: string;
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    done_reason?: string;
  };

  if (provider === "anthropic") {
    return {
      text: (json.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(""),
      promptTokens: json.usage?.input_tokens ?? 0,
      completionTokens: json.usage?.output_tokens ?? 0,
      model: requestedModel,
      finishReason: normalizeFinish(json.stop_reason),
    };
  }

  if (provider === "google") {
    const candidate = json.candidates?.[0];
    return {
      text: (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join(""),
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      model: requestedModel,
      finishReason: normalizeFinish(candidate?.finishReason),
    };
  }

  if (provider === "ollama" || provider === "local") {
    return {
      text: json.message?.content ?? "",
      promptTokens: json.prompt_eval_count ?? 0,
      completionTokens: json.eval_count ?? 0,
      model: requestedModel,
      finishReason: normalizeFinish(json.done_reason),
    };
  }

  return {
    text: json.choices?.[0]?.message?.content ?? "",
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    model: json.model ?? requestedModel,
    finishReason: normalizeFinish(json.choices?.[0]?.finish_reason),
  };
}

export interface ModelOption {
  id: string;
  label: string;
  contextWindow: number;
  tier: "flagship" | "balanced" | "fast";
}

/**
 * Normalise the model listings of OpenAI-compatible, Anthropic, Google and
 * Ollama APIs into one shape. Unknown entries are dropped rather than guessed
 * at, so the UI never offers a model id the provider did not report.
 */
export function parseModelList(provider: ProviderId, payload: unknown): ModelOption[] {
  const body = (payload ?? {}) as {
    data?: { id?: string; name?: string; display_name?: string }[];
    models?: { id?: string; name?: string; model?: string; displayName?: string }[];
  };

  if (provider === "ollama" || provider === "local") {
    return normalize(
      (body.models ?? []).map((entry) => ({
        id: entry.model ?? entry.name ?? entry.id ?? "",
        label: entry.name ?? entry.model ?? entry.id ?? "",
      })),
    );
  }

  if (provider === "google") {
    const entries = (body.models ?? []) as {
      id?: string;
      name?: string;
      displayName?: string;
      display_name?: string;
    }[];
    return normalize(
      entries.map((entry) => {
        const id = (entry.name ?? entry.id ?? "").replace(/^models\//, "");
        return { id, label: entry.displayName ?? entry.display_name ?? id };
      }),
    );
  }

  return normalize(
    (body.data ?? []).map((entry) => ({
      id: entry.id ?? (entry as { name?: string }).name ?? "",
      label: entry.display_name ?? entry.name ?? entry.id ?? "",
    })),
  );

  function normalize(entries: { id: string; label: string }[]): ModelOption[] {
    const seen = new Set<string>();
    return entries
      .filter((entry) => entry.id.trim().length > 0)
      .filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
      .map((entry) => ({
        id: entry.id,
        label: entry.label || entry.id,
        contextWindow: 0,
        tier: "balanced" as const,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

/* ---------------------------------------------------------------- the errors */

/**
 * Remove anything that looks like the credential from text that came back from
 * a provider. Gateways freely echo the rejected key ("received sk-…"), and that
 * text ends up in front of the user, so scrub it first.
 */
export function redactSecrets(text: string, secret?: string | null) {
  let safe = text;
  if (secret && secret.length >= 6) {
    safe = safe.split(secret).join("•••");
    // Gateways often echo a masked form: first/last characters with the middle
    // replaced. Strip the quoted fragments that carry both ends.
    const head = secret.slice(0, 4);
    const tail = secret.slice(-4);
    if (head !== tail) {
      safe = safe.split(`${head}****${tail}`).join("•••");
    }
  }
  return safe
    .replace(/\b(sk|gsk|pa|xai|AIza)-[A-Za-z0-9_\-]{6,}/g, "•••")
    // Providers often echo a hand-masked fragment of the rejected key
    // (`dumm****-123`, `wrong-****`); it is still key material.
    .replace(/\b[A-Za-z0-9_\-]{3,}\*{4,}[A-Za-z0-9_\-]*/g, "•••")
    .replace(/(Bearer|api[-_]?key|x-api-key|x-goog-api-key)["'\s:=]+[^\s"',)]+/gi, "$1 •••")
    .slice(0, 400);
}

export interface ProviderFailure {
  message: string;
  hint?: string;
  upstreamStatus: number;
  /** The status this API answers with; the upstream one is kept alongside. */
  httpStatus: number;
}

/**
 * Turn an upstream failure into an actionable message. The status class decides
 * the wording — a rejected key, an exhausted quota and a bad model id are three
 * different problems for the operator to fix.
 */
export function describeUpstreamFailure(
  provider: ProviderId,
  status: number,
  bodyText: string,
  secret?: string | null,
): ProviderFailure {
  const detail = redactSecrets(extractDetail(bodyText), secret).trim();
  const name = providerName(provider);
  const withDetail = detail ? ` ${detail}` : "";

  if (status === 401 || status === 403) {
    return {
      message: `${name} rejected these credentials (HTTP ${status}).${withDetail}`,
      hint: "Check that the key is active, has not been revoked, and matches this base URL.",
      upstreamStatus: status,
      httpStatus: 502,
    };
  }
  if (status === 402) {
    return {
      message: `${name} reports insufficient credits or quota (HTTP 402).${withDetail}`,
      hint: "Top up the provider account or switch to another key.",
      upstreamStatus: status,
      httpStatus: 502,
    };
  }
  if (status === 404) {
    return {
      message: `${name} does not serve that endpoint or model (HTTP 404).${withDetail}`,
      hint: "Check the base URL and the model id. Some accounts need a model enabled before it can be called.",
      upstreamStatus: status,
      httpStatus: 502,
    };
  }
  if (status === 429) {
    return {
      message: `${name} rate limited this request (HTTP 429).${withDetail}`,
      hint: "Retry shortly, or lower the request rate.",
      upstreamStatus: status,
      httpStatus: 502,
    };
  }
  if (status >= 500) {
    return {
      message: `${name} reported a server error (HTTP ${status}).${withDetail}`,
      hint: "This is upstream; retry in a moment.",
      upstreamStatus: status,
      httpStatus: 502,
    };
  }
  if (status === 400 || status === 422) {
    return {
      message: `${name} rejected the request (HTTP ${status}).${withDetail}`,
      hint: "Check the model id, the message payload and the generation settings.",
      upstreamStatus: status,
      httpStatus: 502,
    };
  }
  return {
    message: `${name} returned HTTP ${status}.${withDetail}`,
    upstreamStatus: status,
    httpStatus: 502,
  };
}

export function extractDetail(bodyText: string) {
  const raw = (bodyText ?? "").trim();
  if (!raw) return "";
  try {
    const body = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
      detail?: string;
    };
    const detail =
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ?? body.message ?? body.detail ?? "");
    return collapse(detail || raw);
  } catch {
    return collapse(raw);
  }
}

function collapse(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function providerName(provider: ProviderId) {
  const names: Record<ProviderId, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google Gemini",
    mistral: "Mistral",
    groq: "Groq",
    openrouter: "OpenRouter",
    ollama: "Ollama",
    cohere: "Cohere",
    voyage: "Voyage AI",
    local: "The local runtime",
    custom: "The custom provider",
  };
  return names[provider] ?? provider;
}

/** A network-level failure (DNS, refused connection, timeout) as the client sees it. */
export function describeTransportFailure(provider: ProviderId, error: unknown): ProviderFailure {
  const timedOut = (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError";
  return {
    message: timedOut
      ? `${providerName(provider)} did not answer before the request timed out.`
      : `${providerName(provider)} could not be reached from the API server.`,
    hint: timedOut
      ? "The provider may be slow or unreachable; retry, or lower the max tokens."
      : "Check the base URL, the host's network access and any firewall in between.",
    upstreamStatus: 0,
    httpStatus: timedOut ? 504 : 502,
  };
}

export function providerFailureException(failure: ProviderFailure) {
  return new BadGatewayException({
    message: failure.message,
    ...(failure.hint ? { hint: failure.hint } : {}),
    upstreamStatus: failure.upstreamStatus,
  });
}
