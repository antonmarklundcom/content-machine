import type { VoiceProvider } from "./contract";

/** Environment variables (a plain record, so tests can pass their own). */
type Env = Record<string, string | undefined>;

/**
 * What a take costs, estimated from the text before the call (docs/VOICE.md
 * "Costs"). The estimate is what `withSpendCap` reserves and, for ElevenLabs
 * and Azure (billed per character), also what is recorded. Pure.
 */

/** ElevenLabs list price for Creator-tier overage is ≈ $0.30 per 1,000 characters. Override with ELEVENLABS_USD_PER_1K_CHARS. */
export const ELEVENLABS_DEFAULT_USD_PER_1K_CHARS = 0.3;

/** Azure neural TTS: $16 per 1M characters (the free tier's 0.5M/month is not modelled — it errs high). */
export const AZURE_USD_PER_1K_CHARS = 0.016;

/**
 * Gemini 2.5 Flash TTS (preview): $0.50 per 1M text input tokens, $10 per 1M
 * audio output tokens; audio is 25 tokens per second. Speech runs about 14
 * characters a second; 12 is used so the estimate errs high, and 4 characters
 * a token for the input.
 */
export const GEMINI_TTS_INPUT_USD_PER_M = 0.5;
export const GEMINI_TTS_OUTPUT_USD_PER_M = 10;
export const GEMINI_TTS_AUDIO_TOKENS_PER_SECOND = 25;
export const GEMINI_TTS_CHARS_PER_SECOND = 12;
export const GEMINI_TTS_CHARS_PER_TOKEN = 4;

export function elevenLabsUsdPer1k(env: Env = process.env): number {
  const raw = env.ELEVENLABS_USD_PER_1K_CHARS?.trim();
  if (!raw) return ELEVENLABS_DEFAULT_USD_PER_1K_CHARS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : ELEVENLABS_DEFAULT_USD_PER_1K_CHARS;
}

/** Characters as the provider bills them (code points, not UTF-16 units). */
export function billableChars(text: string): number {
  return [...text].length;
}

export function estimateGeminiTtsUsd(text: string, instructions = ""): number {
  const chars = billableChars(text);
  const inputTokens =
    Math.ceil((chars + billableChars(instructions)) / GEMINI_TTS_CHARS_PER_TOKEN) + 20;
  const outputTokens = Math.ceil(
    (chars / GEMINI_TTS_CHARS_PER_SECOND) * GEMINI_TTS_AUDIO_TOKENS_PER_SECOND,
  );
  return (
    (inputTokens * GEMINI_TTS_INPUT_USD_PER_M + outputTokens * GEMINI_TTS_OUTPUT_USD_PER_M) /
    1_000_000
  );
}

/** Actual Gemini TTS cost from the response's token counts. */
export function geminiTtsUsdFromUsage(promptTokens: number, outputTokens: number): number {
  return (
    (promptTokens * GEMINI_TTS_INPUT_USD_PER_M + outputTokens * GEMINI_TTS_OUTPUT_USD_PER_M) /
    1_000_000
  );
}

export function estimateTakeUsd(
  provider: VoiceProvider,
  text: string,
  opts: { instructions?: string; env?: Env } = {},
): number {
  const chars = billableChars(text);
  switch (provider) {
    case "elevenlabs":
      return (chars / 1000) * elevenLabsUsdPer1k(opts.env);
    case "azure":
      return (chars / 1000) * AZURE_USD_PER_1K_CHARS;
    case "gemini":
      return estimateGeminiTtsUsd(text, opts.instructions ?? "");
    case "manual":
      return 0;
    // Build 5. Higgsfield is paid in credits (narrations.cost_credits), not USD;
    // Chatterbox is free locally — the Replicate estimate lives in its adapter.
    case "higgsfield":
    case "chatterbox":
      return 0;
  }
}
