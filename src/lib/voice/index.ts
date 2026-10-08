import { insertReturning, updateReturning } from "@/db/mutations";
/**
 * The voice engine's public surface (build 4, docs/PLAN-build4.md §3.A,
 * docs/VOICE.md). Callers outside `src/lib/voice` import only from here.
 */
import "server-only";
import { assertOnPc } from "@/lib/pc-only";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { narrations, type VoiceProfile } from "@/db/schema";
import { registerFile } from "@/lib/media/register";
import { storeImmutableOutput } from "@/lib/media/immutable-output";
import { dispatchSpend, recordSpend, withSpendCap } from "@/lib/spend";
import { narrationFolder } from "@/lib/storage/paths";
import { mediaRoot, mediaRootMessage, mediaRootStatus } from "@/lib/storage/root";

import { restoreWords } from "./alignment";
import { encodeMp3, FfmpegMissingError, measureDurationMs, normaliseToWav } from "./audio";
import {
  NARRATION_OWNER_KINDS,
  NarrationRefusedError,
  TAKE_REVIEW_STATUSES,
  VOICE_LANGUAGES,
  type ImportRecordingRequest,
  type NarrateRequest,
  type NarrateResult,
  type TakeReviewStatus,
  type VoiceProvider,
  type WordTiming,
} from "./contract";
import { elevenLabsUsdPer1k, estimateTakeUsd } from "./costs";
import { applyPronunciations, type PronunciationRule } from "./pronunciations";
import { adapterFor, providerConfigured, speechToSpeech } from "./providers";
import { assertCanSynthesize, assertConsent, assertLanguage, assertTextUsable } from "./refusals";
import { getProfile, pronunciationRulesFor, takeKeyWhere } from "./store";

export * from "./contract";

/** Options beyond the contract, for previews (the pronunciation page). */
export type NarrateOptions = {
  /** Send the text as written (the "without respelling" half of a preview). */
  skipPronunciations?: boolean;
  /** Also apply `proposed` respellings (the "with" half of a preview). */
  includeProposed?: boolean;
};

/** sha256 of text + voice + language: a re-take of unchanged text is visible as such. */
export function takeTextHash(
  text: string,
  voiceProfileId: number | null,
  language: string,
): string {
  return createHash("sha256")
    .update(`${text}\u0000${voiceProfileId ?? "recording"}\u0000${language}`)
    .digest("hex");
}

function assertRequestShape(req: { ownerKind: string; ownerRef: string; language: string }): void {
  if (!(NARRATION_OWNER_KINDS as readonly string[]).includes(req.ownerKind)) {
    throw new Error(`Unknown narration owner kind: ${req.ownerKind}`);
  }
  if (!req.ownerRef?.trim()) throw new Error("A take needs an owner reference.");
  if (!(VOICE_LANGUAGES as readonly string[]).includes(req.language)) {
    throw new NarrationRefusedError(
      "language_not_supported",
      `Unknown narration language: ${req.language}.`,
    );
  }
}

async function loadProfile(id: number): Promise<VoiceProfile> {
  const profile = Number.isInteger(id) && id > 0 ? await getProfile(id) : null;
  if (!profile) {
    throw new NarrationRefusedError(
      "provider_not_configured",
      `There is no voice profile #${id}. Pick a voice in Voice profiles.`,
    );
  }
  return profile;
}

/** The media drive must be there before a row is written or anything is spent. */
async function requireMediaRoot(): Promise<string> {
  const root = mediaRoot();
  const status = await mediaRootStatus(root);
  if (status !== "ok") throw new Error(mediaRootMessage(status));
  return root;
}

type TakeFiles = {
  root: string;
  workDir: string;
  folder: string;
  master: string;
  playback: string;
  abs: (rel: string) => string;
};

async function takeFiles(
  root: string,
  req: NarrateRequest | ImportRecordingRequest,
  id: number,
): Promise<TakeFiles> {
  const folder = narrationFolder(req);
  const workDir = await mkdtemp(path.join(tmpdir(), "cm-voice-"));
  const abs = (rel: string) => path.join(workDir, path.basename(rel));
  return {
    root,
    workDir,
    folder,
    master: `${folder}/take-${id}.wav`,
    playback: `${folder}/take-${id}.mp3`,
    abs,
  };
}

