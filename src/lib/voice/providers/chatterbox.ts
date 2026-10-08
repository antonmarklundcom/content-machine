import { readFile as fsReadFile } from "node:fs/promises";

import { isOnlineDeploy } from "@/lib/pc-only";
import { mediaRoot, resolveMediaFile, splitRelative } from "@/lib/storage/root";

import { NarrationRefusedError, type ChatterboxVoiceSettings } from "../contract";
import { parseWav, pcmToWav } from "../wav";
import {
  failOnHttpError,
  type FetchLike,
  type ProviderVoice,
  type SynthesisProfile,
  type SynthesisResult,
  type VoiceAdapter,
} from "./types";

/**
 * Chatterbox Multilingual (Resemble AI, MIT): clones a voice from a ~10 s
 * reference sample and speaks Spanish (and ~20 other languages, never
 * Guaraní). Two modes per profile (`settings.chatterbox.mode`), docs/CHATTERBOX.md:
 *
 * - `local`: the Python server in `tools/chatterbox-server/` on this PC
 *   (`CHATTERBOX_URL`, default http://127.0.0.1:8004). CPU, slow, free.
 * - `replicate`: Replicate's hosted model (`REPLICATE_API_TOKEN`), cents a clip.
 *
 * Long texts are split HERE (client side) into chunks of at most ~300
 * characters at sentence ends; each chunk is one request, and the WAVs are
 * joined with a short silence. Both modes behave the same, a CPU request never
 * carries a whole chapter, and the timeout applies per chunk.
 *
 * Live paths are UNVERIFIED until Anton runs the server or sets a token.
 */

type Env = Record<string, string | undefined>;

export const CHATTERBOX_DEFAULT_URL = "http://127.0.0.1:8004";
/** CPU inference is slow: generous per-request timeout. Override with CHATTERBOX_TIMEOUT_SEC. */
export const CHATTERBOX_DEFAULT_TIMEOUT_SEC = 900;
/** UNVERIFIED slug: Resemble AI's multilingual Chatterbox on Replicate. Override with CHATTERBOX_REPLICATE_MODEL. */
export const CHATTERBOX_REPLICATE_DEFAULT_MODEL = "resemble-ai/chatterbox-multilingual";
/**
 * USD per second of Replicate predict time (UNVERIFIED: Replicate's public
 * Nvidia L40S rate, $0.000975/s). Override with CHATTERBOX_REPLICATE_USD_PER_SEC.
 */
export const CHATTERBOX_REPLICATE_DEFAULT_USD_PER_SEC = 0.000975;
export const REPLICATE_API = "https://api.replicate.com/v1";
/** Longest chunk sent in one request, characters. */
export const CHATTERBOX_MAX_CHUNK_CHARS = 300;
/** Silence between joined chunks. */
export const CHATTERBOX_GAP_MS = 250;
/** Chatterbox speaks at 24 kHz. */
export const CHATTERBOX_SAMPLE_RATE = 24_000;
/** References at or under this size go inline as a data URI; larger ones are uploaded to Replicate's file API. */
export const REPLICATE_INLINE_MAX_BYTES = 256 * 1024;
const REPLICATE_POLL_MS = 2_000;

/** Languages the multilingual model speaks (its `language_id`s). */
export const CHATTERBOX_LANGUAGE_IDS = [
  "ar",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "he",
  "hi",
  "it",
  "ja",
  "ko",
  "ms",
  "nl",
  "no",
  "pl",
  "pt",
  "ru",
  "sv",
  "sw",
  "tr",
  "zh",
] as const;

const SETTINGS_URL = "“Chatterbox server URL”";
const SETTINGS_TOKEN = "“Replicate API token”";

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

