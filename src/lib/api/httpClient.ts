/**
 * HttpClient — the REST implementation of the `ApiClient` contract.
 *
 * This is the deployment target: point `VITE_PYRE_API_URL` at a service that
 * exposes these routes and the UI runs untouched. The routes intentionally
 * mirror the method names in `client.ts` so the mapping is auditable.
 *
 * Two behaviours change relative to the offline backend, both deliberate:
 *  • `resolveCredentials` returns an empty map. Provider keys are stored
 *    encrypted on the server and never shipped to the browser; generation is
 *    proxied through the API (see `providerProxy.ts`).
 *  • ingestion is performed by the server; `addFile`/`addText` send content and
 *    the returned document carries the processing status streamed over the
 *    subscription channel or polled by the caller.
 *
 * Retrieval assembles its passages from the documents the API stores (chunked
 * in the browser, with the same chunker and embedder the offline pipeline
 * uses). That keeps one retrieval implementation for both modes while the
 * secret-dependent half — the call to the model — stays on the server.
 */

import { chunkText } from "../rag/chunker";
import { createEmbedder } from "./embedder";
import { answerQuestion } from "../rag/pipeline";
import { searchChunks } from "../rag/vectorStore";
import type {
  ActivityEntry,
  AnalyticsSnapshot,
  Assistant,
  AssistantDraft,
  ChatMessage,
  Chunk,
  Conversation,
  DocumentRecord,
  EmbeddingConfig,
  KnowledgeBase,
  ProviderId,
  ProviderKeyRecord,
  QueryRequest,
  QueryResponse,
  RetrievedChunk,
  SearchRequest,
  SearchResponse,
  User,
  Workspace,
  WorkspaceMember,
} from "./types";
import type {
  ApiClient,
  AuthResult,
  BackendEvent,
  Credentials,
  FilePayload,
  ProfilePatch,
  PublicWidgetConfig,
} from "./client";

type Json = Record<string, unknown>;

const TOKEN_KEY = "pyre.http.token.v1";
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
const writeToken = (token?: string) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* session will not survive a reload */
  }
};

