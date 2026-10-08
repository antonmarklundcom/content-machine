"use server";

/**
 * The voice studio's writes (build 4 phase A, docs/VOICE.md). Owner only:
 * takes spend money and voice profiles hold consent records.
 *
 * Errors come back as dictionary keys; `detail` carries the engine's message
 * (English), e.g. a `NarrationRefusedError` naming the Settings field to fill.
 */

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import type { User } from "@/db/schema";
import type { TranslationKey } from "@/lib/i18n";
import { SpendCapExceededError } from "@/lib/spend";
import {
  CONSENT_STATUSES,
  LEXICON_REVIEW_STATUSES,
  NARRATION_OWNER_KINDS,
  NarrationRefusedError,
  TAKE_REVIEW_STATUSES,
  VOICE_LANGUAGES,
  VOICE_PROVIDERS,
  VOICE_ROLES,
  narrate,
  reviewTake,
  selectTake,
  type ConsentStatus,
  type LexiconReviewStatus,
  type NarrationOwnerKind,
  type TakeReviewStatus,
  type VoiceLanguage,
  type VoiceProvider,
  type VoiceRole,
} from "@/lib/voice";
import { listProviderVoices } from "@/lib/voice/providers";
import type { ProviderVoice } from "@/lib/voice/providers/types";
import { toTakeView, type TakeView } from "@/lib/voice/views";
import {
  createProfile,
  createPronunciation,
  deletePronunciation,
  getNarration,
  getPronunciation,
  InvalidVoiceInputError,
  listProfiles,
  listTakes,
  reviewPronunciation,
  setProfileActive,
  updateProfile,
  updatePronunciation,
  type VoiceProfileInput,
} from "@/lib/voice/store";

export type VoiceActionResult =
  { ok: true } | { ok: false; error: TranslationKey; detail?: string };

