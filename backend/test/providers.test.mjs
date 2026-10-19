/**
 * Provider proxy tests.
 *
 * These run against the compiled output (`npm run build` first) and a mock
 * OpenAI-compatible provider on loopback, so they never need a real API key and
 * never spend credits. Run with:  node --test test/
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");

// Windows needs file:// URLs for dynamic ESM imports.
const load = (relative) => import(pathToFileURL(join(dist, relative)).href);

const { ProvidersService } = await load(join("providers", "providers.service.js"));
const wire = await load(join("providers", "provider-wire.js"));
const { ProviderId } = await load(join("providers", "providers.dto.js"));
const { parseCorsOrigins } = await load("cors.js");

process.env.PROVIDER_KEYS_ENCRYPTION_SECRET =
  process.env.PROVIDER_KEYS_ENCRYPTION_SECRET ?? "test-secret-that-is-long-enough-for-aes-gcm";

/* --------------------------------------------------------------- mock prisma */

/** The smallest Prisma surface the providers service actually touches. */
function createPrisma({ memberships = [], credentials = [] } = {}) {
  const state = { credentials: [...credentials] };
  return {
    state,
    membership: {
      async findUnique({ where }) {
        const { userId, workspaceId } = where.userId_workspaceId;
        return memberships.some((m) => m.userId === userId && m.workspaceId === workspaceId)
          ? { workspaceId }
          : null;
      },
    },
    providerCredential: {
      async findUnique({ where }) {
        const key = where.workspaceId_provider;
        return (
          state.credentials.find(
            (entry) => entry.workspaceId === key.workspaceId && entry.provider === key.provider,
          ) ?? null
        );
      },
      async findMany({ where }) {
        return state.credentials.filter((entry) => entry.workspaceId === where.workspaceId);
      },
      async upsert({ where, create, update }) {
        const key = where.workspaceId_provider;
        const existing = state.credentials.find(
          (entry) => entry.workspaceId === key.workspaceId && entry.provider === key.provider,
        );
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const record = {
          id: `cred_${state.credentials.length + 1}`,
          lastCheckedAt: null,
          note: null,
          status: "configured",
          updatedAt: new Date(),
          ...create,
        };
        state.credentials.push(record);
        return record;
      },
      async update({ where, data }) {
        const record = state.credentials.find((entry) => entry.id === where.id);
        Object.assign(record, data);
        return record;
      },
      async deleteMany({ where }) {
        const before = state.credentials.length;
        state.credentials = state.credentials.filter(
          (entry) => !(entry.workspaceId === where.workspaceId && entry.provider === where.provider),
        );
        return { count: before - state.credentials.length };
      },
    },
  };
}

/* ------------------------------------------------------- mock provider server */

const requests = [];

