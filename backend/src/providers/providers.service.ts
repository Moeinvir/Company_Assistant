import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ChatMessageInput, ModelOption, providerName } from "./provider-wire";
import {
  buildChatBody,
  buildHeaders,
  chatEndpoint,
  describeTransportFailure,
  describeUpstreamFailure,
  modelsEndpoint,
  parseChatResponse,
  parseModelList,
  PROVIDER_ENDPOINTS,
  providerFailureException,
  requiresApiKey,
  resolveBaseUrl,
  assertSafeBaseUrl,
} from "./provider-wire";
import { ProviderId, SetProviderKeyDto } from "./providers.dto";

/** How long the API waits on a provider before giving up. */
const MODELS_TIMEOUT_MS = 20_000;
const CHAT_TIMEOUT_MS = 90_000;

interface StoredCredential {
  id: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
  baseUrl: string | null;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, workspaceId: string) {
    await this.requireWorkspace(userId, workspaceId);
    const credentials = await this.prisma.providerCredential.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    return credentials.map((entry) => this.serialize(entry));
  }

  /**
   * Store (or replace) a workspace credential. The key is encrypted before it
   * touches the database and is never echoed back — the response carries only a
   * masked tail.
   */
  async set(userId: string, input: SetProviderKeyDto) {
    await this.requireWorkspace(userId, input.workspaceId);

    const apiKey = input.apiKey?.trim() ?? "";
    const baseUrl = input.baseUrl?.trim();
    if (baseUrl) assertSafeBaseUrl(baseUrl, input.provider);

    // A keyless runtime still needs an address; the vendor default is only
    // correct for the well-known providers.
    if (!requiresApiKey(input.provider) && !baseUrl && !this.hasDefaultBaseUrl(input.provider)) {
      throw new BadRequestException(
        `${providerName(input.provider)} needs a base URL such as http://localhost:11434.`,
      );
    }
    if (requiresApiKey(input.provider) && !apiKey) {
      throw new BadRequestException(
        `${providerName(input.provider)} requires an API key. Paste the key you want this workspace to use.`,
      );
    }

    const secret = process.env.PROVIDER_KEYS_ENCRYPTION_SECRET;
    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException(
        "PROVIDER_KEYS_ENCRYPTION_SECRET must be set to at least 32 characters",
      );
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
    const encryptedKey = Buffer.concat([
      cipher.update(apiKey, "utf8"),
      cipher.final(),
    ]).toString("base64");
    const authTag = cipher.getAuthTag().toString("base64");
    const maskedKey = apiKey ? `••••${apiKey.slice(-4)}` : "no key required";

    const record = await this.prisma.providerCredential.upsert({
      where: {
        workspaceId_provider: { workspaceId: input.workspaceId, provider: input.provider },
      },
      create: {
        workspaceId: input.workspaceId,
        provider: input.provider,
        encryptedKey,
        iv: iv.toString("base64"),
        authTag,
        maskedKey,
        baseUrl,
      },
      update: {
        encryptedKey,
        iv: iv.toString("base64"),
        authTag,
        maskedKey,
        baseUrl,
        status: "configured",
        note: null,
      },
    });

    this.logger.log(
      `credential stored provider=${input.provider} workspace=${input.workspaceId} user=${userId}`,
    );
    return this.serialize(record);
  }

  async remove(userId: string, workspaceId: string, provider: ProviderId) {
    await this.requireWorkspace(userId, workspaceId);
    await this.prisma.providerCredential.deleteMany({ where: { workspaceId, provider } });
    this.logger.log(`credential removed provider=${provider} workspace=${workspaceId} user=${userId}`);
  }

  /** Records the outcome of a connection check against the stored row. */
  async markVerified(
    userId: string,
    workspaceId: string,
    provider: ProviderId,
    result: { ok: boolean; message: string },
  ) {
    await this.requireWorkspace(userId, workspaceId);
    const credential = await this.prisma.providerCredential.findUnique({
      where: { workspaceId_provider: { workspaceId, provider } },
    });
    if (!credential) throw new NotFoundException("Provider key not found");

    const updated = await this.prisma.providerCredential.update({
      where: { id: credential.id },
      data: {
        status: result.ok ? "verified" : "invalid",
        note: result.message.slice(0, 500),
        lastCheckedAt: new Date(),
      },
    });

    return this.serialize(updated);
  }

  /**
   * Test a provider connection.
   *
   * The key may come from the request (testing a key that is not stored yet) or
   * from the workspace credential. Testing before saving is the normal flow in
   * the UI, so a missing stored row is a *user* problem with a clear message —
   * never a 404 that reads like a bug.
   */
  async check(
    userId: string,
    workspaceId: string,
    provider: ProviderId,
    input: { apiKey?: string; baseUrl?: string },
  ) {
    await this.requireWorkspace(userId, workspaceId);
    const started = Date.now();

    const stored = await this.findCredential(workspaceId, provider);
    const candidate = input.apiKey?.trim();
    const apiKey = candidate ?? (stored ? this.decrypt(stored) : "");

    if (requiresApiKey(provider) && !apiKey) {
      this.logger.warn(
        `credential lookup failed provider=${provider} workspace=${workspaceId} reason=no-stored-key`,
      );
      throw new BadRequestException(
        `No ${providerName(provider)} key is stored for this workspace. Paste a key to test it, then save it.`,
      );
    }

    const baseUrl = resolveBaseUrl(provider, input.baseUrl ?? stored?.baseUrl);
    const url = modelsEndpoint(provider, baseUrl);
    const response = await this.fetchProvider(provider, url, {
      method: "GET",
      headers: buildHeaders(provider, apiKey || null, { referer: this.referer() }),
      timeoutMs: MODELS_TIMEOUT_MS,
    });

    if (!response.ok) {
      const failure = describeUpstreamFailure(provider, response.status, await response.text(), apiKey);
      this.logger.warn(
        `provider rejected credentials provider=${provider} workspace=${workspaceId} upstream=${response.status} stored=${Boolean(stored)}`,
      );
      throw providerFailureException(failure);
    }

    const models = parseModelList(provider, await response.json().catch(() => ({})));
    const message =
      models.length > 0
        ? `${providerName(provider)} accepted this key — ${models.length} model${models.length === 1 ? "" : "s"} available.`
        : `${providerName(provider)} accepted this key.`;

    // A check that used the stored key also updates the stored status, so the
    // integrations screen stays truthful even if the client forgets to report.
    if (stored && !candidate) {
      await this.prisma.providerCredential.update({
        where: { id: stored.id },
        data: { status: "verified", note: message.slice(0, 500), lastCheckedAt: new Date() },
      });
    }

    this.logger.log(
      `credential checked provider=${provider} workspace=${workspaceId} models=${models.length} latency=${Date.now() - started}ms`,
    );
    return { ok: true, message, modelCount: models.length, latencyMs: Date.now() - started };
  }

  /**
   * Model discovery for a stored credential. Uses the provider's own catalogue,
   * so the UI offers ids the account can actually call instead of a hardcoded
   * guess — this is what makes OpenRouter and custom gateways usable.
   */
  async models(
    userId: string,
    workspaceId: string,
    provider: ProviderId,
    baseUrlOverride?: string,
  ): Promise<ModelOption[]> {
    await this.requireWorkspace(userId, workspaceId);
    const stored = await this.findCredential(workspaceId, provider);
    const apiKey = stored ? this.decrypt(stored) : "";

    if (requiresApiKey(provider) && !apiKey) {
      this.logger.warn(
        `credential lookup failed provider=${provider} workspace=${workspaceId} reason=no-stored-key`,
      );
      throw new BadRequestException(
        `No ${providerName(provider)} key is stored for this workspace. Add one in API & Integrations to load its models.`,
      );
    }

    const baseUrl = resolveBaseUrl(provider, baseUrlOverride ?? stored?.baseUrl);
    const response = await this.fetchProvider(provider, modelsEndpoint(provider, baseUrl), {
      method: "GET",
      headers: buildHeaders(provider, apiKey || null, { referer: this.referer() }),
      timeoutMs: MODELS_TIMEOUT_MS,
    });

    if (!response.ok) {
      this.logger.warn(
        `model list failed provider=${provider} workspace=${workspaceId} upstream=${response.status}`,
      );
      throw providerFailureException(
        describeUpstreamFailure(provider, response.status, await response.text(), apiKey),
      );
    }

    return parseModelList(provider, await response.json().catch(() => ({})));
  }

  /**
   * Chat completion performed by the API. The browser never sees the key, and
   * because this request originates from the server there is no CORS problem
   * with providers or self-hosted gateways that refuse browser origins.
   */
  async chat(
    userId: string,
    workspaceId: string,
    provider: ProviderId,
    input: {
      model: string;
      messages: ChatMessageInput[];
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      baseUrl?: string;
    },
  ) {
    await this.requireWorkspace(userId, workspaceId);
    const started = Date.now();

    const stored = await this.findCredential(workspaceId, provider);
    const apiKey = stored ? this.decrypt(stored) : "";
    if (requiresApiKey(provider) && !apiKey) {
      this.logger.warn(
        `credential lookup failed provider=${provider} workspace=${workspaceId} reason=no-stored-key`,
      );
      throw new BadRequestException(
        `No ${providerName(provider)} key is stored for this workspace. Save the key before running a query.`,
      );
    }

    const model = input.model.trim();
    if (!model) {
      throw new BadRequestException("A model id is required to run a completion.");
    }

    const baseUrl = resolveBaseUrl(provider, input.baseUrl ?? stored?.baseUrl);
    const response = await this.fetchProvider(provider, chatEndpoint(provider, baseUrl, model), {
      method: "POST",
      headers: buildHeaders(provider, apiKey || null, { referer: this.referer() }),
      body: JSON.stringify(
        buildChatBody(provider, {
          model,
          messages: input.messages,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          topP: input.topP,
        }),
      ),
      timeoutMs: CHAT_TIMEOUT_MS,
    });

    const raw = await response.text().catch(() => "");

    if (!response.ok) {
      const failure = describeUpstreamFailure(provider, response.status, raw, apiKey);
      if (response.status === 401 || response.status === 403) {
        this.logger.warn(
          `provider authentication failed provider=${provider} workspace=${workspaceId} upstream=${response.status}`,
        );
      } else {
        this.logger.warn(
          `provider request failed provider=${provider} workspace=${workspaceId} upstream=${response.status}`,
        );
      }
      throw providerFailureException(failure);
    }

    let payload: Record<string, unknown>;
    try {
      payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      this.logger.warn(
        `provider returned non-JSON provider=${provider} workspace=${workspaceId} bytes=${raw.length}`,
      );
      throw providerFailureException({
        message: `${providerName(provider)} returned a response that was not valid JSON.`,
        hint: "The base URL may point at a web page instead of the API root.",
        upstreamStatus: response.status,
        httpStatus: 502,
      });
    }

    const result = parseChatResponse(provider, payload, model);
    this.logger.log(
      `completion provider=${provider} workspace=${workspaceId} model=${model} status=${response.status} latency=${Date.now() - started}ms promptTokens=${result.promptTokens} completionTokens=${result.completionTokens}`,
    );
    return result;
  }

  /** Fetch with a hard timeout; transport failures become actionable 5xx errors. */
  private async fetchProvider(
    provider: ProviderId,
    url: string,
    init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; timeoutMs: number },
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (error) {
      const failure = describeTransportFailure(provider, error);
      this.logger.error(
        `transport failure provider=${provider} host=${safeHost(url)} cause=${(error as Error)?.name ?? "unknown"}`,
      );
      throw providerFailureException(failure);
    }
  }

  private async findCredential(
    workspaceId: string,
    provider: ProviderId,
  ): Promise<StoredCredential | null> {
    return this.prisma.providerCredential.findUnique({
      where: { workspaceId_provider: { workspaceId, provider } },
      select: { id: true, encryptedKey: true, iv: true, authTag: true, baseUrl: true },
    });
  }

  private decrypt(credential: StoredCredential) {
    const secret = process.env.PROVIDER_KEYS_ENCRYPTION_SECRET;
    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException(
        "PROVIDER_KEYS_ENCRYPTION_SECRET must be set to at least 32 characters",
      );
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      Buffer.from(credential.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(credential.encryptedKey, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private hasDefaultBaseUrl(provider: ProviderId) {
    return Boolean(PROVIDER_ENDPOINTS[provider]?.baseUrl);
  }

  /** Attribution header for OpenRouter; no secrets, just where the traffic came from. */
  private referer() {
    return (
      process.env.APP_URL?.trim() ||
      process.env.WEB_ORIGIN?.split(",")[0]?.trim() ||
      "http://localhost:3000"
    );
  }

  private async requireWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { workspaceId: true },
    });
    if (!membership) throw new NotFoundException("Workspace not found");
  }

  private serialize(record: {
    id: string;
    workspaceId: string;
    provider: string;
    maskedKey: string;
    status: string;
    baseUrl: string | null;
    lastCheckedAt: Date | null;
    note: string | null;
    updatedAt: Date;
  }) {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      provider: record.provider as ProviderId,
      maskedKey: record.maskedKey,
      status: record.status,
      ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
      lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null,
      note: record.note,
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

/** Host only: enough to diagnose a DNS/TLS failure without logging query strings. */
function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}