export class HttpClient implements ApiClient {
  readonly mode = "http" as const;
  readonly capabilities = {
    localProviderKeys: false,
    clientIngestion: false,
    publicWidget: true,
  };
  readonly notes = [
    "Connected to a remote platform API. Provider keys stay on the server.",
  ];

  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async call<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: {
      token?: string;
      body?: Json;
      query?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<T> {
    // A relative base such as "/api" is resolved against the current origin.
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: {
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.token
            ? { authorization: `Bearer ${options.token}` }
            : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      // A network-level failure otherwise reaches the UI as a bare
      // "Failed to fetch", which says nothing about which service was
      // unreachable. Name the target so a wrong VITE_PYRE_API_URL, a stopped
      // API or a blocked origin is obvious instead of looking fatal.
      throw new Error(
        `Cannot reach the platform API at ${url.origin}. Check that the backend is running on that port and that VITE_PYRE_API_URL in the frontend .env points at it.`,
      );
    }

    if (!response.ok) {
      let message = `Request failed with ${response.status}`;
      try {
        const payload = (await response.json()) as {
          message?: string;
          error?: string;
        };
        message = payload.message ?? payload.error ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  auth = {
    signUp: async (input: {
      name: string;
      email: string;
      password: string;
    }) => {
      const result = await this.call<AuthResult>("POST", "/auth/sign-up", {
        body: input as unknown as Json,
      });
      writeToken(result.session.token);
      return result;
    },
    signIn: async (input: { email: string; password: string }) => {
      const result = await this.call<AuthResult>("POST", "/auth/sign-in", {
        body: input as unknown as Json,
      });
      writeToken(result.session.token);
      return result;
    },
    restore: async (token?: string): Promise<AuthResult | null> => {
      const candidate = token ?? readToken();
      if (!candidate) return null;
      try {
        return await this.call<AuthResult>("GET", "/auth/session", {
          token: candidate,
        });
      } catch {
        writeToken(undefined);
        return null;
      }
    },
    signOut: async (token: string) => {
      try {
        await this.call<void>("POST", "/auth/sign-out", { token });
      } finally {
        writeToken(undefined);
      }
    },
    updateProfile: (token: string, patch: ProfilePatch) =>
      this.call<User>("PATCH", "/auth/profile", {
        token,
        body: patch as unknown as Json,
      }),
  };

  workspaces = {
    list: (token: string) =>
      this.call<Workspace[]>("GET", "/workspaces", { token }),
    create: (
      token: string,
      input: { name: string; plan?: Workspace["plan"] },
    ) =>
      this.call<Workspace>("POST", "/workspaces", {
        token,
        body: input as unknown as Json,
      }),
    update: (
      token: string,
      workspaceId: string,
      patch: Partial<Pick<Workspace, "name" | "plan">>,
    ) =>
      this.call<Workspace>("PATCH", `/workspaces/${workspaceId}`, {
        token,
        body: patch as unknown as Json,
      }),
    remove: async (token: string, workspaceId: string) => {
      await this.call<void>("DELETE", `/workspaces/${workspaceId}`, { token });
    },
    members: (token: string, workspaceId: string) =>
      this.call<WorkspaceMember[]>(
        "GET",
        `/workspaces/${workspaceId}/members`,
        { token },
      ),
  };

  assistants = {
    list: (token: string, workspaceId: string) =>
      this.call<Assistant[]>("GET", "/assistants", {
        token,
        query: { workspaceId },
      }),
    get: (token: string, assistantId: string) =>
      this.call<Assistant>("GET", `/assistants/${assistantId}`, { token }),
    create: (token: string, workspaceId: string, draft: AssistantDraft) =>
      this.call<Assistant>("POST", "/assistants", {
        token,
        body: { ...draft, workspaceId } as unknown as Json,
      }),
    update: (
      token: string,
      assistantId: string,
      patch: Partial<AssistantDraft>,
    ) =>
      this.call<Assistant>("PATCH", `/assistants/${assistantId}`, {
        token,
        body: patch as unknown as Json,
      }),
    duplicate: (token: string, assistantId: string) =>
      this.call<Assistant>("POST", `/assistants/${assistantId}/duplicate`, {
        token,
      }),
    remove: async (token: string, assistantId: string) => {
      await this.call<void>("DELETE", `/assistants/${assistantId}`, { token });
    },
  };

  knowledge = {
    list: (token: string, workspaceId: string) =>
      this.call<KnowledgeBase[]>("GET", "/knowledge-bases", {
        token,
        query: { workspaceId },
      }),
    create: (
      token: string,
      workspaceId: string,
      input: { name: string; description: string },
    ) =>
      this.call<KnowledgeBase>("POST", "/knowledge-bases", {
        token,
        body: { ...input, workspaceId } as unknown as Json,
      }),
    update: (
      token: string,
      knowledgeBaseId: string,
      patch: Partial<Pick<KnowledgeBase, "name" | "description">>,
    ) =>
      this.call<KnowledgeBase>("PATCH", `/knowledge-bases/${knowledgeBaseId}`, {
        token,
        body: patch as unknown as Json,
      }),
    remove: async (token: string, knowledgeBaseId: string) => {
      await this.call<void>("DELETE", `/knowledge-bases/${knowledgeBaseId}`, {
        token,
      });
    },
    documents: (token: string, knowledgeBaseId: string) =>
      this.call<DocumentRecord[]>(
        "GET",
        `/knowledge-bases/${knowledgeBaseId}/documents`,
        { token },
      ),
    addText: (
      token: string,
      input: {
        knowledgeBaseId: string;
        name: string;
        content: string;
        embedding: EmbeddingConfig;
      },
    ) => {
      // knowledgeBaseId توی آدرس هست؛ داخل body نباید بره
      const { knowledgeBaseId, ...body } = input;
      return this.call<DocumentRecord>(
        "POST",
        `/knowledge-bases/${knowledgeBaseId}/documents/text`,
        {
          token,
          body: body as unknown as Json,
        },
      );
    },
    addFile: (
      token: string,
      input: {
        knowledgeBaseId: string;
        file: FilePayload;
        embedding: EmbeddingConfig;
      },
    ) => {
      const { knowledgeBaseId, ...body } = input;
      return this.call<DocumentRecord>(
        "POST",
        `/knowledge-bases/${knowledgeBaseId}/documents/file`,
        {
          token,
          body: body as unknown as Json,
        },
      );
    },
    addUrl: (
      token: string,
      input: {
        knowledgeBaseId: string;
        url: string;
        embedding: EmbeddingConfig;
      },
    ) => {
      const { knowledgeBaseId, ...body } = input;
      return this.call<DocumentRecord>(
        "POST",
        `/knowledge-bases/${knowledgeBaseId}/documents/url`,
        {
          token,
          body: body as unknown as Json,
        },
      );
    },
    updateDocument: (
      token: string,
      documentId: string,
      input: { name?: string; content?: string; embedding?: EmbeddingConfig },
    ) =>
      this.call<DocumentRecord>("PATCH", `/documents/${documentId}`, {
        token,
        body: input as unknown as Json,
      }),
    documentContent: (token: string, documentId: string) =>
      this.call<{ content: string }>(
        "GET",
        `/documents/${documentId}/content`,
        { token },
      ).then((result) => result.content),
    removeDocument: async (token: string, documentId: string) => {
      await this.call<void>("DELETE", `/documents/${documentId}`, { token });
    },
    removeAllDocuments: async (token: string, knowledgeBaseId: string) => {
      await this.call<void>(
        "DELETE",
        `/knowledge-bases/${knowledgeBaseId}/documents`,
        { token },
      );
    },
    reindex: async (
      token: string,
      knowledgeBaseId: string,
      embedding: EmbeddingConfig,
    ) => {
      await this.call<void>(
        "POST",
        `/knowledge-bases/${knowledgeBaseId}/reindex`,
        {
          token,
          body: embedding as unknown as Json,
        },
      );
    },
  };

  providers = {
    listKeys: (token: string, workspaceId: string) =>
      this.call<ProviderKeyRecord[]>("GET", "/provider-keys", {
        token,
        query: { workspaceId },
      }),
    setKey: (
      token: string,
      workspaceId: string,
      input: { provider: ProviderId; apiKey?: string; baseUrl?: string },
    ) =>
      this.call<ProviderKeyRecord>("POST", "/provider-keys", {
        token,
        // An absent key is omitted entirely so keyless runtimes validate.
        body: { ...input, workspaceId } as unknown as Json,
      }),
    removeKey: async (
      token: string,
      workspaceId: string,
      provider: ProviderId,
    ) => {
      await this.call<void>("DELETE", `/provider-keys/${provider}`, {
        token,
        query: { workspaceId },
      });
    },
    markVerified: (
      token: string,
      workspaceId: string,
      provider: ProviderId,
      result: { ok: boolean; message: string },
    ) =>
      this.call<ProviderKeyRecord>(
        "POST",
        `/provider-keys/${provider}/verify`,
        {
          token,
          body: { ...result, workspaceId } as unknown as Json,
        },
      ),
    /**
     * Credentials for browser-side provider calls. This deployment keeps the
     * keys server-side, so the correct answer is "none" — the UI reads which
     * providers are configured from `listKeys`, and every provider call is
     * proxied through the API with the stored credential.
     */
    resolveCredentials: async (): Promise<
      Partial<Record<ProviderId, Credentials>>
    > => ({}),
  };

  playground = {
    query: (token: string, request: QueryRequest) =>
      this.runQuery(token, request),
    search: (token: string, request: SearchRequest) =>
      this.runSearch(token, request),
  };

  /**
   * Passages for an assistant, built from the documents the API holds. Each
   * document's chunks are cached until the document itself changes, so a query
   * only re-reads what was edited. Vectors come from the configured embedder;
   * the built-in offline embedder needs no key, which is why it is the default.
   */
  private async retrievalContext(
    token: string,
    assistant: Assistant,
  ): Promise<{
    chunks: Chunk[];
    kbNames: Map<string, string>;
    documentNames: Map<string, string>;
  }> {
    const kbNames = new Map<string, string>();
    const documentNames = new Map<string, string>();
    const chunks: Chunk[] = [];
    if (assistant.knowledgeBaseIds.length === 0)
      return { chunks, kbNames, documentNames };

    const embedder = createEmbedder(assistant.embedding, () => undefined);

    for (const knowledgeBase of await this.knowledge.list(
      token,
      assistant.workspaceId,
    )) {
      kbNames.set(knowledgeBase.id, knowledgeBase.name);
    }

    for (const knowledgeBaseId of assistant.knowledgeBaseIds) {
      const documents = await this.knowledge.documents(token, knowledgeBaseId);
      for (const document of documents) {
        documentNames.set(document.id, document.name);
        const cached = this.documentChunks.get(document.id);
        if (cached && cached.revision === document.updatedAt) {
          chunks.push(...cached.chunks);
          continue;
        }

        let content = "";
        try {
          content = await this.knowledge.documentContent(token, document.id);
        } catch {
          // A document that cannot be read simply contributes no passages.
        }
        const pieces = content.trim()
          ? chunkText(content, {
              chunkSize: assistant.embedding.chunkSize,
              chunkOverlap: assistant.embedding.chunkOverlap,
            })
          : [];
        const vectors = pieces.length
          ? await embedder.embed(pieces.map((piece) => piece.content))
          : [];
        const built: Chunk[] = pieces.map((piece, index) => ({
          id: `${document.id}:${index}`,
          documentId: document.id,
          knowledgeBaseId,
          workspaceId: assistant.workspaceId,
          index,
          content: piece.content,
          tokens: piece.tokens,
          vector: vectors[index] ?? [],
        }));
        this.documentChunks.set(document.id, {
          revision: document.updatedAt,
          chunks: built,
        });
        chunks.push(...built);
      }
    }

    return { chunks, kbNames, documentNames };
  }

  private async runQuery(
    token: string,
    request: QueryRequest,
  ): Promise<QueryResponse> {
    const assistant = await this.assistants.get(token, request.assistantId);
    const { chunks, kbNames, documentNames } = await this.retrievalContext(
      token,
      assistant,
    );
    return answerQuestion({
      assistant,
      question: request.question,
      history: request.history,
      chunks,
      kbNames,
      documentNames,
      getCredentials: () => undefined,
      overrides: {
        topK: request.topKOverride,
        threshold: request.scoreThresholdOverride,
        temperature: request.temperatureOverride,
        strategy: request.strategyOverride,
      },
    });
  }

  private async runSearch(
    token: string,
    request: SearchRequest,
  ): Promise<SearchResponse> {
    const assistant = await this.assistants.get(token, request.assistantId);
    const started = performance.now();
    const { chunks, kbNames, documentNames } = await this.retrievalContext(
      token,
      assistant,
    );
    const embedder = createEmbedder(assistant.embedding, () => undefined);
    const queryVector =
      request.strategy === "keyword"
        ? null
        : ((await embedder.embed([request.query], "query"))[0] ?? null);
    const { results, scanned } = searchChunks(chunks, request.query, {
      topK: request.topK,
      strategy: request.strategy,
      queryVector,
    });

    const retrieved: RetrievedChunk[] = results.map(
      ({ chunk, score, vectorScore, keywordScore }) => ({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentName: documentNames.get(chunk.documentId) ?? "Unknown document",
        knowledgeBaseId: chunk.knowledgeBaseId,
        knowledgeBaseName:
          kbNames.get(chunk.knowledgeBaseId) ?? "Knowledge base",
        index: chunk.index,
        content: chunk.content,
        score: Number(score.toFixed(4)),
        vectorScore: Number(vectorScore.toFixed(4)),
        keywordScore: Number(keywordScore.toFixed(4)),
        tokens: chunk.tokens,
      }),
    );

    return {
      results: retrieved,
      latencyMs: Math.round(performance.now() - started),
      strategy: request.strategy,
      scannedChunks: scanned,
      embeddingProvider: embedder.provider,
      embeddingModel: embedder.model,
    };
  }

  /** Chunked document text, keyed by document id and the revision it was read at. */
  private documentChunks = new Map<
    string,
    { revision: string; chunks: Chunk[] }
  >();

  conversations = {
    list: (token: string, workspaceId: string, assistantId?: string) =>
      this.call<Conversation[]>("GET", "/conversations", {
        token,
        query: { workspaceId, assistantId },
      }),
    messages: (token: string, conversationId: string) =>
      this.call<ChatMessage[]>(
        "GET",
        `/conversations/${conversationId}/messages`,
        { token },
      ),
    clear: async (token: string, workspaceId: string) => {
      await this.call<void>("DELETE", "/conversations", {
        token,
        query: { workspaceId },
      });
    },
  };

  analytics = {
    overview: (
      token: string,
      workspaceId: string,
      range: AnalyticsSnapshot["range"],
    ) =>
      this.call<AnalyticsSnapshot>("GET", "/analytics/overview", {
        token,
        query: { workspaceId, range },
      }),
    activity: (token: string, workspaceId: string, limit = 12) =>
      this.call<ActivityEntry[]>("GET", "/analytics/activity", {
        token,
        query: { workspaceId, limit },
      }),
  };

  widget = {
    config: (publicKey: string) =>
      this.call<PublicWidgetConfig>("GET", `/public/widget/${publicKey}`),
    query: (
      publicKey: string,
      input: { question: string; conversationId?: string },
    ) =>
      this.call<{ response: QueryResponse; conversationId: string }>(
        "POST",
        `/public/widget/${publicKey}/query`,
        { body: input as unknown as Json },
      ),
  };

  /**
   * Server-sent events are the transport for change notifications. The channel
   * is per workspace, so a client can never observe another tenant's events.
   */
  subscribe(
    token: string,
    workspaceId: string,
    handler: (event: BackendEvent) => void,
  ) {
    const url = new URL(`${this.baseUrl}/workspaces/${workspaceId}/events`);
    url.searchParams.set("token", token);
    const source = new EventSource(url.toString());
    source.onmessage = (message) => {
      try {
        handler(JSON.parse(message.data) as BackendEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => source.close();
  }

  async clearSampleData(token: string, workspaceId: string) {
    await this.call<void>("POST", "/workspaces/sample-data/clear", {
      token,
      query: { workspaceId },
    });
  }
}
