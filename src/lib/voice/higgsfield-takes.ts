import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { insertReturning, updateReturning } from "@/db/mutations";
/**
 * Higgsfield voice takes (build 5 §1.1–1.4, §3.A): queue a batch of lines as
 * one `voice` job through the Claude Code bridge, and turn the files the run
 * saved into takes when it ends.
 *
 *   queueHiggsfieldVoice   refusals (as narrate()) → pronunciations → pending
 *                          `narrations` rows → manifest → startJob(kind voice)
 *   finalizeHiggsfieldVoiceJob
 *                          (run.ts calls it when the run ends, and the reaper)
 *                          file → WAV 48 kHz mono master + MP3, measured,
 *                          registered → row done with credits and the
 *                          Higgsfield job id → select + scene audio
 *
 * The pure half (prices, manifest, prompt, HF_* lines) is
 * src/lib/higgsfield/voice.ts.
 */
import "server-only";
import { copyFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import {
  higgsfieldJobs,
  narrations,
  type Narration,
  type VoiceProfile,
  voiceProfiles,
} from "@/db/schema";
import { acquireLease, releaseLease } from "@/lib/lease";
import { getScript } from "@/lib/bridge/scripts";
import {
  getJob,
  HiggsfieldInputError,
  startJob,
  type StartOptions,
  type Started,
} from "@/lib/higgsfield/run";
import {
  engineSpeaks,
  estimateLineCredits,
  HiggsfieldVoiceSettingsError,
  MAX_LINE_CHARS,
  manifestEstimate,
  parseVoiceManifest,
  resolveHiggsfieldSettings,
  scanVoiceMarkers,
  splitCredits,
  voiceArgument,
  voiceOutFile,
  type VoiceManifestLine,
  type VoiceMarkers,
} from "@/lib/higgsfield/voice";
import { registerFile } from "@/lib/media/register";
import { storeImmutableOutput } from "@/lib/media/immutable-output";
import { isOnlineDeploy, PcOnlyError } from "@/lib/pc-only";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import { narrationFolder } from "@/lib/storage/paths";
import { mediaRoot, mediaRootMessage, mediaRootStatus } from "@/lib/storage/root";
import {
  characterProfileFor,
  getScene,
  getStory,
  listActiveProfiles,
  listScenes,
  listStoryTakes,
  storyOwnerRef,
} from "@/lib/stories/data";
import { sceneReadiness } from "@/lib/stories/readiness";
import { ttsAllowed, voiceLanguageFor } from "@/lib/stories/rules";
import { buildSceneAudio, StoryError } from "@/lib/stories/studio";
import { scriptBlocks, scriptOwnerRef } from "@/lib/video/script-blocks";

import { encodeMp3, ffmpegAvailable, measureDurationMs, normaliseToWav } from "./audio";
import {
  NARRATION_OWNER_KINDS,
  NarrationRefusedError,
  VOICE_LANGUAGES,
  type HiggsfieldVoiceSettings,
  type NarrateRequest,
  type NarrationOwnerKind,
  type VoiceLanguage,
} from "./contract";
import { selectTake, spokenTextFor, takeTextHash } from "./index";
import { assertCanSynthesize } from "./refusals";
import { getProfile, listTakes, takeKeyWhere } from "./store";

export class HiggsfieldVoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiggsfieldVoiceError";
  }
}

/** One line to voice: the same fields as a `narrate()` request. */
export type VoiceLineRequest = Pick<
  NarrateRequest,
  "ownerKind" | "ownerRef" | "sceneRef" | "language" | "voiceProfileId" | "text" | "speaker"
> & { pronunciationScope?: string | null };

export type PlannedLine = {
  request: VoiceLineRequest;
  profile: VoiceProfile;
  settings: HiggsfieldVoiceSettings;
  spokenText: string;
  estimateCredits: number;
};

export type RefusedLine = { request: VoiceLineRequest; reason: string; message: string };

export type VoicePlan = { planned: PlannedLine[]; refused: RefusedLine[]; estimateCredits: number };

// ---------------------------------------------------------------------------
// Profiles

