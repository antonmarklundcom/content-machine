import { NarrationRefusedError, type VoiceProvider } from "../contract";
import { chatterboxAdapter, chatterboxConfigured } from "./chatterbox";
import { azureAdapter } from "./azure";
import { elevenLabsAdapter, elevenLabsSpeechToSpeech } from "./elevenlabs";
import { fakeAdapter } from "./fake";
import { geminiTtsAdapter, type GenerateFn } from "./gemini";
import type { ProviderVoice, SynthesisProfile, VoiceAdapter } from "./types";

/** Environment variables (a plain record, so tests can pass their own). */
type Env = Record<string, string | undefined>;

/**
 * Which adapter speaks for a provider, and whether it can (docs/VOICE.md).
 * The ONE place that knows a fake exists: `VOICE_FAKE=1`, or a test process
 * (`NODE_ENV=test`, or the Gemini fake switched on as the integration harness
 * does), answers from `fake.ts`. `VOICE_FAKE=0` forces the real adapters.
 */

export function voiceFakeEnabled(env: Env = process.env): boolean {
  if (env.VOICE_FAKE === "0") return false;
  return env.VOICE_FAKE === "1" || env.NODE_ENV === "test" || env.GEMINI_FAKE === "1";
}

/** The Settings field (by its label) each provider needs. */
const SETTINGS_FIELD: Record<Exclude<VoiceProvider, "manual">, string> = {
  elevenlabs: "“ElevenLabs API key (voice)”",
  azure: "“Azure Speech key (voice)” and “Azure Speech region”",
  gemini: "“Gemini API key”",
  higgsfield: "nothing — Higgsfield runs through Claude Code on this PC (see /higgsfield)",
  chatterbox: "“Chatterbox server URL” or “Replicate API token”",
};

export function providerConfigured(
  provider: VoiceProvider,
  env: Env = process.env,
): { ok: true } | { ok: false; message: string } {
  if (provider === "manual") return { ok: true };
  if (voiceFakeEnabled(env)) return { ok: true };
  // Build 5. Higgsfield needs no key (the bridge's preflight checks Claude Code);
  // Chatterbox's own checks (server reachable, token per mode) live in its adapter.
  if (provider === "higgsfield") return { ok: true };
  if (provider === "chatterbox") return chatterboxConfigured(env);
  const has = (k: string) => !!env[k]?.trim();
  const ok =
    provider === "elevenlabs"
      ? has("ELEVENLABS_API_KEY")
      : provider === "azure"
        ? has("AZURE_SPEECH_KEY") && has("AZURE_SPEECH_REGION")
        : has("GEMINI_API_KEY");
  return ok
    ? { ok: true }
    : {
        ok: false,
        message: `${provider} is not set up: add ${SETTINGS_FIELD[provider]} in Settings.`,
      };
}

let geminiGenerate: GenerateFn | undefined;

/** Gemini goes through the app's one client (src/lib/ai.ts); loaded lazily so pure callers never pull it in. */
async function geminiGenerateFn(): Promise<GenerateFn> {
  if (!geminiGenerate) {
    const { geminiClient } = await import("@/lib/ai");
    geminiGenerate = (params) => geminiClient().models.generateContent(params);
  }
  return geminiGenerate;
}

export async function adapterFor(
  provider: VoiceProvider,
  env: Env = process.env,
): Promise<VoiceAdapter> {
  if (voiceFakeEnabled(env)) return fakeAdapter(provider);
  const configured = providerConfigured(provider, env);
  if (!configured.ok) throw new Error(configured.message);
  switch (provider) {
    case "elevenlabs":
      return elevenLabsAdapter({ apiKey: env.ELEVENLABS_API_KEY!.trim() });
    case "azure":
      return azureAdapter({
        key: env.AZURE_SPEECH_KEY!.trim(),
        region: env.AZURE_SPEECH_REGION!.trim(),
      });
    case "gemini":
      return geminiTtsAdapter({ generate: await geminiGenerateFn() });
    case "manual":
      throw new Error("The manual provider does not synthesise: upload a recording.");
    case "higgsfield":
      throw new NarrationRefusedError(
        "queued_provider",
        "Higgsfield takes are made in a batch job through Claude Code: use “Narrate with Higgsfield”.",
      );
    case "chatterbox":
      return chatterboxAdapter(env);
  }
}

/**
 * ElevenLabs speech-to-speech: `audio` re-voiced as the profile's voice, WAV
 * out. The fake hands the source back unchanged. UNVERIFIED live.
 */
export async function speechToSpeech(
  profile: SynthesisProfile,
  audio: Buffer,
  fileName: string,
  env: Env = process.env,
): Promise<Buffer> {
  if (voiceFakeEnabled(env)) return audio;
  const configured = providerConfigured("elevenlabs", env);
  if (!configured.ok) throw new Error(configured.message);
  return elevenLabsSpeechToSpeech({
    apiKey: env.ELEVENLABS_API_KEY!.trim(),
    voiceId: profile.providerVoiceId ?? "",
    audio,
    fileName,
  });
}

/** Voices a provider offers (the profile form's "load voices"). */
export async function listProviderVoices(provider: VoiceProvider): Promise<ProviderVoice[]> {
  if (provider === "manual") return [];
  return (await adapterFor(provider)).listVoices();
}