function startMockProvider(handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const entry = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: body ? JSON.parse(body) : undefined,
      };
      requests.push(entry);
      handler(entry, response);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}`, port });
    });
  });
}

let mock;
let service;
let prisma;
const WORKSPACE = "ws_1";
const OTHER_WORKSPACE = "ws_2";
const USER = "user_1";
const KEY = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";

before(async () => {
  mock = await startMockProvider((entry, response) => {
    if (entry.url.endsWith("/models")) {
      if (entry.headers.authorization === "Bearer rejected") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: `LiteLLM Virtual Key expected. Received=${KEY.slice(0, 4)}****${KEY.slice(-4)}` },
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [
            { id: "z-ai/glm-4.6", name: "GLM 4.6" },
            { id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini (routed)" },
          ],
        }),
      );
      return;
    }
    if (entry.url.endsWith("/chat/completions")) {
      if (entry.headers.authorization === "Bearer rejected") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: `Invalid API key provided: ${KEY}` } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "gen-1",
          model: entry.body.model,
          choices: [{ message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  prisma = createPrisma({
    memberships: [
      { userId: USER, workspaceId: WORKSPACE },
      { userId: USER, workspaceId: OTHER_WORKSPACE },
    ],
  });
  service = new ProvidersService(prisma);
});

after(() => {
  mock.server.close();
});

/* ----------------------------------------------------------------- wire logic */

describe("wire: URL building", () => {
  it("never duplicates /v1 or the endpoint path", () => {
    assert.equal(
      wire.joinEndpoint("https://openrouter.ai/api/v1", "/chat/completions"),
      "https://openrouter.ai/api/v1/chat/completions",
    );
    assert.equal(
      wire.joinEndpoint("https://openrouter.ai/api/v1", "/v1/chat/completions"),
      "https://openrouter.ai/api/v1/chat/completions",
    );
    assert.equal(
      wire.joinEndpoint("https://openrouter.ai/api/v1/chat/completions", "/chat/completions"),
      "https://openrouter.ai/api/v1/chat/completions",
    );
    assert.equal(
      wire.joinEndpoint("https://openrouter.ai/api", "/v1/models"),
      "https://openrouter.ai/api/v1/models",
    );
    assert.equal(
      wire.joinEndpoint("https://gateway.internal/", "/models"),
      "https://gateway.internal/models",
    );
  });

  it("uses the documented OpenRouter endpoints", () => {
    const base = wire.resolveBaseUrl(ProviderId.openrouter);
    assert.equal(base, "https://openrouter.ai/api/v1");
    assert.equal(wire.modelsEndpoint(ProviderId.openrouter, base), "https://openrouter.ai/api/v1/models");
    assert.equal(
      wire.chatEndpoint(ProviderId.openrouter, base, "openai/gpt-4.1-mini"),
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  it("requires an explicit base URL for a custom gateway", () => {
    assert.throws(() => wire.resolveBaseUrl(ProviderId.custom), /base URL/i);
  });
});

describe("wire: base URL safety", () => {
  it("rejects non-http schemes, embedded credentials and metadata hosts", () => {
    assert.throws(() => wire.assertSafeBaseUrl("file:///etc/passwd", ProviderId.custom), /http/i);
    assert.throws(
      () => wire.assertSafeBaseUrl("https://user:pass@gateway.internal", ProviderId.custom),
      /credentials/i,
    );
    assert.throws(
      () => wire.assertSafeBaseUrl("http://169.254.169.254/latest/meta-data", ProviderId.custom),
      /not allowed/i,
    );
  });

  it("keeps loopback available for self-hosted runtimes", () => {
    assert.ok(wire.assertSafeBaseUrl("http://localhost:11434", ProviderId.ollama));
  });
});

describe("wire: request shaping", () => {
  it("sends OpenRouter's Bearer header, attribution headers and model id", () => {
    const headers = wire.buildHeaders(ProviderId.openrouter, KEY, { referer: "http://localhost:5273" });
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.equal(headers["x-title"], "Parsis Bridge");
    assert.equal(headers["http-referer"], "http://localhost:5273");

    const body = wire.buildChatBody(ProviderId.openrouter, {
      model: "openai/gpt-4.1-mini",
      messages: [{ role: "user", content: "ping" }],
      temperature: 3,
      maxTokens: 64,
    });
    assert.equal(body.model, "openai/gpt-4.1-mini");
    assert.equal(body.max_tokens, 64);
    assert.equal(body.temperature, 2, "temperature is clamped to the vendor range");
  });

  it("keeps Ollama's native shape and keyless headers", () => {
    const headers = wire.buildHeaders(ProviderId.ollama, null);
    assert.equal(headers.authorization, undefined);
    const body = wire.buildChatBody(ProviderId.ollama, {
      model: "llama3.2",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(body.stream, false);
    assert.equal(body.options.num_predict, 1024);
  });
});

describe("wire: responses and errors", () => {
  it("parses OpenAI-compatible and Ollama payloads", () => {
    const openai = wire.parseChatResponse(
      ProviderId.openrouter,
      {
        choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
        model: "openai/gpt-4.1-mini",
      },
      "openai/gpt-4.1-mini",
    );
    assert.equal(openai.text, "pong");
    assert.equal(openai.promptTokens, 5);
    assert.equal(openai.finishReason, "stop");

    const ollama = wire.parseChatResponse(
      ProviderId.ollama,
      { message: { content: "hi" }, prompt_eval_count: 3, eval_count: 1 },
      "llama3.2",
    );
    assert.equal(ollama.text, "hi");
    assert.equal(ollama.promptTokens, 3);
  });

  it("normalises model lists and drops unusable entries", () => {
    const models = wire.parseModelList(ProviderId.openrouter, {
      data: [{ id: "b/model" }, { id: "" }, { id: "a/model", name: "A" }],
    });
    assert.deepEqual(
      models.map((entry) => entry.id),
      ["a/model", "b/model"],
    );
  });

  it("names the problem and never echoes the key", () => {
    const failure = wire.describeUpstreamFailure(
      ProviderId.openrouter,
      401,
      JSON.stringify({ error: { message: `Invalid API key provided: ${KEY}` } }),
      KEY,
    );
    assert.match(failure.message, /rejected these credentials/i);
    assert.match(failure.message, /HTTP 401/);
    assert.ok(!failure.message.includes(KEY), "the key must not leak into the message");
    assert.equal(failure.upstreamStatus, 401);
    assert.equal(failure.httpStatus, 502);

    const rateLimited = wire.describeUpstreamFailure(ProviderId.openrouter, 429, "", KEY);
    assert.match(rateLimited.message, /rate limited/i);

    const noCredits = wire.describeUpstreamFailure(ProviderId.custom, 402, "", KEY);
    assert.match(noCredits.message, /credits/i);
  });

  it("scrubs the masked key fragments providers echo back", () => {
    const liteLlm = wire.describeUpstreamFailure(
      ProviderId.custom,
      401,
      JSON.stringify({
        error: { message: "LiteLLM Virtual Key expected. Received=dumm****-123, expected to start with 'sk-'" },
      }),
    );
    assert.equal(liteLlm.message.includes("dumm****-123"), false);
    assert.match(liteLlm.message, /rejected these credentials/i);

    const shortMask = wire.redactSecrets("Invalid API key provided: wrong-****", "wrong-key-xyz");
    assert.equal(shortMask.includes("wrong-****"), false);
  });
});

/* ------------------------------------------------------- proxy through the API */

describe("credential storage", () => {
  it("encrypts the key and returns only a masked tail", async () => {
    const record = await service.set(USER, {
      workspaceId: WORKSPACE,
      provider: ProviderId.openrouter,
      apiKey: KEY,
    });
    assert.equal(record.maskedKey, `••••${KEY.slice(-4)}`);
    assert.equal(JSON.stringify(record).includes(KEY), false, "the raw key must never be returned");

    const stored = prisma.state.credentials.find((entry) => entry.provider === ProviderId.openrouter);
    assert.ok(stored.encryptedKey);
    assert.ok(!stored.encryptedKey.includes(KEY));
    assert.notEqual(stored.iv, "");
    assert.notEqual(stored.authTag, "");
  });

  it("rejects a key-requiring provider without a key, with a clear message", async () => {
    await assert.rejects(
      () => service.set(USER, { workspaceId: WORKSPACE, provider: ProviderId.openai }),
      /requires an API key/i,
    );
  });

  it("rejects an unsafe base URL", async () => {
    await assert.rejects(
      () =>
        service.set(USER, {
          workspaceId: WORKSPACE,
          provider: ProviderId.custom,
          apiKey: KEY,
          baseUrl: "http://169.254.169.254/v1",
        }),
      /not allowed/i,
    );
  });

  it("stores a keyless runtime with just a base URL", async () => {
    const record = await service.set(USER, {
      workspaceId: WORKSPACE,
      provider: ProviderId.ollama,
      baseUrl: "http://localhost:11434",
    });
    assert.equal(record.maskedKey, "no key required");
  });
});

describe("connection checks", () => {
  it("tests a pasted key that is not stored yet (no 404)", async () => {
    const result = await service.check(USER, OTHER_WORKSPACE, ProviderId.openrouter, {
      apiKey: KEY,
      baseUrl: `${mock.origin}/api/v1`,
    });
    assert.equal(result.ok, true);
    assert.equal(result.modelCount, 2);
    assert.equal(prisma.state.credentials.some((entry) => entry.workspaceId === OTHER_WORKSPACE), false);
  });

  it("explains a missing credential instead of failing with a lookup error", async () => {
    await assert.rejects(
      () => service.check(USER, OTHER_WORKSPACE, ProviderId.openai, {}),
      (error) => {
        assert.equal(error.getStatus(), 400);
        assert.match(error.message, /no OpenAI key is stored/i);
        assert.match(error.message, /paste a key to test it/i);
        return true;
      },
    );
  });

  it("uses the stored key, sends it as a Bearer header and records the outcome", async () => {
    requests.length = 0;
    const result = await service.check(USER, WORKSPACE, ProviderId.openrouter, {
      baseUrl: `${mock.origin}/api/v1`,
    });
    assert.equal(result.ok, true);
    assert.equal(requests[0].url, "/api/v1/models");
    assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
    const record = prisma.state.credentials.find((entry) => entry.provider === ProviderId.openrouter);
    assert.equal(record.status, "verified");
    assert.equal(record.note, result.message);
  });

  it("reports an upstream rejection as an actionable message", async () => {
    await assert.rejects(
      () =>
        service.check(USER, WORKSPACE, ProviderId.openrouter, {
          apiKey: "rejected",
          baseUrl: `${mock.origin}/api/v1`,
        }),
      (error) => {
        assert.equal(error.getStatus(), 502);
        assert.match(JSON.stringify(error.getResponse()), /rejected these credentials/i);
        assert.equal(JSON.stringify(error.getResponse()).includes(KEY), false);
        return true;
      },
    );
  });
});

describe("model discovery", () => {
  it("returns the provider's own catalogue for the stored key", async () => {
    requests.length = 0;
    const models = await service.models(USER, WORKSPACE, ProviderId.openrouter, `${mock.origin}/api/v1`);
    assert.deepEqual(
      models.map((entry) => entry.id),
      ["openai/gpt-4.1-mini", "z-ai/glm-4.6"],
    );
    assert.equal(models[1].label, "GLM 4.6");
    assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  });

  it("refuses to list models without a stored key", async () => {
    await assert.rejects(
      () => service.models(USER, OTHER_WORKSPACE, ProviderId.openrouter),
      /no OpenRouter key is stored/i,
    );
  });
});

describe("chat completions", () => {
  it("sends the selected model, the messages and the Bearer header", async () => {
    requests.length = 0;
    const result = await service.chat(USER, WORKSPACE, ProviderId.openrouter, {
      model: "openai/gpt-4.1-mini",
      messages: [
        { role: "system", content: "Answer from the context." },
        { role: "user", content: "ping" },
      ],
      temperature: 0.2,
      maxTokens: 128,
      baseUrl: `${mock.origin}/api/v1`,
    });

    assert.equal(result.text, "pong");
    assert.equal(result.model, "openai/gpt-4.1-mini");
    assert.equal(result.completionTokens, 3);

    const sent = requests.at(-1);
    assert.equal(sent.url, "/api/v1/chat/completions");
    assert.equal(sent.headers.authorization, `Bearer ${KEY}`);
    assert.equal(sent.body.model, "openai/gpt-4.1-mini");
    assert.equal(sent.body.messages.length, 2);
    assert.equal(sent.body.max_tokens, 128);
  });

  it("reports an upstream authentication failure without leaking the key", async () => {
    await service.set(USER, {
      workspaceId: WORKSPACE,
      provider: ProviderId.custom,
      apiKey: "rejected",
      baseUrl: `${mock.origin}/api/v1`,
    });
    await assert.rejects(
      () =>
        service.chat(USER, WORKSPACE, ProviderId.custom, {
          model: "any-model",
          messages: [{ role: "user", content: "ping" }],
        }),
      (error) => {
        const payload = JSON.stringify(error.getResponse());
        assert.equal(error.getStatus(), 502);
        assert.match(payload, /rejected these credentials/i);
        assert.equal(payload.includes("rejected"), true);
        return true;
      },
    );
    await service.remove(USER, WORKSPACE, ProviderId.custom);
  });

  it("requires a model id", async () => {
    await assert.rejects(
      () =>
        service.chat(USER, WORKSPACE, ProviderId.openrouter, {
          model: "   ",
          messages: [{ role: "user", content: "ping" }],
        }),
      /model id is required/i,
    );
  });

  it("refuses to generate without a stored key", async () => {
    await assert.rejects(
      () =>
        service.chat(USER, OTHER_WORKSPACE, ProviderId.openai, {
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: "ping" }],
        }),
      /no OpenAI key is stored/i,
    );
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's workspace behind the membership check", async () => {
    const stranger = new ProvidersService(
      createPrisma({ memberships: [{ userId: "someone_else", workspaceId: "ws_3" }] }),
    );
    await assert.rejects(
      () => stranger.models("someone_else", WORKSPACE, ProviderId.openrouter),
      /workspace not found/i,
    );
    await assert.rejects(
      () => stranger.chat("someone_else", WORKSPACE, ProviderId.openrouter, {
        model: "openai/gpt-4.1-mini",
        messages: [{ role: "user", content: "ping" }],
      }),
      /workspace not found/i,
    );
  });

  it("never returns a stored key to the client", async () => {
    const records = await service.list(USER, WORKSPACE);
    assert.ok(records.length > 0);
    assert.equal(JSON.stringify(records).includes(KEY), false);
  });
});

/* ------------------------------------------------------- config sanity checks */

describe("deployment configuration", () => {
  it("parses the CORS allowlist and tolerates empty values", () => {
    assert.deepEqual(parseCorsOrigins("http://localhost:5273,http://localhost:8080/"), [
      "http://localhost:5273",
      "http://localhost:8080",
    ]);
    assert.equal(parseCorsOrigins(""), false);
    assert.equal(parseCorsOrigins(undefined), false);
  });

  it("keeps the frontend's proxy paths in step with the controller routes", () => {
    const controller = readFileSync(join(here, "..", "src", "providers", "providers.controller.ts"), "utf8");
    const proxy = readFileSync(join(here, "..", "..", "src", "lib", "api", "providerProxy.ts"), "utf8");

    const routes = {
      chat: /@Post\(":provider\/chat"\)/.test(controller),
      models: /@Get\(":provider\/models"\)/.test(controller),
      check: /@Post\(":provider\/check"\)/.test(controller),
    };
    assert.deepEqual(routes, { chat: true, models: true, check: true }, "controller routes changed");

    for (const path of ["/provider-keys/", "/chat", "/models", "/check"]) {
      assert.ok(proxy.includes(path), `the proxy must call ${path}`);
    }
  });
});
