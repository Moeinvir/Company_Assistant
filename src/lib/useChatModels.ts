import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/store/session";
import {
  fetchProviderModels,
  modelsFor,
  PROVIDER_MAP,
} from "@/lib/api/providers";
import type { ModelOption, ProviderId } from "@/lib/api/types";

const DYNAMIC: ProviderId[] = ["custom"];

export function useChatModels(provider: ProviderId) {
  const { credentials } = useSession();
  const cred = credentials[provider];
  const dynamic = DYNAMIC.includes(provider);
  const [remote, setRemote] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dynamic) return;
    if (PROVIDER_MAP[provider]?.requiresKey && !cred?.apiKey) {
      setRemote([]);
      setError(
        "Save an API key for this provider in API & Integrations first.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRemote(
        await fetchProviderModels(provider, cred?.apiKey, cred?.baseUrl),
      );
    } catch (caught) {
      setRemote([]);
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dynamic, provider, cred?.apiKey, cred?.baseUrl]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    models: dynamic ? remote : modelsFor(provider, "chat"),
    loading,
    error,
    reload,
    dynamic,
  };
}
