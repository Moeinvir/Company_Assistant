/**
 * Vector persistence codec.
 *
 * Storing raw float arrays as JSON would blow the browser's storage quota after
 * a few hundred chunks (a 384-dimension vector is ~8 KB of JSON text). Vectors
 * are L2-normalised, so every component is already inside [-1, 1] and quantises
 * to a signed byte with negligible ranking impact. The packed form is ~512
 * base64 characters per chunk instead of ~8 KB.
 */

export function packVector(vector: number[]): string {
  const bytes = new Uint8Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, vector[i]));
    // Map [-1, 1] onto [-127, 127].
    bytes[i] = Math.round(clamped * 127) + 128;
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function unpackVector(packed: string): number[] {
  if (!packed) return [];
  let binary: string;
  try {
    binary = atob(packed);
  } catch {
    return [];
  }
  const out = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = (binary.charCodeAt(i) - 128) / 127;
  }
  return out;
}

/** Serialised chunk shape used by the demo backend. */
export interface PackedChunk {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  documentId: string;
  index: number;
  content: string;
  tokens: number;
  vector: string;
}
