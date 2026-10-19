import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/store/session";
import { fetchProviderModels, modelsFor, PROVIDER_MAP } from "@/lib/api/providers";
import { isProviderProxyActive } from "@/lib/api/providerProxy";
import type { ModelOption, ProviderId } from "@/lib/api/types";

/**
 * Providers whose catalogue is read from the vendor at runtime. OpenRouter
 * publishes hundreds of model ids that change over time, and a custom gateway
 * serves whatever the operator deployed — neither can be a hardcoded list.
 * The curated entries stay as a fallback so a provider list still renders when
 * the account has no key yet.
 */
const DYNAMIC: ProviderId[] = ["custom", "openrouter"];

export function useChatModels(provider: ProviderId) {
  const { credentials } = useSession();
  const cred = credentials[provider];
  const dynamic = DYNAMIC.includes(provider);
  const proxied = isProviderProxyActive();
  // The fetched list remembers which provider it belongs to: switching provider
  // must never offer the previous vendor's models.
  const [remote, setRemote] = useState<{ provider: ProviderId; models: ModelOption[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dynamic) return;
    // Offline the browser needs its own key to ask the vendor. Against the API
    // the key lives on the server, so a keyless browser is not a blocker.
    if (!proxied && PROVIDER_MAP[provider]?.requiresKey && !cred?.apiKey) {
      setRemote({ provider, models: [] });
      setError("Save an API key for this provider in API & Integrations first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const models = await fetchProviderModels(provider, cred?.apiKey, cred?.baseUrl);
      setRemote({ provider, models });
    } catch (caught) {
      setRemote({ provider, models: [] });
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dynamic, proxied, provider, cred?.apiKey, cred?.baseUrl]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fresh = remote?.provider === provider;
  const curated = modelsFor(provider, "chat");
  const live = fresh ? remote.models : [];
  // Curated first (nicer labels), then everything else the vendor reports.
  const combined = dynamic
    ? [...curated, ...live.filter((entry) => !curated.some((known) => known.id === entry.id))]
    : curated;

  return {
    models: combined,
    loading: dynamic && loading,
    // A failure recorded for another provider is not this provider's problem,
    // and a usable fallback list is worth more than an error line.
    error: dynamic && fresh && combined.length === 0 ? error : null,
    reload,
    dynamic,
  };
}
