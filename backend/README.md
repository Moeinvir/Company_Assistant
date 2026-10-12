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
provider-key storage, and basic analytics reads. Document ingestion is
persisted with a `queued` status; an asynchronous extraction/embedding/indexing
worker and provider-backed playground endpoints are not part of this initial
backend.

Document text is currently stored in PostgreSQL for straightforward local
development. For large deployments, move binary uploads to object storage and
run ingestion in a durable queue; keep PostgreSQL for relational metadata and
use a vector index for chunk embeddings.