function envNumber(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function chatterboxUrl(env: Env = process.env): string {
  return (env.CHATTERBOX_URL?.trim() || CHATTERBOX_DEFAULT_URL).replace(/\/+$/, "");
}

export function chatterboxTimeoutMs(env: Env = process.env): number {
  return envNumber(env, "CHATTERBOX_TIMEOUT_SEC", CHATTERBOX_DEFAULT_TIMEOUT_SEC) * 1000;
}

export function replicateModel(env: Env = process.env): string {
  return env.CHATTERBOX_REPLICATE_MODEL?.trim() || CHATTERBOX_REPLICATE_DEFAULT_MODEL;
}

export function replicateUsdPerSec(env: Env = process.env): number {
  const raw = env.CHATTERBOX_REPLICATE_USD_PER_SEC?.trim();
  if (!raw) return CHATTERBOX_REPLICATE_DEFAULT_USD_PER_SEC;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : CHATTERBOX_REPLICATE_DEFAULT_USD_PER_SEC;
}

function validHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Can any Chatterbox mode run? On the PC the local default URL is acceptable
 * without setup (the server is started by hand); online (APP_MODE=online) there
 * is no local server, so only a Replicate token counts. The adapter re-checks
 * per profile mode with a message naming the Settings field.
 */
export function chatterboxConfigured(
  env: Env = process.env,
): { ok: true } | { ok: false; message: string } {
  const url = env.CHATTERBOX_URL?.trim();
  if (url && !validHttpUrl(url)) {
    return {
      ok: false,
      message: `${SETTINGS_URL} is not an http(s) URL (“${url}”). Fix it in Settings, e.g. ${CHATTERBOX_DEFAULT_URL}.`,
    };
  }
  if (env.REPLICATE_API_TOKEN?.trim()) return { ok: true };
  if (url || !isOnlineDeploy(env)) return { ok: true };
  return {
    ok: false,
    message: `chatterbox is not set up: add ${SETTINGS_URL} or ${SETTINGS_TOKEN} in Settings.`,
  };
}

// ---------------------------------------------------------------------------
// pure helpers: language, text splitting, WAV joining
// ---------------------------------------------------------------------------

/** The model's `language_id` for a narration language; null when it does not speak it. */
export function chatterboxLanguageId(language: string, override?: string): string | null {
  if (language === "gn") return null;
  const forced = override?.trim().toLowerCase();
  if (forced) return forced;
  const base = language.toLowerCase();
  if (base === "es-py" || base === "jopara" || base === "es") return "es";
  const primary = base.split("-")[0];
  return (CHATTERBOX_LANGUAGE_IDS as readonly string[]).includes(primary) ? primary : null;
}

/** Split an over-long piece at the last comma/semicolon/colon, else the last space, else hard. */
function splitLong(piece: string, max: number): string[] {
  const out: string[] = [];
  let rest = piece.trim();
  while ([...rest].length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
      window.lastIndexOf(" — "),
    );
    if (cut > max * 0.3) cut += 1;
    else {
      cut = window.lastIndexOf(" ");
      if (cut < max * 0.3) cut = max;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Text → chunks of at most `max` characters, cut at sentence ends (. ! ? …
 * plus any closing quote or bracket), adjacent short sentences packed
 * together, over-long sentences cut at commas or spaces. Whitespace is
 * collapsed; nothing is dropped.
 */
export function splitForChatterbox(text: string, max = CHATTERBOX_MAX_CHUNK_CHARS): string[] {
  const clean = text.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]*(?:[.!?…]+["'”’»)\]]*|$)\s*/g) ?? [clean];
  const pieces = sentences.flatMap((s) => {
    const t = s.trim();
    if (!t) return [];
    return [...t].length > max ? splitLong(t, max) : [t];
  });
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const joined = current ? `${current} ${piece}` : piece;
    if ([...joined].length <= max) current = joined;
    else {
      if (current) chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Join PCM WAVs (same rate, channels, depth) with `gapMs` of silence between them. */
export function joinWavs(wavs: Buffer[], gapMs = CHATTERBOX_GAP_MS): Buffer {
  if (!wavs.length) throw new Error("Nothing to join.");
  const infos = wavs.map((w, i) => {
    const info = parseWav(w);
    if (!info) throw new Error(`Chatterbox chunk ${i + 1} is not a WAV file.`);
    return info;
  });
  const first = infos[0];
  for (const [i, info] of infos.entries()) {
    if (
      info.sampleRate !== first.sampleRate ||
      info.channels !== first.channels ||
      info.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error(
        `Chatterbox chunk ${i + 1} is ${info.sampleRate} Hz/${info.channels} ch/${info.bitsPerSample} bit; ` +
          `chunk 1 is ${first.sampleRate} Hz/${first.channels} ch/${first.bitsPerSample} bit.`,
      );
    }
  }
  const blockAlign = (first.channels * first.bitsPerSample) / 8;
  const gapBytes = Math.round((gapMs / 1000) * first.sampleRate) * blockAlign;
  const parts: Buffer[] = [];
  wavs.forEach((w, i) => {
    if (i > 0 && gapBytes > 0) parts.push(Buffer.alloc(gapBytes));
    const info = infos[i];
    parts.push(w.subarray(info.dataOffset, info.dataOffset + info.dataLength));
  });
  return pcmToWav(Buffer.concat(parts), first.sampleRate, first.channels, first.bitsPerSample);
}

// ---------------------------------------------------------------------------
// request building
// ---------------------------------------------------------------------------

export type ChatterboxRequest = {
  text: string;
  language_id: string;
  exaggeration: number;
  cfg_weight: number;
  reference_wav_base64: string;
};

/** The local server's `/tts` body (tools/chatterbox-server/server.py). */
export function localTtsBody(
  text: string,
  settings: ChatterboxVoiceSettings | undefined,
  languageId: string,
  reference: Buffer,
): ChatterboxRequest {
  return {
    text,
    language_id: languageId,
    exaggeration: settings?.exaggeration ?? 0.5,
    cfg_weight: settings?.cfgWeight ?? 0.5,
    reference_wav_base64: reference.toString("base64"),
  };
}

/**
 * Replicate prediction input. UNVERIFIED field names (the model page is the
 * truth; change them here only): `text`, `language`, `reference_audio`,
 * `exaggeration`, `cfg_weight`.
 */
export function replicateInput(
  text: string,
  settings: ChatterboxVoiceSettings | undefined,
  languageId: string,
  referenceUrl: string,
): Record<string, unknown> {
  return {
    text,
    language: languageId,
    reference_audio: referenceUrl,
    exaggeration: settings?.exaggeration ?? 0.5,
    cfg_weight: settings?.cfgWeight ?? 0.5,
  };
}

/** `owner/name` → the model's predictions endpoint; `owner/name:version` → /predictions with that version. */
export function replicatePredictionRequest(
  model: string,
  input: Record<string, unknown>,
): { url: string; body: Record<string, unknown> } {
  const [slug, version] = model.split(":");
  if (version) return { url: `${REPLICATE_API}/predictions`, body: { version, input } };
  const [owner, name] = slug.split("/");
  if (!owner || !name) throw new Error(`Not a Replicate model: “${model}” (expected owner/name).`);
  return {
    url: `${REPLICATE_API}/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`,
    body: { input },
  };
}

// ---------------------------------------------------------------------------
// the adapter
// ---------------------------------------------------------------------------

export type ChatterboxDeps = {
  fetch?: FetchLike;
  /** Reads the reference sample (absolute path). */
  readFile?: (absPath: string) => Promise<Buffer>;
  /** The media root the reference path is relative to (default MEDIA_ROOT). */
  mediaRoot?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Any audio → WAV, for Replicate outputs that are not WAV (default: ffmpeg via ../audio). */
  toWav?: (audio: Buffer) => Promise<Buffer>;
};

type ReplicatePrediction = {
  id?: string;
  status?: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: unknown;
  urls?: { get?: string; cancel?: string };
  metrics?: { predict_time?: number };
};

function noReference(name: string): NarrationRefusedError {
  return new NarrationRefusedError(
    "provider_not_configured",
    `Voice “${name}” has no Chatterbox reference sample. Upload or record a ~10 s sample ` +
      "on the voice profile (Chatterbox reference) first.",
  );
}

async function loadReference(
  profile: SynthesisProfile & { name?: string },
  deps: ChatterboxDeps,
): Promise<Buffer> {
  const name = profile.name ?? profile.providerVoiceId ?? "chatterbox";
  const rel = profile.settings.chatterbox?.referencePath?.trim();
  if (!rel) throw noReference(name);
  const segments = splitRelative(rel);
  const file = segments ? await resolveMediaFile(segments, deps.mediaRoot ?? mediaRoot()) : null;
  if (!file) {
    throw new NarrationRefusedError(
      "provider_not_configured",
      `The Chatterbox reference sample of voice “${name}” is missing (${rel}). ` +
        "Is the media drive connected? Otherwise upload the sample again.",
    );
  }
  return (deps.readFile ?? ((p) => fsReadFile(p)))(file);
}

async function defaultToWav(audio: Buffer): Promise<Buffer> {
  const [{ mkdtemp, rm, writeFile, readFile }, { tmpdir }, path, { normaliseToWav }] =
    await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
      import("../audio"),
    ]);
  const dir = await mkdtemp(path.join(tmpdir(), "chatterbox-"));
  try {
    const input = path.join(dir, "output.audio");
    const output = path.join(dir, "output.wav");
    await writeFile(input, audio);
    await normaliseToWav(input, output);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function outputUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return outputUrl(output[0]);
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    return outputUrl(o.audio ?? o.wav ?? o.url ?? null);
  }
  return null;
}

/** Is the local server up? `GET /health`; never throws. */
export async function chatterboxHealth(
  env: Env = process.env,
  doFetch: FetchLike = (input, init) => fetch(input, init),
): Promise<{ ok: true; detail: unknown } | { ok: false; message: string }> {
  const url = chatterboxUrl(env);
  try {
    const res = await doFetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { ok: false, message: `The Chatterbox server answered ${res.status}.` };
    return { ok: true, detail: await res.json().catch(() => null) };
  } catch {
    return {
      ok: false,
      message: `No Chatterbox server at ${url}. Start tools/chatterbox-server (start.bat) or fix ${SETTINGS_URL} in Settings.`,
    };
  }
}

export function chatterboxAdapter(env: Env = process.env, deps: ChatterboxDeps = {}): VoiceAdapter {
  const doFetch: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = chatterboxTimeoutMs(env);

  async function localChunk(body: ChatterboxRequest): Promise<Buffer> {
    const url = chatterboxUrl(env);
    let res: Response;
    try {
      res = await doFetch(`${url}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/wav" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new Error(
        timedOut
          ? `The Chatterbox server took longer than ${timeoutMs / 1000} s for one chunk (CHATTERBOX_TIMEOUT_SEC).`
          : `No Chatterbox server at ${url}. Start tools/chatterbox-server (start.bat) or fix ${SETTINGS_URL} in Settings.`,
      );
    }
    await failOnHttpError("chatterbox", res);
    const wav = Buffer.from(await res.arrayBuffer());
    if (!parseWav(wav))
      throw new Error("The Chatterbox server answered with something that is not a WAV file.");
    return wav;
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function replicateReference(token: string, reference: Buffer): Promise<string> {
    if (reference.length <= REPLICATE_INLINE_MAX_BYTES) {
      return `data:audio/wav;base64,${reference.toString("base64")}`;
    }
    const form = new FormData();
    form.set(
      "content",
      new Blob([new Uint8Array(reference)], { type: "audio/wav" }),
      "reference.wav",
    );
    const res = await doFetch(`${REPLICATE_API}/files`, {
      method: "POST",
      headers: auth(token),
      body: form,
    });
    await failOnHttpError("chatterbox", res);
    const json = (await res.json()) as { urls?: { get?: string } };
    if (!json.urls?.get) throw new Error("Replicate stored the reference but gave no URL.");
    return json.urls.get;
  }

  /** One prediction: create, poll until terminal or the deadline, download. */
  async function replicateChunk(
    token: string,
    input: Record<string, unknown>,
  ): Promise<{ wav: Buffer; seconds: number }> {
    const { url, body } = replicatePredictionRequest(replicateModel(env), input);
    const created = await doFetch(url, {
      method: "POST",
      headers: { ...auth(token), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await failOnHttpError("chatterbox", created);
    let prediction = (await created.json()) as ReplicatePrediction;
    const deadline = now() + timeoutMs;
    const getUrl =
      prediction.urls?.get ??
      `${REPLICATE_API}/predictions/${encodeURIComponent(prediction.id ?? "")}`;
    while (prediction.status !== "succeeded") {
      if (prediction.status === "failed" || prediction.status === "canceled") {
        throw new Error(
          `Replicate prediction ${prediction.id ?? "?"} ${prediction.status}: ${String(prediction.error ?? "no reason given").slice(0, 300)}`,
        );
      }
      if (now() >= deadline) {
        const cancel =
          prediction.urls?.cancel ??
          `${REPLICATE_API}/predictions/${encodeURIComponent(prediction.id ?? "")}/cancel`;
        await doFetch(cancel, { method: "POST", headers: auth(token) }).catch(() => undefined);
        throw new Error(
          `Replicate prediction ${prediction.id ?? "?"} did not finish within ${timeoutMs / 1000} s (CHATTERBOX_TIMEOUT_SEC); it was cancelled.`,
        );
      }
      await sleep(REPLICATE_POLL_MS);
      const res = await doFetch(getUrl, { headers: auth(token) });
      await failOnHttpError("chatterbox", res);
      prediction = (await res.json()) as ReplicatePrediction;
    }
    const out = outputUrl(prediction.output);
    if (!out)
      throw new Error(`Replicate prediction ${prediction.id ?? "?"} succeeded without audio.`);
    // The token goes to Replicate's API only, never to the delivery host.
    const download = await doFetch(out, {});
    await failOnHttpError("chatterbox", download);
    let wav: Buffer = Buffer.from(await download.arrayBuffer());
    if (!parseWav(wav)) wav = await (deps.toWav ?? defaultToWav)(wav);
    const info = parseWav(wav);
    if (!info) throw new Error("Replicate's Chatterbox output could not be read as audio.");
    const seconds = prediction.metrics?.predict_time ?? info.durationMs / 1000;
    return { wav, seconds };
  }

  return {
    provider: "chatterbox",
    async synthesize(text, profile, ctx): Promise<SynthesisResult> {
      const settings = profile.settings.chatterbox;
      const mode = settings?.mode ?? "local";
      const name = (profile as SynthesisProfile & { name?: string }).name ?? "chatterbox";
      const languageId = chatterboxLanguageId(ctx.language, settings?.languageId);
      if (!languageId) {
        throw new NarrationRefusedError(
          "language_not_supported",
          ctx.language === "gn"
            ? "No TTS voice speaks Guaraní. Guaraní takes are recorded by a native speaker and uploaded as a recording."
            : `Chatterbox does not speak ${ctx.language}.`,
        );
      }
      const token = env.REPLICATE_API_TOKEN?.trim();
      if (mode === "replicate" && !token) {
        throw new NarrationRefusedError(
          "provider_not_configured",
          `Voice “${name}” runs Chatterbox on Replicate: add ${SETTINGS_TOKEN} in Settings.`,
        );
      }
      if (mode === "local") {
        const raw = env.CHATTERBOX_URL?.trim();
        if ((raw && !validHttpUrl(raw)) || (!raw && isOnlineDeploy(env))) {
          throw new NarrationRefusedError(
            "provider_not_configured",
            `Voice “${name}” runs Chatterbox on this PC: set ${SETTINGS_URL} in Settings (e.g. ${CHATTERBOX_DEFAULT_URL}).`,
          );
        }
      }
      const reference = await loadReference(profile, deps);
      const chunks = splitForChatterbox(text);
      if (!chunks.length)
        throw new NarrationRefusedError("empty_text", "There is no text to narrate.");

      const wavs: Buffer[] = [];
      let costUsd = 0;
      if (mode === "replicate") {
        const refUrl = await replicateReference(token!, reference);
        for (const chunk of chunks) {
          const r = await replicateChunk(
            token!,
            replicateInput(chunk, settings, languageId, refUrl),
          );
          wavs.push(r.wav);
          costUsd += r.seconds * replicateUsdPerSec(env);
        }
      } else {
        for (const chunk of chunks) {
          wavs.push(await localChunk(localTtsBody(chunk, settings, languageId, reference)));
        }
      }
      const wav = wavs.length === 1 ? wavs[0] : joinWavs(wavs);
      return {
        wav,
        sampleRate: parseWav(wav)?.sampleRate ?? CHATTERBOX_SAMPLE_RATE,
        alignment: null,
        costUsd,
        model: mode === "replicate" ? replicateModel(env) : "chatterbox-multilingual (local)",
      };
    },
    async listVoices(): Promise<ProviderVoice[]> {
      return [];
    },
  };
}
