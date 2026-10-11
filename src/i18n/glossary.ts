/**
 * Persian localisation glossary — the single place to decide which words
 * are translated and which stay in English (Latin script).
 *
 * KEEP_LATIN: terms that are never translated. Persian developers read and
 * write these in English, and a forced translation is less clear than the
 * original. Every entry in ./fa.ts follows this list: these words appear in
 * the Persian text in Latin script, exactly as written here.
 *
 * To keep another word in English, add it here and keep it Latin in ./fa.ts.
 */
export const KEEP_LATIN = [
  "Pyre",
  "API",
  "RAG",
  "URL",
  "PDF",
  "DOCX",
  "TXT",
  "CSV",
  "JSON",
  "YAML",
  "HTML",
  "Markdown",
  "React",
  "JavaScript",
  "iframe",
  "CDN",
  "CORS",
  "BM25",
  "Top K",
  "Top P",
  "OpenAI",
  "Anthropic",
  "Google",
  "Gemini",
  "Mistral",
  "Groq",
  "OpenRouter",
  "Ollama",
  "Cohere",
  "Voyage AI",
  "Embedding",
  "Embeddings",
] as const;

/**
 * Preferred Persian terms (documentation only — the real mapping lives in
 * ./fa.ts). Keeping the choices here makes reviews of wording easy.
 */
export const PREFERRED_TERMS: Record<string, string> = {
  dashboard: "داشبورد",
  workspace: "فضای کاری",
  assistant: "دستیار",
  "knowledge base": "پایگاه دانش",
  document: "سند",
  "chunk / passage": "قطعه",
  provider: "ارائه‌دهنده",
  model: "مدل",
  prompt: "پرامپت",
  token: "توکن",
  widget: "ویجت",
  playground: "محیط آزمایش",
  index: "ایندکس",
  retrieval: "بازیابی",
  latency: "تأخیر",
  temperature: "دما",
};
