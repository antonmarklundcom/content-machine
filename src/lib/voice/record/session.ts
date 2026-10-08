/**
 * Server half of the recording studio (build 5 §3.B, docs/RECORDING.md): the
 * sources a session can read, the speaker profiles that may record, one
 * session's lines with progress and resume point, and minutes recorded per
 * language and profile.
 */
import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { narrations, voiceProfiles, type VoiceProfile } from "@/db/schema";
import { getScript, listScripts } from "@/lib/bridge/scripts";
import { isScriptBodyV1 } from "@/lib/scripts/contract";
import { getStory, listScenes, listStories } from "@/lib/stories/data";
import { scriptBlocks } from "@/lib/video/script-blocks";
import { NarrationRefusedError, type VoiceLanguage } from "@/lib/voice/contract";
import { assertConsent, assertLanguage } from "@/lib/voice/refusals";

import {
  buildScriptLines,
  buildStoryLines,
  recordVoiceLanguage,
  type RecordLine,
  type RecordSource,
} from "./lines";
import { lineStates, sessionProgress, type LineState, type SessionProgress } from "./resume";

export type SourceOption = { key: string; label: string; kind: "story" | "script" };

/** Every story language and every studio script, as `<select>` options. */
export async function listRecordSources(): Promise<SourceOption[]> {
  const [stories, scripts] = await Promise.all([listStories(), listScripts({ limit: 200 })]);
  const out: SourceOption[] = [];
  for (const s of stories) {
    for (const lang of s.languages) {
      out.push({ key: `story:${s.slug}:${lang}`, label: `${s.title} — ${lang}`, kind: "story" });
    }
  }
  for (const s of scripts) {
    out.push({
      key: `script:${s.id}`,
      label: `#${s.id} ${s.title} — ${s.language} (${s.status})`,
      kind: "script",
    });
  }
  return out;
}

/**
 * Profiles a person can record under: active, and either `manual` or a voice
 * that is a real person (consent on record). Consent itself is enforced by
 * `importRecording`; the page also shows the refusal up front.
 */
export async function listSpeakerProfiles(): Promise<VoiceProfile[]> {
  const rows = await db
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.active, true))
    .orderBy(asc(voiceProfiles.name), asc(voiceProfiles.id));
  return rows.filter((p) => p.provider === "manual" || p.consentStatus !== "not_needed");
}

/** What `importRecording` will say about this profile and language, before anything is recorded. */
export function profileRefusal(profile: VoiceProfile, language: VoiceLanguage): string | null {
  try {
    if (!profile.active) {
      return `Voice “${profile.name}” is switched off. Turn it on in Voice profiles first.`;
    }
    assertLanguage({ ...profile, provider: "manual" }, language);
    assertConsent(profile);
    return null;
  } catch (error) {
    if (error instanceof NarrationRefusedError) return error.message;
    throw error;
  }
}

export type ResolvedSource = {
  source: RecordSource;
  title: string;
  voiceLanguage: VoiceLanguage;
  ownerKind: RecordLine["ownerKind"];
  ownerRef: string;
  /** `story:<slug>` / `brand:<id>` — pronunciation scope, as the other studios pass it. */
  pronunciationScope: string;
  lines: RecordLine[];
};

/** The source's lines, built from the database exactly as the upload route rebuilds them. */
export async function resolveSource(source: RecordSource): Promise<ResolvedSource | null> {
  if (source.kind === "story") {
    const story = await getStory(source.slug);
    if (!story) return null;
    const voiceLanguage = recordVoiceLanguage(source);
    if (!voiceLanguage) return null;
    const scenes = await listScenes(story.id);
    return {
      source,
      title: story.title,
      voiceLanguage,
      ownerKind: "story_scene",
      ownerRef: `story:${story.slug}`,
      pronunciationScope: `story:${story.slug}`,
      lines: buildStoryLines(story.slug, scenes, source.lang),
    };
  }
  const script = await getScript(source.scriptId);
  if (!script) return null;
  const voiceLanguage = recordVoiceLanguage(source, script.language);
  if (!voiceLanguage) return null;
  const blocks = isScriptBodyV1(script.body) ? scriptBlocks({ ...script, body: script.body }) : [];
  return {
    source,
    title: script.title,
    voiceLanguage,
    ownerKind: "script",
    ownerRef: `script:${script.id}`,
    pronunciationScope: `brand:${script.brandId}`,
    lines: buildScriptLines(script.id, blocks),
  };
}

