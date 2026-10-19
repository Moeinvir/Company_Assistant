// Measurement probe: what blended scores does the real index produce for
// questions about the racode corpus? Uses the compiled backend scoring code.
import { PrismaClient } from "@prisma/client";
import { createEmbedder } from "./dist/rag/embedder.js";
import { searchChunks } from "./dist/rag/vector-store.js";

const p = new PrismaClient();
const kbId = "cmv91u18r0004wvrg2o00rdjn";
const wsId = "cmv91thwr0001wvrgb27v1nya";

const rows = await p.documentChunk.findMany({
  where: { workspaceId: wsId, knowledgeBaseId: kbId, document: { status: "indexed" } },
  select: { id: true, documentId: true, knowledgeBaseId: true, workspaceId: true, index: true, content: true, tokens: true, vector: true },
  take: 20000,
});
console.log(`chunks: ${rows.length}`);

const embedder = createEmbedder({ provider: "local", model: "pyre-hash-384", dimensions: 384, chunkSize: 900, chunkOverlap: 150 }, () => undefined);

const questions = [
  "هوش مصنوعی چیست و تاریخچهٔ آن چگونه شکل گرفت؟",
  "یادگیری ماشین چیست؟",
  "شبکه‌های عصبی چگونه کار می‌کنند؟",
  "تاریخچه هوش مصنوعی",
];

for (const q of questions) {
  const [qv] = await embedder.embed([q], "query");
  const { results } = searchChunks(rows, q, { topK: 5, strategy: "hybrid", threshold: 0, queryVector: qv });
  const top = results.slice(0, 3).map((r) => `blend=${r.score.toFixed(3)} vec=${r.vectorScore.toFixed(3)} kw=${r.keywordScore.toFixed(3)}`);
  console.log(`\nQ: ${q}`);
  for (const line of top) console.log(`   ${line}`);
  const passing = results.filter((r) => r.score >= 0.6).length;
  console.log(`   passing 0.6: ${passing}/${results.length}`);
}
await p.$disconnect();
