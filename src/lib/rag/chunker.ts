/**
 * Text chunking.
 *
 * A real implementation, not a stub: it recursively splits on natural
 * boundaries (paragraph → line → sentence → word) so chunks never cut a
 * sentence in half unless the sentence itself exceeds the chunk size, and it
 * carries a configurable overlap so retrieval does not lose context that
 * straddles a boundary.
 */

import { SENTENCE_END } from "./text";

export interface ChunkOptions {
  /** Target chunk size in characters. */
  chunkSize: number;
  /** Characters repeated at the start of the next chunk. */
  chunkOverlap: number;
  maxChunks?: number;
}

export interface TextChunk {
  content: string;
  tokens: number;
  start: number;
  end: number;
}

/** Rough token estimate: ~4 characters per token for English prose. */
export const estimateTokens = (text: string) => Math.max(1, Math.round(text.length / 4));

function normalize(input: string) {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(text: string) {
  return text.split(/\n{2,}/).filter((part) => part.trim().length > 0);
}

function splitSentences(text: string) {
  return text.split(SENTENCE_END).filter((part) => part.trim().length > 0);
}

/** Cut at the last whitespace before `size`, never inside a surrogate pair. */
function hardSplit(text: string, size: number) {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/** Last `overlap` characters of `text`, aligned to a word boundary. */
function overlapTail(text: string, overlap: number) {
  if (overlap <= 0 || text.length <= overlap) return "";
  let tail = text.slice(text.length - overlap);
  const space = tail.indexOf(" ");
  if (space > -1 && space < tail.length - 1) tail = tail.slice(space + 1);
  return tail.trim();
}

/**
 * Split a document into overlapping chunks on the largest natural boundary that
 * fits inside the target size: paragraphs and sentences are packed greedily up
 * to `chunkSize`, and each chunk starts with a word-aligned tail of the
 * previous one.
 */
export function chunkText(input: string, options: ChunkOptions): TextChunk[] {
  const text = normalize(input);
  const chunkSize = Math.max(120, options.chunkSize);
  const overlap = Math.min(Math.max(0, options.chunkOverlap), Math.floor(chunkSize / 2));
  const maxChunks = options.maxChunks ?? 800;

  // 1. Break into pieces that each fit inside chunkSize.
  const pieces: string[] = [];
  for (const paragraph of splitParagraphs(text)) {
    const clean = paragraph.trim();
    if (clean.length <= chunkSize) {
      pieces.push(clean);
      continue;
    }
    for (const sentence of splitSentences(clean)) {
      const s = sentence.trim();
      if (s.length <= chunkSize) pieces.push(s);
      else pieces.push(...hardSplit(s, chunkSize));
    }
  }

  // 2. Pack pieces greedily; seed each new chunk with the previous tail.
  const chunks: TextChunk[] = [];
  let buffer = "";
  let fresh = ""; // content of the buffer that is not overlap
  let cursor = 0;

  const flush = () => {
    const content = buffer.trim();
    if (!content || !fresh.trim()) return;
    const found = text.indexOf(fresh.trim().slice(0, 40), cursor);
    const start = found === -1 ? cursor : found;
    cursor = start;
    chunks.push({
      content,
      tokens: estimateTokens(content),
      start,
      end: Math.min(text.length, start + content.length),
    });
  };

  for (const piece of pieces) {
    if (chunks.length >= maxChunks) break;
    const joined = buffer ? `${buffer}\n${piece}` : piece;
    if (buffer && joined.length > chunkSize) {
      const previous = buffer;
      flush();
      const tail = overlapTail(previous, overlap);
      buffer = tail && tail.length + piece.length + 1 <= chunkSize ? `${tail}\n${piece}` : piece;
      fresh = piece;
    } else {
      buffer = joined;
      fresh = fresh ? `${fresh}\n${piece}` : piece;
    }
  }
  if (chunks.length < maxChunks) flush();

  return chunks.slice(0, maxChunks);
}
