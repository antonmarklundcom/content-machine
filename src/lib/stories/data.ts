/**
 * Reads for the story studio (build 4 §3.C.8): stories, scenes, the take
 * history of a story, its renders, and the voice profiles it may use.
 */
import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import { db } from "@/db";
import {
  assets,
  narrations,
  stories,
  storyScenes,
  videoRenders,
  voiceProfiles,
  type Narration,
  type Story,
  type StoryScene,
  type VideoRender,
  type VoiceProfile,
} from "@/db/schema";
import { readSceneMeta } from "./meta";
import { sceneAudioFresh, sceneReadiness, type SceneReadiness } from "./readiness";
import { voiceLanguageFor } from "./rules";

export const storyOwnerRef = (slug: string) => `story:${slug}`;

export type TakeRow = Narration & {
  masterPath: string | null;
  playbackPath: string | null;
  profileKey: string | null;
  profileName: string | null;
};

export type RenderRow = VideoRender & {
  videoPath: string | null;
  srtPath: string | null;
  vttPath: string | null;
};

export async function getStory(slug: string): Promise<Story | null> {
  const [row] = await db.select().from(stories).where(eq(stories.slug, slug)).limit(1);
  return row ?? null;
}

export async function listStories(): Promise<Story[]> {
  return db.select().from(stories).orderBy(asc(stories.series), asc(stories.title));
}

export async function listScenes(storyId: number): Promise<StoryScene[]> {
  return db
    .select()
    .from(storyScenes)
    .where(eq(storyScenes.storyId, storyId))
    .orderBy(asc(storyScenes.position), asc(storyScenes.id));
}

export async function getScene(storyId: number, sceneRef: string): Promise<StoryScene | null> {
  const [row] = await db
    .select()
    .from(storyScenes)
    .where(and(eq(storyScenes.storyId, storyId), eq(storyScenes.sceneRef, sceneRef)))
    .limit(1);
  return row ?? null;
}

/** Every take of a story (all scenes, all languages), with file paths and profile names. */
export async function listStoryTakes(slug: string): Promise<TakeRow[]> {
  const master = alias(assets, "master");
  const playback = alias(assets, "playback");
  const rows = await db
    .select({
      n: narrations,
      masterPath: master.localPath,
      playbackPath: playback.localPath,
      profileKey: voiceProfiles.key,
      profileName: voiceProfiles.name,
    })
    .from(narrations)
    .leftJoin(master, eq(master.id, narrations.masterAssetId))
    .leftJoin(playback, eq(playback.id, narrations.playbackAssetId))
    .leftJoin(voiceProfiles, eq(voiceProfiles.id, narrations.voiceProfileId))
    .where(
      and(eq(narrations.ownerKind, "story_scene"), eq(narrations.ownerRef, storyOwnerRef(slug))),
    )
    .orderBy(desc(narrations.createdAt), desc(narrations.id));
  return rows.map((r) => ({
    ...r.n,
    masterPath: r.masterPath,
    playbackPath: r.playbackPath,
    profileKey: r.profileKey,
    profileName: r.profileName,
  }));
}

export async function listStoryRenders(slug: string): Promise<RenderRow[]> {
  const video = alias(assets, "video");
  const srt = alias(assets, "srt");
  const vtt = alias(assets, "vtt");
  const rows = await db
    .select({
      r: videoRenders,
      videoPath: video.localPath,
      srtPath: srt.localPath,
      vttPath: vtt.localPath,
    })
    .from(videoRenders)
    .leftJoin(video, eq(video.id, videoRenders.outputAssetId))
    .leftJoin(srt, eq(srt.id, videoRenders.srtAssetId))
    .leftJoin(vtt, eq(vtt.id, videoRenders.vttAssetId))
    .where(and(eq(videoRenders.ownerKind, "story"), eq(videoRenders.ownerRef, storyOwnerRef(slug))))
    .orderBy(desc(videoRenders.createdAt), desc(videoRenders.id));
  return rows.map((x) => ({
    ...x.r,
    videoPath: x.videoPath,
    srtPath: x.srtPath,
    vttPath: x.vttPath,
  }));
}

export async function listActiveProfiles(): Promise<VoiceProfile[]> {
  return db
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.active, true))
    .orderBy(asc(voiceProfiles.id));
}

/** Narrator profiles for a story language: role narrator, the language listed, no character key. */
export function narratorProfilesFor(profiles: VoiceProfile[], lang: string): VoiceProfile[] {
  const voiceLang = voiceLanguageFor(lang);
  return profiles.filter(
    (p) =>
      p.active &&
      p.role === "narrator" &&
      !p.characterKey &&
      voiceLang !== null &&
      p.languages.includes(voiceLang),
  );
}

/** The character's own voice, when one is on file. */
export function characterProfileFor(
  profiles: VoiceProfile[],
  speaker: string,
): VoiceProfile | null {
  const key = speaker.trim().toLowerCase();
  return (
    profiles.find((p) => p.active && (p.characterKey ?? "").trim().toLowerCase() === key) ?? null
  );
}

export type LanguageReadiness = {
  lang: string;
  scenes: number;
  textApproved: number;
  takesSelected: number;
  audioBuilt: number;
  latestRender: RenderRow | null;
};

/** Per-language counts for the library: text approved n/N, takes selected n/N, latest render. */
export function storyReadiness(
  story: Story,
  scenes: StoryScene[],
  takes: TakeRow[],
  renders: RenderRow[],
): LanguageReadiness[] {
  return story.languages.map((lang) => {
    let textApproved = 0;
    let takesSelected = 0;
    let audioBuilt = 0;
    for (const scene of scenes) {
      const r: SceneReadiness = sceneReadiness(scene, lang, takes);
      if (r.text.ok) textApproved++;
      if (r.takesReady) takesSelected++;
      if (sceneAudioFresh(readSceneMeta(scene.notes).audio?.[lang], r)) audioBuilt++;
    }
    const voiceLang = voiceLanguageFor(lang) ?? lang;
    return {
      lang,
      scenes: scenes.length,
      textApproved,
      takesSelected,
      audioBuilt,
      latestRender: renders.find((r) => r.language === voiceLang) ?? null,
    };
  });
}
