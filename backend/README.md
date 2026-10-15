# Parsis Bridge API

NestJS API with PostgreSQL and Prisma. Workspace-scoped queries are checked
against the authenticated user's membership. Passwords are bcrypt-hashed and
session tokens can be revoked on sign out.

## Local setup

1. Copy `.env.example` to `.env` and set `JWT_SECRET` and
   `PROVIDER_KEYS_ENCRYPTION_SECRET` to different random values of at least 32
   characters.
2. Start PostgreSQL with `docker compose up -d postgres` from this directory,
   or point `DATABASE_URL` at an existing PostgreSQL database.
3. Run `npm install`, then `npm run prisma:generate` and
   `npm run prisma:migrate -- --name initial`.
4. Start the API with `npm run start:dev`.
5. Set `VITE_PYRE_API_URL=http://localhost:3000` in the frontend environment
   and start the Vite app.

## Current API coverage

Implemented endpoints cover sign-up/sign-in/session, workspace CRUD and
members, assistant CRUD/duplication, knowledge base CRUD, document
metadata/content CRUD, conversation history reads/clearing, encrypted
provider-key storage, the provider proxy (connection checks, model discovery,
chat completions) and basic analytics reads. Document ingestion is persisted
with a `queued` status; an asynchronous extraction/embedding/indexing worker is
not part of this backend yet, so retrieval chunks document text on demand in
the client.

## Provider proxy

Provider API keys never leave this service, and no provider request originates
in the browser — that is what keeps CORS restrictions and browser-held secrets
out of the picture entirely.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/provider-keys?workspaceId=` | Stored credentials as metadata only (`maskedKey`, status) |
| POST | `/provider-keys` | Store or replace a key (AES-256-GCM); `apiKey` is optional for keyless runtimes |
| DELETE | `/provider-keys/:provider?workspaceId=` | Remove a credential |
| GET | `/provider-keys/:provider/models?workspaceId=` | Model discovery with the stored key |
| POST | `/provider-keys/:provider/check` | Probe a connection; accepts a key that is not stored yet |
| POST | `/provider-keys/:provider/chat` | Chat completion performed by the server |
| POST | `/provider-keys/:provider/verify` | Record a check result on the stored row |

Supported providers: `openai`, `anthropic`, `google`, `mistral`, `groq`,
`openrouter`, `ollama`, `cohere`, `voyage`, `local` and `custom` (any
self-hosted, OpenAI-compatible gateway). Vendor specifics — endpoint suffixes,
auth headers, payload shapes, response normalisation and error translation —
all live in `src/providers/provider-wire.ts`, which has no Nest or database
dependency and is covered directly by the test suite.

Safety rules enforced on every provider call:

- the key is read from the encrypted credential, never from the request body
  (except `check`, where testing a key before saving is the whole point);
- a custom `baseUrl` must be `http(s)`, must not embed credentials and must not
  point at a cloud metadata address;
- upstream error bodies are redacted before they reach a client, so a rejected
  key is never echoed back;
- every upstream failure keeps its `upstreamStatus` and becomes a `502` with an
  actionable message; missing credentials and invalid payloads are `400`;
- logs record provider, workspace, status and latency — never key material.

Environment: set `APP_URL` (or the first `WEB_ORIGIN`) so OpenRouter gets a
sensible attribution header, and list every browser origin that calls the API
in `WEB_ORIGIN` (comma-separated).

## Tests

The provider suite runs against the compiled output and a mock
OpenAI-compatible provider on loopback, so it needs no API key and spends no
credits:

```bash
npm test        # builds, then: node --test "test/**/*.test.mjs"
```

It covers credential storage and masking, checks against an unsaved key, model
discovery, chat completions (model id, messages and `Authorization` header),
upstream auth failures, URL building without duplicated `/v1`, the SSRF guard,
tenant isolation and the frontend/backend route contract.

Document text is currently stored in PostgreSQL for straightforward local
development. For large deployments, move binary uploads to object storage and
run ingestion in a durable queue; keep PostgreSQL for relational metadata and
use a vector index for chunk embeddings.
