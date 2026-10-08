"use server";

/**
 * Higgsfield voice from the UI (build 5 §3.A): queue one line, a book's
 * language or a script as a `voice` job, preview what a batch would cost, and
 * save a profile's Higgsfield settings. Owner-only — a run spends Anton's
 * credits. Errors come back as `{ ok: false, error }` with the engine's
 * message (production strips a thrown action's message).
 */

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { HiggsfieldBusyError, HiggsfieldInputError } from "@/lib/higgsfield/run";
import { HiggsfieldVoiceSettingsError, resolveHiggsfieldSettings } from "@/lib/higgsfield/voice";
import {
  HIGGSFIELD_TTS_MODELS,
  HIGGSFIELD_TTS_VARIANTS,
  NarrationRefusedError,
  type HiggsfieldTtsModel,
  type HiggsfieldTtsVariant,
  type NarrationOwnerKind,
  type VoiceLanguage,
} from "@/lib/voice/contract";
import {
  HiggsfieldVoiceError,
  lineTargetRef,
  listHiggsfieldProfiles,
  planHiggsfieldVoice,
  queueHiggsfieldVoice,
  scriptVoiceLines,
  setHiggsfieldProfileSettings,
  storyVoiceLines,
  type BatchLines,
  type HiggsfieldProfileOption,
  type Queued,
  type VoiceLineRequest,
} from "@/lib/voice/higgsfield-takes";
import { getProfileByKey } from "@/lib/voice/store";
import { saveVoiceProfileAction, type VoiceActionResult } from "@/lib/voice.actions";

export type HfVoiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type HfVoicePreview = {
  lines: number;
  estimateCredits: number;
  refused: Array<{ sceneRef: string | null; message: string }>;
  notes: string[];
};

export type HfVoiceQueued = {
  jobId: number;
  status: string;
  lines: number;
  estimateCredits: number;
  refused: Array<{ sceneRef: string | null; message: string }>;
  notes: string[];
};

async function owner(action: string): Promise<string | null> {
  try {
    await requireOwner(action);
    return null;
  } catch (error) {
    if (error instanceof ForbiddenError) return "Only the owner can make Higgsfield voice takes.";
    throw error;
  }
}

