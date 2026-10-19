/** Rate-limit probe. Uses nonsense questions so retrieval refuses fast (no LLM call). */
const PK = "7429424e-8a63-403d-9fb3-d7cf2b4a4de9";
const BASE = "http://localhost:3000";

let first429 = null;
let statuses = {};
for (let i = 0; i < 40; i += 1) {
  const response = await fetch(`${BASE}/public/widget/${PK}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "zzz qqq xxx www vvv" }),
  });
  statuses[response.status] = (statuses[response.status] ?? 0) + 1;
  if (response.status === 429 && !first429) {
    first429 = i + 1;
    const body = await response.json();
    console.log(`429 first at request ${i + 1}: ${body.message}`);
  }
}
console.log(`status distribution over 40 requests: ${JSON.stringify(statuses)}`);
console.log(first429 ? `RATE LIMIT OK (tripped at ${first429})` : "RATE LIMIT NOT WORKING");
