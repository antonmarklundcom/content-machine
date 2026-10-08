import type {
  HiggsfieldTtsModel,
  HiggsfieldTtsVariant,
  HiggsfieldVoiceSettings,
} from "@/lib/voice/contract";
import { HIGGSFIELD_TTS_MODELS, HIGGSFIELD_TTS_VARIANTS } from "@/lib/voice/contract";

import { downloadCommand, ceilingText, forwardSlashes } from "./prompt";

/**
 * Higgsfield voice batches (build 5 §1.1, §3.A) — the pure half: prices and
 * estimates, the line manifest a `voice` job carries, its prompt, and the
 * `HF_*` lines the `/higgsfield-voice` command prints back. No database, no
 * `server-only`, so unit tests import it directly. The queue and the
 * finalize step live in `src/lib/voice/higgsfield-takes.ts`.
 *
 * Lines the command prints (one per line, nothing else on it):
 *
 *   HF_BALANCE before <credits>
 *   HF_JOB <lineId> <higgsfield job id>   right after each submission
 *   HF_FILE <outFile>                     every file saved (relative to MEDIA_ROOT)
 *   HF_FAIL <lineId> <reason>             a line that produced no file
 *   HF_BALANCE after <credits>
 *   HF_CREDITS <credits spent>
 *
 * `HF_JOB <id>` with one token (the build 4 form) is still read as a job id.
 */

/** Characters per minute of Spanish speech, the unit the measured prices are for. */
export const CHARS_PER_MINUTE = 950;

/**
 * Credits per ~950 characters (get_cost, 2026-10-07, build 5 §1.3). Unmeasured
 * engines are priced at the dearest measured one so an estimate errs high.
 */
const MEASURED: Record<string, number> = {
  "text2speech_v2/elevenlabs": 2.7,
  "text2speech_v2/minimax": 2.7,
  elevenlabs_v4: 4.14,
  seed_audio: 5.9,
  qwen_audio_tts: 0.38,
};
export const UNMEASURED_CREDITS_PER_MINUTE = 5.9;

/** Longest line one generation takes (`elevenlabs_v4`'s dialogue limit). */
export const MAX_LINE_CHARS = 10_000;

/** Lines per `generate_audio_batch` call. */
export const BATCH_SIZE = 12;

/** Engines with no Spanish (or Jopará) in their language list. */
const NO_SPANISH: readonly HiggsfieldTtsModel[] = ["qwen_audio_tts"];

export function priceKey(model: string, variant?: string | null): string {
  return model === "text2speech_v2" ? `${model}/${variant ?? ""}` : model;
}

/** Credits per minute of speech for an engine, and whether that price was measured. */
export function creditsPerMinute(
  model: string,
  variant?: string | null,
): { credits: number; measured: boolean } {
  const key = priceKey(model, variant);
  if (key in MEASURED) return { credits: MEASURED[key], measured: true };
  if (model === "elevenlabs_v4_turbo") return { credits: MEASURED.elevenlabs_v4, measured: false };
  return { credits: UNMEASURED_CREDITS_PER_MINUTE, measured: false };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Estimated credits for one line: the per-minute price scaled by characters (at least 0.01). */
export function estimateLineCredits(text: string, model: string, variant?: string | null): number {
  const chars = [...text.trim()].length;
  if (!chars) return 0;
  const { credits } = creditsPerMinute(model, variant);
  return Math.max(0.01, Math.ceil(((credits * chars) / CHARS_PER_MINUTE) * 100) / 100);
}

/** Whether an engine may speak a voice language (none speaks `gn`; qwen has no Spanish). */
export function engineSpeaks(model: string, language: string): boolean {
  if (language === "gn") return false;
  if (NO_SPANISH.includes(model as HiggsfieldTtsModel))
    return !(language.startsWith("es") || language === "jopara");
  return true;
}

export class HiggsfieldVoiceSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiggsfieldVoiceSettingsError";
  }
}

/**
 * A profile's Higgsfield settings, checked: a known model, a variant for
 * `text2speech_v2` (and none otherwise), a voice type and an id. The voice id
 * falls back to the profile's `providerVoiceId`.
 */