function failure(error: unknown): { ok: false; error: string } {
  if (
    error instanceof HiggsfieldVoiceError ||
    error instanceof HiggsfieldInputError ||
    error instanceof HiggsfieldBusyError ||
    error instanceof NarrationRefusedError ||
    error instanceof HiggsfieldVoiceSettingsError
  )
    return { ok: false, error: error.message };
  console.error("[higgsfield-voice]", error);
  return { ok: false, error: "The voice job could not be queued. See the server log." };
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function queuedResult(q: Queued, notes: string[], paths: string[]): HfVoiceResult<HfVoiceQueued> {
  q.finished.catch((error) => console.error("[higgsfield-voice] run", error));
  for (const p of ["/higgsfield", ...paths]) revalidatePath(p);
  return {
    ok: true,
    jobId: q.job.id,
    status: q.job.status,
    lines: q.narrationIds.length,
    estimateCredits: q.estimateCredits,
    refused: q.refused.map((r) => ({ sceneRef: r.request.sceneRef ?? null, message: r.message })),
    notes,
  };
}

async function preview(batch: BatchLines): Promise<HfVoicePreview> {
  const plan = await planHiggsfieldVoice(batch.lines);
  return {
    lines: plan.planned.length,
    estimateCredits: plan.estimateCredits,
    refused: plan.refused.map((r) => ({
      sceneRef: r.request.sceneRef ?? null,
      message: r.message,
    })),
    notes: batch.notes,
  };
}

/** Active Higgsfield voice profiles (for the buttons). */
export async function higgsfieldVoiceProfilesAction(): Promise<
  HfVoiceResult<{ profiles: HiggsfieldProfileOption[] }>
> {
  const denied = await owner("list Higgsfield voices");
  if (denied) return { ok: false, error: denied };
  return { ok: true, profiles: await listHiggsfieldProfiles() };
}

export type VoiceLineInput = {
  ownerKind: NarrationOwnerKind;
  ownerRef: string;
  sceneRef?: string | null;
  language: VoiceLanguage;
  voiceProfileId: number;
  text: string;
  speaker?: string | null;
  pronunciationScope?: string | null;
};

function lineFrom(input: VoiceLineInput): VoiceLineRequest {
  return {
    ownerKind: input.ownerKind,
    ownerRef: String(input.ownerRef ?? ""),
    sceneRef: input.sceneRef ?? null,
    language: input.language,
    voiceProfileId: Number(input.voiceProfileId),
    text: String(input.text ?? ""),
    speaker: input.speaker ?? null,
    pronunciationScope: input.pronunciationScope ?? null,
  };
}

/** What one line would cost (or why it is refused). */
export async function previewVoiceLineAction(
  input: VoiceLineInput,
): Promise<HfVoiceResult<HfVoicePreview>> {
  const denied = await owner("estimate a Higgsfield take");
  if (denied) return { ok: false, error: denied };
  try {
    return { ok: true, ...(await preview({ lines: [lineFrom(input)], notes: [], targetRef: "" })) };
  } catch (error) {
    return failure(error);
  }
}

/** Queue one line (a NarrateButton-like control with a Higgsfield profile chosen). */
export async function queueVoiceAction(
  input: VoiceLineInput & { maxCredits: number },
): Promise<HfVoiceResult<HfVoiceQueued>> {
  const denied = await owner("make a Higgsfield take");
  if (denied) return { ok: false, error: denied };
  try {
    const line = lineFrom(input);
    const q = await queueHiggsfieldVoice({
      lines: [line],
      maxCredits: Number(input.maxCredits),
      targetRef: lineTargetRef(line),
    });
    return queuedResult(q, [], []);
  } catch (error) {
    return failure(error);
  }
}

export async function previewStoryVoiceAction(
  slug: string,
  lang: string,
  profileId: number,
): Promise<HfVoiceResult<HfVoicePreview>> {
  const denied = await owner("estimate Higgsfield voice");
  if (denied) return { ok: false, error: denied };
  if (!isId(profileId)) return { ok: false, error: "Pick a Higgsfield voice." };
  try {
    return {
      ok: true,
      ...(await preview(await storyVoiceLines(String(slug), String(lang), profileId))),
    };
  } catch (error) {
    return failure(error);
  }
}

/** Every ready line of a book in one language that lacks a usable take, as one job. */
export async function queueStoryVoiceAction(
  slug: string,
  lang: string,
  profileId: number,
  maxCredits: number,
): Promise<HfVoiceResult<HfVoiceQueued>> {
  const denied = await owner("make Higgsfield takes");
  if (denied) return { ok: false, error: denied };
  if (!isId(profileId)) return { ok: false, error: "Pick a Higgsfield voice." };
  try {
    const batch = await storyVoiceLines(String(slug), String(lang), profileId);
    const q = await queueHiggsfieldVoice({
      lines: batch.lines,
      maxCredits: Number(maxCredits),
      targetRef: batch.targetRef,
      allowPartial: true,
    });
    return queuedResult(q, batch.notes, [`/stories/${slug}`]);
  } catch (error) {
    return failure(error);
  }
}

export async function previewScriptVoiceAction(
  scriptId: number,
  profileId: number,
): Promise<HfVoiceResult<HfVoicePreview>> {
  const denied = await owner("estimate Higgsfield voice");
  if (denied) return { ok: false, error: denied };
  if (!isId(scriptId) || !isId(profileId)) return { ok: false, error: "Pick a Higgsfield voice." };
  try {
    return { ok: true, ...(await preview(await scriptVoiceLines(scriptId, profileId))) };
  } catch (error) {
    return failure(error);
  }
}

/** Every spoken block of a script, as one job. */
export async function queueScriptVoiceAction(
  scriptId: number,
  profileId: number,
  maxCredits: number,
): Promise<HfVoiceResult<HfVoiceQueued>> {
  const denied = await owner("make Higgsfield takes");
  if (denied) return { ok: false, error: denied };
  if (!isId(scriptId) || !isId(profileId)) return { ok: false, error: "Pick a Higgsfield voice." };
  try {
    const batch = await scriptVoiceLines(scriptId, profileId);
    const q = await queueHiggsfieldVoice({
      lines: batch.lines,
      maxCredits: Number(maxCredits),
      targetRef: batch.targetRef,
      allowPartial: true,
    });
    return queuedResult(q, batch.notes, [`/studio/${scriptId}/voice`]);
  } catch (error) {
    return failure(error);
  }
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The voice profile form's save: other providers go straight to the voice
 * studio's save; a Higgsfield profile also stores engine, variant, voice type
 * and voice id in `settings.higgsfield`. A cloned (`element`) voice must carry
 * a consent record — it starts `pending` and makes takes only once `signed`.
 */
export async function saveVoiceProfileWithHiggsfieldAction(
  id: number | null,
  prev: VoiceActionResult | null,
  formData: FormData,
): Promise<VoiceActionResult> {
  if (field(formData, "provider") !== "higgsfield")
    return saveVoiceProfileAction(id, prev, formData);
  try {
    await requireOwner("edit voice profiles");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "voice.error.owner" };
    throw error;
  }
  const model = field(formData, "hfModel") as HiggsfieldTtsModel;
  const variant = field(formData, "hfVariant") as HiggsfieldTtsVariant;
  const voiceType = field(formData, "hfVoiceType") === "element" ? "element" : "preset";
  const voiceId = field(formData, "providerVoiceId");
  let hf;
  try {
    if (!HIGGSFIELD_TTS_MODELS.includes(model)) return { ok: false, error: "hfVoice.error.model" };
    if (model === "text2speech_v2" && !HIGGSFIELD_TTS_VARIANTS.includes(variant))
      return { ok: false, error: "hfVoice.error.variant" };
    hf = resolveHiggsfieldSettings(
      {
        higgsfield: {
          model,
          ...(model === "text2speech_v2" ? { variant } : {}),
          voiceType,
          voiceId,
        },
      },
      voiceId,
    );
  } catch (error) {
    return {
      ok: false,
      error: "voice.error.invalid",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (voiceType === "element" && field(formData, "consentStatus") === "not_needed")
    return { ok: false, error: "hfVoice.error.elementConsent" };

  const saved = await saveVoiceProfileAction(id, prev, formData);
  if (!saved.ok) return saved;
  const profileId = id ?? (await getProfileByKey(field(formData, "key").toLowerCase()))?.id;
  if (!profileId) return { ok: false, error: "voice.error.missing" };
  try {
    await setHiggsfieldProfileSettings(profileId, hf);
  } catch (error) {
    return {
      ok: false,
      error: "voice.error.failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  revalidatePath("/voice");
  return { ok: true };
}
