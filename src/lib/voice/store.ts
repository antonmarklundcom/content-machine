import { deleteReturning, insertReturning, updateReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  assets,
  narrations,
  pronunciations,
  voiceProfiles,
  type Narration,
  type Pronunciation,
  type VoiceProfile,
} from "@/db/schema";

import {
  CONSENT_STATUSES,
  LEXICON_REVIEW_STATUSES,
  VOICE_LANGUAGES,
  VOICE_PROVIDERS,
  VOICE_ROLES,
  type ConsentStatus,
  type LexiconReviewStatus,
  type NarrationOwnerKind,
  type VoiceProvider,
  type VoiceRole,
  type VoiceSettings,
  HIGGSFIELD_TTS_MODELS,
  HIGGSFIELD_TTS_VARIANTS,
} from "./contract";

/**
 * Reads and writes of the voice tables (docs/VOICE.md). The engine
 * (`index.ts`) and the server actions (`src/lib/voice.actions.ts`) go through
 * here; validation lives here so a script and the UI refuse the same input.
 */

export class InvalidVoiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVoiceInputError";
  }
}

// ---------------------------------------------------------------------------
// voice profiles
// ---------------------------------------------------------------------------

export type VoiceProfileInput = {
  key: string;
  name: string;
  provider: VoiceProvider;
  providerVoiceId?: string | null;
  languages: string[];
  role?: VoiceRole;
  characterKey?: string | null;
  brandId?: string | null;
  settings?: VoiceSettings;
  consentStatus?: ConsentStatus;
  consentPerson?: string | null;
  consentScope?: string | null;
  consentSignedAt?: Date | null;
  consentExpiresAt?: Date | null;
  active?: boolean;
  notes?: string | null;
};

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function finite(n: unknown, min: number, max: number): number | undefined {
  if (n === undefined || n === null || n === "") return undefined;
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

/** Only known settings, numbers clamped to their documented ranges. */
export function cleanSettings(s: VoiceSettings | undefined): VoiceSettings {
  const out: VoiceSettings = {};
  if (!s) return out;
  const model = clean(s.model);
  if (model) out.model = model;
  const stability = finite(s.stability, 0, 1);
  if (stability !== undefined) out.stability = stability;
  const similarity = finite(s.similarity, 0, 1);
  if (similarity !== undefined) out.similarity = similarity;
  const style = finite(s.style, 0, 1);
  if (style !== undefined) out.style = style;
  const speed = finite(s.speed, 0.7, 1.2);
  if (speed !== undefined) out.speed = speed;
  const azureStyle = clean(s.azureStyle);
  if (azureStyle) out.azureStyle = azureStyle;
  const pitch = clean(s.pitch);
  if (pitch) out.pitch = pitch;
  const instructions = clean(s.instructions);
  if (instructions) out.instructions = instructions;
  // Build 5: the Higgsfield engine/voice and the Chatterbox mode/reference.
  const hf = s.higgsfield;
  if (hf && typeof hf === "object") {
    const voiceId = clean(hf.voiceId);
    if (
      voiceId &&
      (HIGGSFIELD_TTS_MODELS as readonly string[]).includes(hf.model) &&
      (hf.voiceType === "preset" || hf.voiceType === "element")
    ) {
      out.higgsfield = { model: hf.model, voiceType: hf.voiceType, voiceId };
      if (hf.variant && (HIGGSFIELD_TTS_VARIANTS as readonly string[]).includes(hf.variant))
        out.higgsfield.variant = hf.variant;
    }
  }
  const cb = s.chatterbox;
  if (cb && typeof cb === "object") {
    const mode = cb.mode === "replicate" ? "replicate" : "local";
    out.chatterbox = { mode };
    const ref = clean(cb.referencePath);
    if (ref && !ref.split(/[\\/]/).includes("..") && !/^([a-zA-Z]:|\/)/.test(ref))
      out.chatterbox.referencePath = ref;
    const exaggeration = finite(cb.exaggeration, 0.25, 2);
    if (exaggeration !== undefined) out.chatterbox.exaggeration = exaggeration;
    const cfgWeight = finite(cb.cfgWeight, 0, 1);
    if (cfgWeight !== undefined) out.chatterbox.cfgWeight = cfgWeight;
    const languageId = clean(cb.languageId);
    if (languageId && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(languageId))
      out.chatterbox.languageId = languageId;
  }
  return out;
}

function validateProfile(input: VoiceProfileInput): typeof voiceProfiles.$inferInsert {
  const key = input.key.trim().toLowerCase();
  if (!KEY_RE.test(key)) {
    throw new InvalidVoiceInputError(
      "The key is lower-case letters, digits and dashes (e.g. narrador-py-1).",
    );
  }
  const name = input.name.trim();
  if (!name) throw new InvalidVoiceInputError("The name is required.");
  if (!VOICE_PROVIDERS.includes(input.provider))
    throw new InvalidVoiceInputError("Unknown provider.");
  const languages = [...new Set(input.languages.map((l) => l.trim()))].filter(Boolean);
  for (const l of languages) {
    if (!(VOICE_LANGUAGES as readonly string[]).includes(l)) {
      throw new InvalidVoiceInputError(`Unknown language: ${l}.`);
    }
  }
  if (!languages.length) throw new InvalidVoiceInputError("Pick at least one language.");
  if (languages.includes("gn") && input.provider !== "manual") {
    throw new InvalidVoiceInputError(
      "Only a recorded (manual) voice can have Guaraní: no TTS speaks it.",
    );
  }
  const role = input.role ?? "narrator";
  if (!VOICE_ROLES.includes(role)) throw new InvalidVoiceInputError("Unknown role.");
  const consentStatus = input.consentStatus ?? "not_needed";
  if (!CONSENT_STATUSES.includes(consentStatus))
    throw new InvalidVoiceInputError("Unknown consent status.");
  if (consentStatus !== "not_needed" && !clean(input.consentPerson)) {
    throw new InvalidVoiceInputError("Name the person whose voice this is (consent).");
  }
  // Higgsfield keeps its voice in settings.higgsfield; Chatterbox clones a
  // reference sample and has no voice id at all (build 5).
  const providerVoiceId =
    clean(input.providerVoiceId) ??
    (input.provider === "higgsfield" ? (clean(input.settings?.higgsfield?.voiceId) ?? null) : null);
  if (input.provider !== "manual" && input.provider !== "chatterbox" && !providerVoiceId) {
    throw new InvalidVoiceInputError("Set the provider's voice id.");
  }
  return {
    key,
    name,
    provider: input.provider,
    providerVoiceId: input.provider === "manual" ? null : providerVoiceId,
    languages,
    role,
    characterKey: role === "character" ? clean(input.characterKey) : null,
    brandId: clean(input.brandId),
    settings: cleanSettings(input.settings),
    consentStatus,
    consentPerson: clean(input.consentPerson),
    consentScope: clean(input.consentScope),
    consentSignedAt: input.consentSignedAt ?? null,
    consentExpiresAt: input.consentExpiresAt ?? null,
    active: input.active ?? true,
    notes: clean(input.notes),
  };
}

export async function listProfiles(opts: { activeOnly?: boolean } = {}): Promise<VoiceProfile[]> {
  return db
    .select()
    .from(voiceProfiles)
    .where(opts.activeOnly ? eq(voiceProfiles.active, true) : undefined)
    .orderBy(desc(voiceProfiles.active), voiceProfiles.name);
}

export async function getProfile(id: number): Promise<VoiceProfile | null> {
  const [row] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.id, id)).limit(1);
  return row ?? null;
}

