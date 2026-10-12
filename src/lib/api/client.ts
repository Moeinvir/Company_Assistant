/**
 * The API seam.
 *
 * Every page talks to this interface and nothing else. Two implementations
 * exist: `LocalBackend`, a complete offline data layer that runs in the browser
 * (used by default so the product is fully explorable without infrastructure),
 * and `HttpClient`, which maps the same methods onto a REST service.
 *
 * The interface is intentionally shaped like a real API: every call is scoped
 * to a workspace, every mutation returns the updated record, and subscriptions
 * report server-side changes. Nothing in the UI can bypass it to reach data.
 */

import type {
  ActivityEntry,
  AnalyticsSnapshot,
  Assistant,
  AssistantDraft,
  ChatMessage,
  Conversation,
  DocumentRecord,
  EmbeddingConfig,
  KnowledgeBase,
  ProviderId,
  ProviderKeyRecord,
  QueryRequest,
  QueryResponse,
  SearchRequest,
  SearchResponse,
  Session,
  User,
  WidgetConfig,
  Workspace,
  WorkspaceMember,
} from "./types";

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

/** Edits to the signed-in account. An empty `image` clears the picture. */
export interface ProfilePatch {
  name?: string;
  image?: string;
}

export interface AuthResult {
  session: Session;
  /** The workspace opened after sign in. */
  workspace: Workspace;
  workspaces: Workspace[];
}

export interface Credentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface FilePayload {
  name: string;
  size: number;
  type: string;
  /** Extracted plain text. Binary parsing belongs on the server. */
  text: string;
}

export interface PublicWidgetConfig {
  assistantId: string;
  name: string;
  description: string;
  widget: WidgetConfig;
  publicKey: string;
  knowledgeBaseCount: number;
  documentCount: number;
  /** Suggested opening questions, derived from indexed document titles. */
  hints: string[];
}

export type BackendEvent =
  | { type: "documents.changed"; workspaceId: string; knowledgeBaseId: string }
  | { type: "knowledge.changed"; workspaceId: string }
  | { type: "assistants.changed"; workspaceId: string }
  | { type: "activity.changed"; workspaceId: string };

export interface ApiClient {
  readonly mode: "demo" | "http";
  readonly capabilities: {
    /** Keys are held client-side and can be used for direct provider calls. */
    localProviderKeys: boolean;
    /** Document ingestion runs inside this client. */
    clientIngestion: boolean;
    /** The embeddable widget runtime can reach the backend without a session. */
    publicWidget: boolean;
  };
  readonly notes: string[];

  auth: {
    signUp(input: SignUpInput): Promise<AuthResult>;
    signIn(input: { email: string; password: string }): Promise<AuthResult>;
    restore(token?: string): Promise<AuthResult | null>;
    signOut(token: string): Promise<void>;
    /** Persists profile edits (display name, picture) and returns the user. */
    updateProfile(token: string, patch: ProfilePatch): Promise<User>;
  };

  workspaces: {
    list(token: string): Promise<Workspace[]>;
    create(
      token: string,
      input: { name: string; plan?: Workspace["plan"] },
    ): Promise<Workspace>;
    update(
      token: string,
      workspaceId: string,
      patch: Partial<Pick<Workspace, "name" | "plan">>,
    ): Promise<Workspace>;
    remove(token: string, workspaceId: string): Promise<void>;
    members(token: string, workspaceId: string): Promise<WorkspaceMember[]>;
  };

  assistants: {
    list(token: string, workspaceId: string): Promise<Assistant[]>;
    get(token: string, assistantId: string): Promise<Assistant>;
    create(token: string, workspaceId: string, draft: AssistantDraft): Promise<Assistant>;
    update(token: string, assistantId: string, patch: Partial<AssistantDraft>): Promise<Assistant>;
    duplicate(token: string, assistantId: string): Promise<Assistant>;
    remove(token: string, assistantId: string): Promise<void>;
  };

