/**
 * End-to-end audit of the platform API.
 *
 * Exercises the whole knowledge pipeline through the same HTTP surface the web
 * client uses: sign-up → knowledge base → document upload → server-side
 * indexing (chunk + embed + persist) → assistant binding → retrieval →
 * playground answer → public widget config → widget answer → follow-up.
 *
 * It also asserts the two properties that are invisible from the happy path:
 * one tenant can never read another tenant's index, and an assistant can only
 * retrieve the knowledge bases it is bound to.
 *
 * Usage:  node scripts/e2e-audit.mjs [baseUrl]
 * Requires a running API (default http://localhost:3000).
 */

const BASE = (process.argv[2] ?? process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(method, path, { body, token } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: response.status, json, ok: response.ok };
}

const EMBEDDING = {
  provider: "local",
  model: "pyre-hash-384",
  dimensions: 384,
  chunkSize: 400,
  chunkOverlap: 60,
};

const REFUND_TEXT = [
  "Refund policy",
  "",
  "Customers may request a refund within 14 days of purchase. The refund is returned to the original payment method within five business days of approval.",
  "",
  "After 30 days the support window is closed and no refund can be issued.",
].join("\n");

const SHIPPING_TEXT = [
  "Shipping policy",
  "",
  "Standard shipping takes three to five business days inside the country. Expedited shipping arrives on the next business day.",
].join("\n");

