export * from "./types";
export {
  getApiClient,
  type ApiClient,
  type AuthResult,
  type BackendEvent,
  type Credentials,
  type FilePayload,
  type PublicWidgetConfig,
  type SignUpInput,
} from "./client";
export {
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
  PROVIDER_MAP,
  ProviderError,
  chatComplete,
  embedWithProvider,
  modelLabel,
  modelsFor,
  providerLabel,
  providersFor,
  verifyProviderKey,
} from "./providers";
export { createEmbedder, embedLocal, LOCAL_EMBEDDING_MODEL, type Embedder } from "./embedder";
export { defaultAssistantDraft, htmlToText } from "./localBackend";
