/**
 * Shared, Unicode-aware text normalisation and tokenisation.
 *
 * A faithful port of `src/lib/rag/text.ts` on the web client: the module
 * embedder, the BM25 scorer and the extractive answerer must tokenise a
 * document exactly the same way on both sides, or a query embedded in the
 * browser would not score against passages embedded on the server.
 *
 * The tokeniser is script-agnostic so Persian, Arabic, Cyrillic, CJK and Latin
 * text are treated the same way.
 */

const COMBINING_MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;

/** Lower-case, unify Arabic/Persian letter variants and strip diacritics. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064a\u0649]/g, "\u06cc") // ي ى -> ی
    .replace(/\u0643/g, "\u06a9") // ك -> ک
    .replace(/\u0629/g, "\u0647") // ة -> ه
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)) // Persian digits
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)) // Arabic digits
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .normalize("NFC");
}

/** Split into word tokens (letters/digits of any script). */
export function tokenizeWords(input: string): string[] {
  return normalizeText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && word.length < 40);
}

export const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
  "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "may", "new", "now",
  "old", "see", "two", "who", "boy", "did", "does", "let", "put", "say", "she", "too", "use",
  "with", "that", "this", "from", "they", "will", "what", "when", "them", "then", "than",
  "into", "about", "would", "there", "their", "which", "these", "those", "been", "have",
  // Persian
  "در", "به", "از", "که", "این", "آن", "را", "با", "برای", "است", "هست", "بود", "شد", "شود",
  "یا", "هم", "تا", "بر", "های", "ها", "می", "نمی", "کرد", "کند", "کنید", "باید", "چه", "چی",
  "کدام", "آیا", "من", "ما", "شما", "او", "اگر", "ولی", "اما", "همه", "هر", "یک", "دو",
]);

/** Sentence terminators for Latin, Persian/Arabic, CJK and Devanagari text. */
export const SENTENCE_END = /(?<=[.!?…؟؛۔。！？]["'»)\]]?)\s+/u;