export async function getProfileByKey(key: string): Promise<VoiceProfile | null> {
  const [row] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.key, key)).limit(1);
  return row ?? null;
}

async function keyTaken(key: string, exceptId?: number): Promise<boolean> {
  const found = await getProfileByKey(key);
  return !!found && found.id !== exceptId;
}

export async function createProfile(input: VoiceProfileInput): Promise<VoiceProfile> {
  const values = validateProfile(input);
  if (await keyTaken(values.key))
    throw new InvalidVoiceInputError(`The key “${values.key}” is taken.`);
  const [row] = await insertReturning(db, voiceProfiles, values);
  return row;
}

export async function updateProfile(
  id: number,
  input: VoiceProfileInput,
): Promise<VoiceProfile | null> {
  const values = validateProfile(input);
  if (await keyTaken(values.key, id))
    throw new InvalidVoiceInputError(`The key “${values.key}” is taken.`);
  // Build 5: settings the form does not carry survive an edit — the Chatterbox
  // reference sample (uploaded separately) and the Higgsfield voice when the
  // form sent none.
  const [existing] = await db
    .select({ settings: voiceProfiles.settings })
    .from(voiceProfiles)
    .where(eq(voiceProfiles.id, id))
    .limit(1);
  const before = existing?.settings;
  if (before && values.settings) {
    const next = values.settings;
    if (next.chatterbox && !next.chatterbox.referencePath && before.chatterbox?.referencePath)
      next.chatterbox.referencePath = before.chatterbox.referencePath;
    if (values.provider === "higgsfield" && !next.higgsfield && before.higgsfield)
      next.higgsfield = before.higgsfield;
  }
  const [row] = await updateReturning(
    db,
    voiceProfiles,
    { ...values, updatedAt: new Date() },
    eq(voiceProfiles.id, id),
  );
  return row ?? null;
}