export function resolveHiggsfieldSettings(
  settings: { higgsfield?: Partial<HiggsfieldVoiceSettings> } | null | undefined,
  providerVoiceId?: string | null,
): HiggsfieldVoiceSettings {
  const hf = settings?.higgsfield ?? {};
  const model = hf.model as HiggsfieldTtsModel | undefined;
  if (!model || !HIGGSFIELD_TTS_MODELS.includes(model))
    throw new HiggsfieldVoiceSettingsError(
      `Pick a Higgsfield engine (${HIGGSFIELD_TTS_MODELS.join(", ")}) on the voice profile.`,
    );
  let variant: HiggsfieldTtsVariant | undefined;
  if (model === "text2speech_v2") {
    variant = hf.variant as HiggsfieldTtsVariant | undefined;
    if (!variant || !HIGGSFIELD_TTS_VARIANTS.includes(variant))
      throw new HiggsfieldVoiceSettingsError(
        `text2speech_v2 needs a variant (${HIGGSFIELD_TTS_VARIANTS.join(", ")}).`,
      );
  }
  const voiceType =
    hf.voiceType === "element" ? "element" : hf.voiceType === "preset" ? "preset" : null;
  if (!voiceType)
    throw new HiggsfieldVoiceSettingsError("Pick the voice type: preset or element (cloned).");
  const voiceId = (hf.voiceId ?? "").trim() || (providerVoiceId ?? "").trim();
  if (!voiceId)
    throw new HiggsfieldVoiceSettingsError(
      "Set the Higgsfield voice id (run list_voices in Claude Code, or copy it from Higgsfield).",
    );
  return variant ? { model, variant, voiceType, voiceId } : { model, voiceType, voiceId };
}

/** The raw download a line's take is made from, next to its master: `<folder>/take-<id>.hf.<ext>`. */
export function voiceOutFile(folder: string, narrationId: number, model: string): string {
  return `${folder}/take-${narrationId}.hf.${model === "seed_audio" ? "wav" : "mp3"}`;
}

export type VoiceManifestLine = {
  /** The pending `narrations` row this line becomes. */
  lineId: number;
  model: HiggsfieldTtsModel;
  variant?: HiggsfieldTtsVariant;
  voiceType: "preset" | "element";
  voiceId: string;
  /** The spoken text (pronunciations applied). */
  text: string;
  /** Relative to MEDIA_ROOT. */
  outFile: string;
  /** This app's estimate; the command's get_cost is the truth. */
  estimateCredits: number;
};

export type VoiceManifest = {
  /** `content-engine job #<id>` once the job row exists. */
  jobRef: string | null;
  ceilingCredits: number;
  lines: VoiceManifestLine[];
};

export function manifestEstimate(lines: Pick<VoiceManifestLine, "estimateCredits">[]): number {
  return round2(lines.reduce((sum, l) => sum + l.estimateCredits, 0));
}

const FENCE_OPEN = "```json\n";
const FENCE_CLOSE = "\n```";

/** What follows `/higgsfield-voice`: the manifest as one fenced JSON block. */
export function voiceArgument(manifest: VoiceManifest): string {
  return `${FENCE_OPEN}${JSON.stringify(manifest, null, 2)}${FENCE_CLOSE}`;
}

function isManifest(value: unknown): value is VoiceManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<VoiceManifest>;
  return (
    Array.isArray(m.lines) &&
    m.lines.every(
      (l) =>
        l &&
        typeof l === "object" &&
        Number.isInteger((l as VoiceManifestLine).lineId) &&
        typeof (l as VoiceManifestLine).outFile === "string",
    )
  );
}

