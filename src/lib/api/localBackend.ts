/**
 * LocalBackend — the offline data layer.
 *
 * A complete implementation of `ApiClient` that runs in the browser so the
 * product can be explored without any infrastructure. It is a faithful model of
 * the API contract, not a hosted service: there is no server-side
 * authentication, no encryption at rest and no cross-device sync.
 *
 * What is real here:
 *  • workspace isolation — every record carries a workspaceId and every read is
 *    checked against the caller's memberships, so one tenant can never observe
 *    another's knowledge;
 *  • ingestion — documents are chunked and embedded through the same pipeline
 *    the UI uses, with genuine processing states;
 *  • retrieval — an exact similarity scan over the assistant's own passages;
 *  • analytics — aggregated from events recorded by real usage.
 *
 * What is synthetic: the contents of the sample workspace, always flagged
 * `isSample: true` and removable from Settings.
 */

import { answerQuestion, ingestText, type IngestStageEvent } from "../rag/pipeline";
import { clearLexicalCache, searchChunks } from "../rag/vectorStore";
import { createEmbedder } from "./embedder";
import { PROVIDER_MAP, ProviderError, modelsFor } from "./providers";
import { htmlToText } from "../rag/html";
import { unpackVector, packVector, type PackedChunk } from "./vectorCodec";
import { SAMPLE_DOCUMENTS, SAMPLE_KNOWLEDGE_BASES } from "./seed";
import type {
  ActivityEntry,
  AnalyticsSnapshot,
  Assistant,
  AssistantDraft,
  ChatMessage,
  Chunk,
  Conversation,
  DocumentRecord,
  DocumentSource,
  EmbeddingConfig,
  KnowledgeBase,
  ProviderId,
  ProviderKeyRecord,
  QueryRequest,
  QueryResponse,
  SearchRequest,
  SearchResponse,
  Session,
  UsageEvent,
  User,
  Workspace,
  WorkspaceMember,
} from "./types";
import type { ApiClient, AuthResult, BackendEvent, Credentials, FilePayload, ProfilePatch, PublicWidgetConfig } from "./client";

const STORAGE_KEY = "pyre.db.v1";
const TOKEN_KEY = "pyre.token.v1";
const DB_VERSION = 2;
const SESSION_DAYS = 7;

interface StoredUser extends User {
  passwordHash: string;
  salt: string;
}

interface StoredSession {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

interface RuntimeChunk {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  documentId: string;
  index: number;
  content: string;
  tokens: number;
  vector: number[];
}

interface StoredMessage extends ChatMessage {
  conversationId: string;
  workspaceId: string;
}

interface QueryLogEntry {
  at: string;
  workspaceId: string;
  assistantId: string;
  query: string;
  topScore: number | null;
  retrievedCount: number;
  latencyMs: number;
  isSample: boolean;
}

interface Persisted {
  version: number;
  users: StoredUser[];
  sessions: StoredSession[];
  workspaces: Workspace[];
  memberships: (WorkspaceMember & { workspaceId: string })[];
  assistants: Assistant[];
  knowledgeBases: KnowledgeBase[];
  documents: DocumentRecord[];
  documentTexts: Record<string, string>;
  chunks: PackedChunk[];
  providerKeys: (ProviderKeyRecord & { secret?: string })[];
  events: UsageEvent[];
  queryLog: QueryLogEntry[];
  activity: ActivityEntry[];
  conversations: Conversation[];
  messages: StoredMessage[];
}

function emptyDatabase(): Persisted {
  return {
    version: DB_VERSION,
    users: [],
    sessions: [],
    workspaces: [],
    memberships: [],
    assistants: [],
    knowledgeBases: [],
    documents: [],
    documentTexts: {},
    chunks: [],
    providerKeys: [],
    events: [],
    queryLog: [],
    activity: [],
    conversations: [],
    messages: [],
  };
}

/* ------------------------------------------------------------------ helpers */

/**
 * v1 data predates the rename: anything attributed to the old brand (sample
 * activity actors, the widget's default branding line, seeded document copy)
 * is rewritten once so stored workspaces show the current name.
 */
function migrateLegacyBrand(db: Persisted): Persisted {
  const rebrand = (value: string) =>
    value.replace(/\bPyre\b/g, "Parsis Bridge").replace(/\bPYRE\b/g, "PARSIS BRIDGE");
  db.activity = db.activity.map((entry) => ({
    ...entry,
    actor: rebrand(entry.actor),
    summary: rebrand(entry.summary),
    detail: entry.detail ? rebrand(entry.detail) : entry.detail,
  }));
  db.assistants = db.assistants.map((assistant) => ({
    ...assistant,
    widget: {
      ...assistant.widget,
      brandingText: rebrand(assistant.widget.brandingText),
    },
  }));
  db.documents = db.documents.map((document) => ({
    ...document,
    name: rebrand(document.name),
  }));
  db.documentTexts = Object.fromEntries(
    Object.entries(db.documentTexts).map(([id, text]) => [id, rebrand(text)]),
  );
  db.version = DB_VERSION;
  return db;
}

const randomId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

const nowIso = () => new Date().toISOString();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Local calendar-day key (YYYY-MM-DD) so charts match the viewer's day. */
function localDayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Keep numeric model settings inside ranges every provider accepts. */
function sanitizePatch(patch: Partial<AssistantDraft>): Partial<AssistantDraft> {
  const next = { ...patch };
  if (typeof next.name === "string" && !next.name.trim()) delete next.name;
  if (typeof next.name === "string") next.name = next.name.trim();
  if (next.model) {
    const model = { ...next.model };
    model.temperature = clamp(Number(model.temperature) || 0, 0, 2);
    model.maxTokens = Math.round(clamp(Number(model.maxTokens) || 1024, 16, 128_000));
    model.topP = clamp(Number.isFinite(Number(model.topP)) ? Number(model.topP) : 1, 0, 1);
    model.frequencyPenalty = clamp(Number(model.frequencyPenalty) || 0, -2, 2);
    next.model = model;
  }
  if (next.rag) {
    next.rag = {
      ...next.rag,
      topK: Math.round(clamp(Number(next.rag.topK) || 5, 1, 50)),
      scoreThreshold: clamp(Number(next.rag.scoreThreshold) || 0, 0, 1),
    };
  }
  if (next.embedding) {
    next.embedding = {
      ...next.embedding,
      chunkSize: Math.round(clamp(Number(next.embedding.chunkSize) || 900, 120, 8000)),
      chunkOverlap: Math.round(clamp(Number(next.embedding.chunkOverlap) || 0, 0, 4000)),
    };
  }
  return next;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function hashPassword(password: string, salt: string) {
  const input = `${salt}:${password}:pyre`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback for non-secure contexts, where SubtleCrypto is unavailable.
  let hash = 2166136261;
  for (let round = 0; round < 64; round += 1) {
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i) + round;
      hash = Math.imul(hash, 16777619);
    }
  }
  return `fnv_${(hash >>> 0).toString(16)}`;
}

export { htmlToText };

const TEXTUAL_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".log",
  ".html",
  ".htm",
  ".pdf",
  ".docx",
];