/** Store a profile's Higgsfield settings (the profile store keeps only its own known fields). */
export async function setHiggsfieldProfileSettings(
  profileId: number,
  hf: HiggsfieldVoiceSettings,
): Promise<void> {
  const profile = await getProfile(profileId);
  if (!profile) throw new HiggsfieldVoiceError(`No voice profile #${profileId}.`);
  const settings = resolveHiggsfieldSettings({ higgsfield: hf }, profile.providerVoiceId);
  await db
    .update(voiceProfiles)
    .set({ settings: { ...profile.settings, higgsfield: settings }, updatedAt: new Date() })
    .where(eq(voiceProfiles.id, profileId));
}

export type HiggsfieldProfileOption = {
  id: number;
  name: string;
  role: string;
  characterKey: string | null;
  languages: string[];
  model: string | null;
  variant: string | null;
  voiceType: "preset" | "element" | null;
};

/** Active Higgsfield profiles, for the batch and line buttons. */
export async function listHiggsfieldProfiles(): Promise<HiggsfieldProfileOption[]> {
  const rows = await listActiveProfiles();
  return rows
    .filter((p) => p.provider === "higgsfield")
    .map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      characterKey: p.characterKey,
      languages: p.languages,
      model: p.settings.higgsfield?.model ?? null,
      variant: p.settings.higgsfield?.variant ?? null,
      voiceType: p.settings.higgsfield?.voiceType ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Plan + queue

function shapeRefusal(line: VoiceLineRequest): string | null {
  if (!(NARRATION_OWNER_KINDS as readonly string[]).includes(line.ownerKind))
    return `Unknown narration owner kind: ${line.ownerKind}`;
  if (!line.ownerRef?.trim()) return "A take needs an owner reference.";
  if (!(VOICE_LANGUAGES as readonly string[]).includes(line.language))
    return `Unknown narration language: ${line.language}.`;
  return null;
}

async function pendingTakeFor(line: VoiceLineRequest): Promise<Narration | null> {
  const [row] = await db
    .select()
    .from(narrations)
    .where(
      and(
        takeKeyWhere({
          ownerKind: line.ownerKind,
          ownerRef: line.ownerRef,
          sceneRef: line.sceneRef ?? null,
          language: line.language,
          speaker: line.speaker ?? null,
        }),
        eq(narrations.status, "pending"),
        eq(narrations.provider, "higgsfield"),
        eq(narrations.inputText, line.text),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Check every line the way `narrate()` would (text, active voice, Guaraní,
 * consent, settings) plus the Higgsfield rules (a cloned `element` voice needs
 * signed consent; the engine must speak the language; one line ≤ 10,000
 * characters; not already queued), apply pronunciations and estimate credits.
 * Nothing is written.
 */
export async function planHiggsfieldVoice(lines: VoiceLineRequest[]): Promise<VoicePlan> {
  const planned: PlannedLine[] = [];
  const refused: RefusedLine[] = [];
  const profiles = new Map<number, VoiceProfile | null>();
  for (const request of lines) {
    const refuse = (reason: string, message: string) => refused.push({ request, reason, message });
    const shape = shapeRefusal(request);
    if (shape) {
      refuse("invalid", shape);
      continue;
    }
    const id = request.voiceProfileId;
    if (!profiles.has(id))
      profiles.set(id, Number.isInteger(id) && id > 0 ? await getProfile(id) : null);
    const profile = profiles.get(id) ?? null;
    if (!profile) {
      refuse("provider_not_configured", `There is no voice profile #${id}.`);
      continue;
    }
    try {
      if (profile.provider !== "higgsfield")
        throw new NarrationRefusedError(
          "provider_not_configured",
          `Voice “${profile.name}” is a ${profile.provider} voice, not a Higgsfield one.`,
        );
      assertCanSynthesize(profile, request, { ok: true });
      const settings = resolveHiggsfieldSettings(profile.settings, profile.providerVoiceId);
      if (settings.voiceType === "element" && profile.consentStatus !== "signed")
        throw new NarrationRefusedError(
          "consent_missing",
          `Voice “${profile.name}” is a cloned voice (element): it needs a signed consent (status: ${profile.consentStatus}).`,
        );
      if (!engineSpeaks(settings.model, request.language))
        throw new NarrationRefusedError(
          "language_not_supported",
          `${settings.model} does not speak ${request.language}. Pick another engine on the voice profile.`,
        );
      const spokenText = await spokenTextFor(request.text, {
        language: request.language,
        provider: "higgsfield",
        scopes: [request.pronunciationScope, profile.brandId ? `brand:${profile.brandId}` : null],
      });
      if ([...spokenText].length > MAX_LINE_CHARS) {
        refuse("too_long", `The line is longer than ${MAX_LINE_CHARS} characters; split it.`);
        continue;
      }
      const queued = await pendingTakeFor(request);
      if (queued) {
        refuse(
          "already_queued",
          `This line is already queued (take #${queued.id}${queued.higgsfieldJobId ? `, job #${queued.higgsfieldJobId}` : ""}).`,
        );
        continue;
      }
      planned.push({
        request,
        profile,
        settings,
        spokenText,
        estimateCredits: estimateLineCredits(spokenText, settings.model, settings.variant),
      });
    } catch (error) {
      if (error instanceof NarrationRefusedError) refuse(error.reason, error.message);
      else if (error instanceof HiggsfieldVoiceSettingsError)
        refuse("provider_not_configured", `Voice “${profile.name}”: ${error.message}`);
      else throw error;
    }
  }
  return { planned, refused, estimateCredits: manifestEstimate(planned) };
}

export type QueueInput = {
  lines: VoiceLineRequest[];
  maxCredits: number;
  /** Serialises runs for one target (`voice:story:<slug>:<lang>` …); null = not serialised. */
  targetRef?: string | null;
  brandId?: string | null;
  /** Queue the lines that pass and report the rest, instead of refusing the batch. */
  allowPartial?: boolean;
};

export type Queued = Started & {
  narrationIds: number[];
  estimateCredits: number;
  refused: RefusedLine[];
};

/**
 * Queue lines as one Higgsfield `voice` job. Throws `NarrationRefusedError`
 * for the first refused line (unless `allowPartial`), `HiggsfieldVoiceError`
 * when the estimate is above the ceiling or nothing is left to voice.
 */
export async function queueHiggsfieldVoice(
  input: QueueInput,
  opts: StartOptions = {},
): Promise<Queued> {
  if (isOnlineDeploy()) throw new HiggsfieldVoiceError(new PcOnlyError("Higgsfield voice").message);
  // One plan at a time also serializes overlapping single-line and whole-script batches.
  const lease = await acquireLease("higgsfield:voice-plan", 60_000);
  if (!lease)
    throw new HiggsfieldVoiceError("Another voice batch is being prepared. Try again in a moment.");
  try {
    return await queuePreparedVoice(input, opts);
  } finally {
    await releaseLease(lease);
  }
}

async function queuePreparedVoice(input: QueueInput, opts: StartOptions): Promise<Queued> {
  if (isOnlineDeploy()) throw new HiggsfieldVoiceError(new PcOnlyError("Higgsfield voice").message);
  await repairOrphanedHiggsfieldTakes();
  const plan = await planHiggsfieldVoice(input.lines);
  if (plan.refused.length && !input.allowPartial) {
    const first = plan.refused[0];
    if (
      first.reason === "invalid" ||
      first.reason === "too_long" ||
      first.reason === "already_queued"
    )
      throw new HiggsfieldVoiceError(first.message);
    throw new NarrationRefusedError(first.reason as NarrationRefusedError["reason"], first.message);
  }
  if (!plan.planned.length)
    throw new HiggsfieldVoiceError(
      plan.refused.length
        ? `Nothing to voice: ${plan.refused.map((r) => r.message).join(" ")}`
        : "Nothing to voice.",
    );
  const ceiling = Number(input.maxCredits);
  if (!Number.isFinite(ceiling) || ceiling <= 0)
    throw new HiggsfieldVoiceError("Set a credit ceiling above 0.");
  if (plan.estimateCredits > ceiling)
    throw new HiggsfieldVoiceError(
      `The estimate is ${plan.estimateCredits} credits for ${plan.planned.length} line(s), above the ceiling of ${ceiling}. Raise the ceiling or voice fewer lines.`,
    );
  const root = mediaRoot();
  const drive = await mediaRootStatus(root);
  if (drive !== "ok") throw new HiggsfieldVoiceError(mediaRootMessage(drive));

  const ids: number[] = [];
  const manifestLines: VoiceManifestLine[] = [];
  const prepareArgument: NonNullable<StartOptions["prepareArgument"]> = async (tx, jobId) => {
    for (const p of plan.planned) {
      const r = p.request;
      const [row] = await insertReturning(
        tx,
        narrations,
        {
          ownerKind: r.ownerKind,
          ownerRef: r.ownerRef,
          sceneRef: r.sceneRef ?? null,
          language: r.language,
          voiceProfileId: p.profile.id,
          speaker: r.speaker ?? null,
          inputText: r.text,
          spokenText: p.spokenText,
          textHash: takeTextHash(r.text, p.profile.id, r.language),
          provider: "higgsfield",
          status: "pending",
          higgsfieldJobId: jobId,
          costUsd: 0,
        },
        { id: narrations.id },
      );
      ids.push(row.id);
      manifestLines.push({
        lineId: row.id,
        model: p.settings.model,
        ...(p.settings.variant ? { variant: p.settings.variant } : {}),
        voiceType: p.settings.voiceType,
        voiceId: p.settings.voiceId,
        text: p.spokenText,
        outFile: voiceOutFile(narrationFolder(r), row.id, p.settings.model),
        estimateCredits: p.estimateCredits,
      });
    }
    return voiceArgument({ jobRef: null, ceilingCredits: ceiling, lines: manifestLines });
  };

  const started = await startJob(
    {
      kind: "voice",
      targetRef: input.targetRef ?? null,
      brandId: input.brandId ?? null,
      maxCredits: ceiling,
      argument: "",
    },
    { ...opts, prepareArgument },
  );
  if (started.job.status === "failed" || started.job.status === "cancelled") {
    // Failed before the CLI ran (no finalize hook ran): fail the rows now.
    await finalizeHiggsfieldVoiceJob(started.job.id, null);
  }
  return {
    ...started,
    narrationIds: ids,
    estimateCredits: plan.estimateCredits,
    refused: plan.refused,
  };
}

/** Repair the old two-transaction gap without dispatching or resubmitting anything. */
export async function repairOrphanedHiggsfieldTakes(now = new Date()): Promise<number[]> {
  const lease = await acquireLease("higgsfield:voice-orphans", 60_000);
  if (!lease) return [];
  try {
    const rows = await db
      .select()
      .from(narrations)
      .where(
        and(
          eq(narrations.provider, "higgsfield"),
          eq(narrations.status, "pending"),
          isNull(narrations.higgsfieldJobId),
          lt(narrations.createdAt, new Date(now.getTime() - 10 * 60_000)),
        ),
      );
    if (!rows.length) return [];
    const jobs = await db.select().from(higgsfieldJobs).where(eq(higgsfieldJobs.kind, "voice"));
    const repaired: number[] = [];
    for (const row of rows) {
      const matches = jobs.filter((job) =>
        parseVoiceManifest(job.prompt)?.lines.some((line) => line.lineId === row.id),
      );
      const job = matches.length === 1 ? matches[0] : null;
      const [changed] = await updateReturning(
        db,
        narrations,
        job
          ? {
              higgsfieldJobId: job.id,
            }
          : {
              status: "failed",
              error:
                "Interrupted before a durable voice job was linked. No automatic submission was made; review generation history before retrying.",
            },
        and(
          eq(narrations.id, row.id),
          eq(narrations.status, "pending"),
          isNull(narrations.higgsfieldJobId),
        ),
        { id: narrations.id },
      );
      if (!changed) continue;
      repaired.push(row.id);
      if (job && !["queued", "running"].includes(job.status))
        await finalizeHiggsfieldVoiceJob(job.id, null);
    }
    return repaired;
  } finally {
    await releaseLease(lease);
  }
}

// ---------------------------------------------------------------------------
// Batches: a story language, a script

export type BatchLines = { lines: VoiceLineRequest[]; notes: string[]; targetRef: string };

/**
 * Every ready line of a book in one language that lacks a usable take:
 * approved text only (canNarrate), never Guaraní, the narrator profile for
 * narration and a character's own Higgsfield profile when there is one.
 */
export async function storyVoiceLines(
  slug: string,
  lang: string,
  narratorProfileId: number,
): Promise<BatchLines> {
  const story = await getStory(slug);
  if (!story) throw new HiggsfieldVoiceError(`No story "${slug}". Import it first.`);
  const voiceLang = voiceLanguageFor(lang);
  if (!voiceLang) throw new HiggsfieldVoiceError(`${lang} is not a narration language.`);
  if (!ttsAllowed(lang))
    throw new NarrationRefusedError(
      "language_not_supported",
      "Guaraní is recorded by a person: no TTS voice speaks it.",
    );
  const profiles = await listActiveProfiles();
  const narrator = profiles.find((p) => p.id === narratorProfileId);
  if (!narrator || narrator.provider !== "higgsfield")
    throw new HiggsfieldVoiceError("Pick an active Higgsfield voice profile as the narrator.");
  const takes = await listStoryTakes(story.slug);
  const notes: string[] = [];
  const lines: VoiceLineRequest[] = [];
  for (const scene of await listScenes(story.id)) {
    const readiness = sceneReadiness(scene, lang, takes);
    if (!readiness.text.ok) continue;
    for (const state of readiness.lines) {
      if (state.usable) continue;
      if (state.takes.some((t) => t.status === "pending" && t.inputText === state.line.text))
        continue;
      let profileId = narrator.id;
      const speaker = state.line.speaker ?? null;
      if (speaker) {
        const own = characterProfileFor(profiles, speaker);
        if (own && own.provider === "higgsfield") profileId = own.id;
        else
          notes.push(`${state.slot}: no Higgsfield voice for "${speaker}"; the narrator reads it.`);
      }
      lines.push({
        ownerKind: "story_scene",
        ownerRef: storyOwnerRef(story.slug),
        sceneRef: state.slot,
        language: voiceLang,
        voiceProfileId: profileId,
        text: state.line.text,
        speaker,
        pronunciationScope: `story:${story.slug}`,
      });
    }
  }
  return { lines, notes, targetRef: `voice:story:${story.slug}:${lang}` };
}

/** Every spoken block of a script (hook, sections, CTA) in its language, unless already queued. */
export async function scriptVoiceLines(scriptId: number, profileId: number): Promise<BatchLines> {
  const row = await getScript(scriptId);
  if (!row) throw new HiggsfieldVoiceError(`No script ${scriptId}.`);
  if (!validateScriptBody(row.body).ok)
    throw new HiggsfieldVoiceError(`Script ${scriptId} has no readable body.`);
  const blocks = scriptBlocks({ ...row, body: row.body as ScriptBodyV1 });
  const ownerRef = scriptOwnerRef(row.id);
  const notes: string[] = [];
  const lines: VoiceLineRequest[] = [];
  for (const block of blocks) {
    const line: VoiceLineRequest = {
      ownerKind: "script",
      ownerRef,
      sceneRef: block.sceneRef,
      language: row.language as VoiceLanguage,
      voiceProfileId: profileId,
      text: block.spokenText,
      speaker: null,
      pronunciationScope: `brand:${row.brandId}`,
    };
    if (await pendingTakeFor(line)) {
      notes.push(`${block.sceneRef}: already queued.`);
      continue;
    }
    lines.push(line);
  }
  return { lines, notes, targetRef: `voice:script:${row.id}` };
}

/** The target a single line's run is serialised on. */
export function lineTargetRef(line: VoiceLineRequest): string {
  return `voice:${line.ownerRef}${line.sceneRef ? `#${line.sceneRef}` : ""}:${line.language}`.slice(
    0,
    255,
  );
}

// ---------------------------------------------------------------------------
// Finalize

export type FinalizeResult = {
  done: number[];
  failed: number[];
  selected: number[];
  notes: string[];
};

const abs = (root: string, rel: string) => path.join(root, ...rel.split("/"));

async function isFile(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  return !!info?.isFile() && info.size > 0;
}

/** The file the run saved for a take: the manifest's outFile, a reported one, or `take-<id>.hf.*`. */
async function findLineFile(
  root: string,
  row: Narration,
  outFile: string | null,
  reported: string[],
): Promise<string | null> {
  const folder = narrationFolder(row);
  const prefix = `${folder}/take-${row.id}.hf.`;
  const candidates = [
    ...(outFile ? [outFile] : []),
    ...reported
      .map((f) => f.replace(/\\/g, "/").replace(/^\/+/, ""))
      .filter((f) => f.startsWith(prefix) && !f.split("/").includes("..")),
  ];
  for (const rel of candidates) if (await isFile(abs(root, rel))) return rel;
  const names = await readdir(abs(root, folder)).catch(() => [] as string[]);
  for (const name of names.sort()) {
    const rel = `${folder}/${name}`;
    if (rel.startsWith(prefix) && (await isFile(abs(root, rel)))) return rel;
  }
  return null;
}

async function registerAsset(rel: string, meta: Parameters<typeof registerFile>[1]) {
  const r = await registerFile(rel, meta);
  if (r.status === "created" || r.status === "existing") return r.asset.id;
  throw new Error(`Could not register ${rel}: ${r.message}`);
}

/** Source file → WAV 48 kHz mono master + MP3 playback, measured and registered. */
async function makeTakeFiles(
  root: string,
  row: Narration,
  source: string,
  meta: { brandId: string | null; model: string },
) {
  const folder = narrationFolder(row);
  const master = `${folder}/take-${row.id}.wav`;
  let playback = `${folder}/take-${row.id}.mp3`;
  const workDir = await mkdtemp(path.join(tmpdir(), "cm-hf-voice-"));
  const work = (rel: string) => path.join(workDir, path.basename(rel));
  try {
    if (await ffmpegAvailable()) {
      await normaliseToWav(abs(root, source), work(master));
      await encodeMp3(work(master), work(playback));
    } else if (source.toLowerCase().endsWith(".wav")) {
      await copyFile(abs(root, source), work(master));
      playback = master;
    } else {
      throw new Error(
        "ffmpeg is needed to turn the Higgsfield file into a take (set FFMPEG_PATH).",
      );
    }
    const durationMs = (await measureDurationMs(work(master))) ?? 0;
    if (durationMs <= 0) throw new Error(`The saved audio (${source}) could not be read.`);
    await storeImmutableOutput(master, { file: work(master) }, root);
    if (playback !== master) await storeImmutableOutput(playback, { file: work(playback) }, root);
    const assetMeta = {
      brandId: meta.brandId,
      source: "import" as const,
      sourceRef: `narration:${row.id}`,
      model: meta.model,
      tags: ["voice", "narration", "higgsfield", row.language],
    };
    const masterAssetId = await registerAsset(master, assetMeta);
    const playbackAssetId =
      playback === master ? masterAssetId : await registerAsset(playback, assetMeta);
    // The WAV master is made from it; the raw download is not kept as a second copy.
    await rm(abs(root, source), { force: true }).catch(() => {});
    return { masterAssetId, playbackAssetId, durationMs };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Turn a finished (or failed, cancelled, reaped) voice job's files into takes.
 * Only `pending` rows are touched, so a second call changes nothing. Then a
 * new take is selected where its slot has no usable selected take, and story
 * scene audio is rebuilt for the scenes that changed.
 */
export async function finalizeHiggsfieldVoiceJob(
  jobId: number,
  markers: VoiceMarkers | null,
): Promise<FinalizeResult> {
  const out: FinalizeResult = { done: [], failed: [], selected: [], notes: [] };
  const job = await getJob(jobId);
  if (!job) return out;
  const manifest = parseVoiceManifest(job.prompt);
  const byLine = new Map((manifest?.lines ?? []).map((l) => [l.lineId, l]));
  const ids = [...byLine.keys()];
  const rows = await db
    .select()
    .from(narrations)
    .where(
      and(
        eq(narrations.status, "pending"),
        eq(narrations.provider, "higgsfield"),
        or(
          eq(narrations.higgsfieldJobId, jobId),
          ids.length
            ? and(isNull(narrations.higgsfieldJobId), inArray(narrations.id, ids))
            : undefined,
        ),
      ),
    );
  if (!rows.length) return out;

  const m = markers ?? scanVoiceMarkers(job.log ?? "");
  const root = mediaRoot();
  const drive = await mediaRootStatus(root);
  const profileIds = [
    ...new Set(rows.map((r) => r.voiceProfileId).filter((x): x is number => !!x)),
  ];
  const profiles = new Map(
    (profileIds.length
      ? await db.select().from(voiceProfiles).where(inArray(voiceProfiles.id, profileIds))
      : []
    ).map((p) => [p.id, p]),
  );

  const fail = async (row: Narration, reason: string) => {
    const updated = await updateReturning(
      db,
      narrations,
      {
        status: "failed",
        error: reason.slice(0, 1024),
        higgsfieldJobId: jobId,
        externalRef: m.jobs[row.id] ?? null,
      },
      and(
        eq(narrations.id, row.id),
        eq(narrations.status, "pending"),
        row.higgsfieldJobId === null
          ? isNull(narrations.higgsfieldJobId)
          : eq(narrations.higgsfieldJobId, jobId),
      ),
      { id: narrations.id },
    );
    if (updated.length) out.failed.push(row.id);
  };

  const made: Array<{
    row: Narration;
    files: { masterAssetId: number; playbackAssetId: number; durationMs: number };
  }> = [];
  for (const row of rows) {
    const line = byLine.get(row.id) ?? null;
    if (drive !== "ok") {
      await fail(row, mediaRootMessage(drive));
      continue;
    }
    const file = await findLineFile(root, row, line?.outFile ?? null, m.files);
    if (!file) {
      const why = m.failures[row.id];
      await fail(
        row,
        why
          ? `Higgsfield: ${why}`
          : `No file was saved for this line (the run ended ${job.status}).`,
      );
      continue;
    }
    try {
      const settings = line
        ? { model: line.model, variant: line.variant }
        : profiles.get(row.voiceProfileId ?? 0)?.settings.higgsfield;
      const model = `higgsfield:${settings?.model ?? "?"}${settings?.variant ? `/${settings.variant}` : ""}`;
      const files = await makeTakeFiles(root, row, file, {
        brandId: profiles.get(row.voiceProfileId ?? 0)?.brandId ?? null,
        model,
      });
      made.push({ row, files });
    } catch (error) {
      await fail(row, error instanceof Error ? error.message : String(error));
    }
  }

  const credits = m.credits ?? job.creditsUsed ?? null;
  const shares = splitCredits(
    credits,
    made.map(({ row }) => ({ lineId: row.id, text: row.spokenText ?? row.inputText })),
  );
  const finished: Narration[] = [];
  for (const { row, files } of made) {
    const [updated] = await updateReturning(
      db,
      narrations,
      {
        status: "done",
        masterAssetId: files.masterAssetId,
        playbackAssetId: files.playbackAssetId,
        durationMs: files.durationMs,
        costUsd: 0,
        costCredits: shares.get(row.id) ?? null,
        higgsfieldJobId: jobId,
        externalRef: m.jobs[row.id] ?? null,
        error: null,
      },
      and(
        eq(narrations.id, row.id),
        eq(narrations.status, "pending"),
        row.higgsfieldJobId === null
          ? isNull(narrations.higgsfieldJobId)
          : eq(narrations.higgsfieldJobId, jobId),
      ),
    );
    if (updated) {
      out.done.push(row.id);
      finished.push(updated);
    }
  }

  await selectNewTakes(finished, out);
  return out;
}

/** Select each new take where its slot has nothing usable selected; rebuild touched story scenes. */
async function selectNewTakes(rows: Narration[], out: FinalizeResult): Promise<void> {
  const scenes = new Map<string, { slug: string; sceneRef: string; lang: string }>();
  for (const row of rows) {
    try {
      if (row.ownerKind === "story_scene" && row.ownerRef.startsWith("story:")) {
        const slug = row.ownerRef.slice("story:".length);
        const story = await getStory(slug);
        const lang = story?.languages.find((l) => voiceLanguageFor(l) === row.language);
        if (!story || !lang || !row.sceneRef) continue;
        const baseRef = row.sceneRef.replace(/#\d+$/, "");
        const scene = await getScene(story.id, baseRef);
        if (!scene) continue;
        const readiness = sceneReadiness(scene, lang, await listStoryTakes(slug));
        const state = readiness.lines.find((l) => l.slot === row.sceneRef);
        if (
          !state ||
          state.usable ||
          state.line.text !== row.inputText ||
          (state.line.speaker ?? null) !== (row.speaker ?? null)
        )
          continue;
        await selectTake(row.id);
        out.selected.push(row.id);
        scenes.set(`${slug}\u0000${baseRef}\u0000${lang}`, { slug, sceneRef: baseRef, lang });
      } else {
        const takes = await listTakes({
          ownerKind: row.ownerKind as NarrationOwnerKind,
          ownerRef: row.ownerRef,
          sceneRef: row.sceneRef,
          language: row.language,
          speaker: row.speaker,
        });
        if (takes.some((t) => t.selected)) continue;
        await selectTake(row.id);
        out.selected.push(row.id);
      }
    } catch (error) {
      out.notes.push(`take #${row.id}: ${(error as Error).message}`);
    }
  }
  for (const s of scenes.values()) {
    try {
      await buildSceneAudio(s.slug, s.sceneRef, s.lang);
    } catch (error) {
      if (error instanceof StoryError && error.code === "not_ready") continue;
      out.notes.push(`${s.sceneRef} ${s.lang} scene audio: ${(error as Error).message}`);
    }
  }
}

export { HiggsfieldInputError };
