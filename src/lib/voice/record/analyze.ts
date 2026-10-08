/**
 * Take analysis for the recording studio (build 5 §3.B). Pure: works on the
 * decoded samples (Float32Array, −1…1) of one take, so the browser runs it
 * right after a take and the unit tests run it on synthetic signals.
 *
 * Warnings are codes (`record.warn.<code>` in the dictionary); none of them
 * blocks a Keep — the narrator decides.
 */

/** Below this absolute level a sample counts as silence (≈ −45 dBFS). */
export const SILENCE_LEVEL = 0.0056;
/** At or above this a sample counts as clipped (≈ −0.1 dBFS). */
export const CLIP_LEVEL = 0.99;
/** Clipped samples tolerated before warning (a single overshoot is harmless). */
export const CLIP_TOLERANCE = 3;
/** Quieter peaks than this ask for more gain (dBFS). */
export const QUIET_PEAK_DB = -24;
/** Less lead-in/tail than this risks a cut word (ms). */
export const MIN_EDGE_SILENCE_MS = 120;
/** More lead-in/tail than this is dead air to trim (ms). */
export const MAX_EDGE_SILENCE_MS = 2000;
/** Spanish read aloud for children, characters per second (unhurried). */
export const CHARS_PER_SECOND = 13;

export type TakeWarning =
  | "silent"
  | "clipping"
  | "quiet"
  | "start_cut"
  | "end_cut"
  | "long_lead"
  | "long_tail"
  | "too_short"
  | "too_long";

export type TakeAnalysis = {
  durationMs: number;
  /** Highest absolute sample, 0–1, and in dBFS (−Infinity for digital silence). */
  peak: number;
  peakDb: number;
  /** RMS over the whole take, dBFS. */
  rmsDb: number;
  clippedSamples: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  /** What we expected from the text, ms (null without text). */
  expectedMs: number | null;
  warnings: TakeWarning[];
};

export function toDb(level: number): number {
  return level > 0 ? 20 * Math.log10(level) : -Infinity;
}

/** Peak and RMS of a block of samples — what the live level meter shows. */
export function levelOf(samples: ArrayLike<number>): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    sum += v * v;
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 };
}

/** A meter position 0–1 for a level, on a −60…0 dBFS scale. */
export function meterFraction(level: number, floorDb = -60): number {
  const db = toDb(level);
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}

/** How long reading `text` should take, ms (letters and digits at `CHARS_PER_SECOND`). */
export function expectedDurationMs(text: string): number {
  const chars = (text.normalize("NFC").match(/[\p{L}\p{N}]/gu) ?? []).length;
  return Math.round((chars / CHARS_PER_SECOND) * 1000);
}

/**
 * Silence is judged on short windows (10 ms), not single samples, so a zero
 * crossing in the middle of a word is not mistaken for a pause.
 */
function edgeSilence(samples: Float32Array, sampleRate: number): { lead: number; tail: number } {
  const win = Math.max(1, Math.round(sampleRate / 100));
  const windows = Math.ceil(samples.length / win);
  const loud = (w: number) => {
    const end = Math.min(samples.length, (w + 1) * win);
    for (let i = w * win; i < end; i++) if (Math.abs(samples[i]) >= SILENCE_LEVEL) return true;
    return false;
  };
  let first = -1;
  for (let w = 0; w < windows; w++) {
    if (loud(w)) {
      first = w;
      break;
    }
  }
  if (first < 0) {
    const all = (samples.length / sampleRate) * 1000;
    return { lead: all, tail: all };
  }
  let last = first;
  for (let w = windows - 1; w >= first; w--) {
    if (loud(w)) {
      last = w;
      break;
    }
  }
  const toMs = (n: number) => (n / sampleRate) * 1000;
  return {
    lead: toMs(first * win),
    tail: toMs(Math.max(0, samples.length - Math.min(samples.length, (last + 1) * win))),
  };
}

/** Analyse one take. `text` (the line) enables the too-short / too-long checks. */
export function analyzeTake(
  samples: Float32Array,
  sampleRate: number,
  text?: string | null,
): TakeAnalysis {
  const durationMs = sampleRate > 0 ? Math.round((samples.length / sampleRate) * 1000) : 0;
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    if (v >= CLIP_LEVEL) clipped++;
    sum += v * v;
  }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  const { lead, tail } = edgeSilence(samples, sampleRate);
  const expectedMs = text?.trim() ? expectedDurationMs(text) : null;

  const warnings: TakeWarning[] = [];
  if (peak < SILENCE_LEVEL) {
    warnings.push("silent");
  } else {
    if (clipped >= CLIP_TOLERANCE) warnings.push("clipping");
    if (toDb(peak) < QUIET_PEAK_DB) warnings.push("quiet");
    if (lead < MIN_EDGE_SILENCE_MS) warnings.push("start_cut");
    else if (lead > MAX_EDGE_SILENCE_MS) warnings.push("long_lead");
    if (tail < MIN_EDGE_SILENCE_MS) warnings.push("end_cut");
    else if (tail > MAX_EDGE_SILENCE_MS) warnings.push("long_tail");
  }
  if (expectedMs !== null) {
    // Speech only: the edges are judged separately above.
    const speechMs = peak < SILENCE_LEVEL ? 0 : Math.max(0, durationMs - lead - tail);
    if (speechMs < Math.max(400, expectedMs * 0.4)) warnings.push("too_short");
    else if (speechMs > expectedMs * 2.5 + 2000) warnings.push("too_long");
  }
  return {
    durationMs,
    peak,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    clippedSamples: clipped,
    leadingSilenceMs: Math.round(lead),
    trailingSilenceMs: Math.round(tail),
    expectedMs,
    warnings,
  };
}

/** Mixes a decoded multi-channel take down to one channel (the analysis works on mono). */
export function mixDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i] / channels.length;
  return out;
}

/** The recorder's container: Opus in WebM when the browser has it, else its best. */
export const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return RECORDER_MIME_TYPES.find((t) => isSupported(t)) ?? null;
}

/** File extension for an uploaded take of `mimeType`. */
export function extensionFor(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
