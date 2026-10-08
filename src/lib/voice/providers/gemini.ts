import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";

import { estimateTakeUsd, geminiTtsUsdFromUsage } from "../costs";
import { pcmToWav, sampleRateFromMime } from "../wav";
import type { ProviderVoice, SynthesisResult, VoiceAdapter } from "./types";

/** Environment variables (a plain record, so tests can pass their own). */
type Env = Record<string, string | undefined>;

/**
 * Gemini TTS (docs/VOICE.md) through the app's one Gemini client. The
 * profile's `settings.instructions` go first as a style direction ("Leé con
 * acento paraguayo, cálido y pausado:"). The answer is raw PCM s16le, 24 kHz
 * mono, wrapped as WAV here. No word timings. Live path UNVERIFIED.
 */

export const GEMINI_TTS_DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";

/** The prebuilt voices Gemini TTS offers (they speak every supported language). */
export const GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;

export function geminiTtsModel(env: Env = process.env): string {
  return env.GEMINI_TTS_MODEL?.trim() || GEMINI_TTS_DEFAULT_MODEL;
}

/** The prompt: the style direction, then the text. */
export function geminiTtsPrompt(text: string, instructions?: string): string {
  const direction = instructions?.trim();
  if (!direction) return text;
  return `${/[:.]$/.test(direction) ? direction : `${direction}:`}\n${text}`;
}

export function geminiTtsRequest(
  text: string,
  voiceName: string,
  opts: { instructions?: string; model?: string },
): GenerateContentParameters {
  return {
    model: opts.model || geminiTtsModel(),
    contents: [{ role: "user", parts: [{ text: geminiTtsPrompt(text, opts.instructions) }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  };
}

export type GenerateFn = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

export function geminiTtsAdapter(opts: { generate: GenerateFn }): VoiceAdapter {
  return {
    provider: "gemini",
    async synthesize(text, profile): Promise<SynthesisResult> {
      const request = geminiTtsRequest(text, profile.providerVoiceId ?? "Kore", {
        instructions: profile.settings.instructions,
        model: profile.settings.model?.trim(),
      });
      const response = await opts.generate(request);
      const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const data = part?.inlineData?.data;
      if (!data) throw new Error("Gemini TTS answered without audio.");
      const sampleRate = sampleRateFromMime(part?.inlineData?.mimeType);
      const usage = response.usageMetadata;
      const costUsd =
        usage?.candidatesTokenCount !== undefined
          ? geminiTtsUsdFromUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount)
          : estimateTakeUsd("gemini", text, { instructions: profile.settings.instructions });
      return {
        wav: pcmToWav(Buffer.from(data, "base64"), sampleRate),
        sampleRate,
        alignment: null,
        costUsd,
        model: request.model,
      };
    },
    async listVoices(): Promise<ProviderVoice[]> {
      return GEMINI_VOICES.map((name) => ({ id: name, name }));
    },
  };
}
