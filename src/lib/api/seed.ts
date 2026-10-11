/**
 * Sample workspace content.
 *
 * This is the only place in the codebase with canned text, and it is used for
 * exactly one purpose: seeding the clearly-labelled sample workspace so a new
 * account can see a populated product. Documents are indexed through the real
 * pipeline, so search over them returns genuine scored results. The user's own
 * workspace starts empty, and every sample record carries `isSample: true`.
 */

export interface SeedDocument {
  name: string;
  knowledgeBase: string;
  source: "text" | "url";
  sourceUrl?: string;
  content: string;
}

export const SAMPLE_KNOWLEDGE_BASES = [
  {
    name: "Product handbook",
    description: "Feature guides and configuration walkthroughs for the platform.",
  },
  {
    name: "Platform engineering",
    description: "Provider integrations, embedding choices and the security model.",
  },
  {
    name: "Support runbook",
    description: "Triage steps for retrieval quality and ingestion failures.",
  },
];

export const SAMPLE_DOCUMENTS: SeedDocument[] = [
  {
    name: "Pyre platform overview",
    knowledgeBase: "Product handbook",
    source: "text",
    content: `Pyre is a workspace for building retrieval-augmented assistants on top of knowledge you already own.
An assistant is a configuration object: a model, an embedding model, a system prompt, a retrieval
policy and one or more knowledge bases. Assistants do not hold their own copy of a document; they
reference knowledge bases, so a single upload can serve several assistants at once.

THE FOUR SURFACES
The dashboard reports platform health: assistant activity, ingestion status, query volume and
retrieval quality. The knowledge centre owns documents and their processing pipeline. The playground
is a laboratory where a query can be run against an assistant and the retrieved passages inspected
alongside the answer. The widget builder produces the embeddable client that your customers use.

HOW A QUESTION IS ANSWERED
A question is embedded with the assistant's embedding model. The vector is compared against every
indexed passage the assistant can see, and the highest scoring passages above the relevance
threshold are selected. Those passages are inserted into the prompt as numbered context, and the
model is instructed to cite the numbers it used. The response metadata records the provider, the
model, the token counts, the number of passages retrieved and the top score, so an answer can always
be traced back to the evidence behind it.

WHAT PYRE IS NOT
Pyre does not fine-tune models and it does not store your prompts for training. Retrieval quality
comes from good documents, sensible chunk sizes and an honest relevance threshold, in that order.`,
  },
  {
    name: "RAG configuration guide",
    knowledgeBase: "Product handbook",
    source: "text",
    content: `Retrieval quality is a configuration problem before it is a model problem. This guide covers the
five settings that matter most.

CHUNK SIZE AND OVERLAP
Chunk size controls how much text one retrievable passage contains; overlap controls how much of the
previous passage is repeated at the start of the next one. Large chunks retrieve broad context but
dilute the signal, so a passage about three topics matches all three weakly. Small chunks match
precisely but may cut an explanation in half. For prose, start at 900 characters with 150 characters
of overlap. For dense reference material such as API documentation, 500 to 700 characters with 100
characters of overlap usually scores better.

TOP K
Top K is the number of passages placed in the context window. A value of 4 to 6 is right for most
assistants. Raising Top K reduces the chance of a missing fact, but every extra passage costs tokens
and gives the model more opportunity to be distracted by loosely related text.

RELEVANCE THRESHOLD
The threshold is the minimum blended score a passage must reach to be used. Without a threshold,
every question retrieves something, including questions your knowledge base cannot answer. A
threshold between 0.25 and 0.45 is typical for hybrid retrieval. Raise it when answers are vague;
lower it when the assistant wrongly claims it does not know.

STRATEGY
Hybrid retrieval blends cosine similarity with BM25 keyword scoring and is the right default: vectors
capture paraphrase, keywords capture exact identifiers, error codes and product names. Use vector
only when your queries are natural language and your corpus has no shared vocabulary. Use keyword
only as a debugging tool to confirm a term exists in the index.

NO-ANSWER BEHAVIOUR
Decide what happens when nothing clears the threshold. Refusing is safer for regulated content;
answering from general knowledge is friendlier for open-ended assistants. The playground shows which
branch was taken on every request.`,
  },
  {
    name: "Connecting model providers",
    knowledgeBase: "Platform engineering",
    source: "text",
    content: `Model providers are configured per workspace and selected per assistant, so different assistants can
run on different vendors and different price points.

SUPPORTED SHAPES
Most vendors expose an OpenAI-compatible chat endpoint: OpenAI, Mistral, Groq and OpenRouter all
accept the same request body. Anthropic uses the Messages API with a system field and a version
header. Google Gemini uses generateContent with contents and generationConfig. Ollama runs locally
and needs no key; the browser talks to 127.0.0.1, so nothing leaves the machine.

KEYS AND WHERE THEY LIVE
A provider key is an operator secret. The integration screen stores it for this browser profile and
only ever displays a masked tail. In a production deployment the key belongs on the server: put it in
your platform API, add an endpoint that performs the provider call, and never ship the secret to the
client. Providers that reject cross-origin browser requests, such as Voyage AI, must be proxied this
way regardless.

VERIFYING A CONNECTION
The verify button performs a real request against the provider's models endpoint and reports the
result verbatim. A 401 means the key was rejected, a 429 means you are rate limited, and a network
failure usually means the provider does not allow browser origins. Pyre never reports a connection as
working when the request did not succeed.

FAILURE BEHAVIOUR
If the configured host is unreachable at query time, the request is reported as failed rather than
retried silently. In the playground, the answer falls back to an extractive reply assembled from the
retrieved passages, and the metadata panel states exactly why.`,
  },
  {
    name: "Choosing an embedding model",
    knowledgeBase: "Platform engineering",
    source: "text",
    content: `The embedding model determines what "similar" means for your retrieval. Changing it invalidates
every vector in the affected knowledge base, so it is a decision worth making early.

THE BUILT-IN EMBEDDER
Pyre ships a deterministic offline embedder: signed feature hashing over unigrams and bigrams, two
positions per token to reduce collisions, sublinear term weighting and L2 normalisation so cosine
similarity is a dot product. It requires no key, no network and no cost, which makes it ideal for
evaluating chunking and thresholds before you pay for anything. Its weakness is vocabulary: it cannot
recognise that "refund" and "reimbursement" are related unless both words appear.

HOSTED EMBEDDERS
text-embedding-3-large returns 3072 dimensions and is the strongest general-purpose choice among the
hosted options listed; text-embedding-3-small at 1536 dimensions is roughly five times cheaper and
sufficient for well-structured documentation. Google's text-embedding-004 returns 768 dimensions.
Cohere's embed-v4.0 is tuned for search and supports Matryoshka truncation, which lets you cut the
stored vector size without re-running the model. Voyage's voyage-3-large is strong on long documents
but does not accept browser-origin requests.

DIMENSIONS AND STORAGE
Higher dimensionality improves discrimination and increases both storage and scan cost. Retrieval in
Pyre is an exact scan, so doubling the dimensions doubles the work per query. For corpora under a few
hundred thousand passages this stays comfortably interactive; larger corpora want an approximate
index and a dedicated vector database.

SWITCHING MODELS
Switching the embedding provider or model on an assistant requires re-indexing its knowledge bases.
Pyre marks affected documents as stale rather than silently serving vectors from a model that is no
longer configured.`,
  },
  {
    name: "Deploying the chat widget",
    knowledgeBase: "Product handbook",
    source: "text",
    content: `The widget builder turns an assistant into a script tag you can drop onto any page.

WHAT THE SNIPPET DOES
The generated snippet loads a small loader script that injects a single iframe pointing at the widget
runtime for the current assistant. Everything happens inside that iframe, which means the host page's
CSS cannot break the widget and the widget cannot leak styles into the host page. The loader accepts
configuration through data attributes, and the widget reads its presentation settings from the
platform at load time, so changing the welcome message does not require editing the host page.

IDENTITY AND SECURITY
Each assistant has a public key, which is not a secret: it identifies the assistant and is visible in
the page source. The widget uses it to request the assistant's public configuration and to submit
questions. Production deployments should additionally restrict the key to an allowlist of origins and
apply per-key rate limits, so a copied key cannot be used to burn your provider budget from someone
else's site.

POSITION, THEME AND BRANDING
Position controls which corner the launcher occupies and accepts a pixel offset for sites with fixed
navigation bars. The theme can be dark, light or automatic. Primary colour defaults to the active
fire theme accent, but can be pinned to a brand colour. Branding text is shown in the widget footer
and can be disabled on paid plans.

ACCESSIBILITY
The launcher is a real button with an accessible label, the panel traps focus while open, Escape
closes it and every message is announced in a live region. The widget respects prefers-reduced-motion
for its open and close animation.`,
  },
  {
    name: "Support runbook — retrieval problems",
    knowledgeBase: "Support runbook",
    source: "text",
    content: `Use this runbook when an assistant gives vague answers, claims it does not know, or retrieves the
wrong passages.

SYMPTOM: THE ASSISTANT SAYS IT DOES NOT KNOW
Open the playground, switch to semantic search and run the exact question the customer asked. If
passages return with healthy scores, the threshold is too high or the prompt is too strict. If
nothing returns, the knowledge base is not attached to the assistant, the documents failed to index,
or the wording of the question shares no vocabulary with the corpus. Check the knowledge centre for
documents stuck in a failed state, which carry an error message describing the cause.

SYMPTOM: ANSWERS CITE IRRELEVANT PASSAGES
Compare the vector score and the keyword score in the search results. High keyword and low vector
scores usually mean the query contains a rare identifier that dominates the ranking; lower the
hybrid weight or switch to vector-only. Uniformly low scores across all results mean the embedding
model does not fit the corpus language, which calls for a different embedding model and a re-index.

SYMPTOM: DOCUMENTS STUCK IN EMBEDDING
The embedding stage is where provider failures surface. A 401 means the key is missing or revoked, a
429 means the provider is rate limiting the workspace, and a network error means the provider blocks
browser origins. Switch the affected assistant to the built-in offline embedder to unblock indexing,
then reconnect the provider.

SYMPTOM: DUPLICATE OR CONTRADICTORY ANSWERS
Duplicate passages come from uploading the same document twice, often once by file and once by URL.
Delete the older copy; the pipeline does not attempt deduplication because two documents can
legitimately share text.

ESCALATION
Collect the assistant identifier, the exact query, the retrieved passage identifiers and the response
metadata. The metadata panel exposes all of it and can be copied as JSON.`,
  },
  {
    name: "Data isolation and security model",
    knowledgeBase: "Platform engineering",
    source: "text",
    content: `Every record in Pyre belongs to exactly one workspace, and every read is scoped by the workspace ids
the caller is a member of.

TENANCY
Workspaces are the isolation boundary. Assistants, knowledge bases, documents, chunks, provider keys,
conversations and usage events all carry a workspace identifier, and the data layer refuses a request
when the authenticated principal is not a member of the workspace that owns the record. There is no
query path that returns rows across workspaces.

VECTOR ISOLATION
Retrieval never scans a global index. The candidate set is assembled from the documents in the
knowledge bases attached to the requesting assistant, inside its own workspace. An assistant cannot
retrieve a passage from a knowledge base it is not attached to, and a widget can only ever reach the
single assistant its public key identifies.

SECRETS
Provider keys are operator secrets, not user data. In this local build they are held in the browser
profile for the current workspace and only a masked tail is ever returned to the interface. The
interface never logs a key, never places it in a URL and never includes it in an error message.

RETENTION
Documents, chunks and conversations can be deleted individually or wholesale from the knowledge
centre. Deleting a document removes its chunks and vectors in the same operation, so a deleted
document cannot be retrieved afterwards. Usage events are retained for analytics and can be cleared
from settings along with the rest of the sample data.

WHAT THIS BUILD DOES NOT DO
This build runs its data layer locally in the browser. It is a faithful model of the API contract,
not a hosted service: there is no server-side authentication, no encryption at rest and no
cross-device sync. The API client interface is the seam where a real backend is attached.`,
  },
];
