import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { assets, narrations, voiceProfiles, type VoiceProfile } from "@/db/schema";

import { selectClips, type DatasetCandidate } from "./select";

/** Every take of one voice profile in one language, with its WAV master's path. */
export async function loadCandidates(
  voiceProfileId: number,
  language: string,
): Promise<DatasetCandidate[]> {
  const rows = await db
    .select({
      id: narrations.id,
      ownerKind: narrations.ownerKind,
      ownerRef: narrations.ownerRef,
      sceneRef: narrations.sceneRef,
      speaker: narrations.speaker,
      provider: narrations.provider,
      status: narrations.status,
      reviewStatus: narrations.reviewStatus,
      selected: narrations.selected,
      durationMs: narrations.durationMs,
      inputText: narrations.inputText,
      createdAt: narrations.createdAt,
      masterPath: assets.localPath,
    })
    .from(narrations)
    .leftJoin(assets, eq(assets.id, narrations.masterAssetId))
    .where(and(eq(narrations.voiceProfileId, voiceProfileId), eq(narrations.language, language)));
  return rows;
}

export type DatasetOverviewRow = {
  profileId: number;
  profileKey: string;
  profileName: string;
  consentStatus: VoiceProfile["consentStatus"];
  language: string;
  approvedClips: number;
  approvedSeconds: number;
  unreviewed: number;
  excluded: number;
};

/** Per profile × language (languages that have takes, plus the profile's own): what an export would hold. */
export async function datasetOverview(): Promise<DatasetOverviewRow[]> {
  const profiles = await db.select().from(voiceProfiles).orderBy(voiceProfiles.name);
  const langRows = await db
    .select({ profileId: narrations.voiceProfileId, language: narrations.language })
    .from(narrations)
    .where(sql`${narrations.voiceProfileId} is not null`)
    .groupBy(narrations.voiceProfileId, narrations.language);
  const out: DatasetOverviewRow[] = [];
  for (const p of profiles) {
    const languages = new Set(langRows.filter((r) => r.profileId === p.id).map((r) => r.language));
    if (p.provider === "manual") for (const l of p.languages) languages.add(l);
    for (const language of [...languages].sort()) {
      const candidates = await loadCandidates(p.id, language);
      const sel = selectClips(candidates);
      out.push({
        profileId: p.id,
        profileKey: p.key,
        profileName: p.name,
        consentStatus: p.consentStatus,
        language,
        approvedClips: sel.clips.length,
        approvedSeconds: sel.clips.reduce((s, c) => s + (c.durationMs ?? 0) / 1000, 0),
        unreviewed: candidates.filter(
          (c) => c.status === "done" && c.provider === "manual" && c.reviewStatus === "unreviewed",
        ).length,
        excluded: sel.excluded.length,
      });
    }
  }
  return out;
}
