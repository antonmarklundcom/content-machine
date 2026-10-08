import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";

import { parseWav } from "../wav";
import { azureAdapter } from "./azure";
import { elevenLabsAdapter, elevenLabsBody } from "./elevenlabs";
import { fakeAdapter, fakeDurationMs } from "./fake";
import { geminiTtsAdapter, geminiTtsPrompt } from "./gemini";
import type { FetchLike, SynthesisProfile } from "./types";

type Call = { url: string; init?: RequestInit };

function recorder(respond: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
  };
}

const profile = (p: Partial<SynthesisProfile>): SynthesisProfile => ({
  provider: "elevenlabs",
  providerVoiceId: "voice123",
  settings: {},
  ...p,
});

test("ElevenLabs: request shape, PCM wrapped as 44.1 kHz WAV, timings as words", async () => {
  const pcm = Buffer.alloc(44_100 * 2); // 1 s
  const text = "Hola che";
  const chars = [...text];
  const { fetch, calls } = recorder(() =>
    Response.json({
      audio_base64: pcm.toString("base64"),
      alignment: {
        characters: chars,
        character_start_times_seconds: chars.map((_, i) => i * 0.1),
        character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
      },
    }),
  );
  const adapter = elevenLabsAdapter({ apiKey: "KEY", fetch });
  const result = await adapter.synthesize(
    text,
    profile({ settings: { stability: 0.4, similarity: 0.8, style: 0.1, speed: 0.9 } }),
    { language: "es-PY" },
  );
  assert.equal(
    calls[0].url,
    "https://api.elevenlabs.io/v1/text-to-speech/voice123/with-timestamps?output_format=pcm_44100",
  );
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["xi-api-key"], "KEY");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.1, speed: 0.9 },
  });
  assert.equal(parseWav(result.wav)?.sampleRate, 44_100);
  assert.equal(parseWav(result.wav)?.durationMs, 1000);
  assert.deepEqual(result.alignment, [
    { word: "Hola", startMs: 0, endMs: 400 },
    { word: "che", startMs: 500, endMs: 800 },
  ]);
  assert.ok(result.costUsd > 0);
});

test("ElevenLabs body uses settings.model and omits empty voice settings", () => {
  assert.deepEqual(elevenLabsBody("x", profile({ settings: { model: "eleven_v3" } })), {
    text: "x",
    model_id: "eleven_v3",
  });
});

test("ElevenLabs: an HTTP error names the provider and status; voices list maps", async () => {
  const failing = elevenLabsAdapter({
    apiKey: "K",
    fetch: async () => new Response("quota exceeded", { status: 401 }),
  });
  await assert.rejects(
    failing.synthesize("x", profile({}), { language: "es" }),
    /elevenlabs answered 401: quota/,
  );

  const { fetch } = recorder(() =>
    Response.json({
      voices: [
        {
          voice_id: "v1",
          name: "Ana",
          labels: { accent: "latin", gender: "female" },
          category: "cloned",
        },
      ],
    }),
  );
  assert.deepEqual(await elevenLabsAdapter({ apiKey: "K", fetch }).listVoices(), [
    { id: "v1", name: "Ana", locale: "latin", gender: "female", description: "cloned" },
  ]);
});

test("Azure: SSML POST with the right headers; WAV passed through; no timings", async () => {
  const wav = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WAVEfmt "),
    Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0xc0, 0x5d, 0, 0, 0x80, 0xbb, 0, 0, 2, 0, 16, 0]),
    Buffer.from("data"),
    Buffer.from([0x80, 0xbb, 0, 0]),
    Buffer.alloc(48_000),
  ]);
  const { fetch, calls } = recorder(() => new Response(wav));
  const adapter = azureAdapter({ key: "AK", region: "brazilsouth", fetch });
  const result = await adapter.synthesize(
    "Vos sabés & yo",
    profile({
      provider: "azure",
      providerVoiceId: "es-PY-TaniaNeural",
      settings: { azureStyle: "calm" },
    }),
    { language: "es-PY" },
  );
  assert.equal(calls[0].url, "https://brazilsouth.tts.speech.microsoft.com/cognitiveservices/v1");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["Ocp-Apim-Subscription-Key"], "AK");
  assert.equal(headers["X-Microsoft-OutputFormat"], "riff-24khz-16bit-mono-pcm");
  assert.match(String(calls[0].init?.body), /xml:lang="es-PY".*style="calm".*Vos sabés &amp; yo/);
  assert.equal(result.sampleRate, 24_000);
  assert.equal(result.alignment, null);
  assert.equal(parseWav(result.wav)?.durationMs, 1000);
});

test("Azure: a bad region is refused before any request", async () => {
  const adapter = azureAdapter({
    key: "k",
    region: "evil.com/x",
    fetch: async () => new Response(""),
  });
  await assert.rejects(
    adapter.synthesize("x", profile({ provider: "azure" }), { language: "es-PY" }),
    /Not an Azure region/,
  );
});

test("Gemini: instructions first, AUDIO modality, voice name; PCM wrapped as WAV; cost from usage", async () => {
  let sent: GenerateContentParameters | undefined;
  const pcm = Buffer.alloc(24_000 * 2);
  const adapter = geminiTtsAdapter({
    generate: async (params) => {
      sent = params;
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/L16;codec=pcm;rate=24000",
                    data: pcm.toString("base64"),
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25 },
      } as unknown as GenerateContentResponse;
    },
  });
  const result = await adapter.synthesize(
    "¿Qué tal, che?",
    profile({
      provider: "gemini",
      providerVoiceId: "Kore",
      settings: { instructions: "Leé con acento paraguayo, cálido y pausado" },
    }),
    { language: "es-PY" },
  );
  assert.equal(sent?.model, "gemini-2.5-flash-preview-tts");
  const contents = sent?.contents as Array<{ parts: Array<{ text: string }> }>;
  assert.equal(
    contents[0].parts[0].text,
    "Leé con acento paraguayo, cálido y pausado:\n¿Qué tal, che?",
  );
  assert.deepEqual(sent?.config?.responseModalities, ["AUDIO"]);
  const speech = sent?.config?.speechConfig as {
    voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } };
  };
  assert.equal(speech.voiceConfig?.prebuiltVoiceConfig?.voiceName, "Kore");
  assert.equal(parseWav(result.wav)?.durationMs, 1000);
  assert.ok(Math.abs(result.costUsd - (100 * 0.5 + 25 * 10) / 1e6) < 1e-12);
  assert.equal(geminiTtsPrompt("x"), "x");
  assert.equal(geminiTtsPrompt("x", "Leé así:"), "Leé así:\nx");
});

test("Gemini: no audio in the answer is an error", async () => {
  const adapter = geminiTtsAdapter({
    generate: async () =>
      ({
        candidates: [{ content: { parts: [{ text: "no" }] } }],
      }) as unknown as GenerateContentResponse,
  });
  await assert.rejects(
    adapter.synthesize("x", profile({ provider: "gemini" }), { language: "es" }),
    /without audio/,
  );
});

test("the fake: WAV of text-proportional length, word timings, provider cost", async () => {
  const text = "Había una vez un sapito";
  const r = await fakeAdapter("azure").synthesize(text, profile({ provider: "azure" }), {
    language: "es-PY",
  });
  assert.equal(parseWav(r.wav)?.durationMs, fakeDurationMs(text));
  assert.equal(r.alignment?.length, 5);
  assert.ok(r.costUsd > 0);
  assert.ok((await fakeAdapter("azure").listVoices()).some((v) => v.id === "es-PY-TaniaNeural"));
});