async function signUp(label) {
  const email = `e2e_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
  const result = await api("POST", "/auth/sign-up", {
    body: { name: `E2E ${label}`, email, password: "supersecret123" },
  });
  if (!result.ok) throw new Error(`sign-up failed: ${result.status} ${JSON.stringify(result.json)}`);
  return {
    token: result.json.session.token,
    workspaceId: result.json.workspace.id,
    userId: result.json.session.user.id,
  };
}

async function createKnowledgeBase(tenant, name) {
  const result = await api("POST", "/knowledge-bases", {
    token: tenant.token,
    body: { workspaceId: tenant.workspaceId, name, description: "" },
  });
  if (!result.ok) throw new Error(`knowledge base failed: ${result.status}`);
  return result.json;
}

async function addTextDocument(tenant, knowledgeBaseId, name, content) {
  const result = await api("POST", `/knowledge-bases/${knowledgeBaseId}/documents/text`, {
    token: tenant.token,
    body: { name, content, embedding: EMBEDDING },
  });
  if (!result.ok) throw new Error(`document add failed: ${result.status} ${JSON.stringify(result.json)}`);
  return result.json;
}

async function waitForIndex(tenant, knowledgeBaseId, documentId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const list = await api("GET", `/knowledge-bases/${knowledgeBaseId}/documents`, { token: tenant.token });
    last = (list.json ?? []).find((entry) => entry.id === documentId);
    if (last && (last.status === "indexed" || last.status === "failed")) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

async function createAssistant(tenant, name, knowledgeBaseIds) {
  const result = await api("POST", "/assistants", {
    token: tenant.token,
    body: {
      workspaceId: tenant.workspaceId,
      name,
      description: "",
      status: "active",
      systemPrompt: "You are a precise support assistant. Answer only from the context.",
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 512,
        topP: 1,
        frequencyPenalty: 0,
      },
      embedding: EMBEDDING,
      rag: {
        enabled: true,
        topK: 4,
        scoreThreshold: 0.1,
        strategy: "hybrid",
        rerank: false,
        instruction: "Be precise and cite the passages.",
        noAnswerBehavior: "refuse",
        noAnswerMessage: "I could not find that in the knowledge base.",
      },
      widget: {
        enabled: true,
        position: "bottom-right",
        theme: "dark",
        launcherLabel: "Chat",
        welcomeMessage: "Hi!",
        placeholder: "Ask…",
        showSources: true,
        primaryColor: "",
        avatarStyle: "gradient",
        cornerRadius: 16,
        showBranding: true,
        brandingText: "Parsis Bridge",
        offsetX: 0,
        offsetY: 0,
      },
      knowledgeBaseIds,
    },
  });
  if (!result.ok) throw new Error(`assistant create failed: ${result.status} ${JSON.stringify(result.json)}`);
  return result.json;
}

async function main() {
  console.log(`\nParsis Bridge — end-to-end audit against ${BASE}\n`);

  /* ---------------------------------------------------------------- health */
  console.log("1. Health");
  const health = await api("GET", "/health");
  check("API answers /health", health.ok && health.json?.status === "ok", `status ${health.status}`);
  if (!health.ok) {
    console.log("\nAPI is not reachable; aborting.\n");
    process.exit(1);
  }

  /* ------------------------------------------------------- tenant A setup */
  console.log("\n2. Tenant A: knowledge base + document upload → indexing");
  const tenantA = await signUp("a");
  check("signed up tenant A", Boolean(tenantA.token && tenantA.workspaceId));

  const kbRefunds = await createKnowledgeBase(tenantA, "Refund policies");
  const kbShipping = await createKnowledgeBase(tenantA, "Shipping policies");

  const refundDoc = await addTextDocument(tenantA, kbRefunds.id, "refunds.txt", REFUND_TEXT);
  check("upload answers immediately with a queued document", refundDoc.status === "queued", `status=${refundDoc.status}`);
  check("upload stores the chunking parameters", refundDoc.chunkCount === 0 && refundDoc.characters === REFUND_TEXT.length);

  const shippingDoc = await addTextDocument(tenantA, kbShipping.id, "shipping.txt", SHIPPING_TEXT);

  const indexedRefund = await waitForIndex(tenantA, kbRefunds.id, refundDoc.id);
  check("refund document reached `indexed`", indexedRefund?.status === "indexed", `status=${indexedRefund?.status} error=${indexedRefund?.error ?? "none"}`);
  check("refund document persisted passages", (indexedRefund?.chunkCount ?? 0) > 0, `chunkCount=${indexedRefund?.chunkCount}`);
  check("refund document recorded indexedAt", Boolean(indexedRefund?.indexedAt));
  check("refund document has no error", indexedRefund?.error === null);

  const indexedShipping = await waitForIndex(tenantA, kbShipping.id, shippingDoc.id);
  check("shipping document reached `indexed`", indexedShipping?.status === "indexed", `status=${indexedShipping?.status}`);

  const kbList = await api("GET", `/knowledge-bases?workspaceId=${tenantA.workspaceId}`, { token: tenantA.token });
  const refundsKb = (kbList.json ?? []).find((entry) => entry.id === kbRefunds.id);
  check("knowledge base reports its passage count", (refundsKb?.chunkCount ?? 0) > 0, `chunkCount=${refundsKb?.chunkCount}`);

  const content = await api("GET", `/documents/${refundDoc.id}/content`, { token: tenantA.token });
  check("document content is readable", content.ok && content.json?.content === REFUND_TEXT);

  /* ------------------------------------------------- URL ingestion (local) */
  console.log("\n3. URL document ingestion");
  const urlDoc = await api("POST", `/knowledge-bases/${kbRefunds.id}/documents/url`, {
    token: tenantA.token,
    body: { url: `${BASE}/health`, embedding: EMBEDDING },
  });
  check("URL document accepted", urlDoc.ok, JSON.stringify(urlDoc.json));
  const indexedUrl = urlDoc.ok ? await waitForIndex(tenantA, kbRefunds.id, urlDoc.json.id) : null;
  check("URL document reached `indexed`", indexedUrl?.status === "indexed", `status=${indexedUrl?.status} error=${indexedUrl?.error ?? "-"}`);
  check("URL document persisted fetched text as content", (indexedUrl?.characters ?? 0) > 0, `characters=${indexedUrl?.characters}`);
  if (urlDoc.ok) {
    await api("DELETE", `/documents/${urlDoc.json.id}`, { token: tenantA.token });
  }

  /* --------------------------------------------------------- assistant A */
  console.log("\n4. Assistant bound only to the refund knowledge base");
  const assistant = await createAssistant(tenantA, "Refund helper", [kbRefunds.id]);
  check("assistant created with a public key", Boolean(assistant.publicKey));
  check("assistant reports its binding", assistant.knowledgeBaseIds?.includes(kbRefunds.id));

  /* ------------------------------------------------------ playground path */
  console.log("\n5. Playground retrieval (authenticated)");
  const query = await api("POST", "/playground/query", {
    token: tenantA.token,
    body: { assistantId: assistant.id, question: "How many days do I have to ask for a refund?" },
  });
  check("playground query succeeded", query.ok, JSON.stringify(query.json)?.slice(0, 200));
  const retrieved = query.json?.retrieved ?? [];
  check("playground retrieved a passage", retrieved.length > 0, `retrieved=${retrieved.length}`);
  check("the retrieved passage is the refund document",
    retrieved[0]?.documentName === "refunds.txt",
    `documentName=${retrieved[0]?.documentName ?? "none"}`);
  check("retrieved passage carries a score", (retrieved[0]?.score ?? 0) > 0, `score=${retrieved[0]?.score}`);
  const answer = query.json?.message?.content ?? "";
  check("answer is grounded in the retrieved passage", answer.includes("14"),
    `answer=${answer.slice(0, 160)}`);
  check("answer cites its source", /\[\d+\]/.test(answer), `answer=${answer.slice(0, 160)}`);
  check("metadata reports extractive mode without a generation key",
    query.json?.message?.meta?.mode === "extractive",
    `mode=${query.json?.message?.meta?.mode}`);
  check("metadata carries a note explaining the mode",
    (query.json?.message?.meta?.notes ?? []).length > 0);

  const search = await api("POST", "/playground/search", {
    token: tenantA.token,
    body: { assistantId: assistant.id, query: "refund window", topK: 5, strategy: "hybrid" },
  });
  check("playground search succeeded", search.ok);
  check("search reports the scanned passage count", (search.json?.scannedChunks ?? 0) > 0, `scanned=${search.json?.scannedChunks}`);
  check("search reports the embedder used", search.json?.embeddingModel === "pyre-hash-384", `model=${search.json?.embeddingModel}`);

  /* ------------------------------------------------ assistant-scoped index */
  console.log("\n6. An assistant can only retrieve its own knowledge bases");
  const offTopic = await api("POST", "/playground/query", {
    token: tenantA.token,
    body: { assistantId: assistant.id, question: "How many business days does standard shipping take?" },
  });
  const offTopicNames = (offTopic.json?.retrieved ?? []).map((entry) => entry.documentName);
  check("shipping passage is not retrievable by the refund assistant",
    !offTopicNames.includes("shipping.txt"),
    `retrieved=${JSON.stringify(offTopicNames)}`);

  // `noAnswerBehavior: "refuse"` fires when nothing clears the score
  // threshold. Asserting it needs a threshold that excludes the loosely
  // related passage a hybrid score otherwise keeps — the default threshold
  // intentionally keeps weak matches so the model can judge them.
  const refuses = await api("POST", "/playground/query", {
    token: tenantA.token,
    body: {
      assistantId: assistant.id,
      question: "How many business days does standard shipping take?",
      scoreThresholdOverride: 0.95,
    },
  });
  check("nothing clearing the threshold yields no retrieved passages",
    (refuses.json?.retrieved ?? []).length === 0,
    `retrieved=${(refuses.json?.retrieved ?? []).length}`);
  check("an unanswerable question is refused with the configured message",
    (refuses.json?.message?.content ?? "") === "I could not find that in the knowledge base.",
    `answer=${(refuses.json?.message?.content ?? "").slice(0, 120)}`);
  check("the refusal is reported as extractive, not generated",
    refuses.json?.message?.meta?.mode === "extractive");

  /* ---------------------------------------------------------- widget path */
  console.log("\n7. Public widget (no session)");
  const widgetConfig = await api("GET", `/public/widget/${assistant.publicKey}`);
  check("widget config is served without a token", widgetConfig.ok, `status=${widgetConfig.status}`);
  check("widget config reports indexed documents", (widgetConfig.json?.documentCount ?? 0) > 0, `documentCount=${widgetConfig.json?.documentCount}`);
  check("widget config reports the bound knowledge bases", widgetConfig.json?.knowledgeBaseCount === 1, `kbCount=${widgetConfig.json?.knowledgeBaseCount}`);
  check("widget config offers hints from indexed documents", (widgetConfig.json?.hints ?? []).length > 0);
  check("widget config does not leak the workspace id", widgetConfig.json?.workspaceId === undefined);

  const widgetQuery = await api("POST", `/public/widget/${assistant.publicKey}/query`, {
    body: { question: "How long does a refund take to arrive?" },
  });
  check("widget query succeeded without a token", widgetQuery.ok, JSON.stringify(widgetQuery.json)?.slice(0, 200));
  check("widget retrieved the refund passage",
    (widgetQuery.json?.response?.retrieved ?? []).some((entry) => entry.documentName === "refunds.txt"));
  check("widget answer references the knowledge",
    /14|five business days|refund/i.test(widgetQuery.json?.response?.message?.content ?? ""),
    `answer=${(widgetQuery.json?.response?.message?.content ?? "").slice(0, 160)}`);
  const conversationId = widgetQuery.json?.conversationId;
  check("widget returned a conversation id", Boolean(conversationId));

  const followUp = await api("POST", `/public/widget/${assistant.publicKey}/query`, {
    body: { question: "And after that?", conversationId },
  });
  check("widget follow-up continues the same conversation",
    followUp.json?.conversationId === conversationId,
    `${followUp.json?.conversationId} !== ${conversationId}`);
  const widgetConversation = await api("GET", `/conversations/${conversationId}/messages`, { token: tenantA.token });
  check("widget conversation is visible to the workspace",
    (widgetConversation.json ?? []).length >= 4,
    `messages=${(widgetConversation.json ?? []).length}`);

  const foreignConversation = await api("POST", `/public/widget/${assistant.publicKey}/query`, {
    body: { question: "Hi", conversationId: "not-a-real-conversation" },
  });
  check("an unknown conversation id cannot be adopted",
    foreignConversation.ok && foreignConversation.json?.conversationId !== "not-a-real-conversation",
    `conversationId=${foreignConversation.json?.conversationId}`);

  const unknownKey = await api("GET", "/public/widget/00000000-0000-0000-0000-000000000000");
  check("an unknown public key is refused", unknownKey.status === 404, `status=${unknownKey.status}`);

  const paused = await api("PATCH", `/assistants/${assistant.id}`, {
    token: tenantA.token,
    body: { status: "paused" },
  });
  check("assistant can be paused", paused.ok);
  const pausedWidget = await api("GET", `/public/widget/${assistant.publicKey}`);
  check("a paused assistant's widget is refused", pausedWidget.status === 403, `status=${pausedWidget.status}`);
  await api("PATCH", `/assistants/${assistant.id}`, { token: tenantA.token, body: { status: "active" } });

  /* ------------------------------------------------------------- analytics */
  console.log("\n8. Analytics reflects real usage");
  const overview = await api("GET", `/analytics/overview?workspaceId=${tenantA.workspaceId}&range=7d`, { token: tenantA.token });
  const totals = overview.json?.totals ?? {};
  check("indexed document count is not stuck at zero", (totals.documentsIndexed ?? 0) > 0,
    `documentsIndexed=${totals.documentsIndexed}`);
  check("recorded queries are counted", (totals.queries ?? 0) >= 4, `queries=${totals.queries}`);
  check("latency is measured, not zeroed", (totals.avgLatencyMs ?? 0) > 0, `avgLatencyMs=${totals.avgLatencyMs}`);
  check("p95 latency is at least the average", (totals.p95LatencyMs ?? 0) >= (totals.avgLatencyMs ?? 0),
    `p95=${totals.p95LatencyMs} avg=${totals.avgLatencyMs}`);
  check("ground rate reflects answers that retrieved passages", (totals.groundRate ?? 0) > 0,
    `groundRate=${totals.groundRate}`);
  check("conversations are counted", (totals.conversations ?? 0) > 0, `conversations=${totals.conversations}`);
  check("latency buckets cover every query",
    (overview.json?.latencyBuckets ?? []).reduce((sum, bucket) => sum + bucket.count, 0) === totals.queries,
    `bucketed=${(overview.json?.latencyBuckets ?? []).reduce((sum, bucket) => sum + bucket.count, 0)} queries=${totals.queries}`);
  check("usage is attributed to the assistant by name",
    (overview.json?.byAssistant ?? []).some((entry) => entry.name === "Refund helper" && entry.queries > 0),
    JSON.stringify(overview.json?.byAssistant));
  check("top questions are ranked", (overview.json?.topQueries ?? []).length > 0,
    JSON.stringify(overview.json?.topQueries));
  check("the series has one point per day in range", (overview.json?.series ?? []).length === 7,
    `points=${(overview.json?.series ?? []).length}`);

  const activity = await api("GET", `/analytics/activity?workspaceId=${tenantA.workspaceId}&limit=20`, { token: tenantA.token });
  check("activity feed is populated by ingestion and queries", (activity.json ?? []).length > 0, `entries=${(activity.json ?? []).length}`);

  const assistantsList = await api("GET", `/assistants?workspaceId=${tenantA.workspaceId}`, { token: tenantA.token });
  const listed = (assistantsList.json ?? []).find((entry) => entry.id === assistant.id);
  check("assistant stats report its conversations", (listed?.stats?.conversations ?? 0) > 0,
    `conversations=${listed?.stats?.conversations}`);
  check("assistant stats report its messages", (listed?.stats?.messages ?? 0) > 0,
    `messages=${listed?.stats?.messages}`);
  check("assistant stats report a real last activity", Boolean(listed?.stats?.lastActivityAt),
    `lastActivityAt=${listed?.stats?.lastActivityAt}`);

  const sampleClear = await api("POST", `/workspaces/sample-data/clear?workspaceId=${tenantA.workspaceId}`, { token: tenantA.token });
  check("sample-data clear route exists and is a no-op for real data", sampleClear.ok, `status=${sampleClear.status}`);

  /* ------------------------------------------------------ tenant isolation */
  console.log("\n9. Tenant isolation");
  const tenantB = await signUp("b");
  check("signed up tenant B", Boolean(tenantB.token && tenantB.workspaceId));

  const crossQuery = await api("POST", "/playground/query", {
    token: tenantB.token,
    body: { assistantId: assistant.id, question: "refunds?" },
  });
  check("tenant B cannot query tenant A's assistant", crossQuery.status === 404, `status=${crossQuery.status}`);

  const crossSearch = await api("POST", "/playground/search", {
    token: tenantB.token,
    body: { assistantId: assistant.id, query: "refunds", topK: 3, strategy: "hybrid" },
  });
  check("tenant B cannot search tenant A's index", crossSearch.status === 404, `status=${crossSearch.status}`);

  const crossKb = await api("GET", `/knowledge-bases/${kbRefunds.id}/documents`, { token: tenantB.token });
  check("tenant B cannot list tenant A's documents", crossKb.status === 404, `status=${crossKb.status}`);

  const crossDoc = await api("GET", `/documents/${refundDoc.id}/content`, { token: tenantB.token });
  check("tenant B cannot read tenant A's document content", crossDoc.status === 404, `status=${crossDoc.status}`);

  const crossMembers = await api("GET", `/workspaces/${tenantA.workspaceId}/members`, { token: tenantB.token });
  check("tenant B cannot read tenant A's members", crossMembers.status === 404, `status=${crossMembers.status}`);

  const bKbs = await api("GET", `/knowledge-bases?workspaceId=${tenantA.workspaceId}`, { token: tenantB.token });
  check("tenant B cannot list tenant A's knowledge bases", bKbs.status === 404, `status=${bKbs.status}`);

  /* ------------------------------------------------ reindex replaces index */
  console.log("\n10. Re-indexing replaces the stored passages");
  const reindex = await api("POST", `/knowledge-bases/${kbRefunds.id}/reindex`, {
    token: tenantA.token,
    body: { ...EMBEDDING, chunkSize: 200, chunkOverlap: 40 },
  });
  check("reindex accepted", reindex.ok, JSON.stringify(reindex.json));
  const reindexed = await waitForIndex(tenantA, kbRefunds.id, refundDoc.id);
  check("document re-indexed after a chunking change", reindexed?.status === "indexed", `status=${reindexed?.status}`);
  check("re-index produced more, smaller passages", (reindexed?.chunkCount ?? 0) > (indexedRefund?.chunkCount ?? 0),
    `${indexedRefund?.chunkCount} → ${reindexed?.chunkCount}`);

  const afterReindex = await api("POST", "/playground/query", {
    token: tenantA.token,
    body: { assistantId: assistant.id, question: "How many days do I have to ask for a refund?" },
  });
  check("retrieval still works after re-indexing",
    (afterReindex.json?.retrieved ?? []).length > 0 && /14/.test(afterReindex.json?.message?.content ?? ""),
    `answer=${(afterReindex.json?.message?.content ?? "").slice(0, 120)}`);

  /* -------------------------------------------------- deletion drops chunks */
  console.log("\n11. Deleting a document removes it from retrieval");
  await api("DELETE", `/documents/${refundDoc.id}`, { token: tenantA.token });
  const afterDelete = await api("POST", "/playground/query", {
    token: tenantA.token,
    body: { assistantId: assistant.id, question: "How many days do I have to ask for a refund?" },
  });
  check("deleted document is no longer retrieved",
    (afterDelete.json?.retrieved ?? []).length === 0,
    `retrieved=${(afterDelete.json?.retrieved ?? []).length}`);

  /* --------------------------------------------------------------- summary */
  console.log(`\n${"─".repeat(60)}`);
  console.log(`passed: ${passed}   failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  • ${failure}`);
  }
  console.log("");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nAudit crashed:", error);
  process.exit(1);
});
