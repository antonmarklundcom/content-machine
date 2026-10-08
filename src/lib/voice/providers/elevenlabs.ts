import { charactersToWords, type CharacterAlignment } from "../alignment";
import { estimateTakeUsd } from "../costs";
import { pcmToWav } from "../wav";
import {
  failOnHttpError,
  type FetchLike,
  type ProviderVoice,
  type SynthesisProfile,
  type SynthesisResult,
  type VoiceAdapter,
} from "./types";

/**
 * ElevenLabs (docs/VOICE.md). `with-timestamps` returns base64 PCM plus
 * per-character timings, which become word timings for captions.
 * Live path UNVERIFIED until a key is in Settings.
 */

export const ELEVENLABS_BASE = "https://api.elevenlabs.io";
export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";
const SAMPLE_RATE = 44_100;

export function elevenLabsBody(text: string, profile: SynthesisProfile): Record<string, unknown> {
  const s = profile.settings;
  const voiceSettings: Record<string, number> = {};
  if (s.stability !== undefined) voiceSettings.stability = s.stability;
  if (s.similarity !== undefined) voiceSettings.similarity_boost = s.similarity;
  if (s.style !== undefined) voiceSettings.style = s.style;
  if (s.speed !== undefined) voiceSettings.speed = s.speed;
  return {
    text,
    model_id: s.model?.trim() || ELEVENLABS_DEFAULT_MODEL,
    ...(Object.keys(voiceSettings).length ? { voice_settings: voiceSettings } : {}),
  };
}

type TimestampsResponse = {
  audio_base64?: string;
  alignment?: CharacterAlignment | null;
};

export function elevenLabsAdapter(opts: { apiKey: string; fetch?: FetchLike }): VoiceAdapter {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  return {
    provider: "elevenlabs",
    async synthesize(text, profile): Promise<SynthesisResult> {
      const voiceId = encodeURIComponent(profile.providerVoiceId ?? "");
      const res = await doFetch(
        `${ELEVENLABS_BASE}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=pcm_44100`,
        {
          method: "POST",
          headers: {
            "xi-api-key": opts.apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(elevenLabsBody(text, profile)),
        },
      );
      await failOnHttpError("elevenlabs", res);
      const json = (await res.json()) as TimestampsResponse;
      if (!json.audio_base64) throw new Error("ElevenLabs answered without audio.");
      const pcm = Buffer.from(json.audio_base64, "base64");
      const words = charactersToWords(json.alignment ?? null);
      return {
        wav: pcmToWav(pcm, SAMPLE_RATE),
        sampleRate: SAMPLE_RATE,
        alignment: words.length ? words : null,
        costUsd: estimateTakeUsd("elevenlabs", text),
        model: profile.settings.model?.trim() || ELEVENLABS_DEFAULT_MODEL,
      };
    },
    async listVoices(): Promise<ProviderVoice[]> {
      const res = await doFetch(`${ELEVENLABS_BASE}/v1/voices`, {
        headers: { "xi-api-key": opts.apiKey, accept: "application/json" },
      });
      await failOnHttpError("elevenlabs", res);
      const json = (await res.json()) as {
        voices?: Array<{
          voice_id: string;
          name: string;
          labels?: Record<string, string>;
          description?: string | null;
          category?: string;
        }>;
      };
      return (json.voices ?? []).map((v) => ({
        id: v.voice_id,
        name: v.name,
        locale: v.labels?.accent ?? v.labels?.language ?? null,
        gender: v.labels?.gender ?? null,
        description: v.description ?? v.category ?? null,
      }));
    },
  };
}

/**
 * Speech-to-speech ("voice changer"): a recording re-voiced as the profile's
 * voice, keeping its timing and intonation. Returns WAV bytes.
 * UNVERIFIED (no key in the build session).
 */
export async function elevenLabsSpeechToSpeech(opts: {
  apiKey: string;
  voiceId: string;
  audio: Buffer;
  fileName: string;
  model?: string;
  fetch?: FetchLike;
}): Promise<Buffer> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(opts.audio)]), opts.fileName);
  form.set("model_id", opts.model ?? "eleven_multilingual_sts_v2");
  const res = await doFetch(
    `${ELEVENLABS_BASE}/v1/speech-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=pcm_44100`,
    { method: "POST", headers: { "xi-api-key": opts.apiKey }, body: form },
  );
  await failOnHttpError("elevenlabs", res);
  return pcmToWav(Buffer.from(await res.arrayBuffer()), SAMPLE_RATE);
}