function failure(err: unknown): { ok: false; error: TranslationKey; detail?: string } {
  if (err instanceof ForbiddenError) return { ok: false, error: "voice.error.owner" };
  if (err instanceof InvalidVoiceInputError) {
    return { ok: false, error: "voice.error.invalid", detail: err.message };
  }
  if (err instanceof NarrationRefusedError) {
    return { ok: false, error: "voice.error.refused", detail: err.message };
  }
  if (err instanceof SpendCapExceededError) {
    return { ok: false, error: "voice.error.cap", detail: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: "voice.error.failed", detail: message.slice(0, 500) };
}

async function asOwner<T extends { ok: boolean }>(
  what: string,
  paths: string[],
  fn: (owner: User) => Promise<T>,
): Promise<T> {
  try {
    const owner = await requireOwner(what);
    const result = await fn(owner);
    if (result.ok) for (const p of paths) revalidatePath(p);
    return result;
  } catch (err) {
    // A redirect (signed out) must propagate; everything else becomes a result.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return failure(err) as unknown as T;
  }
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------
// voice profiles
// ---------------------------------------------------------------------------

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function optionalNumber(form: FormData, name: string): number | undefined {
  const raw = field(form, name).trim();
  if (!raw) return undefined;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function optionalDate(form: FormData, name: string): Date | null {
  const raw = field(form, name).trim();
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function profileFromForm(form: FormData): VoiceProfileInput {
  const provider = field(form, "provider") as VoiceProvider;
  const role = (field(form, "role") || "narrator") as VoiceRole;
  const consentStatus = (field(form, "consentStatus") || "not_needed") as ConsentStatus;
  if (!VOICE_PROVIDERS.includes(provider)) throw new InvalidVoiceInputError("Pick a provider.");
  if (!VOICE_ROLES.includes(role)) throw new InvalidVoiceInputError("Unknown role.");
  if (!CONSENT_STATUSES.includes(consentStatus)) {
    throw new InvalidVoiceInputError("Unknown consent status.");
  }
  return {
    key: field(form, "key"),
    name: field(form, "name"),
    provider,
    providerVoiceId: field(form, "providerVoiceId"),
    languages: form.getAll("languages").filter((v): v is string => typeof v === "string"),
    role,
    characterKey: field(form, "characterKey"),
    brandId: field(form, "brandId"),
    settings: {
      model: field(form, "model"),
      stability: optionalNumber(form, "stability"),
      similarity: optionalNumber(form, "similarity"),
      style: optionalNumber(form, "style"),
      speed: optionalNumber(form, "speed"),
      azureStyle: field(form, "azureStyle"),
      pitch: field(form, "pitch"),
      instructions: field(form, "instructions"),
      // Build 5: Chatterbox mode and tuning. The reference sample is set by its
      // own upload (/api/voice/reference) and kept by updateProfile.
      ...(provider === "chatterbox"
        ? {
            chatterbox: {
              mode:
                field(form, "cbMode") === "replicate" ? ("replicate" as const) : ("local" as const),
              exaggeration: optionalNumber(form, "cbExaggeration"),
              cfgWeight: optionalNumber(form, "cbCfgWeight"),
              languageId: field(form, "cbLanguageId") || undefined,
            },
          }
        : {}),
    },
    consentStatus,
    consentPerson: field(form, "consentPerson"),
    consentScope: field(form, "consentScope"),
    consentSignedAt: optionalDate(form, "consentSignedAt"),
    consentExpiresAt: optionalDate(form, "consentExpiresAt"),
    active: form.get("active") !== null,
    notes: field(form, "notes"),
  };
}

/** Create (`id` null) or edit a voice profile. `useActionState` shape. */
export async function saveVoiceProfileAction(
  id: number | null,
  _prev: VoiceActionResult | null,
  formData: FormData,
): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("edit voice profiles", ["/voice", "/voice/test"], async () => {
    const input = profileFromForm(formData);
    if (id === null) {
      await createProfile(input);
      return { ok: true };
    }
    if (!isId(id)) return { ok: false, error: "voice.error.missing" };
    return (await updateProfile(id, input))
      ? { ok: true }
      : { ok: false, error: "voice.error.missing" };
  });
}

export async function setVoiceProfileActiveAction(
  id: number,
  active: boolean,
): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("edit voice profiles", ["/voice", "/voice/test"], async () => {
    if (!isId(id)) return { ok: false, error: "voice.error.missing" };
    return (await setProfileActive(id, active === true))
      ? { ok: true }
      : { ok: false, error: "voice.error.missing" };
  });
}

export type LoadVoicesResult =
  { ok: true; voices: ProviderVoice[] } | { ok: false; error: TranslationKey; detail?: string };

/** "Load voices" on the profile form: the provider's voice list (es-PY first for Azure). */
export async function loadProviderVoicesAction(provider: string): Promise<LoadVoicesResult> {
  return asOwner<LoadVoicesResult>("list provider voices", [], async () => {
    if (!VOICE_PROVIDERS.includes(provider as VoiceProvider)) {
      return { ok: false, error: "voice.error.invalid" };
    }
    const voices = await listProviderVoices(provider as VoiceProvider);
    const rank = (v: ProviderVoice) =>
      v.locale === "es-PY" ? 0 : v.locale?.startsWith("es") ? 1 : 2;
    return { ok: true, voices: [...voices].sort((a, b) => rank(a) - rank(b)) };
  });
}

// ---------------------------------------------------------------------------
// pronunciations
// ---------------------------------------------------------------------------

function pronunciationFromForm(form: FormData) {
  return {
    term: field(form, "term"),
    sayAs: field(form, "sayAs"),
    language: field(form, "language") || "*",
    scope: field(form, "scope") || "global",
    notes: field(form, "notes"),
  };
}

export async function createPronunciationAction(
  _prev: VoiceActionResult | null,
  formData: FormData,
): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("edit pronunciations", ["/voice/pronunciations"], async () => {
    await createPronunciation(pronunciationFromForm(formData));
    return { ok: true };
  });
}

export async function updatePronunciationAction(
  id: number,
  _prev: VoiceActionResult | null,
  formData: FormData,
): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("edit pronunciations", ["/voice/pronunciations"], async () => {
    if (!isId(id)) return { ok: false, error: "voice.error.missing" };
    return (await updatePronunciation(id, pronunciationFromForm(formData)))
      ? { ok: true }
      : { ok: false, error: "voice.error.missing" };
  });
}

export async function reviewPronunciationAction(
  id: number,
  status: LexiconReviewStatus,
  reviewer: string,
): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>(
    "review pronunciations",
    ["/voice/pronunciations"],
    async () => {
      if (!isId(id) || !LEXICON_REVIEW_STATUSES.includes(status)) {
        return { ok: false, error: "voice.error.missing" };
      }
      return (await reviewPronunciation(id, status, reviewer))
        ? { ok: true }
        : { ok: false, error: "voice.error.missing" };
    },
  );
}