/** The manifest inside a voice argument or a whole stored prompt; null when there is none. */
export function parseVoiceManifest(text: string): VoiceManifest | null {
  const start = text.indexOf(FENCE_OPEN);
  if (start === -1) return null;
  const end = text.indexOf(FENCE_CLOSE, start + FENCE_OPEN.length);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(text.slice(start + FENCE_OPEN.length, end)) as unknown;
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The whole prompt for a voice job: slash command, the manifest (with job ref and ceiling), run rules. */
export function buildVoiceRunPrompt(input: {
  jobId: number;
  argument: string;
  maxCredits: number;
  mediaRoot: string;
}): string {
  const parsed = parseVoiceManifest(input.argument);
  if (!parsed) throw new Error("A voice job needs a line manifest.");
  const manifest: VoiceManifest = {
    ...parsed,
    jobRef: `content-engine job #${input.jobId}`,
    ceilingCredits: input.maxCredits,
  };
  const root = forwardSlashes(input.mediaRoot);
  return `/higgsfield-voice ${voiceArgument(manifest)}

---

## Run rules (content-engine job #${input.jobId}, headless)

- **${ceilingText(input.maxCredits)}** This is a hard ceiling set by Anton: if the next submission would take the total past it, stop, do not submit it, and say so in the report.
- Nobody is watching this run and nobody can answer a question. Wherever the command says "stop and ask", stop instead and explain why in the report.
- MEDIA_ROOT is \`${root}\` (the drive is connected). Every \`outFile\` is relative to it. Write nothing outside MEDIA_ROOT.
- Download each result with exactly: \`${downloadCommand(root)} "<outFile>" "<result url>"\` — no other shell command is allowed.
- Never resubmit a line whose job id you printed: check it with \`jobs_wait\` first.
- Print each of these on a line of its own, with nothing else on the line, as it happens:
  - \`HF_BALANCE before <credits>\` after checking the balance, before any generation
  - \`HF_JOB <lineId> <higgsfield job id>\` right after submitting each line
  - \`HF_FILE <outFile>\` for every file you save
  - \`HF_FAIL <lineId> <short reason>\` for every line that ends without a file
  - \`HF_BALANCE after <credits>\` at the end
  - \`HF_CREDITS <credits spent in this run>\` at the end
- Do not run \`npm run media:scan\`; content-engine turns the files into takes when this run ends.
- If the \`/higgsfield-voice\` command above was not expanded, read \`.claude/commands/higgsfield-voice.md\` and follow it with the manifest above.
`;
}

// ---------------------------------------------------------------------------
// What the run prints

export type VoiceMarkers = {
  /** lineId → Higgsfield job id. */
  jobs: Record<number, string>;
  /** Higgsfield job ids in the order printed (including the one-token form). */
  jobIds: string[];
  /** lineId → reason. */
  failures: Record<number, string>;
  /** Reported files, as printed (trimmed). */
  files: string[];
  credits: number | null;
};

export function emptyMarkers(): VoiceMarkers {
  return { jobs: {}, jobIds: [], failures: {}, files: [], credits: null };
}

const LINE = /^[\s>*`-]*HF_(JOB|FILE|FAIL|CREDITS)[:\s]+(.+?)[\s`*]*$/;

function clean(token: string): string {
  return token.replace(/^["'`]+|["'`,;]+$/g, "");
}

/** Read the `HF_*` lines out of some text into `into` (mutated and returned). */
export function scanVoiceMarkers(text: string, into: VoiceMarkers = emptyMarkers()): VoiceMarkers {
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const [, kind, value] = m;
    const tokens = value.trim().split(/\s+/).map(clean).filter(Boolean);
    if (kind === "JOB") {
      if (tokens.length >= 2 && /^\d+$/.test(tokens[0])) {
        into.jobs[Number(tokens[0])] = tokens[1];
        if (!into.jobIds.includes(tokens[1])) into.jobIds.push(tokens[1]);
      } else if (tokens[0] && !into.jobIds.includes(tokens[0])) {
        into.jobIds.push(tokens[0]);
      }
    } else if (kind === "FAIL") {
      if (tokens.length && /^\d+$/.test(tokens[0])) {
        const reason = value.trim().slice(value.trim().indexOf(tokens[0]) + tokens[0].length);
        into.failures[Number(tokens[0])] = reason.trim() || "failed";
      }
    } else if (kind === "FILE") {
      const file = clean(value.trim());
      if (file && !into.files.includes(file)) into.files.push(file);
    } else if (kind === "CREDITS") {
      const n = /-?\d+(?:[.,]\d+)?/.exec(value);
      if (n) into.credits = Number(n[0].replace(",", "."));
    }
  }
  return into;
}

/**
 * Incremental reader of the run's stream-json stdout for the voice markers
 * (the generic parser in stream.ts takes `HF_JOB`'s first token as the job id,
 * which for a voice line is the line id).
 */
export class VoiceMarkerCollector {
  readonly markers = emptyMarkers();
  private buffer = "";

  feed(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      this.line(this.buffer.slice(0, nl));
      this.buffer = this.buffer.slice(nl + 1);
    }
  }

  end(): void {
    const rest = this.buffer;
    this.buffer = "";
    if (rest.trim()) this.line(rest);
  }

  private line(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    let event: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object") event = parsed as Record<string, unknown>;
    } catch {
      /* plain text */
    }
    if (!event) {
      scanVoiceMarkers(line, this.markers);
      return;
    }
    if (event.type === "assistant") {
      const message = (event.message ?? {}) as { content?: unknown };
      for (const b of Array.isArray(message.content) ? message.content : []) {
        const block = (b ?? {}) as { type?: unknown; text?: unknown };
        if (block.type === "text" && typeof block.text === "string")
          scanVoiceMarkers(block.text, this.markers);
      }
    } else if (event.type === "result" && typeof event.result === "string") {
      scanVoiceMarkers(event.result, this.markers);
    }
  }
}

/**
 * Split the run's credits over the lines that produced a take, by characters.
 * Returns lineId → credits (rounded to 0.01); null credits → every line null.
 */
export function splitCredits(
  credits: number | null,
  lines: Array<{ lineId: number; text: string }>,
): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const total = lines.reduce((s, l) => s + Math.max(1, [...l.text].length), 0);
  for (const l of lines) {
    out.set(
      l.lineId,
      credits === null || !total
        ? null
        : round2((credits * Math.max(1, [...l.text].length)) / total),
    );
  }
  return out;
}
