import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getApiClient, type ApiClient, type Credentials, type ProfilePatch } from "@/lib/api/client";
import type { ProviderId, Session, User, Workspace } from "@/lib/api/types";

const WORKSPACE_KEY = "pyre.workspace.v1";

interface SessionContextValue {
  client: ApiClient;
  clientReady: boolean;
  restoring: boolean;
  session: Session | null;
  user: User | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  /** Raw provider credentials, only populated by the offline backend. */
  credentials: Partial<Record<ProviderId, Credentials>>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Persists profile edits (name, picture) and refreshes the session user. */
  updateProfile: (patch: ProfilePatch) => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  updateWorkspace: (patch: Partial<Pick<Workspace, "name" | "plan">>) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  refreshCredentials: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ApiClient | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Partial<Record<ProviderId, Credentials>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let restored: Awaited<ReturnType<ApiClient["auth"]["restore"]>> = null;
      try {
        const api = await getApiClient();
        if (cancelled) return;
        setClient(api);
        restored = await api.auth.restore();
      } catch (error) {
        // A broken backend must not leave the app on the loading screen forever.
        console.warn("[parsis] could not restore the session", error);
      }
      if (cancelled) return;
      if (restored) {
        setSession(restored.session);
        setWorkspaces(restored.workspaces);
        const stored = (() => {
          try {
            return localStorage.getItem(WORKSPACE_KEY);
          } catch {
            return null;
          }
        })();
        const match = restored.workspaces.find((entry) => entry.id === stored);
        setWorkspaceId(match?.id ?? restored.workspace?.id ?? restored.workspaces[0]?.id ?? null);
      }
      setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const workspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? workspaces[0] ?? null,
    [workspaces, workspaceId],
  );

  const refreshCredentials = useCallback(async () => {
    if (!client || !session || !workspace) return;
    try {
      const next = await client.providers.resolveCredentials(session.token, workspace.id);
      setCredentials(next);
    } catch {
      setCredentials({});
    }
  }, [client, session, workspace]);

  useEffect(() => {
    void refreshCredentials();
  }, [refreshCredentials]);

  const adopt = useCallback((token: Session, list: Workspace[], preferred?: Workspace) => {
    setSession(token);
    setWorkspaces(list);
    const stored = (() => {
      try {
        return localStorage.getItem(WORKSPACE_KEY);
      } catch {
        return null;
      }
    })();
    const match = list.find((entry) => entry.id === stored);
    const next = match?.id ?? preferred?.id ?? list[list.length - 1]?.id ?? list[0]?.id ?? null;
    setWorkspaceId(next);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) throw new Error("Still starting up. Try again in a moment.");
      const result = await client.auth.signIn({ email, password });
      // Open the personal workspace rather than the sample one when both exist.
      const personal = result.workspaces.find((entry) => !entry.isSample);
      adopt(result.session, result.workspaces, personal ?? result.workspace);
    },
    [client, adopt],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      if (!client) throw new Error("Still starting up. Try again in a moment.");
      const result = await client.auth.signUp({ name, email, password });
      adopt(result.session, result.workspaces, result.workspace);
    },
    [client, adopt],
  );

  const signOut = useCallback(async () => {
    if (!client || !session) return;
    try {
      await client.auth.signOut(session.token);
    } catch (error) {
      console.warn("[parsis] sign-out request failed; signing out locally", error);
    }
    setSession(null);
    setWorkspaces([]);
    setWorkspaceId(null);
    setCredentials({});
  }, [client, session]);

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      if (!client || !session) throw new Error("Still starting up. Try again in a moment.");
      const user = await client.auth.updateProfile(session.token, patch);
      setSession((current) => (current ? { ...current, user } : current));
    },
    [client, session],
  );

  const selectWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    try {
      localStorage.setItem(WORKSPACE_KEY, id);
    } catch {
      /* preference is not persisted */
    }
  }, []);

  const updateWorkspace = useCallback(
    async (patch: Partial<Pick<Workspace, "name" | "plan">>) => {
      if (!client || !session || !workspace) return;
      const updated = await client.workspaces.update(session.token, workspace.id, patch);
      setWorkspaces((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    },
    [client, session, workspace],
  );

  const removeWorkspace = useCallback(
    async (id: string) => {
      if (!client || !session) return;
      await client.workspaces.remove(session.token, id);
      let remaining = await client.workspaces.list(session.token);
      // Never leave the user without a workspace (the shell would wait forever).
      if (remaining.length === 0) {
        const created = await client.workspaces.create(session.token, {
          name: `${session.user.name.split(" ")[0]}'s workspace`,
        });
        remaining = [created];
      }
      setWorkspaces(remaining);
      if (workspaceId === id) {
        const next = remaining.find((entry) => !entry.isSample) ?? remaining[0];
        setWorkspaceId(next?.id ?? null);
      }
    },
    [client, session, workspaceId],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      client: client as ApiClient,
      clientReady: Boolean(client),
      restoring,
      session,
      user: session?.user ?? null,
      workspaces,
      workspace,
      credentials,
      signIn,
      signUp,
      signOut,
      updateProfile,
      selectWorkspace,
      updateWorkspace,
      removeWorkspace,
      refreshCredentials,
    }),
    [
      client,
      restoring,
      session,
      workspaces,
      workspace,
      credentials,
      signIn,
      signUp,
      signOut,
      updateProfile,
      selectWorkspace,
      updateWorkspace,
      removeWorkspace,
      refreshCredentials,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}

/** Guarded accessor for pages that only render inside the authenticated shell. */
export function useAuthenticated() {
  const context = useSession();
  if (!context.session || !context.workspace) {
    throw new Error("This view requires an active session and workspace.");
  }
  return {
    ...context,
    session: context.session,
    workspace: context.workspace,
    token: context.session.token,
    workspaceId: context.workspace.id,
  };
}
