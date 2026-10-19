/**
 * Assistant tone — a faithful port of `src/lib/rag/tone.ts`, so a widget answer
 * carries the same tone instruction the playground would send.
 */

export type AssistantTone =
  | "professional"
  | "friendly"
  | "formal"
  | "casual"
  | "concise"
  | "empathetic";

export const DEFAULT_TONE: AssistantTone = "professional";

export const TONES: Record<AssistantTone, { instruction: string }> = {
  professional: {
    instruction: "Use a professional, clear and courteous tone.",
  },
  friendly: {
    instruction: "Use a warm, friendly and approachable tone, while staying accurate.",
  },
  formal: {
    instruction:
      "Use a formal, respectful tone. In Persian, address the user with «شما» and avoid slang.",
  },
  casual: {
    instruction: "Use a relaxed, conversational tone. Short sentences. No jargon unless needed.",
  },
  concise: {
    instruction: "Answer as briefly as possible. No preamble, no filler. Lead with the answer.",
  },
  empathetic: {
    instruction:
      "Acknowledge the user's situation briefly and empathetically before answering. Stay calm and supportive.",
  },
};

export const toneInstruction = (tone?: unknown) =>
  `Tone: ${(TONES[tone as AssistantTone] ?? TONES[DEFAULT_TONE]).instruction} Reply in the same language the user writes in.`;
