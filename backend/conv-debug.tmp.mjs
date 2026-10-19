/** Debug: conversation continuity. */
const PK = "7429424e-8a63-403d-9fb3-d7cf2b4a4de9";
const BASE = "http://localhost:3000";

const q1 = await fetch(`${BASE}/public/widget/${PK}/query`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "هوش مصنوعی چیست؟" }),
});
const j1 = await q1.json();
console.log("turn1 conversationId:", JSON.stringify(j1.conversationId));

const q2 = await fetch(`${BASE}/public/widget/${PK}/query`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "ادامه بده", conversationId: j1.conversationId }),
});
const j2 = await q2.json();
console.log("turn2 conversationId:", JSON.stringify(j2.conversationId));
console.log("same:", j1.conversationId === j2.conversationId);