export async function setProfileActive(id: number, active: boolean): Promise<boolean> {
  const rows = await updateReturning(
    db,
    voiceProfiles,
    { active, updatedAt: new Date() },
    eq(voiceProfiles.id, id),
    { id: voiceProfiles.id },
  );
  return rows.length > 0;
}

export async function setConsentDocument(id: number, relPath: string): Promise<boolean> {
  const rows = await updateReturning(
    db,
    voiceProfiles,
    { consentDocPath: relPath, updatedAt: new Date() },
    eq(voiceProfiles.id, id),
    { id: voiceProfiles.id },
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// pronunciations
// ---------------------------------------------------------------------------

export type PronunciationInput = {
  term: string;
  sayAs: string;
  language?: string;
  scope?: string;
  notes?: string | null;
};

const SCOPE_RE = /^(global|(brand|story|provider):[A-Za-z0-9._-]{1,100})$/;

function validatePronunciation(input: PronunciationInput) {
  const term = input.term.normalize("NFC").trim();
  const sayAs = input.sayAs.normalize("NFC").trim();
  if (!term || !sayAs)
    throw new InvalidVoiceInputError("Both the term and how to say it are required.");
  const language = (input.language ?? "*").trim() || "*";
  if (language !== "*" && !(VOICE_LANGUAGES as readonly string[]).includes(language)) {
    throw new InvalidVoiceInputError(`Unknown language: ${language}.`);
  }
  const scope = (input.scope ?? "global").trim() || "global";
  if (!SCOPE_RE.test(scope)) {
    throw new InvalidVoiceInputError(
      "Scope is global, brand:<id>, story:<slug> or provider:<name>.",
    );
  }
  if (
    scope.startsWith("provider:") &&
    !(VOICE_PROVIDERS as readonly string[]).includes(scope.slice(9))
  ) {
    throw new InvalidVoiceInputError("Unknown provider in the scope.");
  }
  return { term, sayAs, language, scope, notes: clean(input.notes) };
}

export type PronunciationFilter = {
  language?: string;
  scope?: string;
  status?: LexiconReviewStatus;
};

export async function listPronunciations(
  filter: PronunciationFilter = {},
): Promise<Pronunciation[]> {
  const conds = [
    filter.language ? eq(pronunciations.language, filter.language) : undefined,
    filter.scope ? eq(pronunciations.scope, filter.scope) : undefined,
    filter.status && LEXICON_REVIEW_STATUSES.includes(filter.status)
      ? eq(pronunciations.reviewStatus, filter.status)
      : undefined,
  ].filter((c): c is SQL => c !== undefined);
  return db
    .select()
    .from(pronunciations)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(pronunciations.term, pronunciations.language, pronunciations.scope)
    .limit(1000);
}

/** The candidate rows for a take: this language or `*`, not rejected. `pronunciations.ts` picks the winners. */
export async function pronunciationRulesFor(language: string): Promise<Pronunciation[]> {
  return db
    .select()
    .from(pronunciations)
    .where(
      and(
        inArray(pronunciations.language, [language, "*"]),
        inArray(pronunciations.reviewStatus, ["approved", "proposed"]),
      ),
    );
}

export async function getPronunciation(id: number): Promise<Pronunciation | null> {
  const [row] = await db.select().from(pronunciations).where(eq(pronunciations.id, id)).limit(1);
  return row ?? null;
}

async function duplicate(v: { term: string; language: string; scope: string }, exceptId?: number) {
  const [row] = await db
    .select({ id: pronunciations.id })
    .from(pronunciations)
    .where(
      and(
        eq(pronunciations.term, v.term),
        eq(pronunciations.language, v.language),
        eq(pronunciations.scope, v.scope),
      ),
    )
    .limit(1);
  return !!row && row.id !== exceptId;
}

export async function createPronunciation(input: PronunciationInput): Promise<Pronunciation> {
  const values = validatePronunciation(input);
  if (await duplicate(values)) {
    throw new InvalidVoiceInputError(
      "That term already has a respelling for this language and scope.",
    );
  }
  const [row] = await insertReturning(db, pronunciations, values);
  return row;
}

/** An edit sends the row back to `proposed`: a changed respelling needs a new listen. */
export async function updatePronunciation(
  id: number,
  input: PronunciationInput,
): Promise<Pronunciation | null> {
  const values = validatePronunciation(input);
  if (await duplicate(values, id)) {
    throw new InvalidVoiceInputError(
      "That term already has a respelling for this language and scope.",
    );
  }
  const [row] = await updateReturning(
    db,
    pronunciations,
    {
      ...values,
      reviewStatus: "proposed",
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: new Date(),
    },
    eq(pronunciations.id, id),
  );
  return row ?? null;
}

export async function reviewPronunciation(
  id: number,
  status: LexiconReviewStatus,
  reviewer: string | null,
): Promise<boolean> {
  if (!LEXICON_REVIEW_STATUSES.includes(status))
    throw new InvalidVoiceInputError("Unknown review status.");
  const who = clean(reviewer);
  if (status !== "proposed" && !who) throw new InvalidVoiceInputError("Name the reviewer.");
  const rows = await updateReturning(
    db,
    pronunciations,
    {
      reviewStatus: status,
      reviewedBy: status === "proposed" ? null : who,
      reviewedAt: status === "proposed" ? null : new Date(),
      updatedAt: new Date(),
    },
    eq(pronunciations.id, id),
    { id: pronunciations.id },
  );
  return rows.length > 0;
}

export async function deletePronunciation(id: number): Promise<boolean> {
  const rows = await deleteReturning(db, pronunciations, eq(pronunciations.id, id), {
    id: pronunciations.id,
  });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// takes
// ---------------------------------------------------------------------------

export type TakeKey = {
  ownerKind: NarrationOwnerKind;
  ownerRef: string;
  sceneRef?: string | null;
  language?: string | null;
  speaker?: string | null;
};

function nullableEq<T extends SQL | undefined>(
  col: Parameters<typeof eq>[0],
  value: string | null | undefined,
): T {
  return (value ? eq(col, value) : isNull(col)) as T;
}

export function takeKeyWhere(key: TakeKey): SQL {
  const conds: SQL[] = [
    eq(narrations.ownerKind, key.ownerKind),
    eq(narrations.ownerRef, key.ownerRef),
    nullableEq(narrations.sceneRef, key.sceneRef),
    nullableEq(narrations.speaker, key.speaker),
  ];
  if (key.language) conds.push(eq(narrations.language, key.language));
  return and(...conds)!;
}

export type TakeRow = Narration & {
  profileName: string | null;
  masterPath: string | null;
  playbackPath: string | null;
};

const takeColumns = {
  narration: narrations,
  profileName: voiceProfiles.name,
};

async function withPaths(
  rows: Array<{ narration: Narration; profileName: string | null }>,
): Promise<TakeRow[]> {
  const ids = [
    ...new Set(
      rows
        .flatMap((r) => [r.narration.masterAssetId, r.narration.playbackAssetId])
        .filter((x): x is number => !!x),
    ),
  ];
  const paths = new Map<number, string | null>();
  if (ids.length) {
    const found = await db
      .select({ id: assets.id, localPath: assets.localPath })
      .from(assets)
      .where(inArray(assets.id, ids));
    for (const a of found) paths.set(a.id, a.localPath);
  }
  return rows.map((r) => ({
    ...r.narration,
    profileName: r.profileName,
    masterPath: r.narration.masterAssetId ? (paths.get(r.narration.masterAssetId) ?? null) : null,
    playbackPath: r.narration.playbackAssetId
      ? (paths.get(r.narration.playbackAssetId) ?? null)
      : null,
  }));
}

/** Every take of one line, newest first. */
export async function listTakes(key: TakeKey, limit = 100): Promise<TakeRow[]> {
  const rows = await db
    .select(takeColumns)
    .from(narrations)
    .leftJoin(voiceProfiles, eq(voiceProfiles.id, narrations.voiceProfileId))
    .where(takeKeyWhere(key))
    .orderBy(desc(narrations.createdAt), desc(narrations.id))
    .limit(limit);
  return withPaths(rows);
}

export async function getNarration(id: number): Promise<Narration | null> {
  const [row] = await db.select().from(narrations).where(eq(narrations.id, id)).limit(1);
  return row ?? null;
}

/** Voice-gate runs, newest first: `{ ownerRef, takes }` per run. */
export async function listVoiceTests(
  limitRuns = 10,
): Promise<Array<{ ownerRef: string; takes: TakeRow[] }>> {
  const refs = await db
    .select({ ownerRef: narrations.ownerRef, latest: sql<Date>`max(${narrations.createdAt})` })
    .from(narrations)
    .where(eq(narrations.ownerKind, "voice_test"))
    .groupBy(narrations.ownerRef)
    .orderBy(desc(sql`max(${narrations.createdAt})`))
    .limit(limitRuns);
  if (!refs.length) return [];
  const rows = await db
    .select(takeColumns)
    .from(narrations)
    .leftJoin(voiceProfiles, eq(voiceProfiles.id, narrations.voiceProfileId))
    .where(
      and(
        eq(narrations.ownerKind, "voice_test"),
        inArray(
          narrations.ownerRef,
          refs.map((r) => r.ownerRef),
        ),
      ),
    )
    .orderBy(narrations.id);
  const takes = await withPaths(rows);
  return refs.map((r) => ({
    ownerRef: r.ownerRef,
    takes: takes.filter((t) => t.ownerRef === r.ownerRef),
  }));
}

/** Takes made for a pronunciation preview (`free`, `pronunciation:<id>`), newest first. */
export async function listPreviewTakes(pronunciationId: number): Promise<TakeRow[]> {
  const rows = await db
    .select(takeColumns)
    .from(narrations)
    .leftJoin(voiceProfiles, eq(voiceProfiles.id, narrations.voiceProfileId))
    .where(
      and(
        eq(narrations.ownerKind, "free"),
        eq(narrations.ownerRef, `pronunciation:${pronunciationId}`),
        or(isNull(narrations.error), eq(narrations.status, "done")),
      ),
    )
    .orderBy(desc(narrations.id))
    .limit(4);
  return withPaths(rows);
}