export async function deletePronunciationAction(id: number): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("edit pronunciations", ["/voice/pronunciations"], async () => {
    if (!isId(id)) return { ok: false, error: "voice.error.missing" };
    return (await deletePronunciation(id))
      ? { ok: true }
      : { ok: false, error: "voice.error.missing" };
  });
}

export type PreviewTake = { assetId: number | null; text: string; costUsd: number };
export type PreviewResult =
  | { ok: true; without: PreviewTake; with: PreviewTake }
  | { ok: false; error: TranslationKey; detail?: string };

/** Two short takes of the term in a sentence: as written, and with the respelling (even while proposed). */
export async function previewPronunciationAction(
  id: number,
  voiceProfileId: number,
  sample: string,
): Promise<PreviewResult> {
  return asOwner<PreviewResult>("preview a pronunciation", ["/voice/pronunciations"], async () => {
    if (!isId(id) || !isId(voiceProfileId)) {
      return { ok: false, error: "voice.error.missing" };
    }
    const rule = await getPronunciation(id);
    if (!rule) return { ok: false, error: "voice.error.missing" };
    const text = sample.trim() || rule.term;
    const language = (rule.language === "*" ? "es-PY" : rule.language) as VoiceLanguage;
    const scope = rule.scope.startsWith("provider:") || rule.scope === "global" ? null : rule.scope;
    const base = {
      ownerKind: "free" as const,
      ownerRef: `pronunciation:${rule.id}`,
      language,
      voiceProfileId,
      text,
      pronunciationScope: scope,
    };
    const without = await narrate({ ...base, sceneRef: "without" }, { skipPronunciations: true });
    const withIt = await narrate({ ...base, sceneRef: "with" }, { includeProposed: true });
    const [a, b] = await Promise.all([
      getNarration(without.narrationId),
      getNarration(withIt.narrationId),
    ]);
    return {
      ok: true,
      without: {
        assetId: a?.playbackAssetId ?? null,
        text: a?.spokenText ?? text,
        costUsd: without.costUsd,
      },
      with: {
        assetId: b?.playbackAssetId ?? null,
        text: b?.spokenText ?? text,
        costUsd: withIt.costUsd,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// takes
// ---------------------------------------------------------------------------

export type TakeKeyInput = {
  ownerKind: NarrationOwnerKind;
  ownerRef: string;
  sceneRef?: string | null;
  language?: string | null;
  speaker?: string | null;
};

function cleanKey(key: TakeKeyInput): TakeKeyInput | null {
  if (!NARRATION_OWNER_KINDS.includes(key.ownerKind)) return null;
  if (typeof key.ownerRef !== "string" || !key.ownerRef.trim()) return null;
  return {
    ownerKind: key.ownerKind,
    ownerRef: key.ownerRef,
    sceneRef: key.sceneRef || null,
    language: key.language || null,
    speaker: key.speaker || null,
  };
}

export type TakesResult =
  { ok: true; takes: TakeView[] } | { ok: false; error: TranslationKey; detail?: string };

/** The takes of one line, newest first (NarrationTakes reloads through this). */
export async function listTakesAction(key: TakeKeyInput): Promise<TakesResult> {
  return asOwner<TakesResult>("list takes", [], async () => {
    const clean = cleanKey(key);
    if (!clean) return { ok: false, error: "voice.error.invalid" };
    const rows = await listTakes(clean);
    return { ok: true, takes: rows.map(toTakeView) };
  });
}

export type NarrateActionInput = TakeKeyInput & {
  language: VoiceLanguage;
  voiceProfileId: number;
  text: string;
  pronunciationScope?: string | null;
};

export type NarrateActionResult =
  | { ok: true; narrationId: number; costUsd: number; durationMs: number }
  | { ok: false; error: TranslationKey; detail?: string };

/** "Make a take" (NarrateButton). */
export async function narrateAction(input: NarrateActionInput): Promise<NarrateActionResult> {
  return asOwner<NarrateActionResult>("make a take", ["/voice/test"], async () => {
    const key = cleanKey(input);
    if (!key || !isId(input.voiceProfileId) || !VOICE_LANGUAGES.includes(input.language)) {
      return { ok: false, error: "voice.error.invalid" };
    }
    const result = await narrate({
      ownerKind: key.ownerKind,
      ownerRef: key.ownerRef,
      sceneRef: key.sceneRef,
      speaker: key.speaker,
      language: input.language,
      voiceProfileId: input.voiceProfileId,
      text: String(input.text ?? ""),
      pronunciationScope: input.pronunciationScope ?? null,
    });
    return {
      ok: true,
      narrationId: result.narrationId,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    };
  });
}

export async function selectTakeAction(id: number): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("select a take", ["/voice/test"], async () => {
    if (!isId(id)) return { ok: false, error: "voice.error.missing" };
    await selectTake(id);
    return { ok: true };
  });
}

export async function reviewTakeAction(
  id: number,
  status: TakeReviewStatus,
  note?: string | null,
): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("review a take", ["/voice/test"], async (owner) => {
    if (!isId(id) || !TAKE_REVIEW_STATUSES.includes(status)) {
      return { ok: false, error: "voice.error.missing" };
    }
    await reviewTake(id, status, note ?? null, owner.email);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// voice gate (/voice/test)
// ---------------------------------------------------------------------------

export type VoiceTestOutcome =
  | { profileId: number; ok: true; narrationId: number; costUsd: number }
  | { profileId: number; ok: false; error: TranslationKey; detail?: string };

export type VoiceTestResult =
  | { ok: true; ownerRef: string; outcomes: VoiceTestOutcome[] }
  | { ok: false; error: TranslationKey; detail?: string };

const MAX_TEST_VOICES = 4;

/**
 * Render one script with 2–4 voices side by side (ownerKind `voice_test`).
 * One voice refusing (consent, key) does not stop the others.
 */
export async function runVoiceTestAction(
  _prev: VoiceTestResult | null,
  formData: FormData,
): Promise<VoiceTestResult> {
  return asOwner<VoiceTestResult>("run a voice test", ["/voice/test"], async () => {
    const text = field(formData, "text").trim();
    const language = field(formData, "language") as VoiceLanguage;
    const ids = [
      ...new Set(
        formData
          .getAll("profiles")
          .map((v) => Number(v))
          .filter(isId),
      ),
    ];
    if (!text) return { ok: false, error: "voice.test.error.text" };
    if (!VOICE_LANGUAGES.includes(language)) {
      return { ok: false, error: "voice.error.invalid" };
    }
    if (ids.length < 1 || ids.length > MAX_TEST_VOICES) {
      return { ok: false, error: "voice.test.error.count" };
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const ownerRef = `voice-test:${stamp}`;
    const outcomes: VoiceTestOutcome[] = [];
    for (const profileId of ids) {
      try {
        const r = await narrate({
          ownerKind: "voice_test",
          ownerRef,
          language,
          voiceProfileId: profileId,
          text,
        });
        outcomes.push({ profileId, ok: true, narrationId: r.narrationId, costUsd: r.costUsd });
      } catch (err) {
        if (err instanceof ForbiddenError) throw err;
        const f = failure(err);
        outcomes.push({ profileId, ok: false, error: f.error, detail: f.detail });
      }
    }
    return { ok: true, ownerRef, outcomes };
  });
}

/** The voice gate's verdict: this take wins (selected + approved with a note). */
export async function markWinnerAction(id: number, note: string): Promise<VoiceActionResult> {
  return asOwner<VoiceActionResult>("pick a voice", ["/voice/test"], async (owner) => {
    if (!isId(id)) return { ok: false, error: "voice.error.missing" };
    await selectTake(id);
    await reviewTake(id, "approved", String(note ?? "").trim() || "Voice gate winner", owner.email);
    return { ok: true };
  });
}

export type VoiceOption = {
  id: number;
  name: string;
  provider: VoiceProvider;
  languages: string[];
  role: VoiceRole;
  characterKey: string | null;
};

export type VoiceOptionsResult =
  { ok: true; voices: VoiceOption[] } | { ok: false; error: TranslationKey; detail?: string };

/** Active voice profiles (for NarrateButton and the recording upload's speaker list). */
export async function voiceOptionsAction(): Promise<VoiceOptionsResult> {
  return asOwner<VoiceOptionsResult>("list voices", [], async () => {
    const rows = await listProfiles({ activeOnly: true });
    return {
      ok: true,
      voices: rows.map((p) => ({
        id: p.id,
        name: p.name,
        provider: p.provider,
        languages: p.languages,
        role: p.role,
        characterKey: p.characterKey,
      })),
    };
  });
}
