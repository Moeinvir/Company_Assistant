import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BackendEvent, Credentials, FilePayload } from "@/lib/api/client";
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
  WorkspaceMember,
} from "@/lib/api/types";
import { useToast } from "./toast";
import { useAuthenticated, useSession } from "./session";

interface WorkspaceDataValue {
  ready: boolean;
  loading: boolean;
  error: string | null;
  assistants: Assistant[];
  knowledgeBases: KnowledgeBase[];
  providerKeys: ProviderKeyRecord[];
  activity: ActivityEntry[];
  analytics: AnalyticsSnapshot | null;
  analyticsRange: AnalyticsSnapshot["range"];
  members: WorkspaceMember[];
  documentsByKb: Record<string, DocumentRecord[]>;
  credentials: Partial<Record<ProviderId, Credentials>>;
  refresh: () => Promise<void>;
  setAnalyticsRange: (range: AnalyticsSnapshot["range"]) => void;
  loadDocuments: (knowledgeBaseId: string) => Promise<DocumentRecord[]>;
  assistantById: (id: string) => Assistant | undefined;
  knowledgeBaseById: (id: string) => KnowledgeBase | undefined;

  createAssistant: (draft: AssistantDraft) => Promise<Assistant>;
  updateAssistant: (id: string, patch: Partial<AssistantDraft>) => Promise<Assistant>;
  deleteAssistant: (id: string) => Promise<void>;
  duplicateAssistant: (id: string) => Promise<Assistant>;

  createKnowledgeBase: (input: { name: string; description: string }) => Promise<KnowledgeBase>;
  updateKnowledgeBase: (
    id: string,
    patch: Partial<Pick<KnowledgeBase, "name" | "description">>,
  ) => Promise<void>;
  deleteKnowledgeBase: (id: string) => Promise<void>;

  addTextDocument: (
    knowledgeBaseId: string,
    input: { name: string; content: string; embedding: EmbeddingConfig },
  ) => Promise<DocumentRecord>;
  addFileDocument: (
    knowledgeBaseId: string,
    input: { file: FilePayload; embedding: EmbeddingConfig },
  ) => Promise<DocumentRecord>;
  addUrlDocument: (
    knowledgeBaseId: string,
    input: { url: string; embedding: EmbeddingConfig },
  ) => Promise<DocumentRecord>;
  updateDocument: (
    id: string,
    input: { name?: string; content?: string; embedding?: EmbeddingConfig },
  ) => Promise<DocumentRecord>;
  documentContent: (id: string) => Promise<string>;
  deleteDocument: (id: string) => Promise<void>;
  deleteAllDocuments: (knowledgeBaseId: string) => Promise<void>;
  reindexKnowledgeBase: (knowledgeBaseId: string, embedding: EmbeddingConfig) => Promise<void>;

  saveProviderKey: (input: { provider: ProviderId; apiKey: string; baseUrl?: string }) => Promise<void>;
  removeProviderKey: (provider: ProviderId) => Promise<void>;
  markProviderVerified: (provider: ProviderId, result: { ok: boolean; message: string }) => Promise<void>;

  runQuery: (request: QueryRequest) => Promise<QueryResponse>;
  runSearch: (request: SearchRequest) => Promise<SearchResponse>;
  listConversations: (assistantId?: string) => Promise<Conversation[]>;
  conversationMessages: (conversationId: string) => Promise<ChatMessage[]>;
  clearConversations: () => Promise<void>;
  clearSampleData: () => Promise<void>;
}

const WorkspaceDataContext = createContext<WorkspaceDataValue | null>(null);