/** Every take on the source's slots in its language (anyone's: "selected" needs them all). */
export async function sourceTakes(resolved: ResolvedSource) {
  return db
    .select({
      id: narrations.id,
      ownerKind: narrations.ownerKind,
      ownerRef: narrations.ownerRef,
      sceneRef: narrations.sceneRef,
      language: narrations.language,
      voiceProfileId: narrations.voiceProfileId,
      speaker: narrations.speaker,
      provider: narrations.provider,
      status: narrations.status,
      inputText: narrations.inputText,
      reviewStatus: narrations.reviewStatus,
      selected: narrations.selected,
      durationMs: narrations.durationMs,
    })
    .from(narrations)
    .where(
      and(
        eq(narrations.ownerKind, resolved.ownerKind),
        eq(narrations.ownerRef, resolved.ownerRef),
        eq(narrations.language, resolved.voiceLanguage),
      ),
    )
    .orderBy(desc(narrations.id));
}

export type RecordSession = {
  sourceKey: string;
  title: string;
  voiceLanguage: VoiceLanguage;
  profile: { id: number; name: string; key: string };
  /** `importRecording`'s refusal for this profile and language, shown before recording. */
  refusal: string | null;
  lines: LineState[];
  progress: SessionProgress;
};

/** One session: the source's lines, what this profile recorded, and where to resume. */
export async function loadRecordSession(
  source: RecordSource,
  sourceKey: string,
  profile: VoiceProfile,
): Promise<RecordSession | null> {
  const resolved = await resolveSource(source);
  if (!resolved) return null;
  const takes = await sourceTakes(resolved);
  const states = lineStates(resolved.lines, takes, profile.id, resolved.voiceLanguage);
  return {
    sourceKey,
    title: resolved.title,
    voiceLanguage: resolved.voiceLanguage,
    profile: { id: profile.id, name: profile.name, key: profile.key },
    refusal: profileRefusal(profile, resolved.voiceLanguage),
    lines: states,
    progress: sessionProgress(states),
  };
}

export type MinutesRow = {
  language: string;
  voiceProfileId: number | null;
  profileName: string | null;
  takes: number;
  ms: number;
};

/** Minutes of finished, not-rejected recordings per language and profile (the dataset's size). */
export async function recordingMinutes(profileIds?: number[]): Promise<MinutesRow[]> {
  const where = and(
    eq(narrations.provider, "manual"),
    eq(narrations.status, "done"),
    sql`${narrations.reviewStatus} <> 'rejected'`,
    profileIds?.length ? inArray(narrations.voiceProfileId, profileIds) : undefined,
  );
  const rows = await db
    .select({
      language: narrations.language,
      voiceProfileId: narrations.voiceProfileId,
      profileName: voiceProfiles.name,
      takes: sql<number>`count(*)`.mapWith(Number),
      ms: sql<number>`coalesce(sum(${narrations.durationMs}), 0)`.mapWith(Number),
    })
    .from(narrations)
    .leftJoin(voiceProfiles, eq(voiceProfiles.id, narrations.voiceProfileId))
    .where(where)
    .groupBy(narrations.language, narrations.voiceProfileId, voiceProfiles.name)
    .orderBy(narrations.language, voiceProfiles.name);
  return rows.map((r) => ({ ...r, takes: Number(r.takes), ms: Number(r.ms) }));
}