/** Formats the browser can read as UTF-8 text without a parsing library. */
export function isBrowserReadableFile(name: string) {
  const lower = name.toLowerCase();
  return TEXTUAL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function defaultEmbedding(): EmbeddingConfig {
  return { provider: "local", model: "pyre-hash-384", dimensions: 384, chunkSize: 900, chunkOverlap: 150 };
}

export function defaultAssistantDraft(name = "New assistant"): AssistantDraft {
  return {
    name,
    description: "",
    status: "draft",
    systemPrompt:
      "You are a precise, helpful assistant. Answer using the retrieved context and cite the passage numbers you rely on.",
    model: { provider: "openai", model: "gpt-4.1-mini", temperature: 0.2, maxTokens: 1024, topP: 1, frequencyPenalty: 0 },
    embedding: defaultEmbedding(),
    rag: {
      enabled: true,
      topK: 5,
      scoreThreshold: 0.22,
      strategy: "hybrid",
      rerank: false,
      instruction:
        "Ground every claim in the provided passages. If the context is insufficient, say what is missing instead of guessing.",
      noAnswerBehavior: "refuse",
      noAnswerMessage:
        "I could not find anything in the connected knowledge bases that answers this. Try rephrasing, or add the source document to a knowledge base.",
    },
    widget: {
      enabled: true,
      position: "bottom-right",
      theme: "dark",
      launcherLabel: "Ask us anything",
      launcherIcon: "spark",
      welcomeMessage: `Hello — I'm ${name}. Ask me anything about our documentation.`,
      placeholder: "Ask a question…",
      assistantDisplayName: name,
      primaryColor: "",
      avatarStyle: "gradient",
      avatarUrl: "",
      cornerRadius: 16,
      showBranding: true,
      brandingText: "Powered by Parsis Bridge",
      showSources: true,
      offsetX: 20,
      offsetY: 20,
    },
    knowledgeBaseIds: [],
  };
}

/* -------------------------------------------------------------------- store */

export class LocalBackend implements ApiClient {
  readonly mode = "demo" as const;
  readonly capabilities = {
    localProviderKeys: true,
    clientIngestion: true,
    publicWidget: true,
  };
  readonly notes: string[] = [
    "Data is stored in this browser profile only. Nothing is uploaded anywhere.",
    "Provider keys are held client-side so direct provider calls can be made from this device. A hosted deployment must keep them on the server.",
  ];

  private db: Persisted;
  private chunks: RuntimeChunk[];
  private subscribers = new Set<{
    token: string;
    workspaceId: string;
    handler: (event: BackendEvent) => void;
  }>();
  private saveTimer = 0;
  private persistFailed = false;

  constructor() {
    this.db = this.load();
    this.chunks = this.db.chunks.map((chunk) => ({
      id: chunk.id,
      workspaceId: chunk.workspaceId,
      knowledgeBaseId: chunk.knowledgeBaseId,
      documentId: chunk.documentId,
      index: chunk.index,
      content: chunk.content,
      tokens: chunk.tokens,
      vector: unpackVector(chunk.vector),
    }));
    this.isolateResults();
    this.watchStorage();
  }

  /**
   * Every public method returns a deep copy. Handing out the live records let
   * React state share objects with the store, so in-place edits were invisible
   * to memoised components (e.g. the "unsaved changes" bar never cleared).
   */
  private isolateResults() {
    const wrap = <T extends object>(api: T): T => {
      const out = {} as Record<string, unknown>;
      for (const [key, value] of Object.entries(api)) {
        out[key] =
          typeof value === "function"
            ? async (...args: unknown[]) => {
                const result = await (value as (...a: unknown[]) => unknown)(...args);
                return result === undefined ? result : structuredClone(result);
              }
            : value;
      }
      return out as T;
    };
    this.auth = wrap(this.auth);
    this.workspaces = wrap(this.workspaces);
    this.assistants = wrap(this.assistants);
    this.knowledge = wrap(this.knowledge);
    this.providers = wrap(this.providers);
    this.playground = wrap(this.playground);
    this.conversations = wrap(this.conversations);
    this.analytics = wrap(this.analytics);
    this.widget = wrap(this.widget);
  }

  /** Several tabs/iframes share one localStorage: pick up their writes and flush ours on exit. */
  private watchStorage() {
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", () => {
      if (this.saveTimer) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
        this.save();
      }
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || this.saveTimer) return;
      this.db = this.load();
      this.chunks = this.db.chunks.map((chunk) => ({ ...chunk, vector: unpackVector(chunk.vector) }));
      clearLexicalCache();
      const workspaceIds = new Set([...this.subscribers].map((entry) => entry.workspaceId));
      for (const workspaceId of workspaceIds) {
        this.emit({ type: "assistants.changed", workspaceId });
        this.emit({ type: "knowledge.changed", workspaceId });
        this.emit({ type: "documents.changed", workspaceId, knowledgeBaseId: "*" });
        this.emit({ type: "activity.changed", workspaceId });
      }
    });
  }

  /* ------------------------------------------------------------- persistence */

  private load(): Persisted {
    if (typeof localStorage === "undefined") return emptyDatabase();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyDatabase();
      const parsed = JSON.parse(raw) as Persisted;
      if (!parsed || parsed.version > DB_VERSION) return emptyDatabase();
      const merged = { ...emptyDatabase(), ...parsed };
      return parsed.version < DB_VERSION ? migrateLegacyBrand(merged) : merged;
    } catch {
      return emptyDatabase();
    }
  }

  private save = () => {
    if (typeof localStorage === "undefined") return;
    try {
      const payload: Persisted = {
        ...this.db,
        chunks: this.chunks.map((chunk) => ({
          id: chunk.id,
          workspaceId: chunk.workspaceId,
          knowledgeBaseId: chunk.knowledgeBaseId,
          documentId: chunk.documentId,
          index: chunk.index,
          content: chunk.content,
          tokens: chunk.tokens,
          vector: packVector(chunk.vector),
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      this.persistFailed = false;
    } catch (error) {
      if (!this.persistFailed) {
        this.persistFailed = true;
        this.notes.push(
          "Browser storage is full, so the newest changes may not survive a reload. Remove documents or clear the sample data.",
        );
        console.warn("[parsis] could not persist local data", error);
      }
    }
  };

  /** Coalesce bursts of writes (an ingestion emits several status changes). */
  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      this.save();
    }, 120);
  }

  private emit(event: BackendEvent) {
    for (const entry of this.subscribers) {
      if (entry.workspaceId !== event.workspaceId) continue;
      try {
        entry.handler(event);
      } catch (error) {
        console.warn("[parsis] subscriber failed", error);
      }
    }
  }

  subscribe(token: string, workspaceId: string, handler: (event: BackendEvent) => void) {
    const entry = { token, workspaceId, handler };
    this.subscribers.add(entry);
    return () => this.subscribers.delete(entry);
  }

  /* -------------------------------------------------------------- principals */

  private sessionOf(token: string) {
    const session = this.db.sessions.find((entry) => entry.token === token);
    if (!session) throw new Error("Your session has expired. Sign in again.");
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.db.sessions = this.db.sessions.filter((entry) => entry.token !== token);
      this.scheduleSave();
      throw new Error("Your session has expired. Sign in again.");
    }
    return session;
  }

  private userOf(token: string) {
    const session = this.sessionOf(token);
    const user = this.db.users.find((entry) => entry.id === session.userId);
    if (!user) throw new Error("Account not found for this session.");
    return user;
  }

  /** Workspace access check — the tenancy boundary. */
  private assertWorkspace(token: string, workspaceId: string) {
    const user = this.userOf(token);
    const workspace = this.db.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    const member = this.db.memberships.some(
      (entry) => entry.workspaceId === workspaceId && entry.userId === user.id,
    );
    if (!member) throw new Error("You do not have access to this workspace.");
    return { user, workspace };
  }

  private workspacesFor(token: string) {
    const user = this.userOf(token);
    const ids = this.db.memberships
      .filter((entry) => entry.userId === user.id)
      .map((entry) => entry.workspaceId);
    return this.db.workspaces
      .filter((workspace) => ids.includes(workspace.id))
      .sort((a, b) => Number(b.isSample) - Number(a.isSample) || a.name.localeCompare(b.name));
  }

  /** Assistant access check, routed through the owning workspace. */
  private findAssistant(token: string, assistantId: string) {
    const assistant = this.db.assistants.find((entry) => entry.id === assistantId);
    if (!assistant) throw new Error("Assistant not found.");
    this.assertWorkspace(token, assistant.workspaceId);
    return assistant;
  }

  private findDocument(token: string, documentId: string) {
    const document = this.db.documents.find((entry) => entry.id === documentId);
    if (!document) throw new Error("Document not found.");
    this.assertWorkspace(token, document.workspaceId);
    return document;
  }

  private findKnowledgeBase(token: string, knowledgeBaseId: string) {
    const knowledgeBase = this.db.knowledgeBases.find((entry) => entry.id === knowledgeBaseId);
    if (!knowledgeBase) throw new Error("Knowledge base not found.");
    this.assertWorkspace(token, knowledgeBase.workspaceId);
    return knowledgeBase;
  }

  /* ---------------------------------------------------------------- activity */

  private recordActivity(
    workspaceId: string,
    entry: Omit<ActivityEntry, "id" | "workspaceId" | "at" | "actor" | "isSample">,
    actor = "You",
    isSample = false,
  ) {
    this.db.activity.unshift({
      id: randomId("act"),
      workspaceId,
      at: nowIso(),
      actor,
      isSample,
      ...entry,
    });
    if (this.db.activity.length > 600) this.db.activity.length = 600;
  }    /** Sample records are attributed to Parsis Bridge rather than the current user. */
  private isSampleWorkspace(workspaceId: string) {
    return this.db.workspaces.find((entry) => entry.id === workspaceId)?.isSample ?? false;
  }

  private activityActor(workspaceId: string) {
    return this.isSampleWorkspace(workspaceId) ? "Parsis Bridge (sample)" : "You";
  }

  private trimQueryLog() {
    if (this.db.queryLog.length > 5000) this.db.queryLog.splice(0, this.db.queryLog.length - 5000);
  }

  private recordEvent(event: Omit<UsageEvent, "id" | "at" | "isSample">, isSample = false) {
    this.db.events.push({ id: randomId("evt"), at: nowIso(), isSample, ...event });
    if (this.db.events.length > 20_000) this.db.events.splice(0, this.db.events.length - 20_000);
  }

  private refreshAssistantStats(assistantId: string) {
    const assistant = this.db.assistants.find((entry) => entry.id === assistantId);
    if (!assistant) return;
    const conversations = this.db.conversations.filter((entry) => entry.assistantId === assistantId);
    const events = this.db.events.filter((entry) => entry.assistantId === assistantId);
    const conversationIds = new Set(conversations.map((entry) => entry.id));
    const messages = this.db.messages.filter((entry) => conversationIds.has(entry.conversationId));
    const latencies = events.filter((entry) => entry.latencyMs > 0).map((entry) => entry.latencyMs);
    assistant.stats = {
      conversations: conversations.length,
      messages: messages.length,
      tokensUsed: events.reduce((sum, entry) => sum + entry.promptTokens + entry.completionTokens, 0),
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
        : 0,
      lastActivityAt: conversations.length
        ? conversations
            .map((entry) => entry.updatedAt)
            .sort()
            .at(-1) ?? null
        : null,
    };
  }

  /* -------------------------------------------------------------- retrieval */

  private assistantChunks(assistant: Assistant): Chunk[] {
    if (assistant.knowledgeBaseIds.length === 0) return [];
    return this.chunks.filter(
      (chunk) =>
        chunk.workspaceId === assistant.workspaceId &&
        assistant.knowledgeBaseIds.includes(chunk.knowledgeBaseId),
    );
  }

  private kbNameMap(workspaceId: string) {
    return new Map(
      this.db.knowledgeBases
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => [entry.id, entry.name]),
    );
  }

  private documentNameMap(workspaceId: string) {
    return new Map(
      this.db.documents
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => [entry.id, entry.name]),
    );
  }

  /** Provider key records never leave the data layer with the secret attached. */
  private safeKey(record: ProviderKeyRecord & { secret?: string }): ProviderKeyRecord {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      provider: record.provider,
      maskedKey: record.maskedKey,
      status: record.status,
      baseUrl: record.baseUrl,
      lastCheckedAt: record.lastCheckedAt,
      note: record.note,
      updatedAt: record.updatedAt,
    };
  }

  private credentialsFor(workspaceId: string): (provider: ProviderId) => Credentials | undefined {
    return (provider: ProviderId) => {
      const record = this.db.providerKeys.find(
        (entry) => entry.workspaceId === workspaceId && entry.provider === provider,
      );
      if (!record?.secret) return undefined;
      return { apiKey: record.secret, baseUrl: record.baseUrl };
    };
  }

  /* ------------------------------------------------------------------- auth */

  async signUp(input: { name: string; email: string; password: string }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("Enter a valid email address.");
    if (input.password.length < 8) throw new Error("Use at least 8 characters for your password.");
    if (this.db.users.some((user) => user.email === email)) {
      throw new Error("An account with that email already exists. Sign in instead.");
    }

    const salt = randomId("salt");
    const user: StoredUser = {
      id: randomId("usr"),
      email,
      name: input.name.trim() || email.split("@")[0],
      role: "owner",
      createdAt: nowIso(),
      salt,
      passwordHash: await hashPassword(input.password, salt),
    };

    this.db.users.push(user);

    const personal: Workspace = {
      id: randomId("wsp"),
      name: `${user.name.split(" ")[0]}'s workspace`,
      slug: `ws-${user.id.slice(-6)}`,
      plan: "trial",
      ownerId: user.id,
      memberIds: [user.id],
      isSample: false,
      createdAt: nowIso(),
    };
    const sample: Workspace = {
      id: randomId("wsp"),
      name: "Forge Labs (sample)",
      slug: `sample-${user.id.slice(-6)}`,
      plan: "scale",
      ownerId: user.id,
      memberIds: [user.id],
      isSample: true,
      createdAt: nowIso(),
    };
    this.db.workspaces.push(personal, sample);
    for (const workspace of [personal, sample]) {
      this.db.memberships.push({
        workspaceId: workspace.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: "owner",
        joinedAt: nowIso(),
      });
    }

    this.recordActivity(
      personal.id,
      { kind: "workspace.created", summary: `Workspace "${personal.name}" created`, detail: "Owner: " + user.email },
      user.name,
    );

    await this.seedSampleWorkspace(sample);
    this.save();

    const session = this.createSession(user.id);
    return { session, workspace: personal, workspaces: this.workspacesFor(session.token) };
  }

  async signIn(input: { email: string; password: string }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const user = this.db.users.find((entry) => entry.email === email);
    if (!user) throw new Error("No account found for that email on this device.");
    const hash = await hashPassword(input.password, user.salt);
    if (hash !== user.passwordHash) throw new Error("That password does not match.");
    const session = this.createSession(user.id);
    // A user whose last workspace was deleted would otherwise be stuck on a loading screen.
    if (this.workspacesFor(session.token).length === 0) {
      await this.createWorkspace(session.token, { name: `${user.name.split(" ")[0]}'s workspace` });
      this.save();
    }
    const workspaces = this.workspacesFor(session.token);
    return { session, workspace: workspaces[0], workspaces };
  }

  private createSession(userId: string): Session {
    const user = this.db.users.find((entry) => entry.id === userId)!;
    const token = randomId("tok") + randomId("s");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    const now = Date.now();
    this.db.sessions = this.db.sessions.filter((entry) => new Date(entry.expiresAt).getTime() > now);
    this.db.sessions.push({ token, userId, expiresAt, createdAt: nowIso() });
    this.save();
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* session simply will not survive a reload */
    }
    return { token, user: this.publicUser(user), expiresAt };
  }

  async restore(token?: string): Promise<AuthResult | null> {
    let candidate = token;
    if (!candidate) {
      try {
        candidate = localStorage.getItem(TOKEN_KEY) ?? undefined;
      } catch {
        candidate = undefined;
      }
    }
    if (!candidate) return null;
    try {
      const session = this.sessionOf(candidate);
      const user = this.db.users.find((entry) => entry.id === session.userId);
      if (!user) return null;
      const workspaces = this.workspacesFor(candidate);
      if (workspaces.length === 0) return null;
      return {
        session: { token: candidate, user: this.publicUser(user), expiresAt: session.expiresAt },
        workspace: workspaces[0],
        workspaces,
      };
    } catch {
      return null;
    }
  }

  async signOut(token: string): Promise<void> {
    this.db.sessions = this.db.sessions.filter((entry) => entry.token !== token);
    this.subscribers = new Set([...this.subscribers].filter((entry) => entry.token !== token));
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    this.save();
  }

  /** Strip credential material before a user object leaves the data layer. */
  private publicUser(user: StoredUser): User {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      ...(user.image ? { image: user.image } : {}),
      createdAt: user.createdAt,
    };
  }

  /** Persist profile edits (display name, picture) for the signed-in account. */
  async updateProfile(token: string, patch: ProfilePatch): Promise<User> {
    const user = this.userOf(token);

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0) throw new Error("Enter a display name.");
      if (name.length > 80) throw new Error("Keep the display name under 80 characters.");
      user.name = name;
      // The member directory is a projection of the account, so keep it in step.
      for (const membership of this.db.memberships) {
        if (membership.userId === user.id) membership.name = name;
      }
    }

    if (patch.image !== undefined) {
      const image = patch.image.trim();
      if (image && !/^(https:\/\/|data:image\/)/.test(image)) {
        throw new Error("That picture is not a valid image URL.");
      }
      // Stored as-is: the picture lives with the rest of this device's data.
      user.image = image || undefined;
    }

    this.save();
    return this.publicUser(user);
  }

  /* ------------------------------------------------------------- workspaces */

  auth = {
    signUp: (input: { name: string; email: string; password: string }) => this.signUp(input),
    signIn: (input: { email: string; password: string }) => this.signIn(input),
    restore: (token?: string) => this.restore(token),
    signOut: (token: string) => this.signOut(token),
    updateProfile: (token: string, patch: ProfilePatch) => this.updateProfile(token, patch),
  };

  async listWorkspaces(token: string) {
    return this.workspacesFor(token);
  }

  async createWorkspace(token: string, input: { name: string; plan?: Workspace["plan"] }) {
    const user = this.userOf(token);
    const workspace: Workspace = {
      id: randomId("wsp"),
      name: input.name.trim() || "Untitled workspace",
      slug: `ws-${Math.random().toString(36).slice(2, 8)}`,
      plan: input.plan ?? "trial",
      ownerId: user.id,
      memberIds: [user.id],
      isSample: false,
      createdAt: nowIso(),
    };
    this.db.workspaces.push(workspace);
    this.db.memberships.push({
      workspaceId: workspace.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: "owner",
      joinedAt: nowIso(),
    });
    this.recordActivity(workspace.id, { kind: "workspace.created", summary: `Workspace "${workspace.name}" created` }, user.name);
    this.scheduleSave();
    return workspace;
  }

  async updateWorkspace(token: string, workspaceId: string, patch: Partial<Pick<Workspace, "name" | "plan">>) {
    const { workspace } = this.assertWorkspace(token, workspaceId);
    const clean = { ...patch };
    if (typeof clean.name === "string") {
      clean.name = clean.name.trim();
      if (!clean.name) delete clean.name;
    }
    Object.assign(workspace, clean);
    this.emit({ type: "knowledge.changed", workspaceId });
    this.scheduleSave();
    return workspace;
  }

  async removeWorkspace(token: string, workspaceId: string) {
    const { workspace } = this.assertWorkspace(token, workspaceId);
    const documentIds = this.db.documents
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => entry.id);

    this.db.workspaces = this.db.workspaces.filter((entry) => entry.id !== workspace.id);
    this.db.memberships = this.db.memberships.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.assistants = this.db.assistants.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.knowledgeBases = this.db.knowledgeBases.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.documents = this.db.documents.filter((entry) => entry.workspaceId !== workspaceId);
    this.chunks = this.chunks.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.providerKeys = this.db.providerKeys.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.events = this.db.events.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.queryLog = this.db.queryLog.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.activity = this.db.activity.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.conversations = this.db.conversations.filter((entry) => entry.workspaceId !== workspaceId);
    this.db.messages = this.db.messages.filter((entry) => entry.workspaceId !== workspaceId);
    for (const id of documentIds) delete this.db.documentTexts[id];
    this.save();
  }

  async listMembers(token: string, workspaceId: string) {
    this.assertWorkspace(token, workspaceId);
    return this.db.memberships.filter((entry) => entry.workspaceId === workspaceId);
  }

  workspaces = {
    list: (token: string) => this.listWorkspaces(token),
    create: (token: string, input: { name: string; plan?: Workspace["plan"] }) =>
      this.createWorkspace(token, input),
    update: (token: string, workspaceId: string, patch: Partial<Pick<Workspace, "name" | "plan">>) =>
      this.updateWorkspace(token, workspaceId, patch),
    remove: (token: string, workspaceId: string) => this.removeWorkspace(token, workspaceId),
    members: (token: string, workspaceId: string) => this.listMembers(token, workspaceId),
  };

  /* ------------------------------------------------------------- assistants */

  async listAssistants(token: string, workspaceId: string) {
    this.assertWorkspace(token, workspaceId);
    return this.db.assistants
      .filter((entry) => entry.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  assistants = {
    list: (token: string, workspaceId: string) => this.listAssistants(token, workspaceId),
    get: async (token: string, assistantId: string) => this.findAssistant(token, assistantId),
    create: async (token: string, workspaceId: string, draft: AssistantDraft) => {
      this.assertWorkspace(token, workspaceId);
      const assistant: Assistant = {
        ...structuredClone({ ...draft, ...sanitizePatch(draft) }),
        id: randomId("ast"),
        workspaceId,
        // Mirrors the HTTP API: a new assistant is immediately usable (the
        // public widget refuses drafts), while an explicit "paused" is honored.
        status: draft.status === "paused" ? "paused" : "active",
        publicKey: `pk_${randomId("pub").slice(4)}`,
        stats: { conversations: 0, messages: 0, tokensUsed: 0, avgLatencyMs: 0, lastActivityAt: null },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.db.assistants.push(assistant);
      this.recordActivity(
        workspaceId,
        { kind: "assistant.created", summary: `Assistant "${assistant.name}" created`, detail: `${assistant.model.provider} · ${assistant.model.model}` },
      );
      this.emit({ type: "assistants.changed", workspaceId });
      this.emit({ type: "activity.changed", workspaceId });
      this.save();
      return assistant;
    },
    update: async (token: string, assistantId: string, patch: Partial<AssistantDraft>) => {
      const assistant = this.findAssistant(token, assistantId);
      patch = sanitizePatch(patch);
      const modelIdentityChanged =
        patch.model &&
        (patch.model.provider !== assistant.model.provider ||
          patch.model.model !== assistant.model.model);
      Object.assign(assistant, structuredClone(patch), { updatedAt: nowIso() });
      if (assistant.status === "draft" && modelIdentityChanged) assistant.status = "active";
      this.recordActivity(
        assistant.workspaceId,
        { kind: "assistant.updated", summary: `Assistant "${assistant.name}" updated`, detail: Object.keys(patch).join(", ") },
      );
      this.emit({ type: "assistants.changed", workspaceId: assistant.workspaceId });
      this.emit({ type: "activity.changed", workspaceId: assistant.workspaceId });
      this.save();
      return assistant;
    },
    duplicate: async (token: string, assistantId: string) => {
      const assistant = this.findAssistant(token, assistantId);
      const copy: Assistant = {
        ...structuredClone(assistant),
        id: randomId("ast"),
        name: `${assistant.name} copy`,
        publicKey: `pk_${randomId("pub").slice(4)}`,
        stats: { conversations: 0, messages: 0, tokensUsed: 0, avgLatencyMs: 0, lastActivityAt: null },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.db.assistants.push(copy);
      this.recordActivity(assistant.workspaceId, {
        kind: "assistant.created",
        summary: `Assistant "${copy.name}" duplicated from "${assistant.name}"`,
      });
      this.emit({ type: "assistants.changed", workspaceId: assistant.workspaceId });
      this.save();
      return copy;
    },
    remove: async (token: string, assistantId: string) => {
      const assistant = this.findAssistant(token, assistantId);
      this.db.assistants = this.db.assistants.filter((entry) => entry.id !== assistantId);
      const conversations = this.db.conversations.filter((entry) => entry.assistantId === assistantId);
      this.db.conversations = this.db.conversations.filter((entry) => entry.assistantId !== assistantId);
      const conversationIds = conversations.map((entry) => entry.id);
      this.db.messages = this.db.messages.filter((entry) => !conversationIds.includes(entry.conversationId));
      this.recordActivity(assistant.workspaceId, {
        kind: "assistant.deleted",
        summary: `Assistant "${assistant.name}" deleted`,
      });
      this.emit({ type: "assistants.changed", workspaceId: assistant.workspaceId });
      this.save();
    },
  };

  /* -------------------------------------------------------------- knowledge */

  knowledge = {
    list: async (token: string, workspaceId: string) => {
      this.assertWorkspace(token, workspaceId);
      return this.db.knowledgeBases
        .filter((entry) => entry.workspaceId === workspaceId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    create: async (token: string, workspaceId: string, input: { name: string; description: string }) => {
      this.assertWorkspace(token, workspaceId);
      const knowledgeBase: KnowledgeBase = {
        id: randomId("kb"),
        workspaceId,
        name: input.name.trim() || "Untitled knowledge base",
        description: input.description.trim(),
        documentCount: 0,
        chunkCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.db.knowledgeBases.push(knowledgeBase);
      this.recordActivity(workspaceId, {
        kind: "knowledge.created",
        summary: `Knowledge base "${knowledgeBase.name}" created`,
      });
      this.emit({ type: "knowledge.changed", workspaceId });
      this.save();
      return knowledgeBase;
    },
    update: async (
      token: string,
      knowledgeBaseId: string,
      patch: Partial<Pick<KnowledgeBase, "name" | "description">>,
    ) => {
      const knowledgeBase = this.findKnowledgeBase(token, knowledgeBaseId);
      const clean = { ...patch };
      if (typeof clean.name === "string") {
        clean.name = clean.name.trim();
        if (!clean.name) delete clean.name;
      }
      if (typeof clean.description === "string") clean.description = clean.description.trim();
      Object.assign(knowledgeBase, clean, { updatedAt: nowIso() });
      this.emit({ type: "knowledge.changed", workspaceId: knowledgeBase.workspaceId });
      this.save();
      return knowledgeBase;
    },
    remove: async (token: string, knowledgeBaseId: string) => {
      const knowledgeBase = this.findKnowledgeBase(token, knowledgeBaseId);
      const { workspaceId } = knowledgeBase;
      const documentIds = this.db.documents
        .filter((entry) => entry.knowledgeBaseId === knowledgeBaseId)
        .map((entry) => entry.id);

      this.db.knowledgeBases = this.db.knowledgeBases.filter((entry) => entry.id !== knowledgeBaseId);
      this.db.documents = this.db.documents.filter((entry) => entry.knowledgeBaseId !== knowledgeBaseId);
      this.chunks = this.chunks.filter((entry) => entry.knowledgeBaseId !== knowledgeBaseId);
      for (const id of documentIds) delete this.db.documentTexts[id];
      for (const assistant of this.db.assistants) {
        if (assistant.knowledgeBaseIds.includes(knowledgeBaseId)) {
          assistant.knowledgeBaseIds = assistant.knowledgeBaseIds.filter((id) => id !== knowledgeBaseId);
          assistant.updatedAt = nowIso();
        }
      }
      this.recordActivity(workspaceId, {
        kind: "document.deleted",
        summary: `Knowledge base "${knowledgeBase.name}" deleted`,
        detail: `${documentIds.length} document(s) removed`,
      });
      this.emit({ type: "knowledge.changed", workspaceId });
      this.emit({ type: "assistants.changed", workspaceId });
      this.emit({ type: "documents.changed", workspaceId, knowledgeBaseId });
      this.save();
    },
    documents: async (token: string, knowledgeBaseId: string) => {
      this.findKnowledgeBase(token, knowledgeBaseId);
      return this.db.documents
        .filter((entry) => entry.knowledgeBaseId === knowledgeBaseId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    addText: async (
      token: string,
      input: { knowledgeBaseId: string; name: string; content: string; embedding: EmbeddingConfig },
    ) => {
      const knowledgeBase = this.findKnowledgeBase(token, input.knowledgeBaseId);
      const record = this.createDocument({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        name: input.name.trim() || "Pasted text",
        source: "text",
        mimeType: "text/plain",
        content: input.content,
        embedding: input.embedding,
      });
      void this.processDocument(record.id, input.embedding);
      return record;
    },
    addFile: async (
      token: string,
      input: { knowledgeBaseId: string; file: FilePayload; embedding: EmbeddingConfig },
    ) => {
      const knowledgeBase = this.findKnowledgeBase(token, input.knowledgeBaseId);
      if (!isBrowserReadableFile(input.file.name)) {
        throw new Error(
          `${input.file.name} is not a supported file type. Upload PDF, DOCX, plain text, Markdown, CSV, JSON, YAML or HTML — or paste the text with "Add text".`,
        );
      }
      if (!input.file.text.trim()) {
        throw new Error(`No readable text was found in ${input.file.name}.`);
      }
      const record = this.createDocument({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        name: input.file.name,
        source: "file",
        mimeType: input.file.type || "text/plain",
        content: /\.html?$/i.test(input.file.name) ? htmlToText(input.file.text) : input.file.text,
        sizeBytes: input.file.size,
        embedding: input.embedding,
      });
      void this.processDocument(record.id, input.embedding);
      return record;
    },
    addUrl: async (
      token: string,
      input: { knowledgeBaseId: string; url: string; embedding: EmbeddingConfig },
    ) => {
      const knowledgeBase = this.findKnowledgeBase(token, input.knowledgeBaseId);
      let url: URL;
      try {
        url = new URL(input.url.trim());
      } catch {
        throw new Error("Enter a full URL including https://");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only http:// and https:// addresses can be imported.");
      }

      const record = this.createDocument({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        name: url.hostname + url.pathname,
        source: "url",
        sourceUrl: url.toString(),
        mimeType: "text/html",
        content: "",
        embedding: input.embedding,
      });
      void this.fetchAndProcessUrl(record.id, url.toString(), input.embedding);
      return record;
    },
    updateDocument: async (
      token: string,
      documentId: string,
      input: { name?: string; content?: string; embedding?: EmbeddingConfig },
    ) => {
      const document = this.findDocument(token, documentId);
      if (input.name !== undefined && input.name.trim()) document.name = input.name.trim();
      if (input.content !== undefined) {
        this.db.documentTexts[document.id] = input.content;
        document.characters = input.content.length;
        document.sizeBytes = new TextEncoder().encode(input.content).length;
      }
      document.updatedAt = nowIso();
      const embedding = input.embedding ?? {
        provider: document.embeddingProvider,
        model: document.embeddingModel,
        dimensions:
          modelsFor(document.embeddingProvider, "embedding").find((m) => m.id === document.embeddingModel)
            ?.dimensions ?? 384,
        chunkSize: 900,
        chunkOverlap: 150,
      };
      this.scheduleSave();
      if (input.content !== undefined) {
        void this.processDocument(document.id, embedding);
      } else {
        this.emit({ type: "documents.changed", workspaceId: document.workspaceId, knowledgeBaseId: document.knowledgeBaseId });
      }
      return document;
    },
    documentContent: async (token: string, documentId: string) => {
      const document = this.findDocument(token, documentId);
      return this.db.documentTexts[document.id] ?? "";
    },
    removeDocument: async (token: string, documentId: string) => {
      const document = this.findDocument(token, documentId);
      this.db.documents = this.db.documents.filter((entry) => entry.id !== documentId);
      this.chunks = this.chunks.filter((entry) => entry.documentId !== documentId);
      delete this.db.documentTexts[documentId];
      this.recount(document.knowledgeBaseId);
      this.recordActivity(document.workspaceId, {
        kind: "document.deleted",
        summary: `Document "${document.name}" deleted`,
      });
      this.emit({ type: "documents.changed", workspaceId: document.workspaceId, knowledgeBaseId: document.knowledgeBaseId });
      this.emit({ type: "activity.changed", workspaceId: document.workspaceId });
      this.save();
    },
    removeAllDocuments: async (token: string, knowledgeBaseId: string) => {
      const knowledgeBase = this.findKnowledgeBase(token, knowledgeBaseId);
      const removed = this.db.documents.filter((entry) => entry.knowledgeBaseId === knowledgeBaseId);
      this.db.documents = this.db.documents.filter((entry) => entry.knowledgeBaseId !== knowledgeBaseId);
      this.chunks = this.chunks.filter((entry) => entry.knowledgeBaseId !== knowledgeBaseId);
      for (const document of removed) delete this.db.documentTexts[document.id];
      this.recount(knowledgeBaseId);
      this.recordActivity(knowledgeBase.workspaceId, {
        kind: "document.deleted",
        summary: `All documents removed from "${knowledgeBase.name}"`,
        detail: `${removed.length} document(s)`,
      });
      this.emit({ type: "documents.changed", workspaceId: knowledgeBase.workspaceId, knowledgeBaseId });
      this.save();
    },
    reindex: async (token: string, knowledgeBaseId: string, embedding: EmbeddingConfig) => {
      const knowledgeBase = this.findKnowledgeBase(token, knowledgeBaseId);
      const documents = this.db.documents.filter((entry) => entry.knowledgeBaseId === knowledgeBaseId);
      for (const document of documents) {
        await this.processDocument(document.id, embedding);
      }
      this.emit({ type: "documents.changed", workspaceId: knowledgeBase.workspaceId, knowledgeBaseId });
    },
  };

  private createDocument(input: {
    workspaceId: string;
    knowledgeBaseId: string;
    name: string;
    source: DocumentSource;
    sourceUrl?: string;
    mimeType: string;
    content: string;
    sizeBytes?: number;
    embedding: EmbeddingConfig;
  }): DocumentRecord {
    const record: DocumentRecord = {
      id: randomId("doc"),
      workspaceId: input.workspaceId,
      knowledgeBaseId: input.knowledgeBaseId,
      name: input.name,
      source: input.source,
      sourceUrl: input.sourceUrl,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes ?? input.content.length,
      characters: input.content.length,
      status: "uploading",
      progress: 0.05,
      chunkCount: 0,
      tokenEstimate: 0,
      embeddingProvider: input.embedding.provider,
      embeddingModel: input.embedding.model,
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      indexedAt: null,
    };
    this.db.documents.push(record);
    this.db.documentTexts[record.id] = input.content;
    this.recount(input.knowledgeBaseId);
    this.recordActivity(
      input.workspaceId,
      {
        kind: "document.added",
        summary: `Document "${record.name}" added`,
        detail: input.source === "url" ? input.sourceUrl : `${input.source} · ${input.embedding.provider}`,
      },
      this.activityActor(input.workspaceId),
      this.isSampleWorkspace(input.workspaceId),
    );
    this.emit({ type: "documents.changed", workspaceId: input.workspaceId, knowledgeBaseId: input.knowledgeBaseId });
    this.emit({ type: "activity.changed", workspaceId: input.workspaceId });
    this.scheduleSave();
    return record;
  }

  private recount(knowledgeBaseId: string) {
    const knowledgeBase = this.db.knowledgeBases.find((entry) => entry.id === knowledgeBaseId);
    if (!knowledgeBase) return;
    const documents = this.db.documents.filter((entry) => entry.knowledgeBaseId === knowledgeBaseId);
    knowledgeBase.documentCount = documents.length;
    knowledgeBase.chunkCount = this.chunks.filter((entry) => entry.knowledgeBaseId === knowledgeBaseId).length;
    knowledgeBase.updatedAt = nowIso();
  }

  private updateDocumentStatus(
    documentId: string,
    patch: Partial<DocumentRecord>,
  ) {
    const document = this.db.documents.find((entry) => entry.id === documentId);
    if (!document) return;
    Object.assign(document, patch, { updatedAt: nowIso() });
    this.emit({
      type: "documents.changed",
      workspaceId: document.workspaceId,
      knowledgeBaseId: document.knowledgeBaseId,
    });
    this.scheduleSave();
  }

  /** The ingestion worker: chunk → embed → index, with real state transitions. */
  private runs = new Map<string, number>();

  private async processDocument(documentId: string, embedding: EmbeddingConfig) {
    const document = this.db.documents.find((entry) => entry.id === documentId);
    if (!document) return;
    // A newer run for the same document supersedes this one.
    const runId = (this.runs.get(documentId) ?? 0) + 1;
    this.runs.set(documentId, runId);
    const stale = () =>
      this.runs.get(documentId) !== runId || !this.db.documents.some((entry) => entry.id === documentId);
    const text = this.db.documentTexts[documentId] ?? "";
    const workspaceId = document.workspaceId;

    // A re-index replaces the previous vectors atomically at the end.
    try {
      this.updateDocumentStatus(documentId, { status: "processing", progress: 0.12, error: null });
      await yieldToUi();

      this.updateDocumentStatus(documentId, { status: "chunking", progress: 0.25 });
      await yieldToUi();

      const result = await ingestText({
        text,
        embedding,
        getCredentials: this.credentialsFor(workspaceId),
        onStage: (event: IngestStageEvent) => {
          this.updateDocumentStatus(documentId, {
            status: event.stage,
            progress: 0.25 + event.progress * 0.6,
          });
        },
      });

      // The document may have been deleted or re-processed while embedding ran.
      if (stale()) return;

      const nextChunks: RuntimeChunk[] = result.chunks.map((chunk, index) => ({
        id: randomId("chk"),
        workspaceId,
        knowledgeBaseId: document.knowledgeBaseId,
        documentId,
        index,
        content: chunk.content,
        tokens: chunk.tokens,
        vector: chunk.vector,
      }));

      this.updateDocumentStatus(documentId, { status: "indexing", progress: 0.94 });
      await yieldToUi();
      if (stale()) return;

      this.chunks = this.chunks.filter((entry) => entry.documentId !== documentId);
      this.chunks.push(...nextChunks);

      this.updateDocumentStatus(documentId, {
        status: "indexed",
        progress: 1,
        chunkCount: nextChunks.length,
        tokenEstimate: nextChunks.reduce((sum, chunk) => sum + chunk.tokens, 0),
        characters: text.length,
        embeddingProvider: result.embeddingProvider as ProviderId,
        embeddingModel: result.embeddingModel,
        indexedAt: nowIso(),
        error: null,
      });
      this.recount(document.knowledgeBaseId);
      this.recordActivity(
        document.workspaceId,
        {
          kind: "document.indexed",
          summary: `"${document.name}" indexed`,
          detail: `${nextChunks.length} passages · ${result.embeddingModel} · ${result.durationMs} ms`,
        },
        this.activityActor(document.workspaceId),
        this.isSampleWorkspace(document.workspaceId),
      );
      this.recordEvent(
        {
          workspaceId: document.workspaceId,
          assistantId: null,
          kind: "ingest",
          latencyMs: result.durationMs,
          promptTokens: 0,
          completionTokens: 0,
          provider: result.embeddingProvider as ProviderId,
          model: result.embeddingModel,
          retrievedCount: nextChunks.length,
          topScore: null,
        },
        this.isSampleWorkspace(document.workspaceId),
      );
      this.emit({ type: "activity.changed", workspaceId: document.workspaceId });
    } catch (error) {
      if (stale()) return;
      const providerError = error instanceof ProviderError ? error : null;
      const message = providerError
        ? `${providerError.message}${providerError.hint ? ` — ${providerError.hint}` : ""}`
        : (error as Error).message;
      this.updateDocumentStatus(documentId, { status: "failed", progress: 0, error: message });
      this.recordActivity(
        document.workspaceId,
        {
          kind: "document.failed",
          summary: `"${document.name}" failed to index`,
          detail: message,
        },
        this.activityActor(document.workspaceId),
        this.isSampleWorkspace(document.workspaceId),
      );
      this.recordEvent(
        {
          workspaceId: document.workspaceId,
          assistantId: null,
          kind: "error",
          latencyMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          provider: embedding.provider,
          model: embedding.model,
          retrievedCount: 0,
          topScore: null,
        },
        this.isSampleWorkspace(document.workspaceId),
      );
      this.emit({ type: "activity.changed", workspaceId: document.workspaceId });
    } finally {
      this.save();
    }
  }

  private async fetchAndProcessUrl(documentId: string, url: string, embedding: EmbeddingConfig) {
    const document = this.db.documents.find((entry) => entry.id === documentId);
    if (!document) return;
    try {
      this.updateDocumentStatus(documentId, { status: "processing", progress: 0.12, error: null });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        throw new Error(`The site returned ${response.status} ${response.statusText}.`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const text = contentType.includes("html") || /<html/i.test(body.slice(0, 400))
        ? htmlToText(body)
        : body.trim();
      if (text.length < 40) {
        throw new Error("The page contained no readable text.");
      }
      if (!this.db.documents.some((entry) => entry.id === documentId)) return;
      this.db.documentTexts[documentId] = text;
      await this.processDocument(documentId, embedding);
    } catch (error) {
      const message =
        (error as Error)?.name === "AbortError"
          ? "The site did not respond within 30 seconds."
          : error instanceof TypeError
          ? "The browser could not fetch this URL (blocked by CORS or offline). Server-side ingestion is required to add pages from most external sites."
          : (error as Error).message;
      this.updateDocumentStatus(documentId, { status: "failed", progress: 0, error: message });
      this.recordActivity(
        document.workspaceId,
        {
          kind: "document.failed",
          summary: `"${document.name}" failed to index`,
          detail: message,
        },
        this.activityActor(document.workspaceId),
        this.isSampleWorkspace(document.workspaceId),
      );
      this.emit({ type: "activity.changed", workspaceId: document.workspaceId });
      this.save();
    }
  }

  /* -------------------------------------------------------------- providers */

  providers = {
    listKeys: async (token: string, workspaceId: string): Promise<ProviderKeyRecord[]> => {
      this.assertWorkspace(token, workspaceId);
      return this.db.providerKeys
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => this.safeKey(entry));
    },
    setKey: async (
      token: string,
      workspaceId: string,
      input: { provider: ProviderId; apiKey?: string; baseUrl?: string },
    ) => {
      this.assertWorkspace(token, workspaceId);
      const trimmed = input.apiKey?.trim() ?? "";
      // A local runtime such as Ollama needs an address, not a secret.
      const keyless = PROVIDER_MAP[input.provider]?.requiresKey === false;
      if (!trimmed && !keyless) throw new Error("Paste a key before saving.");
      if (!trimmed && keyless && !input.baseUrl?.trim() && !PROVIDER_MAP[input.provider]?.defaultBaseUrl) {
        throw new Error("Enter the address this runtime is served from.");
      }
      const existing = this.db.providerKeys.find(
        (entry) => entry.workspaceId === workspaceId && entry.provider === input.provider,
      );
      const record: ProviderKeyRecord & { secret?: string } = {
        id: existing?.id ?? randomId("key"),
        workspaceId,
        provider: input.provider,
        maskedKey: trimmed ? (trimmed.length > 8 ? `••••${trimmed.slice(-4)}` : "••••") : "no key required",
        status: "configured",
        baseUrl: input.baseUrl?.trim() || undefined,
        lastCheckedAt: null,
        note: null,
        updatedAt: nowIso(),
        ...(trimmed ? { secret: trimmed } : {}),
      };
      if (existing) {
        Object.assign(existing, record);
        // Replacing a key with a keyless configuration must not leave the old
        // secret behind for the browser to keep serving.
        if (!trimmed) delete (existing as { secret?: string }).secret;
      } else {
        this.db.providerKeys.push(record);
      }
      this.recordActivity(workspaceId, {
        kind: "provider.connected",
        summary: `${input.provider} key stored`,
        detail: record.maskedKey,
      });
      this.emit({ type: "knowledge.changed", workspaceId });
      this.save();
      return this.safeKey(record);
    },
    removeKey: async (token: string, workspaceId: string, provider: ProviderId) => {
      this.assertWorkspace(token, workspaceId);
      this.db.providerKeys = this.db.providerKeys.filter(
        (entry) => !(entry.workspaceId === workspaceId && entry.provider === provider),
      );
      this.emit({ type: "knowledge.changed", workspaceId });
      this.save();
    },
    markVerified: async (
      token: string,
      workspaceId: string,
      provider: ProviderId,
      result: { ok: boolean; message: string },
    ) => {
      this.assertWorkspace(token, workspaceId);
      const record = this.db.providerKeys.find(
        (entry) => entry.workspaceId === workspaceId && entry.provider === provider,
      );
      if (!record) throw new Error("Store a key before verifying it.");
      record.status = result.ok ? "verified" : "invalid";
      record.note = result.message;
      record.lastCheckedAt = nowIso();
      this.emit({ type: "knowledge.changed", workspaceId });
      this.save();
      return this.safeKey(record);
    },
    resolveCredentials: async (token: string, workspaceId: string) => {
      this.assertWorkspace(token, workspaceId);
      const out: Partial<Record<ProviderId, Credentials>> = {};
      for (const record of this.db.providerKeys) {
        if (record.workspaceId !== workspaceId || !record.secret) continue;
        out[record.provider] = { apiKey: record.secret, baseUrl: record.baseUrl };
      }
      return out;
    },
  };

  /* ------------------------------------------------------------- playground */

  playground = {
    query: async (token: string, request: QueryRequest): Promise<QueryResponse> => {
      const assistant = this.findAssistant(token, request.assistantId);
      const response = await answerQuestion({
        assistant,
        question: request.question,
        history: request.history,
        chunks: this.assistantChunks(assistant),
        kbNames: this.kbNameMap(assistant.workspaceId),
        documentNames: this.documentNameMap(assistant.workspaceId),
        getCredentials: this.credentialsFor(assistant.workspaceId),
        overrides: {
          topK: request.topKOverride,
          threshold: request.scoreThresholdOverride,
          temperature: request.temperatureOverride,
          strategy: request.strategyOverride,
        },
      });

      const usage = response.message.meta!;
      this.recordEvent({
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        kind: "query",
        latencyMs: usage.latencyMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        provider: usage.provider,
        model: usage.model,
        retrievedCount: usage.retrievedCount,
        topScore: usage.topScore,
      });
      this.db.queryLog.push({
        at: nowIso(),
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        query: request.question,
        topScore: usage.topScore,
        retrievedCount: usage.retrievedCount,
        latencyMs: usage.latencyMs,
        isSample: false,
      });
      this.trimQueryLog();
      this.recordActivity(assistant.workspaceId, {
        kind: "query.run",
        summary: `Playground query on "${assistant.name}"`,
        detail: `${usage.retrievedCount} passages · ${usage.latencyMs} ms · ${usage.mode === "model" ? usage.model : "extractive"}`,
      });
      this.touchConversation(assistant, request.question, response.message, "playground");
      this.emit({ type: "activity.changed", workspaceId: assistant.workspaceId });
      this.save();
      return response;
    },
    search: async (token: string, request: SearchRequest): Promise<SearchResponse> => {
      const assistant = this.findAssistant(token, request.assistantId);
      const started = performance.now();
      const embedder = createEmbedder(assistant.embedding, this.credentialsFor(assistant.workspaceId));
      const chunks = this.assistantChunks(assistant);
      const queryVector =
        request.strategy === "keyword" ? null : ((await embedder.embed([request.query], "query"))[0] ?? null);
      const { results, scanned } = searchChunks(chunks, request.query, {
        topK: request.topK,
        strategy: request.strategy,
        queryVector,
      });
      const kbNames = this.kbNameMap(assistant.workspaceId);
      const documentNames = this.documentNameMap(assistant.workspaceId);

      const latencyMs = Math.round(performance.now() - started);
      this.recordEvent({
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        kind: "query",
        latencyMs,
        promptTokens: 0,
        completionTokens: 0,
        provider: embedder.provider,
        model: embedder.model,
        retrievedCount: results.length,
        topScore: results[0]?.score ?? null,
      });
      this.db.queryLog.push({
        at: nowIso(),
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        query: request.query,
        topScore: results[0]?.score ?? null,
        retrievedCount: results.length,
        latencyMs,
        isSample: false,
      });
      this.save();

      return {
        results: results.map(({ chunk, score, vectorScore, keywordScore }) => ({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName: documentNames.get(chunk.documentId) ?? "Unknown document",
          knowledgeBaseId: chunk.knowledgeBaseId,
          knowledgeBaseName: kbNames.get(chunk.knowledgeBaseId) ?? "Knowledge base",
          index: chunk.index,
          content: chunk.content,
          score: Number(score.toFixed(4)),
          vectorScore: Number(vectorScore.toFixed(4)),
          keywordScore: Number(keywordScore.toFixed(4)),
          tokens: chunk.tokens,
        })),
        latencyMs,
        strategy: request.strategy,
        scannedChunks: scanned,
        embeddingProvider: embedder.provider,
        embeddingModel: embedder.model,
      };
    },
  };

  private touchConversation(
    assistant: Assistant,
    question: string,
    answer: ChatMessage,
    channel: Conversation["channel"],
  ) {
    const existing = this.db.conversations.find(
      (entry) => entry.assistantId === assistant.id && entry.channel === channel,
    );
    const conversation: Conversation =
      existing ??
      {
        id: randomId("cnv"),
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        title: question.slice(0, 60) || "New conversation",
        channel,
        messageCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    if (!existing) this.db.conversations.push(conversation);

    this.db.messages.push(
      {
        id: randomId("msg"),
        role: "user",
        content: question,
        createdAt: nowIso(),
        conversationId: conversation.id,
        workspaceId: assistant.workspaceId,
      },
      { ...answer, conversationId: conversation.id, workspaceId: assistant.workspaceId },
    );
    conversation.messageCount += 2;
    conversation.updatedAt = nowIso();
    this.refreshAssistantStats(assistant.id);
  }

  /* ---------------------------------------------------------- conversations */

  conversations = {
    list: async (token: string, workspaceId: string, assistantId?: string) => {
      this.assertWorkspace(token, workspaceId);
      return this.db.conversations
        .filter((entry) => entry.workspaceId === workspaceId)
        .filter((entry) => (assistantId ? entry.assistantId === assistantId : true))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    messages: async (token: string, conversationId: string) => {
      const conversation = this.db.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) throw new Error("Conversation not found.");
      this.assertWorkspace(token, conversation.workspaceId);
      return this.db.messages
        .filter((entry) => entry.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((entry) => ({
          id: entry.id,
          role: entry.role,
          content: entry.content,
          createdAt: entry.createdAt,
          retrieved: entry.retrieved,
          meta: entry.meta,
        }));
    },
    clear: async (token: string, workspaceId: string) => {
      this.assertWorkspace(token, workspaceId);
      const ids = this.db.conversations
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => entry.id);
      this.db.conversations = this.db.conversations.filter((entry) => entry.workspaceId !== workspaceId);
      this.db.messages = this.db.messages.filter((entry) => !ids.includes(entry.conversationId));
      for (const assistant of this.db.assistants) {
        if (assistant.workspaceId === workspaceId) this.refreshAssistantStats(assistant.id);
      }
      this.emit({ type: "assistants.changed", workspaceId });
      this.save();
    },
  };

  /* --------------------------------------------------------------- analytics */

  analytics = {
    overview: (token: string, workspaceId: string, range: AnalyticsSnapshot["range"]) =>
      this.analyticsOverview(token, workspaceId, range),
    activity: (token: string, workspaceId: string, limit?: number) =>
      this.listActivity(token, workspaceId, limit),
  };

  private async analyticsOverview(
    token: string,
    workspaceId: string,
    range: AnalyticsSnapshot["range"],
  ): Promise<AnalyticsSnapshot> {
    this.assertWorkspace(token, workspaceId);
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const today = new Date();
    const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));

    const events = this.db.events.filter(
      (entry) => entry.workspaceId === workspaceId && new Date(entry.at) >= since,
    );
    // Widget traffic is real usage: it counts in totals, not only in the chart.
    const queryEvents = events.filter((entry) => entry.kind === "query" || entry.kind === "widget_message");
    const latencies = queryEvents.map((entry) => entry.latencyMs).sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;

    const seriesMap = new Map<string, { queries: number; ingestions: number; tokens: number; errors: number }>();
    for (let i = 0; i < days; i += 1) {
      const date = localDayKey(new Date(since.getFullYear(), since.getMonth(), since.getDate() + i));
      seriesMap.set(date, { queries: 0, ingestions: 0, tokens: 0, errors: 0 });
    }
    for (const event of events) {
      const date = localDayKey(new Date(event.at));
      const bucket = seriesMap.get(date);
      if (!bucket) continue;
      if (event.kind === "query" || event.kind === "widget_message") bucket.queries += 1;
      if (event.kind === "ingest") bucket.ingestions += 1;
      if (event.kind === "error") bucket.errors += 1;
      bucket.tokens += event.promptTokens + event.completionTokens;
    }

    const providerMap = new Map<string, { provider: ProviderId; queries: number; tokens: number }>();
    for (const event of queryEvents) {
      if (!event.provider) continue;
      const entry = providerMap.get(event.provider) ?? { provider: event.provider, queries: 0, tokens: 0 };
      entry.queries += 1;
      entry.tokens += event.promptTokens + event.completionTokens;
      providerMap.set(event.provider, entry);
    }

    const assistantMap = new Map<string, { assistantId: string; name: string; queries: number; tokens: number }>();
    for (const event of queryEvents) {
      if (!event.assistantId) continue;
      const assistant = this.db.assistants.find((entry) => entry.id === event.assistantId);
      const entry =
        assistantMap.get(event.assistantId) ??
        { assistantId: event.assistantId, name: assistant?.name ?? "Deleted assistant", queries: 0, tokens: 0 };
      entry.queries += 1;
      entry.tokens += event.promptTokens + event.completionTokens;
      assistantMap.set(event.assistantId, entry);
    }

    const buckets = [
      { bucket: "< 500 ms", min: 0, max: 500 },
      { bucket: "0.5 – 1 s", min: 500, max: 1000 },
      { bucket: "1 – 2 s", min: 1000, max: 2000 },
      { bucket: "2 – 4 s", min: 2000, max: 4000 },
      { bucket: "≥ 4 s", min: 4000, max: Number.POSITIVE_INFINITY },
    ];
    const latencyBuckets = buckets.map((entry) => ({
      bucket: entry.bucket,
      count: latencies.filter((value) => value >= entry.min && value < entry.max).length,
    }));

    const queryCounts = new Map<string, { count: number; scoreSum: number; scoreCount: number }>();
    for (const entry of this.db.queryLog) {
      if (entry.workspaceId !== workspaceId || new Date(entry.at) < since) continue;
      const key = entry.query.trim().toLowerCase().slice(0, 90);
      const bucket = queryCounts.get(key) ?? { count: 0, scoreSum: 0, scoreCount: 0 };
      bucket.count += 1;
      if (entry.topScore !== null) {
        bucket.scoreSum += entry.topScore;
        bucket.scoreCount += 1;
      }
      queryCounts.set(key, bucket);
    }

    const conversations = this.db.conversations.filter((entry) => entry.workspaceId === workspaceId);
    const documentsIndexed = this.db.documents.filter(
      (entry) => entry.workspaceId === workspaceId && entry.status === "indexed",
    ).length;

    return {
      range,
      totals: {
        queries: queryEvents.length,
        tokens: queryEvents.reduce((sum, entry) => sum + entry.promptTokens + entry.completionTokens, 0),
        documentsIndexed,
        conversations: conversations.length,
        errors: events.filter((entry) => entry.kind === "error").length,
        avgLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0,
        p95LatencyMs: p95,
        avgRetrieved: queryEvents.length
          ? Number((queryEvents.reduce((sum, entry) => sum + entry.retrievedCount, 0) / queryEvents.length).toFixed(1))
          : 0,
        groundRate: queryEvents.length
          ? queryEvents.filter((entry) => entry.retrievedCount > 0).length / queryEvents.length
          : 0,
      },
      series: [...seriesMap.entries()].map(([date, value]) => ({ date, ...value })),
      byProvider: [...providerMap.values()].sort((a, b) => b.queries - a.queries),
      byAssistant: [...assistantMap.values()].sort((a, b) => b.queries - a.queries),
      latencyBuckets,
      topQueries: [...queryCounts.entries()]
        .map(([query, value]) => ({
          query,
          count: value.count,
          avgScore: value.scoreCount ? value.scoreSum / value.scoreCount : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }

  private async listActivity(token: string, workspaceId: string, limit = 12) {
    this.assertWorkspace(token, workspaceId);
    return this.db.activity
      .filter((entry) => entry.workspaceId === workspaceId)
      .slice(0, limit);
  }

  /* ------------------------------------------------------------------ widget */

  async widgetConfig(publicKey: string): Promise<PublicWidgetConfig> {
    const assistant = this.db.assistants.find((entry) => entry.publicKey === publicKey);
    if (!assistant) throw new Error("This widget key is not recognised.");
    if (!assistant.widget.enabled) throw new Error("This widget is currently disabled by its owner.");
    // Mirrors the HTTP API: draft serves (the widget switch is the control),
    // paused always refuses.
    if (assistant.status === "paused") throw new Error("This assistant is paused.");
    const documents = this.db.documents.filter(
      (entry) =>
        assistant.knowledgeBaseIds.includes(entry.knowledgeBaseId) && entry.status === "indexed",
    );
    return {
      assistantId: assistant.id,
      name: assistant.name,
      description: assistant.description,
      widget: assistant.widget,
      publicKey,
      knowledgeBaseCount: assistant.knowledgeBaseIds.length,
      documentCount: documents.length,
      hints: documents.slice(0, 3).map((document) => `What does "${document.name}" cover?`),
    };
  }

  async widgetQuery(publicKey: string, input: { question: string; conversationId?: string }) {
    const assistant = this.db.assistants.find((entry) => entry.publicKey === publicKey);
    if (!assistant) throw new Error("This widget key is not recognised.");
    if (!assistant.widget.enabled) throw new Error("This widget is currently disabled.");
    if (assistant.status === "paused") throw new Error("This assistant is paused.");

    const question = input.question.trim();
    if (!question) throw new Error("Type a question first.");
    if (question.length > 4000) throw new Error("That question is too long. Keep it under 4,000 characters.");

    // A public caller may only continue a widget conversation of this same assistant.
    const owned = input.conversationId
      ? this.db.conversations.find(
          (entry) =>
            entry.id === input.conversationId &&
            entry.assistantId === assistant.id &&
            entry.channel === "widget",
        )
      : undefined;

    const history = owned
      ? this.db.messages
          .filter((entry) => entry.conversationId === owned.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(-8)
          .map((entry) => ({ role: entry.role, content: entry.content }))
      : [];

    const response = await answerQuestion({
      assistant,
      question,
      history,
      chunks: this.assistantChunks(assistant),
      kbNames: this.kbNameMap(assistant.workspaceId),
      documentNames: this.documentNameMap(assistant.workspaceId),
      getCredentials: this.credentialsFor(assistant.workspaceId),
    });

    const usage = response.message.meta!;
    this.recordEvent({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      kind: "widget_message",
      latencyMs: usage.latencyMs,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      provider: usage.provider,
      model: usage.model,
      retrievedCount: usage.retrievedCount,
      topScore: usage.topScore,
    });

    let conversation = owned;

    if (!conversation) {
      conversation = {
        id: randomId("cnv"),
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        title: question.slice(0, 60),
        channel: "widget",
        messageCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.db.conversations.push(conversation);
    }

    this.db.messages.push(
      {
        id: randomId("msg"),
        role: "user",
        content: question,
        createdAt: nowIso(),
        conversationId: conversation.id,
        workspaceId: assistant.workspaceId,
      },
      { ...response.message, conversationId: conversation.id, workspaceId: assistant.workspaceId },
    );
    conversation.messageCount += 2;
    conversation.updatedAt = nowIso();
    this.db.queryLog.push({
      at: nowIso(),
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      query: question,
      topScore: usage.topScore,
      retrievedCount: usage.retrievedCount,
      latencyMs: usage.latencyMs,
      isSample: false,
    });
    this.trimQueryLog();
    this.refreshAssistantStats(assistant.id);
    this.emit({ type: "assistants.changed", workspaceId: assistant.workspaceId });
    this.emit({ type: "activity.changed", workspaceId: assistant.workspaceId });
    this.save();

    return { response, conversationId: conversation.id };
  }

  widget = {
    config: (publicKey: string) => this.widgetConfig(publicKey),
    query: (publicKey: string, input: { question: string; conversationId?: string }) =>
      this.widgetQuery(publicKey, input),
  };

  /* ------------------------------------------------------------ maintenance */

  async clearSampleData(token: string, workspaceId: string) {
    const { workspace } = this.assertWorkspace(token, workspaceId);
    // Flagged sample records go everywhere; documents, passages and conversations
    // only in the sample workspace, so a real workspace never loses its own content.
    this.db.events = this.db.events.filter((e) => !(e.workspaceId === workspaceId && e.isSample));
    this.db.queryLog = this.db.queryLog.filter((e) => !(e.workspaceId === workspaceId && e.isSample));
    this.db.activity = this.db.activity.filter((e) => !(e.workspaceId === workspaceId && e.isSample));

    if (workspace.isSample) {
      const documentIds = this.db.documents.filter((e) => e.workspaceId === workspaceId).map((e) => e.id);
      for (const id of documentIds) {
        delete this.db.documentTexts[id];
        this.runs.delete(id);
      }
      this.db.documents = this.db.documents.filter((e) => e.workspaceId !== workspaceId);
      this.chunks = this.chunks.filter((e) => e.workspaceId !== workspaceId);
      this.db.events = this.db.events.filter((e) => e.workspaceId !== workspaceId);
      this.db.queryLog = this.db.queryLog.filter((e) => e.workspaceId !== workspaceId);
      const conversationIds = new Set(
        this.db.conversations.filter((e) => e.workspaceId === workspaceId).map((e) => e.id),
      );
      this.db.conversations = this.db.conversations.filter((e) => e.workspaceId !== workspaceId);
      this.db.messages = this.db.messages.filter((e) => !conversationIds.has(e.conversationId));
      for (const knowledgeBase of this.db.knowledgeBases) {
        if (knowledgeBase.workspaceId === workspaceId) {
          knowledgeBase.documentCount = 0;
          knowledgeBase.chunkCount = 0;
        }
      }
      clearLexicalCache();
    }
    for (const assistant of this.db.assistants) {
      if (assistant.workspaceId === workspaceId) this.refreshAssistantStats(assistant.id);
    }
    this.emit({ type: "knowledge.changed", workspaceId });
    this.emit({ type: "assistants.changed", workspaceId });
    this.emit({ type: "documents.changed", workspaceId, knowledgeBaseId: "*" });
    this.emit({ type: "activity.changed", workspaceId });
    this.save();
  }

  /* ------------------------------------------------------------------- seed */

  /** Populate the sample workspace using the real ingestion pipeline. */
  private async seedSampleWorkspace(workspace: Workspace) {
    const embedding = defaultEmbedding();

    const knowledgeBases = SAMPLE_KNOWLEDGE_BASES.map((seed) => {
      const record: KnowledgeBase = {
        id: randomId("kb"),
        workspaceId: workspace.id,
        name: seed.name,
        description: seed.description,
        documentCount: 0,
        chunkCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.db.knowledgeBases.push(record);
      return record;
    });

    const byName = new Map(knowledgeBases.map((entry) => [entry.name, entry]));

    for (const seed of SAMPLE_DOCUMENTS) {
      const knowledgeBase = byName.get(seed.knowledgeBase)!;
      this.createDocument({
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        name: seed.name,
        source: seed.source,
        sourceUrl: seed.sourceUrl,
        mimeType: "text/plain",
        content: seed.content,
        embedding,
      });
    }

    // Index synchronously so the workspace is immediately usable.
    const documents = this.db.documents.filter((entry) => entry.workspaceId === workspace.id);
    for (const document of documents) {
      await this.processDocument(document.id, embedding);
    }

    const handbook = byName.get("Product handbook")!;
    const engineering = byName.get("Platform engineering")!;
    const runbook = byName.get("Support runbook")!;

    const assistantSeeds: {
      name: string;
      description: string;
      systemPrompt: string;
      model: Assistant["model"];
      rag: Assistant["rag"];
      knowledgeBaseIds: string[];
      widgetPosition: Assistant["widget"]["position"];
      status: Assistant["status"];
    }[] = [
      {
        name: "Handbook Guide",
        description: "Answers product questions from the handbook with inline citations.",
        systemPrompt:
          "You are the product guide. Answer concisely, cite passage numbers, and link the reader to the right feature area.",
        model: { provider: "openai", model: "gpt-4.1-mini", temperature: 0.15, maxTokens: 900, topP: 1, frequencyPenalty: 0 },
        rag: {
          enabled: true,
          topK: 5,
          scoreThreshold: 0.18,
          strategy: "hybrid",
          rerank: false,
          instruction:
            "Prefer the most specific passage. If two passages conflict, say so and cite both.",
          noAnswerBehavior: "refuse",
          noAnswerMessage: "That is not covered in the handbook yet — I have flagged it as a documentation gap.",
        },
        knowledgeBaseIds: [handbook.id],
        widgetPosition: "bottom-right",
        status: "active",
      },
      {
        name: "Engineering Copilot",
        description: "Dense retrieval over provider and embedding notes for the platform team.",
        systemPrompt:
          "You are an engineering reference assistant. Be precise, name the exact setting or endpoint, and never speculate about behaviour that is not documented.",
        model: { provider: "anthropic", model: "claude-sonnet-4-5", temperature: 0.1, maxTokens: 1200, topP: 1, frequencyPenalty: 0 },
        rag: {
          enabled: true,
          topK: 6,
          scoreThreshold: 0.2,
          strategy: "vector",
          rerank: false,
          instruction: "Quote identifiers exactly as written in the context.",
          noAnswerBehavior: "refuse",
          noAnswerMessage: "Not documented here. Check the provider's own reference for this.",
        },
        knowledgeBaseIds: [engineering.id],
        widgetPosition: "bottom-left",
        status: "active",
      },
      {
        name: "Support Triage",
        description: "Walks support through retrieval diagnostics from the runbook.",
        systemPrompt:
          "You are a support triage assistant. Lead with the likely cause, then the exact steps to confirm it.",
        model: { provider: "google", model: "gemini-2.5-flash", temperature: 0.3, maxTokens: 1000, topP: 1, frequencyPenalty: 0 },
        rag: {
          enabled: true,
          topK: 4,
          scoreThreshold: 0.12,
          strategy: "hybrid",
          rerank: false,
          instruction: "Structure the answer as symptom, cause, fix. Cite every step.",
          noAnswerBehavior: "answer-without-context",
          noAnswerMessage: "I could not match this to a known symptom.",
        },
        knowledgeBaseIds: [runbook.id, handbook.id],
        widgetPosition: "bottom-right",
        status: "active",
      },
    ];

    for (const seed of assistantSeeds) {
      const draft = defaultAssistantDraft(seed.name);
      const assistant: Assistant = {
        ...draft,
        name: seed.name,
        description: seed.description,
        systemPrompt: seed.systemPrompt,
        model: seed.model,
        embedding,
        rag: seed.rag,
        knowledgeBaseIds: seed.knowledgeBaseIds,
        widget: {
          ...draft.widget,
          position: seed.widgetPosition,
          assistantDisplayName: seed.name,
          welcomeMessage: `Hi — I'm ${seed.name}. ${seed.description}`,
          launcherLabel: `Chat with ${seed.name}`,
        },
        id: randomId("ast"),
        workspaceId: workspace.id,
        status: seed.status,
        publicKey: `pk_${randomId("pub").slice(4)}`,
        stats: { conversations: 0, messages: 0, tokensUsed: 0, avgLatencyMs: 0, lastActivityAt: null },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.db.assistants.push(assistant);
    }

    this.seedUsageHistory(workspace.id);

    this.recordActivity(
      workspace.id,
      {
        kind: "workspace.created",
        summary: "Sample workspace created",
        detail: `${SAMPLE_DOCUMENTS.length} documents indexed across ${knowledgeBases.length} knowledge bases`,
      },
      "Parsis Bridge",
      true,
    );
  }

  /** Synthetic history for the sample workspace, flagged as sample throughout. */
  private seedUsageHistory(workspaceId: string) {
    const random = mulberry32(0x5eed);
    const assistants = this.db.assistants.filter((entry) => entry.workspaceId === workspaceId);
    const providers: ProviderId[] = ["openai", "anthropic", "google"];
    const sampleQueries = [
      "how should I choose a chunk size",
      "what does the relevance threshold do",
      "how do I deploy the widget on my site",
      "why is my document stuck embedding",
      "how are workspaces isolated from each other",
      "which embedding model should I start with",
      "how do I cite sources in an answer",
      "what happens when no passage matches",
      "how do I rotate a provider key",
      "does the widget work on mobile",
    ];

    for (let day = 29; day >= 0; day -= 1) {
      const date = new Date(Date.now() - day * 86_400_000);
      const weekday = date.getDay();
      const weekendFactor = weekday === 0 || weekday === 6 ? 0.42 : 1;
      const volume = Math.round((14 + random() * 26) * weekendFactor);
      for (let i = 0; i < volume; i += 1) {
        const assistant = assistants[Math.floor(random() * assistants.length)];
        if (!assistant) break;
        const at = new Date(date);
        at.setHours(8 + Math.floor(random() * 11), Math.floor(random() * 60), Math.floor(random() * 60));
        if (at.getTime() > Date.now()) at.setTime(Date.now() - Math.floor(random() * 3_600_000));
        const latency = Math.round(520 + random() * 2400);
        const retrieved = random() < 0.88 ? 2 + Math.floor(random() * 5) : 0;
        const prompt = 420 + Math.floor(random() * 1800);
        const completion = 120 + Math.floor(random() * 520);
        const provider = assistants.indexOf(assistant) % providers.length;
        const failed = random() < 0.015;

        this.db.events.push({
          id: randomId("evt"),
          workspaceId,
          assistantId: assistant.id,
          kind: failed ? "error" : random() < 0.22 ? "widget_message" : "query",
          at: at.toISOString(),
          latencyMs: latency,
          promptTokens: prompt,
          completionTokens: completion,
          provider: providers[provider],
          model: assistant.model.model,
          retrievedCount: retrieved,
          topScore: retrieved ? Number((0.24 + random() * 0.5).toFixed(3)) : null,
          isSample: true,
        });

        if (random() < 0.34) {
          this.db.queryLog.push({
            at: at.toISOString(),
            workspaceId,
            assistantId: assistant.id,
            query: sampleQueries[Math.floor(random() * sampleQueries.length)],
            topScore: Number((0.26 + random() * 0.45).toFixed(3)),
            retrievedCount: retrieved,
            latencyMs: latency,
            isSample: true,
          });
        }
      }
    }

    // A few sample conversations so the assistant cards are not empty.
    const titles = [
      "Chunk size for API reference docs",
      "Widget not appearing behind the navbar",
      "Documents failing on the embedding stage",
    ];
    assistants.forEach((assistant, index) => {
      const conversation: Conversation = {
        id: randomId("cnv"),
        workspaceId,
        assistantId: assistant.id,
        title: titles[index % titles.length],
        channel: index % 2 === 0 ? "playground" : "widget",
        messageCount: 4,
        createdAt: new Date(Date.now() - (index + 2) * 86_400_000).toISOString(),
        updatedAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
      };
      this.db.conversations.push(conversation);
      this.db.messages.push(
        {
          id: randomId("msg"),
          role: "user",
          content: conversation.title,
          createdAt: conversation.createdAt,
          conversationId: conversation.id,
          workspaceId,
        },
        {
          id: randomId("msg"),
          role: "assistant",
          content:
            "Based on the indexed passages, start from the settings described in the retrieval configuration guide and re-run the query in the playground to confirm the change.",
          createdAt: conversation.createdAt,
          conversationId: conversation.id,
          workspaceId,
        },
      );
      this.refreshAssistantStats(assistant.id);
    });

    this.db.activity.unshift(
      {
        id: randomId("act"),
        workspaceId,
        at: new Date(Date.now() - 40 * 60_000).toISOString(),
        kind: "document.indexed",
        summary: '"RAG configuration guide" indexed',
        detail: "9 passages · pyre-hash-384",
        actor: "Parsis Bridge (sample)",
        isSample: true,
      },
      {
        id: randomId("act"),
        workspaceId,
        at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        kind: "query.run",
        summary: "Playground query on Support Triage",
        detail: "4 passages · 1.24 s",
        actor: "Parsis Bridge (sample)",
        isSample: true,
      },
      {
        id: randomId("act"),
        workspaceId,
        at: new Date(Date.now() - 9 * 3_600_000).toISOString(),
        kind: "assistant.updated",
        summary: 'Assistant "Handbook Guide" updated',
        detail: "rag, widget",
        actor: "Parsis Bridge (sample)",
        isSample: true,
      },
    );
  }
}
