/** UTF-8-safe core RAG widget tests against the racode assistant. */
const PK = "7429424e-8a63-403d-9fb3-d7cf2b4a4de9";
const BASE = "http://localhost:3000";

async function query(question, conversationId) {
  const started = Date.now();
  const response = await fetch(`${BASE}/public/widget/${PK}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, ...(conversationId ? { conversationId } : {}) }),
  });
  const json = await response.json();
  return { status: response.status, json, wallMs: Date.now() - started };
}

function report(label, { status, json, wallMs }) {
  const m = json?.response?.message;
  const meta = m?.meta ?? {};
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${status} · wall ${wallMs}ms · mode=${meta.mode} · retrieved=${meta.retrievedCount} · topScore=${meta.topScore} · grounded=${meta.grounded} · genMs=${meta.latencyMs}`);
  if (meta.notes?.length) console.log(`notes: ${JSON.stringify(meta.notes)}`);
  console.log(`answer: ${(m?.content ?? JSON.stringify(json)).slice(0, 500)}`);
  for (const r of (json?.response?.retrieved ?? []).slice(0, 3)) {
    console.log(`  source: ${r.documentName} #${r.index} score=${r.score}`);
  }
  return { meta, conversationId: json?.conversationId, content: m?.content ?? "" };
}

const q1 = await query("هوش مصنوعی چیست و تاریخچهٔ آن چگونه شکل گرفت؟");
const r1 = report("1. KB question (expect model answer + citations)", q1);

const q2 = await query("مثال‌هایی از کاربردهای عملی آن بیان کن", r1.conversationId);
report("2. Follow-up (same conversation)", q2);
console.log(`conversation preserved: ${q2.conversationId === r1.conversationId}`);

const q3 = await query("آدرس دفتر گوگل در کالیفرنیا چیست؟");
report("3. Out-of-KB question", q3);

const q4 = await query("طبق همان تعریفی که دادی، نظرت چیست؟", r1.conversationId);
report("4. Referential follow-up (needs turn-1 context)", q4);

const big = await fetch(`${BASE}/public/widget/${PK}/query`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "x".repeat(5000) }),
});
console.log(`\n=== 5. Oversized question ===\nHTTP ${big.status} (expect 400)`);

const unknown = await fetch(`${BASE}/public/widget/00000000-0000-0000-0000-000000000000`);
console.log(`\n=== 6. Unknown key ===\nHTTP ${unknown.status} (expect 404)`);

console.log("\nSUMMARY:");
console.log(`grounded model answer: ${r1.meta.mode === "model" && r1.meta.grounded}`);
console.log(`retrieved > 0: ${r1.meta.retrievedCount > 0}`);
console.log(`conversation continued: ${q2.conversationId === r1.conversationId}`);