export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const { client, workspace, workspaceId, token } = useAuthenticated();
  const { refreshCredentials, credentials } = useSession();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [providerKeys, setProviderKeys] = useState<ProviderKeyRecord[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsSnapshot["range"]>("30d");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [documentsByKb, setDocumentsByKb] = useState<Record<string, DocumentRecord[]>>({});
  const requestId = useRef(0);
  /** Knowledge bases whose document lists should be kept fresh by refresh(). */
  const trackedKbIds = useRef(new Set<string>());

  const loadDocuments = useCallback(
    async (knowledgeBaseId: string) => {
      trackedKbIds.current.add(knowledgeBaseId);
      const documents = await client.knowledge.documents(token, knowledgeBaseId);
      setDocumentsByKb((current) => ({ ...current, [knowledgeBaseId]: documents }));
      return documents;
    },
    [client, token],
  );

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const [nextAssistants, nextKnowledge, nextKeys, nextActivity, nextMembers, nextAnalytics] =
        await Promise.all([
          client.assistants.list(token, workspaceId),
          client.knowledge.list(token, workspaceId),
          client.providers.listKeys(token, workspaceId),
          client.analytics.activity(token, workspaceId, 14),
          client.workspaces.members(token, workspaceId),
          client.analytics.overview(token, workspaceId, analyticsRange),
        ]);
      if (id !== requestId.current) return;
      setAssistants(nextAssistants);
      setKnowledgeBases(nextKnowledge);
      setProviderKeys(nextKeys);
      setActivity(nextActivity);
      setMembers(nextMembers);
      setAnalytics(nextAnalytics);
      setError(null);

      // Refresh the document lists that the UI is currently watching.
      for (const knowledgeBaseId of trackedKbIds.current) {
        if (!nextKnowledge.some((entry) => entry.id === knowledgeBaseId)) continue;
        const documents = await client.knowledge.documents(token, knowledgeBaseId);
        if (id !== requestId.current) return;
        setDocumentsByKb((current) => ({ ...current, [knowledgeBaseId]: documents }));
      }
    } catch (caught) {
      if (id !== requestId.current) return;
      setError((caught as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [client, token, workspaceId, analyticsRange]);

  // Latest refresh, so the long-lived subscription below never goes stale.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const loadDocumentsRef = useRef(loadDocuments);
  loadDocumentsRef.current = loadDocuments;

  // Initial load, plus a reload whenever the workspace or range changes.
  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Document lists are scoped to a workspace. Drop them the moment the active
  // workspace changes so ingestion state from the previous workspace never
  // leaks into the dashboard or the knowledge centre.
  useEffect(() => {
    setDocumentsByKb({});
    setAssistants([]);
    setKnowledgeBases([]);
    setProviderKeys([]);
    setActivity([]);
    setMembers([]);
    setAnalytics(null);
    trackedKbIds.current.clear();
  }, [workspaceId]);

  // Live updates: ingestion publishes status changes while documents process.
  useEffect(() => {
    // Ingestion emits a burst of status events; coalesce them into one refresh.
    let timer = 0;
    const handler = (event: BackendEvent) => {
      if (event.type === "documents.changed" && event.knowledgeBaseId !== "*") {
        void loadDocumentsRef.current(event.knowledgeBaseId).catch(() => undefined);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshRef.current(), 150);
    };
    const unsubscribe = client.subscribe(token, workspaceId, handler);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [client, token, workspaceId]);

  const guard = useCallback(
    async <T,>(action: () => Promise<T>, successMessage?: string): Promise<T> => {
      try {
        const result = await action();
        if (successMessage) toast.success(successMessage);
        return result;
      } catch (caught) {
        toast.error("Action failed", (caught as Error).message);
        throw caught;
      }
    },
    [toast],
  );

  const value = useMemo<WorkspaceDataValue>(() => {
    const replaceAssistant = (assistant: Assistant) =>
      setAssistants((current) => {
        const exists = current.some((entry) => entry.id === assistant.id);
        return exists
          ? current.map((entry) => (entry.id === assistant.id ? assistant : entry))
          : [assistant, ...current];
      });

    return {
      ready: Boolean(workspace),
      loading,
      error,
      assistants,
      knowledgeBases,
      providerKeys,
      activity,
      analytics,
      analyticsRange,
      members,
      documentsByKb,
      credentials,
      refresh,
      setAnalyticsRange,
      loadDocuments,
      assistantById: (id) => assistants.find((entry) => entry.id === id),
      knowledgeBaseById: (id) => knowledgeBases.find((entry) => entry.id === id),

      createAssistant: (draft) =>
        guard(async () => {
          const assistant = await client.assistants.create(token, workspaceId, draft);
          replaceAssistant(assistant);
          return assistant;
        }, "Assistant created"),

      updateAssistant: (id, patch) =>
        guard(async () => {
          const assistant = await client.assistants.update(token, id, patch);
          replaceAssistant(assistant);
          return assistant;
        }),

      deleteAssistant: (id) =>
        guard(async () => {
          await client.assistants.remove(token, id);
          setAssistants((current) => current.filter((entry) => entry.id !== id));
        }, "Assistant deleted"),

      duplicateAssistant: (id) =>
        guard(async () => {
          const assistant = await client.assistants.duplicate(token, id);
          replaceAssistant(assistant);
          return assistant;
        }, "Assistant duplicated"),

      createKnowledgeBase: (input) =>
        guard(async () => {
          const knowledgeBase = await client.knowledge.create(token, workspaceId, input);
          setKnowledgeBases((current) => [...current, knowledgeBase]);
          return knowledgeBase;
        }, "Knowledge base created"),

      updateKnowledgeBase: (id, patch) =>
        guard(async () => {
          const updated = await client.knowledge.update(token, id, patch);
          setKnowledgeBases((current) =>
            current.map((entry) => (entry.id === id ? updated : entry)),
          );
        }),

      deleteKnowledgeBase: (id) =>
        guard(async () => {
          await client.knowledge.remove(token, id);
          setKnowledgeBases((current) => current.filter((entry) => entry.id !== id));
          setDocumentsByKb((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
        }, "Knowledge base deleted"),

      addTextDocument: (knowledgeBaseId, input) =>
        guard(async () => {
          const document = await client.knowledge.addText(token, { knowledgeBaseId, ...input });
          await loadDocuments(knowledgeBaseId);
          return document;
        }, "Document queued for indexing"),

      addFileDocument: (knowledgeBaseId, input) =>
        guard(async () => {
          const document = await client.knowledge.addFile(token, { knowledgeBaseId, ...input });
          await loadDocuments(knowledgeBaseId);
          return document;
        }, "File queued for indexing"),

      addUrlDocument: (knowledgeBaseId, input) =>
        guard(async () => {
          const document = await client.knowledge.addUrl(token, { knowledgeBaseId, ...input });
          await loadDocuments(knowledgeBaseId);
          return document;
        }, "URL queued for indexing"),

      updateDocument: (id, input) =>
        guard(async () => {
          const document = await client.knowledge.updateDocument(token, id, input);
          await loadDocuments(document.knowledgeBaseId);
          return document;
        }, "Document updated"),

      documentContent: (id) => client.knowledge.documentContent(token, id),

      deleteDocument: (id) =>
        guard(async () => {
          const document = Object.values(documentsByKb)
            .flat()
            .find((entry) => entry.id === id);
          await client.knowledge.removeDocument(token, id);
          if (document) await loadDocuments(document.knowledgeBaseId);
        }, "Document deleted"),

      deleteAllDocuments: (knowledgeBaseId) =>
        guard(async () => {
          await client.knowledge.removeAllDocuments(token, knowledgeBaseId);
          await loadDocuments(knowledgeBaseId);
        }, "All documents deleted"),

      reindexKnowledgeBase: (knowledgeBaseId, embedding) =>
        guard(async () => {
          await client.knowledge.reindex(token, knowledgeBaseId, embedding);
          await loadDocuments(knowledgeBaseId);
        }, "Re-indexing complete"),

      saveProviderKey: (input) =>
        guard(async () => {
          const record = await client.providers.setKey(token, workspaceId, input);
          setProviderKeys((current) => [
            ...current.filter((entry) => entry.provider !== record.provider),
            record,
          ]);
          await refreshCredentials();
        }, "Key stored for this device"),

      removeProviderKey: (provider) =>
        guard(async () => {
          await client.providers.removeKey(token, workspaceId, provider);
          setProviderKeys((current) => current.filter((entry) => entry.provider !== provider));
          await refreshCredentials();
        }, "Key removed"),

      markProviderVerified: (provider, result) =>
        guard(async () => {
          const record = await client.providers.markVerified(token, workspaceId, provider, result);
          setProviderKeys((current) =>
            current.map((entry) => (entry.provider === provider ? record : entry)),
          );
        }),

      runQuery: async (request) => {
        const response = await client.playground.query(token, request);
        void refresh();
        return response;
      },

      runSearch: async (request) => {
        const response = await client.playground.search(token, request);
        void refresh();
        return response;
      },

      listConversations: (assistantId) => client.conversations.list(token, workspaceId, assistantId),

      conversationMessages: (conversationId) => client.conversations.messages(token, conversationId),

      clearConversations: () =>
        guard(async () => {
          await client.conversations.clear(token, workspaceId);
          await refresh();
        }, "Conversation history cleared"),

      clearSampleData: () =>
        guard(async () => {
          await client.clearSampleData(token, workspaceId);
          setDocumentsByKb({});
          await refresh();
        }, "Sample data removed"),
    };
  }, [
    loading,
    error,
    assistants,
    knowledgeBases,
    providerKeys,
    activity,
    analytics,
    analyticsRange,
    members,
    documentsByKb,
    credentials,
    refresh,
    loadDocuments,
    guard,
    client,
    token,
    workspaceId,
    workspace,
    refreshCredentials,
  ]);

  return <WorkspaceDataContext.Provider value={value}>{children}</WorkspaceDataContext.Provider>;
}

export function useWorkspaceData() {
  const context = useContext(WorkspaceDataContext);
  if (!context) throw new Error("useWorkspaceData must be used inside <WorkspaceDataProvider>");
  return context;
}
