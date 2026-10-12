/**
 * Domain model for the Parsis Bridge platform.
 *
 * These types are the contract between the UI and any backend. `localBackend`
 * (the offline demo store) and a future HTTP backend both satisfy the same
 * `ApiClient` interface in `client.ts`, so pages never know which is running.
 */

import type { AssistantTone } from "../rag/tone";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "groq"
  | "openrouter"
  | "ollama"
  | "cohere"
  | "voyage"
  | "local"
  | "custom";

export type ProviderCapability = "chat" | "embedding";

export interface ModelOption {
  id: string;
  label: string;
  contextWindow: number;
  /** Only meaningful for embedding models. */
  dimensions?: number;
  tier: "flagship" | "balanced" | "fast";
}

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  vendor: string;
  capability: ProviderCapability;
  /** False for local runtimes such as Ollama. */
  requiresKey: boolean;
  defaultBaseUrl?: string;
  docsUrl: string;
  /**
   * Whether the provider accepts requests straight from a browser. Providers
   * marked "restricted" need a server-side proxy before they can be used in
   * production; the UI surfaces that honestly instead of failing silently.
   */
  browserAccess: "supported" | "restricted" | "local";
  keyPlaceholder: string;
  models: ModelOption[];
  note?: string;
}

/* ------------------------------------------------------------------- people */

export interface User {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  /**
   * Profile picture. Either a remote https URL or a `data:` URL produced by
   * the account settings screen (the offline backend stores it as-is).
   */
  image?: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: "trial" | "team" | "scale";
  ownerId: string;
  memberIds: string[];
  /** Demo workspaces are pre-populated and labelled in the UI. */
  isSample: boolean;
  createdAt: string;
}

export interface Session {
  token: string;
  user: User;
  expiresAt: string;
}

export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

/* --------------------------------------------------------------- assistants */

export interface ModelConfig {
  provider: ProviderId;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
}

export interface EmbeddingConfig {
  provider: ProviderId;
  model: string;
  dimensions: number;
  chunkSize: number;
  chunkOverlap: number;
}

export type RetrievalStrategy = "hybrid" | "vector" | "keyword";

export interface RagConfig {
  enabled: boolean;
  topK: number;
  /** Minimum cosine similarity kept in the context window. */
  scoreThreshold: number;
  strategy: RetrievalStrategy;
  rerank: boolean;
  /** Injected before the model sees the retrieved context. */
  instruction: string;
  noAnswerBehavior: "refuse" | "answer-without-context";
  noAnswerMessage: string;
}

export type AssistantStatus = "active" | "draft" | "paused" | "error";
export type WidgetPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";
export type WidgetTheme = "dark" | "light" | "auto";
export type LauncherIcon = "spark" | "flame" | "orb" | "chat";
export type AvatarStyle = "gradient" | "initials" | "image";

export interface WidgetConfig {
  enabled: boolean;
  position: WidgetPosition;
  theme: WidgetTheme;
  launcherLabel: string;
  launcherIcon: LauncherIcon;
  welcomeMessage: string;
  placeholder: string;
  assistantDisplayName: string;
  /** Empty string means "inherit the active fire theme accent". */
  primaryColor: string;
  avatarStyle: AvatarStyle;
  avatarUrl: string;
  cornerRadius: number;
  showBranding: boolean;
  brandingText: string;
  showSources: boolean;
  offsetX: number;
  offsetY: number;
}

export interface AssistantStats {
  conversations: number;
  messages: number;
  tokensUsed: number;
  avgLatencyMs: number;
  lastActivityAt: string | null;
}

export interface Assistant {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: AssistantStatus;
  systemPrompt: string;
  model: ModelConfig;
  tone?: AssistantTone;
  embedding: EmbeddingConfig;
  rag: RagConfig;
  widget: WidgetConfig;
  knowledgeBaseIds: string[];
  /** Public identifier used by the embeddable widget. Not a secret. */
  publicKey: string;
  stats: AssistantStats;
  createdAt: string;
  updatedAt: string;
}