async function register(rel: string, meta: Parameters<typeof registerFile>[1]): Promise<number> {
  const result = await registerFile(rel, meta);
  if (result.status === "created" || result.status === "existing") return result.asset.id;
  throw new Error(`Could not register ${rel}: ${result.message}`);
}

/**
 * The shared tail of every take: MP3 playback copy (or, without ffmpeg, the
 * WAV doubles as playback), measured duration, both files registered, row done.
 */
async function finishTake(
  id: number,
  files: TakeFiles,
  meta: {
    brandId: string | null;
    source: "import" | "upload";
    provider: VoiceProvider;
    language: string;
    model: string | null;
    alignment: WordTiming[] | null;
    costUsd: number;
    spokenText: string | null;
  },
): Promise<NarrateResult> {
  let playback = files.playback;
  try {
    await encodeMp3(files.abs(files.master), files.abs(files.playback));
  } catch (error) {
    if (!(error instanceof FfmpegMissingError)) throw error;
    playback = files.master;
  }
  const durationMs = (await measureDurationMs(files.abs(files.master))) ?? 0;
  if (durationMs <= 0) throw new Error("The completed voice master could not be read.");
  await storeImmutableOutput(files.master, { file: files.abs(files.master) }, files.root);
  if (playback !== files.master)
    await storeImmutableOutput(playback, { file: files.abs(playback) }, files.root);
  const assetMeta = {
    brandId: meta.brandId,
    source: meta.source,
    sourceRef: `narration:${id}`,
    model: meta.model,
    tags: ["voice", "narration", meta.provider, meta.language],
  };
  const masterAssetId = await register(files.master, assetMeta);
  const playbackAssetId =
    playback === files.master ? masterAssetId : await register(playback, assetMeta);
  await db
    .update(narrations)
    .set({
      status: "done",
      masterAssetId,
      playbackAssetId,
      durationMs,
      alignment: meta.alignment,
      costUsd: meta.costUsd,
      spokenText: meta.spokenText,
      error: null,
    })
    .where(eq(narrations.id, id));
  return {
    narrationId: id,
    durationMs,
    masterPath: files.master,
    playbackPath: playback,
    alignment: meta.alignment,
    costUsd: meta.costUsd,
  };
}

async function failTake(id: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(narrations)
    .set({ status: "failed", error: message.slice(0, 1024) })
    .where(eq(narrations.id, id));
}

/** The respelled text for a take, and which narrow scopes were in play. */
export async function spokenTextFor(
  text: string,
  ctx: {
    language: string;
    provider: VoiceProvider;
    scopes: Array<string | null | undefined>;
    includeProposed?: boolean;
  },
): Promise<string> {
  const rows = await pronunciationRulesFor(ctx.language);
  const rules: PronunciationRule[] = rows.map((r) => ({
    term: r.term,
    sayAs: r.sayAs,
    language: r.language,
    scope: r.scope,
    reviewStatus: r.reviewStatus,
  }));
  return applyPronunciations(text, rules, ctx).text;
}

/**
 * Make one take: apply pronunciations, call the profile's provider under the
 * spend cap, store a WAV master + MP3 playback copy under MEDIA_ROOT
 * (`narrationFolder`), register both as assets, and record a `narrations` row.
 * Throws `NarrationRefusedError` for consent, language and configuration
 * refusals (no row is written); a failure after that keeps the row as `failed`.
 */
