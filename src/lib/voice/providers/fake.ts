import { proportionalWords } from "../alignment";
import type { VoiceProvider } from "../contract";
import { estimateTakeUsd } from "../costs";
import { toneWav } from "../wav";
import { GEMINI_VOICES } from "./gemini";
import type { ProviderVoice, VoiceAdapter } from "./types";

/**
 * The voice test double (docs/VOICE.md), like `src/lib/ai-fake.ts` for
 * Gemini: `VOICE_FAKE=1` (and always under tests) swaps every adapter for
 * this. No network. A take is a quiet tone whose length follows the text
 * (~70 ms a character, at least 0.5 s) with proportional word timings, and
 * the cost the real provider would have charged, so the spend path runs.
 *
 * Nothing but `providers/index.ts` imports this.
 */

export const FAKE_MS_PER_CHAR = 70;

export function fakeDurationMs(text: string): number {
  return Math.max(500, Math.min(120_000, [...text].length * FAKE_MS_PER_CHAR));
}

/** Recorded calls, for tests: what text reached which provider. */
export const fakeVoiceCalls: Array<{
  provider: VoiceProvider;
  text: string;
  voiceId: string | null;
}> = [];

export function resetFakeVoice(): void {
  fakeVoiceCalls.length = 0;
}

const FAKE_VOICES: Record<VoiceProvider, ProviderVoice[]> = {
  elevenlabs: [
    {
      id: "fake-eleven-1",
      name: "Fake ElevenLabs narrator",
      locale: "latin american",
      gender: "female",
    },
    {
      id: "fake-eleven-2",
      name: "Fake ElevenLabs storyteller",
      locale: "latin american",
      gender: "male",
    },
  ],
  azure: [
    { id: "es-PY-TaniaNeural", name: "Tania", locale: "es-PY", gender: "Female" },
    { id: "es-PY-MarioNeural", name: "Mario", locale: "es-PY", gender: "Male" },
  ],
  gemini: GEMINI_VOICES.map((name) => ({ id: name, name })),
  manual: [],
  higgsfield: [{ id: "fake-hf-preset-1", name: "Fake Higgsfield preset", gender: "female" }],
  chatterbox: [],
};

export function fakeAdapter(provider: VoiceProvider): VoiceAdapter {
  return {
    provider,
    async synthesize(text, profile) {
      fakeVoiceCalls.push({ provider, text, voiceId: profile.providerVoiceId });
      const durationMs = fakeDurationMs(text);
      const sampleRate = provider === "elevenlabs" ? 44_100 : 24_000;
      return {
        wav: toneWav({ durationMs, sampleRate, noise: true }),
        sampleRate,
        alignment: proportionalWords(text, durationMs),
        costUsd: estimateTakeUsd(provider, text, { instructions: profile.settings.instructions }),
        model: "fake",
      };
    },
    async listVoices() {
      return FAKE_VOICES[provider];
    },
  };
}
