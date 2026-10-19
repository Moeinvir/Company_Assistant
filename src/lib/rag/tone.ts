export type AssistantTone =
  | "professional" | "friendly" | "formal" | "casual" | "concise" | "empathetic";

export const DEFAULT_TONE: AssistantTone = "professional";

export const TONES: Record<AssistantTone, { label: string; description: string; instruction: string }> = {
  professional: {
    label: "حرفه‌ای",
    description: "روشن، مؤدب و بی‌حاشیه",
    instruction: "Use a professional, clear and courteous tone.",
  },
  friendly: {
    label: "صمیمی",
    description: "گرم و دوستانه، ولی دقیق",
    instruction: "Use a warm, friendly and approachable tone, while staying accurate.",
  },
  formal: {
    label: "رسمی",
    description: "مناسب مکاتبات و مستندات رسمی",
    instruction:
      "Use a formal, respectful tone. In Persian, address the user with «شما» and avoid slang.",
  },
  casual: {
    label: "محاوره‌ای",
    description: "راحت و نزدیک به گفتار روزمره",
    instruction: "Use a relaxed, conversational tone. Short sentences. No jargon unless needed.",
  },
  concise: {
    label: "کوتاه و مستقیم",
    description: "فقط جواب، بدون مقدمه",
    instruction: "Answer as briefly as possible. No preamble, no filler. Lead with the answer.",
  },
  empathetic: {
    label: "همدلانه",
    description: "مناسب پشتیبانی و مشتری ناراضی",
    instruction:
      "Acknowledge the user's situation briefly and empathetically before answering. Stay calm and supportive.",
  },
};

export const toneInstruction = (tone?: AssistantTone) =>
  `Tone: ${(TONES[tone ?? DEFAULT_TONE] ?? TONES[DEFAULT_TONE]).instruction} Reply in the same language the user writes in.`;