export async function narrate(
  req: NarrateRequest,
  options: NarrateOptions = {},
): Promise<NarrateResult> {
  assertOnPc("Making a voice take");
  assertRequestShape(req);
  const profile = await loadProfile(req.voiceProfileId);
  assertCanSynthesize(profile, req, providerConfigured(profile.provider));
  const root = await requireMediaRoot();

  const scopes = [req.pronunciationScope, profile.brandId ? `brand:${profile.brandId}` : null];
  const spoken = options.skipPronunciations
    ? req.text.normalize("NFC")
    : await spokenTextFor(req.text, {
        language: req.language,
        provider: profile.provider,
        scopes,
        includeProposed: options.includeProposed,
      });

  const [row] = await insertReturning(
    db,
    narrations,
    {
      ownerKind: req.ownerKind,
      ownerRef: req.ownerRef,
      sceneRef: req.sceneRef ?? null,
      language: req.language,
      voiceProfileId: profile.id,
      speaker: req.speaker ?? null,
      inputText: req.text,
      spokenText: spoken,
      textHash: takeTextHash(req.text, profile.id, req.language),
      provider: profile.provider,
      status: "pending",
    },
    { id: narrations.id },
  );

  let files: TakeFiles | null = null;
  try {
    files = await takeFiles(root, req, row.id);
    const estimate = estimateTakeUsd(profile.provider, spoken, {
      instructions: profile.settings.instructions,
    });
    const adapter = await adapterFor(profile.provider);
    const synthesis = await withSpendCap(estimate, async () => {
      const result = await dispatchSpend(() =>
        adapter.synthesize(spoken, profile, { language: req.language }),
      );
      await recordSpend(result.costUsd);
      return result;
    });
    await writeFile(files.abs(files.master), synthesis.wav);
    return await finishTake(row.id, files, {
      brandId: profile.brandId,
      source: "import",
      provider: profile.provider,
      language: req.language,
      model: synthesis.model,
      alignment: synthesis.alignment ? restoreWords(synthesis.alignment, req.text) : null,
      costUsd: synthesis.costUsd,
      spokenText: spoken,
    });
  } catch (error) {
    await failTake(row.id, error);
    throw error;
  } finally {
    if (files) await rm(files.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Largest recording accepted, bytes. */
export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

async function checkRecordingFile(filePath: string): Promise<void> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`No such recording: ${filePath}`);
  if (info.size === 0) throw new Error("The recording is empty.");
  if (info.size > MAX_RECORDING_BYTES) throw new Error("The recording is larger than 200 MB.");
}

/**
 * Store an uploaded recording as a `manual` take (see `ImportRecordingRequest`):
 * normalised to WAV 48 kHz mono + MP3, measured, registered. With a profile,
 * consent and its languages are checked; Guaraní is allowed (a person speaks it).
 */
export async function importRecording(req: ImportRecordingRequest): Promise<NarrateResult> {
  assertOnPc("Uploading a recording");
  assertRequestShape(req);
  assertTextUsable(req.text);
  let profile: VoiceProfile | null = null;
  if (req.voiceProfileId !== null && req.voiceProfileId !== undefined) {
    profile = await loadProfile(req.voiceProfileId);
    if (!profile.active) {
      throw new NarrationRefusedError(
        "provider_not_configured",
        `Voice “${profile.name}” is switched off. Turn it on in Voice profiles first.`,
      );
    }
    assertLanguage({ ...profile, provider: "manual" }, req.language);
    assertConsent(profile);
  }
  await checkRecordingFile(req.filePath);
  const root = await requireMediaRoot();

  const [row] = await insertReturning(
    db,
    narrations,
    {
      ownerKind: req.ownerKind,
      ownerRef: req.ownerRef,
      sceneRef: req.sceneRef ?? null,
      language: req.language,
      voiceProfileId: profile?.id ?? null,
      speaker: req.speaker ?? null,
      inputText: req.text,
      spokenText: req.text,
      textHash: takeTextHash(req.text, profile?.id ?? null, req.language),
      provider: "manual",
      status: "pending",
    },
    { id: narrations.id },
  );

  let files: TakeFiles | null = null;
  try {
    files = await takeFiles(root, req, row.id);
    await normaliseToWav(req.filePath, files.abs(files.master));
    return await finishTake(row.id, files, {
      brandId: profile?.brandId ?? null,
      source: "upload",
      provider: "manual",
      language: req.language,
      model: null,
      alignment: null,
      costUsd: 0,
      spokenText: req.text,
    });
  } catch (error) {
    await failTake(row.id, error);
    throw error;
  } finally {
    if (files) await rm(files.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export type VoiceChangeRequest = Omit<ImportRecordingRequest, "voiceProfileId"> & {
  /** The ElevenLabs profile whose voice the recording is converted into. */
  voiceProfileId: number;
  /** The person in the source recording agreed to having it re-voiced (required for Guaraní). */
  sourceSpeakerConsent: boolean;
};

/**
 * ElevenLabs speech-to-speech ("voice changer"): a native speaker's recording
 * re-voiced as the profile's voice, keeping their pronunciation and timing.
 * Never for `gn` without the source speaker's consent. UNVERIFIED live.
 */
export async function voiceChangeRecording(req: VoiceChangeRequest): Promise<NarrateResult> {
  assertOnPc("Changing a recording's voice");
  assertRequestShape(req);
  assertTextUsable(req.text);
  const profile = await loadProfile(req.voiceProfileId);
  if (profile.provider !== "elevenlabs") {
    throw new NarrationRefusedError(
      "provider_not_configured",
      "Voice changing needs an ElevenLabs voice profile.",
    );
  }
  if (!req.sourceSpeakerConsent) {
    throw new NarrationRefusedError(
      "consent_missing",
      "Voice changing needs the consent of the person in the source recording.",
    );
  }
  // The words come from a person, so Guaraní is allowed here; the target voice's other languages still apply.
  if (req.language !== "gn") assertLanguage(profile, req.language);
  if (!profile.active) {
    throw new NarrationRefusedError(
      "provider_not_configured",
      `Voice “${profile.name}” is switched off.`,
    );
  }
  assertConsent(profile);
  const configured = providerConfigured(profile.provider);
  if (!configured.ok)
    throw new NarrationRefusedError("provider_not_configured", configured.message);
  await checkRecordingFile(req.filePath);
  const root = await requireMediaRoot();

  const [row] = await insertReturning(
    db,
    narrations,
    {
      ownerKind: req.ownerKind,
      ownerRef: req.ownerRef,
      sceneRef: req.sceneRef ?? null,
      language: req.language,
      voiceProfileId: profile.id,
      speaker: req.speaker ?? null,
      inputText: req.text,
      spokenText: req.text,
      textHash: takeTextHash(req.text, profile.id, req.language),
      provider: "elevenlabs",
      status: "pending",
    },
    { id: narrations.id },
  );

  let files: TakeFiles | null = null;
  try {
    files = await takeFiles(root, req, row.id);
    // Normalise first: a fixed WAV in, and its length prices the call.
    const source = files.abs(`${files.folder}/take-${row.id}-source.wav`);
    await normaliseToWav(req.filePath, source);
    const minutes = ((await measureDurationMs(source)) ?? 60_000) / 60_000;
    // ElevenLabs bills speech-to-speech at ≈ 1,000 characters' worth per minute of audio.
    const estimate = minutes * elevenLabsUsdPer1k();
    const wav = await withSpendCap(estimate, async () => {
      const sourceBytes = await readFile(source);
      const out = await dispatchSpend(() =>
        speechToSpeech(profile, sourceBytes, path.basename(source)),
      );
      await recordSpend(estimate);
      return out;
    });
    await writeFile(files.abs(files.master), wav);
    return await finishTake(row.id, files, {
      brandId: profile.brandId,
      source: "upload",
      provider: "elevenlabs",
      language: req.language,
      model: "eleven_multilingual_sts_v2",
      alignment: null,
      costUsd: estimate,
      spokenText: req.text,
    });
  } catch (error) {
    await failTake(row.id, error);
    throw error;
  } finally {
    if (files) await rm(files.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Make this take the selected one for its (owner, scene, language, speaker),
 * unselecting the others in one transaction. Only a finished take can be selected.
 */
export async function selectTake(narrationId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [take] = await tx
      .select()
      .from(narrations)
      .where(eq(narrations.id, narrationId))
      .limit(1);
    if (!take) throw new Error(`No take #${narrationId}.`);
    if (take.status !== "done")
      throw new Error(
        `Take #${narrationId} is ${take.status}; only a finished take can be selected.`,
      );
    await tx
      .update(narrations)
      .set({ selected: false })
      .where(
        and(
          takeKeyWhere({
            ownerKind: take.ownerKind,
            ownerRef: take.ownerRef,
            sceneRef: take.sceneRef,
            language: take.language,
            speaker: take.speaker,
          }),
          ne(narrations.id, take.id),
          eq(narrations.selected, true),
        ),
      );
    await tx.update(narrations).set({ selected: true }).where(eq(narrations.id, take.id));
  });
}

/** Record a listening review of one take. */
export async function reviewTake(
  narrationId: number,
  status: TakeReviewStatus,
  note?: string | null,
  reviewer?: string | null,
): Promise<void> {
  if (!TAKE_REVIEW_STATUSES.includes(status)) throw new Error(`Unknown review status: ${status}`);
  const rows = await updateReturning(
    db,
    narrations,
    {
      reviewStatus: status,
      reviewNote: note?.trim() ? note.trim() : null,
      reviewedBy: reviewer?.trim() ? reviewer.trim().slice(0, 255) : null,
    },
    eq(narrations.id, narrationId),
    { id: narrations.id },
  );
  if (!rows.length) throw new Error(`No take #${narrationId}.`);
}