  knowledge: {
    list(token: string, workspaceId: string): Promise<KnowledgeBase[]>;
    create(
      token: string,
      workspaceId: string,
      input: { name: string; description: string },
    ): Promise<KnowledgeBase>;
    update(
      token: string,
      knowledgeBaseId: string,
      patch: Partial<Pick<KnowledgeBase, "name" | "description">>,
    ): Promise<KnowledgeBase>;
    remove(token: string, knowledgeBaseId: string): Promise<void>;
    documents(token: string, knowledgeBaseId: string): Promise<DocumentRecord[]>;
    addText(
      token: string,
      input: {
        knowledgeBaseId: string;
        name: string;
        content: string;
        embedding: EmbeddingConfig;
      },
    ): Promise<DocumentRecord>;
    addFile(
      token: string,
      input: { knowledgeBaseId: string; file: FilePayload; embedding: EmbeddingConfig },
    ): Promise<DocumentRecord>;
    addUrl(
      token: string,
      input: { knowledgeBaseId: string; url: string; embedding: EmbeddingConfig },
    ): Promise<DocumentRecord>;
    updateDocument(
      token: string,
      documentId: string,
      input: { name?: string; content?: string; embedding?: EmbeddingConfig },
    ): Promise<DocumentRecord>;
    documentContent(token: string, documentId: string): Promise<string>;
    removeDocument(token: string, documentId: string): Promise<void>;
    removeAllDocuments(token: string, knowledgeBaseId: string): Promise<void>;
    reindex(token: string, knowledgeBaseId: string, embedding: EmbeddingConfig): Promise<void>;
  };

  providers: {
    listKeys(token: string, workspaceId: string): Promise<ProviderKeyRecord[]>;
    setKey(
      token: string,
      workspaceId: string,
      input: { provider: ProviderId; apiKey: string; baseUrl?: string },
    ): Promise<ProviderKeyRecord>;
    removeKey(token: string, workspaceId: string, provider: ProviderId): Promise<void>;
    markVerified(
      token: string,
      workspaceId: string,
      provider: ProviderId,
      result: { ok: boolean; message: string },
    ): Promise<ProviderKeyRecord>;
    /**
     * Credentials for browser-side provider calls. The offline backend returns
     * the stored keys; an HTTP backend returns an empty map because a real
     * deployment keeps secrets on the server and proxies the provider call.
     */
    resolveCredentials(
      token: string,
      workspaceId: string,
    ): Promise<Partial<Record<ProviderId, Credentials>>>;
  };

  playground: {
    query(token: string, request: QueryRequest): Promise<QueryResponse>;
    search(token: string, request: SearchRequest): Promise<SearchResponse>;
  };

  conversations: {
    list(token: string, workspaceId: string, assistantId?: string): Promise<Conversation[]>;
    messages(token: string, conversationId: string): Promise<ChatMessage[]>;
    clear(token: string, workspaceId: string): Promise<void>;
  };

  analytics: {
    overview(
      token: string,
      workspaceId: string,
      range: AnalyticsSnapshot["range"],
    ): Promise<AnalyticsSnapshot>;
    activity(token: string, workspaceId: string, limit?: number): Promise<ActivityEntry[]>;
  };

  widget: {
    config(publicKey: string): Promise<PublicWidgetConfig>;
    query(
      publicKey: string,
      input: { question: string; conversationId?: string },
    ): Promise<{ response: QueryResponse; conversationId: string }>;
  };

  /** Subscribe to server-side changes. Returns an unsubscribe function. */
  subscribe(
    token: string,
    workspaceId: string,
    handler: (event: BackendEvent) => void,
  ): () => void;

  /** Removes every sample record from a workspace. */
  clearSampleData(token: string, workspaceId: string): Promise<void>;
}

let client: ApiClient | null = null;

/**
 * Resolve the active client. Set `VITE_PYRE_API_URL` to point at a REST
 * backend; otherwise the offline data layer is used.
 */
export async function getApiClient(): Promise<ApiClient> {
  if (client) return client;
  const baseUrl = (import.meta.env.VITE_PYRE_API_URL as string | undefined)?.trim();
  if (baseUrl) {
    const { HttpClient } = await import("./httpClient");
    client = new HttpClient(baseUrl);
  } else {
    const { LocalBackend } = await import("./localBackend");
    client = new LocalBackend();
  }
  return client;
}