export type AssistantDraft = Pick<
  Assistant,
  | "name"
  | "description"
  | "status"
  | "systemPrompt"
  | "model"
  | "tone"
  | "embedding"
  | "rag"
  | "widget"
  | "knowledgeBaseIds"
>;

/* ---------------------------------------------------------------- knowledge */

export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export type DocumentStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "chunking"
  | "embedding"
  | "indexing"
  | "indexed"
  | "failed";

export type DocumentSource = "file" | "url" | "text";

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  name: string;
  source: DocumentSource;
  sourceUrl?: string;
  mimeType: string;
  sizeBytes: number;
  characters: number;
  status: DocumentStatus;
  /** 0–1, meaningful while a document is being processed. */
  progress: number;
  chunkCount: number;
  tokenEstimate: number;
  embeddingProvider: ProviderId;
  embeddingModel: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  indexedAt: string | null;
}

export interface Chunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  workspaceId: string;
  index: number;
  content: string;
  tokens: number;
  vector: number[];
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  index: number;
  content: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
  tokens: number;
}

/* ------------------------------------------------------------------ talking */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  retrieved?: RetrievedChunk[];
  meta?: ResponseMetadata;
}

export interface ResponseMetadata {
  provider: ProviderId;
  model: string;
  mode: "model" | "extractive";
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retrievedCount: number;
  contextCharacters: number;
  scoreThreshold: number;
  topScore: number | null;
  grounded: boolean;
  notes: string[];
}

export interface QueryRequest {
  assistantId: string;
  question: string;
  /** Conversation history, oldest first. */
  history?: { role: ChatRole; content: string }[];
  topKOverride?: number;
  scoreThresholdOverride?: number;
  temperatureOverride?: number;
  strategyOverride?: RetrievalStrategy;
}

export interface QueryResponse {
  message: ChatMessage;
  retrieved: RetrievedChunk[];
}

export interface SearchRequest {
  assistantId: string;
  query: string;
  topK: number;
  strategy: RetrievalStrategy;
}

export interface SearchResponse {
  results: RetrievedChunk[];
  latencyMs: number;
  strategy: RetrievalStrategy;
  scannedChunks: number;
  embeddingProvider: ProviderId;
  embeddingModel: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  assistantId: string;
  title: string;
  channel: "playground" | "widget" | "api";
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------- integrations */

export type KeyStatus = "unset" | "configured" | "invalid" | "verified";

export interface ProviderKeyRecord {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  /** Never the raw key: only a masked tail is ever returned to the client. */
  maskedKey: string;
  status: KeyStatus;
  baseUrl?: string;
  lastCheckedAt: string | null;
  note: string | null;
  updatedAt: string;
}

/* ----------------------------------------------------------------- analytics */

export type UsageEventKind = "query" | "ingest" | "widget_message" | "error";

export interface UsageEvent {
  id: string;
  workspaceId: string;
  assistantId: string | null;
  kind: UsageEventKind;
  at: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  provider: ProviderId | null;
  model: string | null;
  retrievedCount: number;
  topScore: number | null;
  isSample: boolean;
}

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  at: string;
  kind:
    | "assistant.created"
    | "assistant.updated"
    | "assistant.deleted"
    | "document.added"
    | "document.indexed"
    | "document.failed"
    | "document.deleted"
    | "knowledge.created"
    | "provider.connected"
    | "query.run"
    | "workspace.created";
  summary: string;
  detail?: string;
  actor: string;
  isSample: boolean;
}

export interface UsagePoint {
  date: string;
  queries: number;
  ingestions: number;
  tokens: number;
  errors: number;
}

export interface AnalyticsSnapshot {
  range: "7d" | "30d" | "90d";
  totals: {
    queries: number;
    tokens: number;
    documentsIndexed: number;
    conversations: number;
    errors: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    avgRetrieved: number;
    groundRate: number;
  };
  series: UsagePoint[];
  byProvider: { provider: ProviderId; queries: number; tokens: number }[];
  byAssistant: {
    assistantId: string;
    name: string;
    queries: number;
    tokens: number;
  }[];
  latencyBuckets: { bucket: string; count: number }[];
  topQueries: { query: string; count: number; avgScore: number }[];
}
